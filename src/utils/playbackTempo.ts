import { PlaybackTempoEvent } from '../types/piano';

export const FALLBACK_SCORE_BPM = 100;
export const PLAYBACK_SPEED_DEFAULT = 1;
export const PLAYBACK_SPEED_MIN = 0.5;
export const PLAYBACK_SPEED_MAX = 2;
export const PLAYBACK_SPEED_STEP = 0.05;

export const normalizePlaybackSpeedMultiplier = (value: unknown): number => {
  const numericValue = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(numericValue)) return PLAYBACK_SPEED_DEFAULT;
  const clamped = Math.max(PLAYBACK_SPEED_MIN, Math.min(PLAYBACK_SPEED_MAX, numericValue));
  return Math.round(clamped * 100) / 100;
};

export const formatTempoLabel = (tempoEvents: PlaybackTempoEvent[] | undefined): string => {
  const bpms = Array.from(new Set((tempoEvents ?? [])
    .map((event) => event.bpm)
    .filter((bpm) => Number.isFinite(bpm) && bpm > 0)
    .map((bpm) => Math.round(bpm))
  )).sort((left, right) => left - right);

  if (bpms.length === 0) return `${FALLBACK_SCORE_BPM} BPM`;
  if (bpms.length === 1) return `${bpms[0]} BPM`;
  return `${bpms[0]}-${bpms[bpms.length - 1]} BPM`;
};

const getTempoIndexAtTick = (tempoEvents: PlaybackTempoEvent[], tick: number): number => {
  let index = 0;
  for (let nextIndex = 1; nextIndex < tempoEvents.length; nextIndex += 1) {
    if (tempoEvents[nextIndex].tick > tick) break;
    index = nextIndex;
  }
  return index;
};

export const advanceTickByElapsedMs = (
  startTick: number,
  elapsedMs: number,
  tempoEvents: PlaybackTempoEvent[],
  ppq: number,
  speedMultiplier: number
): number => {
  if (elapsedMs <= 0) return startTick;
  const safePpq = Number.isFinite(ppq) && ppq > 0 ? ppq : 480;
  const safeSpeed = normalizePlaybackSpeedMultiplier(speedMultiplier);
  const sortedTempoEvents = tempoEvents.length > 0
    ? [...tempoEvents].sort((left, right) => left.tick - right.tick)
    : [{ tick: 0, bpm: FALLBACK_SCORE_BPM }];

  let remainingMs = elapsedMs;
  let tick = startTick;
  let tempoIndex = getTempoIndexAtTick(sortedTempoEvents, startTick);

  while (remainingMs > 0) {
    const tempo = sortedTempoEvents[tempoIndex] ?? sortedTempoEvents[sortedTempoEvents.length - 1];
    const ticksPerMs = (tempo.bpm * safeSpeed * safePpq) / 60000;
    if (!Number.isFinite(ticksPerMs) || ticksPerMs <= 0) return tick;

    const nextTempo = sortedTempoEvents[tempoIndex + 1];
    if (!nextTempo || nextTempo.tick <= tick) {
      return tick + remainingMs * ticksPerMs;
    }

    const ticksUntilNextTempo = nextTempo.tick - tick;
    const msUntilNextTempo = ticksUntilNextTempo / ticksPerMs;
    if (remainingMs < msUntilNextTempo) {
      return tick + remainingMs * ticksPerMs;
    }

    remainingMs -= msUntilNextTempo;
    tick = nextTempo.tick;
    tempoIndex += 1;
  }

  return tick;
};
