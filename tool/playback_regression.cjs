const { chromium } = require('playwright');

const APP_URL = process.env.APP_URL || 'http://127.0.0.1:5173/Interactive-Score-Piano/';

const isGreen = (value) => typeof value === 'string' &&
  (value.includes('#4caf50') || value.includes('rgb(76, 175, 80)') || value.includes('76, 175, 80'));

const getGreenScoreNoteheadMidis = async (page) => page.locator('svg path[data-midi], svg ellipse[data-midi]').evaluateAll((elements) =>
  elements.filter((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.y < 230 || rect.y > window.innerHeight - 170) return false;
    const computed = window.getComputedStyle(element);
    return [
      element.getAttribute('fill'),
      element.getAttribute('stroke'),
      element.style?.fill,
      element.style?.stroke,
      computed.fill,
      computed.stroke,
    ].some((value) => typeof value === 'string' &&
      (value.includes('#4caf50') || value.includes('rgb(76, 175, 80)') || value.includes('76, 175, 80'))
    );
  }).map((element) => Number(element.getAttribute('data-midi'))).filter(Number.isFinite)
);

const countGreenScoreElements = async (page) => (await getGreenScoreNoteheadMidis(page)).length;

const getGreenKeyboardMidis = async (page) => page.locator('[data-testid="piano-key"][data-midi]').evaluateAll((elements) =>
  elements.filter((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.y < window.innerHeight - 170) return false;
    const computed = window.getComputedStyle(element);
    return [element.getAttribute('fill'), element.style?.fill, computed.fill].some((value) =>
      typeof value === 'string' &&
      (value.includes('#4caf50') || value.includes('rgb(76, 175, 80)') || value.includes('76, 175, 80'))
    );
  }).map((element) => Number(element.getAttribute('data-midi'))).filter(Number.isFinite)
);

const countGreenKeyboardKeys = async (page) => (await getGreenKeyboardMidis(page)).length;

const countRangeRects = async (page) => page.locator('[data-testid="score-range-overlay"]').evaluateAll((elements) =>
  elements.filter((element) => {
    const rect = element.getBoundingClientRect();
    if (rect.y < 230 || rect.y > window.innerHeight - 170) return false;
    const fill = element.getAttribute('fill') || element.style?.fill || window.getComputedStyle(element).fill;
    const stroke = element.getAttribute('stroke') || element.style?.stroke || window.getComputedStyle(element).stroke;
    return [fill, stroke].some((value) =>
      typeof value === 'string' &&
      (value.includes('rgba(76, 175, 80') || value.includes('rgb(76, 175, 80)') || value.includes('76, 175, 80'))
    );
  }).length
);

const dragScoreRange = async (page, points, endX = points.endX, afterCommitDelayMs = 1000) => {
  await page.mouse.move(points.startX, points.y);
  await page.mouse.down();
  await page.mouse.move((points.startX + endX) / 2, points.y, { steps: 8 });
  await page.mouse.move(endX, points.y, { steps: 8 });
  await page.waitForTimeout(250);
  const duringRange = await countRangeRects(page);
  await page.mouse.up();
  await page.waitForTimeout(afterCommitDelayMs);
  const afterRange = await countRangeRects(page);
  return { duringRange, afterRange };
};

const observePlaybackLoop = async (page) => {
  let greenEdges = 0;
  let sawClear = true;
  let maxGreenScore = 0;
  let maxGreenKeyboard = 0;
  let greenScoreMidis = [];
  let greenKeyboardMidis = [];
  const deadline = Date.now() + 6500;

  while (Date.now() < deadline) {
    const nextScoreMidis = await getGreenScoreNoteheadMidis(page);
    const nextKeyboardMidis = await getGreenKeyboardMidis(page);
    const hasMatchingGreen = nextScoreMidis.length > 0 &&
      nextKeyboardMidis.some((midi) => nextScoreMidis.includes(midi));

    if (nextScoreMidis.length > maxGreenScore) {
      greenScoreMidis = nextScoreMidis;
      maxGreenScore = nextScoreMidis.length;
    }
    if (nextKeyboardMidis.length > maxGreenKeyboard) {
      greenKeyboardMidis = nextKeyboardMidis;
      maxGreenKeyboard = nextKeyboardMidis.length;
    }
    if (hasMatchingGreen && sawClear) {
      greenEdges += 1;
      sawClear = false;
    }
    if (nextScoreMidis.length === 0 && nextKeyboardMidis.length === 0) {
      sawClear = true;
    }
    if (greenEdges >= 2) break;
    await page.waitForTimeout(75);
  }

  return { greenEdges, maxGreenScore, maxGreenKeyboard, greenScoreMidis, greenKeyboardMidis };
};

const getScoreDragPoints = async (page) => page.locator('path, ellipse').evaluateAll((elements) => {
  const candidates = elements.map((element) => {
    const rect = element.getBoundingClientRect();
    return {
      x: rect.x,
      y: rect.y,
      width: rect.width,
      height: rect.height,
    };
  }).filter((rect) =>
    rect.x > 30 &&
    rect.x < window.innerWidth - 30 &&
    rect.y > 230 &&
    rect.y < window.innerHeight - 170 &&
    rect.width > 0 &&
    rect.height > 0
  );

  if (candidates.length === 0) {
    throw new Error('No score notehead candidates found.');
  }

  const byY = new Map();
  for (const rect of candidates) {
    const key = Math.round(rect.y / 50) * 50;
    const group = byY.get(key) || [];
    group.push(rect);
    byY.set(key, group);
  }
  const groups = Array.from(byY.values()).sort((left, right) => right.length - left.length);
  const noteBounds = groups[0] || candidates;
  const minX = Math.min(...noteBounds.map((rect) => rect.x));
  const maxX = Math.max(...noteBounds.map((rect) => rect.x + rect.width));
  const minY = Math.min(...noteBounds.map((rect) => rect.y));
  const maxY = Math.max(...noteBounds.map((rect) => rect.y + rect.height));

  return {
    startX: minX + 12,
    endX: Math.min(maxX - 12, minX + 260),
    y: minY + (maxY - minY) / 2,
  };
});

const waitForScore = async (page) => {
  await page.waitForFunction(() => {
    return Array.from(document.querySelectorAll('path, ellipse')).some((element) => {
      const rect = element.getBoundingClientRect();
      return rect.x > 30 && rect.y > 230 && rect.y < window.innerHeight - 170 && rect.width > 0 && rect.height > 0;
    });
  }, { timeout: 30000 });
};

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  const logs = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error' || msg.type() === 'warning') logs.push(`${msg.type()}: ${msg.text()}`);
  });
  await page.addInitScript(() => {
    window.localStorage.clear();
  });

  await page.goto(APP_URL, { waitUntil: 'networkidle' });
  await waitForScore(page);
  await page.waitForTimeout(1200);

  const points = await getScoreDragPoints(page);
  const { duringRange, afterRange } = await dragScoreRange(page, points);

  let maxGreenScore = await countGreenScoreElements(page);
  let maxGreenKeyboard = await countGreenKeyboardKeys(page);
  let greenScoreMidis = await getGreenScoreNoteheadMidis(page);
  let greenKeyboardMidis = await getGreenKeyboardMidis(page);
  for (let index = 0; index < 40; index += 1) {
    await page.waitForTimeout(150);
    const nextScoreMidis = await getGreenScoreNoteheadMidis(page);
    const nextKeyboardMidis = await getGreenKeyboardMidis(page);
    if (nextScoreMidis.length > maxGreenScore) {
      greenScoreMidis = nextScoreMidis;
      maxGreenScore = nextScoreMidis.length;
    }
    if (nextKeyboardMidis.length > maxGreenKeyboard) {
      greenKeyboardMidis = nextKeyboardMidis;
      maxGreenKeyboard = nextKeyboardMidis.length;
    }
    if (maxGreenScore > 0 && maxGreenKeyboard > 0) break;
  }

  const stopButtonDisabled = await page.getByLabel('Stop simple playback').isDisabled();
  if (!stopButtonDisabled) {
    await page.getByLabel('Stop simple playback').click();
  }
  await page.waitForTimeout(500);
  const greenAfterStop = await countGreenScoreElements(page) + await countGreenKeyboardKeys(page);

  const nonLoopPoints = await getScoreDragPoints(page);
  const nonLoopEndX = Math.min(nonLoopPoints.endX, nonLoopPoints.startX + 90);
  const nonLoopRange = await dragScoreRange(page, nonLoopPoints, nonLoopEndX, 150);
  let nonLoopStoppedAtEnd = false;
  try {
    await page.waitForFunction(() => {
      const stopButton = document.querySelector('button[aria-label="Stop simple playback"]');
      return stopButton instanceof HTMLButtonElement && stopButton.disabled;
    }, { timeout: 4500 });
    nonLoopStoppedAtEnd = true;
  } catch {
    nonLoopStoppedAtEnd = false;
  }
  const nonLoopGreenAfterEnd = await countGreenScoreElements(page) + await countGreenKeyboardKeys(page);

  await page.getByTestId('playback-loop-toggle').click();
  const loopPoints = await getScoreDragPoints(page);
  const loopEndX = Math.min(loopPoints.endX, loopPoints.startX + 90);
  const loopRange = await dragScoreRange(page, loopPoints, loopEndX);
  const loopObservation = await observePlaybackLoop(page);
  const loopRangeAfterObservation = await countRangeRects(page);
  await page.getByLabel('Stop simple playback').click();
  await page.waitForTimeout(500);
  const loopGreenAfterStop = await countGreenScoreElements(page) + await countGreenKeyboardKeys(page);
  const loopRangeAfterStop = await countRangeRects(page);

  const result = {
    duringRange,
    afterRange,
    maxGreenScore,
    maxGreenKeyboard,
    greenScoreMidis,
    greenKeyboardMidis,
    greenAfterStop,
    nonLoopRange,
    nonLoopStoppedAtEnd,
    nonLoopGreenAfterEnd,
    loopRange,
    loopObservation,
    loopRangeAfterObservation,
    loopGreenAfterStop,
    loopRangeAfterStop,
    logs,
  };
  console.log(JSON.stringify(result, null, 2));

  if (duringRange <= 0) throw new Error('Expected green range overlay while dragging.');
  if (afterRange <= 0) throw new Error('Expected green range overlay after range commit.');
  if (maxGreenScore <= 0) throw new Error('Expected green score notehead during playback.');
  if (maxGreenKeyboard <= 0) throw new Error('Expected green keyboard key during playback.');
  if (!greenKeyboardMidis.some((midi) => greenScoreMidis.includes(midi))) {
    throw new Error(`Expected green score notehead MIDI to match green keyboard MIDI. score=${greenScoreMidis.join(',')} keyboard=${greenKeyboardMidis.join(',')}`);
  }
  if (greenAfterStop !== 0) throw new Error('Expected green score/keyboard highlights to clear after Stop.');
  if (nonLoopRange.duringRange <= 0) throw new Error('Expected green range overlay while dragging in non-loop end check.');
  if (!nonLoopStoppedAtEnd) throw new Error('Expected range playback to stop at end when loop is off.');
  if (nonLoopGreenAfterEnd !== 0) throw new Error('Expected non-loop playback highlights to clear after natural end.');
  if (loopRange.duringRange <= 0) throw new Error('Expected green range overlay while dragging with loop enabled.');
  if (loopRange.afterRange <= 0) throw new Error('Expected green range overlay after loop range commit.');
  if (loopObservation.greenEdges < 2) throw new Error(`Expected playback highlights to recur across loop cycles. edges=${loopObservation.greenEdges}`);
  if (loopObservation.maxGreenScore <= 0) throw new Error('Expected green score notehead during loop playback.');
  if (loopObservation.maxGreenKeyboard <= 0) throw new Error('Expected green keyboard key during loop playback.');
  if (!loopObservation.greenKeyboardMidis.some((midi) => loopObservation.greenScoreMidis.includes(midi))) {
    throw new Error(`Expected loop green score notehead MIDI to match keyboard MIDI. score=${loopObservation.greenScoreMidis.join(',')} keyboard=${loopObservation.greenKeyboardMidis.join(',')}`);
  }
  if (loopRangeAfterObservation <= 0) throw new Error('Expected range overlay to remain while loop playback continues.');
  if (loopGreenAfterStop !== 0) throw new Error('Expected loop score/keyboard highlights to clear after Stop.');
  if (loopRangeAfterStop !== 0) throw new Error('Expected loop range overlay to clear after Stop.');

  await browser.close();
})().catch(async (error) => {
  console.error(error);
  process.exit(1);
});
