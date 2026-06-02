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

const assertSampleTieTimeline = async (page) => {
  const measureTwoEvents = await page.evaluate(async () => {
    const transformedUtils = await fetch('/Interactive-Score-Piano/src/utils/osmdCoordinates.ts').then((response) => response.text());
    const osmdImport = transformedUtils.match(/from\s+["']([^"']*opensheetmusicdisplay[^"']*)["']/)?.[1];
    if (!osmdImport) throw new Error('Could not resolve transformed OSMD import path.');

    const osmdModule = await import(osmdImport);
    const OpenSheetMusicDisplay = osmdModule.OpenSheetMusicDisplay ?? osmdModule.default?.OpenSheetMusicDisplay;
    const { sampleMusicXML } = await import('/Interactive-Score-Piano/src/data/sampleScores.ts');
    const {
      extractMeasureContexts,
      extractPlaybackTimeline,
      extractSourceNoteMidiMap,
      getPixelPerUnit,
    } = await import('/Interactive-Score-Piano/src/utils/osmdCoordinates.ts');

    const host = document.createElement('div');
    host.style.width = '1200px';
    document.body.appendChild(host);
    const osmd = new OpenSheetMusicDisplay(host, {
      backend: 'svg',
      drawTitle: false,
      drawPartNames: false,
      drawSlurs: true,
      drawingParameters: 'compact',
    });
    await osmd.load(sampleMusicXML);
    osmd.render();
    const pixelPerUnit = getPixelPerUnit(osmd, host);
    const contexts = extractMeasureContexts(osmd, pixelPerUnit);
    const timeline = extractPlaybackTimeline(osmd, contexts, extractSourceNoteMidiMap(osmd));
    host.remove();

    return timeline.events
      .filter((event) => event.measureNumber === 2)
      .map((event) => ({
        type: event.type,
        midi: event.sourceMidi,
        tick: event.tick,
        durationTicks: event.durationTicks ?? null,
        noteIdentities: event.noteIdentities ?? [event.noteIdentity],
      }));
  });

  const tiedCNoteOns = measureTwoEvents.filter((event) => event.type === 'note-on' && event.midi === 60);
  const tiedCNoteOffs = measureTwoEvents.filter((event) => event.type === 'note-off' && event.midi === 60);
  if (tiedCNoteOns.length !== 1 || tiedCNoteOffs.length !== 1) {
    throw new Error(`Expected sample tied C to be merged into one note-on/off pair. events=${JSON.stringify(measureTwoEvents)}`);
  }
  if (tiedCNoteOns[0].durationTicks !== tiedCNoteOffs[0].tick - tiedCNoteOns[0].tick) {
    throw new Error(`Expected tied C duration to reach its merged note-off. events=${JSON.stringify(measureTwoEvents)}`);
  }
  if (tiedCNoteOns[0].noteIdentities.length !== 2 || tiedCNoteOffs[0].noteIdentities.length !== 2) {
    throw new Error(`Expected sample tied C playback events to highlight both tied noteheads. events=${JSON.stringify(measureTwoEvents)}`);
  }
};

const tempoChangeMusicXML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>60</per-minute></metronome></direction-type><sound tempo="60"/></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
    <measure number="2">
      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>120</per-minute></metronome></direction-type><sound tempo="120"/></direction>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>B</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;

const noTempoMusicXML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;

const lateSingleTempoMusicXML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>145</per-minute></metronome></direction-type><sound tempo="145"/></direction>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;

const fermataMusicXML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>1</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>60</per-minute></metronome></direction-type><sound tempo="60"/></direction>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type><notations><fermata type="upright">normal</fermata></notations></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
    <measure number="2">
      <direction placement="above"><direction-type><metronome><beat-unit>quarter</beat-unit><per-minute>120</per-minute></metronome></direction-type><sound tempo="120"/></direction>
      <note><pitch><step>G</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>A</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>B</step><octave>4</octave></pitch><duration>1</duration><type>quarter</type></note>
      <note><pitch><step>C</step><octave>5</octave></pitch><duration>1</duration><type>quarter</type></note>
    </measure>
  </part>
</score-partwise>`;

const graceArpeggioMusicXML = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 3.1 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="3.1">
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1">
      <attributes><divisions>4</divisions><key><fifths>0</fifths></key><time><beats>4</beats><beat-type>4</beat-type></time><clef><sign>G</sign><line>2</line></clef></attributes>
      <note><grace slash="yes"/><pitch><step>D</step><octave>4</octave></pitch><type>eighth</type></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>4</duration><type>quarter</type></note>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>8</duration><type>half</type><notations><arpeggiate direction="up"/></notations></note>
      <note><chord/><pitch><step>E</step><octave>4</octave></pitch><duration>8</duration><type>half</type><notations><arpeggiate direction="up"/></notations></note>
      <note><chord/><pitch><step>G</step><octave>4</octave></pitch><duration>8</duration><type>half</type><notations><arpeggiate direction="up"/></notations></note>
    </measure>
  </part>
</score-partwise>`;

const assertTempoMapTimeline = async (page) => {
  const result = await page.evaluate(async ({ tempoChangeMusicXML, noTempoMusicXML, lateSingleTempoMusicXML }) => {
    const transformedUtils = await fetch('/Interactive-Score-Piano/src/utils/osmdCoordinates.ts').then((response) => response.text());
    const osmdImport = transformedUtils.match(/from\s+["']([^"']*opensheetmusicdisplay[^"']*)["']/)?.[1];
    if (!osmdImport) throw new Error('Could not resolve transformed OSMD import path.');

    const osmdModule = await import(osmdImport);
    const OpenSheetMusicDisplay = osmdModule.OpenSheetMusicDisplay ?? osmdModule.default?.OpenSheetMusicDisplay;
    const {
      extractMeasureContexts,
      extractPlaybackTimeline,
      extractSourceNoteMidiMap,
      getPixelPerUnit,
    } = await import('/Interactive-Score-Piano/src/utils/osmdCoordinates.ts');
    const { advanceTickByElapsedMs, formatTempoLabel } = await import('/Interactive-Score-Piano/src/utils/playbackTempo.ts');

    const buildTimeline = async (xml) => {
      const host = document.createElement('div');
      host.style.width = '1200px';
      document.body.appendChild(host);
      const osmd = new OpenSheetMusicDisplay(host, {
        backend: 'svg',
        drawTitle: false,
        drawPartNames: false,
        drawSlurs: true,
        drawingParameters: 'compact',
      });
      await osmd.load(xml);
      osmd.render();
      const pixelPerUnit = getPixelPerUnit(osmd, host);
      const contexts = extractMeasureContexts(osmd, pixelPerUnit);
      const timeline = extractPlaybackTimeline(osmd, contexts, extractSourceNoteMidiMap(osmd));
      host.remove();
      return timeline;
    };

    const tempoTimeline = await buildTimeline(tempoChangeMusicXML);
    const noTempoTimeline = await buildTimeline(noTempoMusicXML);
    const lateSingleTempoTimeline = await buildTimeline(lateSingleTempoMusicXML);
    return {
      tempoEvents: tempoTimeline.tempoEvents,
      noTempoEvents: noTempoTimeline.tempoEvents,
      lateSingleTempoEvents: lateSingleTempoTimeline.tempoEvents,
      lateSingleTempoLabel: formatTempoLabel(lateSingleTempoTimeline.tempoEvents),
      tempoLabel: formatTempoLabel(tempoTimeline.tempoEvents),
      tickAt2500Ms: advanceTickByElapsedMs(0, 2500, tempoTimeline.tempoEvents, tempoTimeline.ppq, 1),
      tickAt2500MsDoubleSpeed: advanceTickByElapsedMs(0, 2500, tempoTimeline.tempoEvents, tempoTimeline.ppq, 2),
    };
  }, { tempoChangeMusicXML, noTempoMusicXML, lateSingleTempoMusicXML });

  const firstTempo = result.tempoEvents.find((event) => event.tick === 0);
  const secondTempo = result.tempoEvents.find((event) => event.tick === 1920);
  if (!firstTempo || firstTempo.bpm !== 60 || !secondTempo || secondTempo.bpm !== 120) {
    throw new Error(`Expected tempo map 0=>60 and 1920=>120. result=${JSON.stringify(result)}`);
  }
  if (result.noTempoEvents.length !== 1 || result.noTempoEvents[0].tick !== 0 || result.noTempoEvents[0].bpm !== 100) {
    throw new Error(`Expected no-tempo score to fall back to 100 BPM. result=${JSON.stringify(result)}`);
  }
  if (!result.lateSingleTempoEvents.some((event) => event.tick === 0 && event.bpm === 145) || result.lateSingleTempoLabel !== '145 BPM') {
    throw new Error(`Expected single detected 145 BPM tempo to be normalized to score start without 100 BPM fallback. result=${JSON.stringify(result)}`);
  }
  if (result.tempoLabel !== '60-120 BPM') {
    throw new Error(`Expected tempo range label. result=${JSON.stringify(result)}`);
  }
  if (Math.abs(result.tickAt2500Ms - 1200) > 2) {
    throw new Error(`Expected 2500ms at 1x to advance to about tick 1200. result=${JSON.stringify(result)}`);
  }
  if (Math.abs(result.tickAt2500MsDoubleSpeed - 2880) > 2) {
    throw new Error(`Expected 2500ms at 2x to advance through the tempo change to about tick 2880. result=${JSON.stringify(result)}`);
  }
};

const assertFermataTimeline = async (page) => {
  const result = await page.evaluate(async ({ fermataMusicXML, noTempoMusicXML }) => {
    const transformedUtils = await fetch('/Interactive-Score-Piano/src/utils/osmdCoordinates.ts').then((response) => response.text());
    const osmdImport = transformedUtils.match(/from\s+["']([^"']*opensheetmusicdisplay[^"']*)["']/)?.[1];
    if (!osmdImport) throw new Error('Could not resolve transformed OSMD import path.');

    const osmdModule = await import(osmdImport);
    const OpenSheetMusicDisplay = osmdModule.OpenSheetMusicDisplay ?? osmdModule.default?.OpenSheetMusicDisplay;
    const { sampleMusicXML } = await import('/Interactive-Score-Piano/src/data/sampleScores.ts');
    const {
      extractMeasureContexts,
      extractPlaybackTimeline,
      extractSourceNoteMidiMap,
      getPixelPerUnit,
    } = await import('/Interactive-Score-Piano/src/utils/osmdCoordinates.ts');

    const buildTimeline = async (xml) => {
      const host = document.createElement('div');
      host.style.width = '1200px';
      document.body.appendChild(host);
      const osmd = new OpenSheetMusicDisplay(host, {
        backend: 'svg',
        drawTitle: false,
        drawPartNames: false,
        drawSlurs: true,
        drawingParameters: 'compact',
      });
      await osmd.load(xml);
      osmd.render();
      const pixelPerUnit = getPixelPerUnit(osmd, host);
      const contexts = extractMeasureContexts(osmd, pixelPerUnit);
      const timeline = extractPlaybackTimeline(osmd, contexts, extractSourceNoteMidiMap(osmd));
      host.remove();
      return timeline;
    };

    const summarizeEvents = (timeline, measureNumber = null) => timeline.events
      .filter((event) => measureNumber === null || event.measureNumber === measureNumber)
      .map((event) => ({
        type: event.type,
        midi: event.sourceMidi,
        tick: event.tick,
        durationTicks: event.durationTicks ?? null,
      }));

    const fermataTimeline = await buildTimeline(fermataMusicXML);
    const noFermataTimeline = await buildTimeline(noTempoMusicXML);
    const sampleTimeline = await buildTimeline(sampleMusicXML);

    return {
      fermataEvents: summarizeEvents(fermataTimeline),
      fermataTempoEvents: fermataTimeline.tempoEvents,
      fermataDurationTicks: fermataTimeline.durationTicks,
      noFermataEvents: summarizeEvents(noFermataTimeline),
      sampleMeasureNineEvents: summarizeEvents(sampleTimeline, 9),
    };
  }, { fermataMusicXML, noTempoMusicXML });

  const cOn = result.fermataEvents.find((event) => event.type === 'note-on' && event.midi === 60);
  const cOff = result.fermataEvents.find((event) => event.type === 'note-off' && event.midi === 60);
  const dOn = result.fermataEvents.find((event) => event.type === 'note-on' && event.midi === 62);
  const shiftedTempo = result.fermataTempoEvents.find((event) => event.bpm === 120);
  if (!cOn || !cOff || cOn.tick !== 0 || cOff.tick !== 720 || cOn.durationTicks !== 720) {
    throw new Error(`Expected fermata C quarter to last 720 ticks. result=${JSON.stringify(result)}`);
  }
  if (!dOn || dOn.tick !== 720) {
    throw new Error(`Expected following D note-on to shift to tick 720. result=${JSON.stringify(result)}`);
  }
  if (!shiftedTempo || shiftedTempo.tick !== 2160) {
    throw new Error(`Expected tempo event after fermata boundary to shift to tick 2160. result=${JSON.stringify(result)}`);
  }
  const plainCOff = result.noFermataEvents.find((event) => event.type === 'note-off' && event.midi === 60);
  const plainDOn = result.noFermataEvents.find((event) => event.type === 'note-on' && event.midi === 62);
  if (!plainCOff || plainCOff.tick !== 480 || !plainDOn || plainDOn.tick !== 480) {
    throw new Error(`Expected non-fermata score timeline to remain unwarped. result=${JSON.stringify(result)}`);
  }
  const sampleCOn = result.sampleMeasureNineEvents.find((event) => event.type === 'note-on' && event.midi === 60);
  const sampleCOff = result.sampleMeasureNineEvents.find((event) => event.type === 'note-off' && event.midi === 60);
  const sampleDOn = result.sampleMeasureNineEvents.find((event) => event.type === 'note-on' && event.midi === 62);
  if (!sampleCOn || !sampleCOff || !sampleDOn || sampleCOff.tick - sampleCOn.tick !== 720 || sampleDOn.tick - sampleCOn.tick !== 720) {
    throw new Error(`Expected sample measure 9 to expose fermata playback timing. result=${JSON.stringify(result)}`);
  }
};

const assertGraceArpeggioTimeline = async (page) => {
  const result = await page.evaluate(async ({ graceArpeggioMusicXML }) => {
    const transformedUtils = await fetch('/Interactive-Score-Piano/src/utils/osmdCoordinates.ts').then((response) => response.text());
    const osmdImport = transformedUtils.match(/from\s+["']([^"']*opensheetmusicdisplay[^"']*)["']/)?.[1];
    if (!osmdImport) throw new Error('Could not resolve transformed OSMD import path.');

    const osmdModule = await import(osmdImport);
    const OpenSheetMusicDisplay = osmdModule.OpenSheetMusicDisplay ?? osmdModule.default?.OpenSheetMusicDisplay;
    const { sampleMusicXML } = await import('/Interactive-Score-Piano/src/data/sampleScores.ts');
    const {
      extractMeasureContexts,
      extractPlaybackTimeline,
      extractSourceNoteMidiMap,
      getPixelPerUnit,
    } = await import('/Interactive-Score-Piano/src/utils/osmdCoordinates.ts');

    const buildTimeline = async (xml) => {
      const host = document.createElement('div');
      host.style.width = '1200px';
      document.body.appendChild(host);
      const osmd = new OpenSheetMusicDisplay(host, {
        backend: 'svg',
        drawTitle: false,
        drawPartNames: false,
        drawSlurs: true,
        drawingParameters: 'compact',
      });
      await osmd.load(xml);
      osmd.render();
      const pixelPerUnit = getPixelPerUnit(osmd, host);
      const contexts = extractMeasureContexts(osmd, pixelPerUnit);
      const timeline = extractPlaybackTimeline(osmd, contexts, extractSourceNoteMidiMap(osmd));
      host.remove();
      return timeline;
    };

    const summarizeEvents = (timeline, measureNumber = null) => timeline.events
      .filter((event) => measureNumber === null || event.measureNumber === measureNumber)
      .map((event) => ({
        type: event.type,
        midi: event.sourceMidi,
        tick: event.tick,
        durationTicks: event.durationTicks ?? null,
      }));

    const graceArpeggioTimeline = await buildTimeline(graceArpeggioMusicXML);
    const sampleTimeline = await buildTimeline(sampleMusicXML);
    return {
      graceArpeggioEvents: summarizeEvents(graceArpeggioTimeline),
      graceArpeggioDurationTicks: graceArpeggioTimeline.durationTicks,
      sampleMeasureTenEvents: summarizeEvents(sampleTimeline, 10),
    };
  }, { graceArpeggioMusicXML });

  const noteOns = result.graceArpeggioEvents.filter((event) => event.type === 'note-on');
  const graceD = noteOns.find((event) => event.midi === 62 && event.durationTicks === 60);
  const mainC = noteOns.find((event) => event.midi === 60 && event.durationTicks === 480);
  const followingD = noteOns.find((event) => event.midi === 62 && event.durationTicks === 480);
  const arpeggioNoteOns = noteOns.filter((event) => [60, 64, 67].includes(event.midi) && (event.durationTicks ?? 0) > 900);
  if (!graceD || graceD.tick !== 0 || !mainC || mainC.tick !== 60 || !followingD || followingD.tick !== 540) {
    throw new Error(`Expected score-start grace note to play before the main note and shift following notes. result=${JSON.stringify(result)}`);
  }
  const arpeggioTicksByMidi = new Map(arpeggioNoteOns.map((event) => [event.midi, event.tick]));
  if (arpeggioTicksByMidi.get(60) !== 1020 || arpeggioTicksByMidi.get(64) !== 1040 || arpeggioTicksByMidi.get(67) !== 1060) {
    throw new Error(`Expected upward arpeggio note-ons to roll in 20-tick steps. result=${JSON.stringify(result)}`);
  }
  if (result.graceArpeggioDurationTicks !== 1980) {
    throw new Error(`Expected grace insertion to extend synthetic timeline to 1980 ticks. result=${JSON.stringify(result)}`);
  }

  const sampleNoteOns = result.sampleMeasureTenEvents.filter((event) => event.type === 'note-on');
  const sampleGrace = sampleNoteOns.find((event) => event.midi === 62 && event.durationTicks === 60);
  const sampleMainC = sampleNoteOns.find((event) => event.midi === 60 && event.durationTicks === 480);
  const sampleArpeggioNoteOns = sampleNoteOns.filter((event) => [60, 64, 67].includes(event.midi) && (event.durationTicks ?? 0) > 900);
  if (!sampleGrace || !sampleMainC || sampleMainC.tick - sampleGrace.tick !== 60) {
    throw new Error(`Expected sample measure 10 to expose grace-note playback timing. result=${JSON.stringify(result)}`);
  }
  const sampleArpeggioTicks = sampleArpeggioNoteOns.map((event) => event.tick).sort((left, right) => left - right);
  if (sampleArpeggioTicks.length !== 3 || sampleArpeggioTicks[1] - sampleArpeggioTicks[0] !== 20 || sampleArpeggioTicks[2] - sampleArpeggioTicks[1] !== 20) {
    throw new Error(`Expected sample measure 10 to expose arpeggio playback timing. result=${JSON.stringify(result)}`);
  }
};

const stopPlaybackIfEnabled = async (page) => {
  const stopButton = page.getByLabel('Stop simple playback');
  if (await stopButton.isDisabled()) return;
  try {
    await stopButton.click({ timeout: 1000 });
  } catch (error) {
    if (!String(error).includes('Timeout') && !String(error).includes('not enabled')) {
      throw error;
    }
  }
};

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
  let firstSignature = null;
  let previousSignature = null;
  let sawDifferentAfterFirst = false;
  let signatureLoops = 0;
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
    const matchingMidis = nextScoreMidis
      .filter((midi) => nextKeyboardMidis.includes(midi))
      .sort((left, right) => left - right);
    const signature = matchingMidis.join(',');

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
    if (hasMatchingGreen && signature !== previousSignature) {
      if (firstSignature === null) {
        firstSignature = signature;
        signatureLoops = 1;
      } else if (signature === firstSignature && sawDifferentAfterFirst) {
        signatureLoops += 1;
        sawDifferentAfterFirst = false;
      } else if (signature !== firstSignature) {
        sawDifferentAfterFirst = true;
      }
      previousSignature = signature;
    }
    if (nextScoreMidis.length === 0 && nextKeyboardMidis.length === 0) {
      sawClear = true;
      previousSignature = null;
    }
    if (Math.max(greenEdges, signatureLoops) >= 2) break;
    await page.waitForTimeout(75);
  }

  return { greenEdges: Math.max(greenEdges, signatureLoops), maxGreenScore, maxGreenKeyboard, greenScoreMidis, greenKeyboardMidis };
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

const assertScoreLayoutIsGlobal = async (page) => {
  await page.getByTestId('settings-button').click();
  await page.getByTestId('score-layout-select').click();
  await page.getByRole('option', { name: 'Compact tight' }).click();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#settings-popover'));

  await page.getByLabel('Score Library').click();
  await page.getByRole('option', { name: 'Sample: Clef Change' }).click();
  await waitForScore(page);

  await page.getByTestId('settings-button').click();
  const layoutTextAfterScoreChange = await page.getByTestId('score-layout-select').innerText();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#settings-popover'));
  if (!layoutTextAfterScoreChange.includes('Compact tight')) {
    throw new Error(`Expected score layout setting to remain global after score change. label=${layoutTextAfterScoreChange}`);
  }

  await page.getByLabel('Score Library').click();
  await page.getByRole('option', { name: 'Sample: Grand Staff' }).click();
  await waitForScore(page);

  await page.getByTestId('settings-button').click();
  await page.getByTestId('score-layout-select').click();
  await page.getByRole('option', { name: 'Compact', exact: true }).click();
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#settings-popover'));
  await waitForScore(page);
  await page.waitForTimeout(1000);
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
  await assertSampleTieTimeline(page);
  await assertTempoMapTimeline(page);
  await assertFermataTimeline(page);
  await assertGraceArpeggioTimeline(page);
  await page.getByTestId('playback-speed-slider').waitFor({ timeout: 5000 });
  const tempoLabelText = await page.getByTestId('playback-tempo-label').innerText();
  if (!tempoLabelText.includes('Score:')) {
    throw new Error(`Expected read-only score tempo label. label=${tempoLabelText}`);
  }
  if (!tempoLabelText.includes('60-120 BPM')) {
    throw new Error(`Expected default sample to expose its 60-120 BPM tempo range. label=${tempoLabelText}`);
  }
  if (await page.getByText('BPM', { exact: true }).count() > 0) {
    throw new Error('Expected BPM control label to be removed.');
  }
  await assertScoreLayoutIsGlobal(page);

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

  await stopPlaybackIfEnabled(page);
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
  const loopEndX = Math.min(loopPoints.endX, loopPoints.startX + 180);
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
