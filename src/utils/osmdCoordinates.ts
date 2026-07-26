import { OpenSheetMusicDisplay, KeyInstruction, ClefInstruction, ClefEnum, ArticulationEnum } from 'opensheetmusicdisplay';
import { ColumnDetail, MeasureContext, ClefType, NoteDetail, PlaybackNoteEvent, PlaybackTempoEvent, PlaybackTimeline } from '../types/piano';
import { FALLBACK_SCORE_BPM } from './playbackTempo';

const PLAYBACK_PPQ = 480;
const OSMD_FERMATA_ARTICULATION_ENUM = 10;
const FERMATA_DURATION_MULTIPLIER = 1.5;
const GRACE_NOTE_DURATION_TICKS = PLAYBACK_PPQ / 8;
const ARPEGGIO_STEP_TICKS = PLAYBACK_PPQ / 24;
const OSMD_ARPEGGIO_TYPE_DOWN = 3;
const GRADUAL_TEMPO_TARGET_RATIO = 0.75;
const GRADUAL_TEMPO_STEP_TICKS = PLAYBACK_PPQ / 4;

type TimelineWarpPoint = {
  boundaryTick: number;
  extraTicks: number;
};

type PlaybackEventMetadata = {
  isGraceNote: boolean;
  graceAnchorTick?: number;
  graceGroupKey?: string;
  arpeggioGroupKey?: string;
  arpeggioDirection?: 'up' | 'down';
};

const fractionToTicks = (fraction: any, ppq: number = PLAYBACK_PPQ): number | null => {
  if (!fraction) return null;

  const realValue = typeof fraction.RealValue === 'number'
    ? fraction.RealValue
    : typeof fraction.realValue === 'number'
      ? fraction.realValue
      : null;

  if (realValue !== null && Number.isFinite(realValue)) {
    return Math.max(0, Math.round(realValue * ppq * 4));
  }

  const whole = typeof fraction.WholeValue === 'number' ? fraction.WholeValue : 0;
  const numerator = typeof fraction.Numerator === 'number' ? fraction.Numerator : 0;
  const denominator = typeof fraction.Denominator === 'number' ? fraction.Denominator : 1;
  if (!Number.isFinite(whole) || !Number.isFinite(numerator) || !Number.isFinite(denominator) || denominator === 0) {
    return null;
  }

  return Math.max(0, Math.round((whole + numerator / denominator) * ppq * 4));
};

const getSourceNoteDurationTicks = (sourceNote: any): number | null => {
  const candidates = [
    sourceNote?.Length,
    sourceNote?.length,
    sourceNote?.TypeLength,
    sourceNote?.typeLength,
  ];

  for (const candidate of candidates) {
    const ticks = fractionToTicks(candidate);
    if (ticks !== null && ticks > 0) return ticks;
  }

  return null;
};

const shouldSkipPlaybackNote = (sourceNote: any): boolean => {
  if (!sourceNote) return true;
  if (typeof sourceNote.isRest === 'function' && sourceNote.isRest()) return true;
  if (sourceNote.IsCueNote || sourceNote.PrintObject === false) return true;
  return false;
};

const isGraceNote = (sourceNote: any): boolean => Boolean(
  sourceNote?.IsGraceNote ||
  sourceNote?.isGraceNote ||
  sourceNote?.ParentVoiceEntry?.isGrace ||
  sourceNote?.ParentVoiceEntry?.IsGrace
);

const getArticulationEnums = (sourceNote: any): Set<number> => {
  const articulations = sourceNote?.ParentVoiceEntry?.Articulations ?? [];
  return new Set(articulations
    .map((articulation: any) => articulation?.articulationEnum)
    .filter((value: unknown): value is number => typeof value === 'number'));
};

const getPlaybackModifiers = (sourceNote: any): { durationMultiplier: number; velocityRatio: number } => {
  const articulations = getArticulationEnums(sourceNote);
  const hasStaccatissimo = articulations.has(ArticulationEnum.staccatissimo);
  const hasStaccato = articulations.has(ArticulationEnum.staccato);
  const hasStrongAccent = articulations.has(ArticulationEnum.strongaccent) ||
    articulations.has(ArticulationEnum.invertedstrongaccent) ||
    articulations.has(ArticulationEnum.marcatoup) ||
    articulations.has(ArticulationEnum.marcatodown);
  const hasAccent = articulations.has(ArticulationEnum.accent);

  let durationMultiplier = 1;
  if (hasStaccatissimo) {
    durationMultiplier = 0.35;
  } else if (hasStaccato) {
    durationMultiplier = 0.5;
  }

  let velocityRatio = 0.8;
  if (hasStrongAccent) {
    velocityRatio = 1.0;
  } else if (hasAccent) {
    velocityRatio = 0.92;
  }

  return { durationMultiplier, velocityRatio };
};

const getFermataArticulationEnum = (): number => {
  const articulationEnum = ArticulationEnum as unknown as Record<string, unknown>;
  const namedValue = articulationEnum.fermata ?? articulationEnum.Fermata;
  return typeof namedValue === 'number' ? namedValue : OSMD_FERMATA_ARTICULATION_ENUM;
};

const hasFermata = (sourceNote: any): boolean => {
  return getArticulationEnums(sourceNote).has(getFermataArticulationEnum());
};

const getTieGroupNotes = (sourceNote: any): any[] => {
  const tieNotes = sourceNote?.NoteTie?.notes;
  if (!Array.isArray(tieNotes) || tieNotes.length <= 1) return [sourceNote];
  return tieNotes.filter((note) => note && !shouldSkipPlaybackNote(note));
};

const getSourceNoteStartTicks = (sourceNote: any, fallbackTicks: number): number => {
  return fractionToTicks(sourceNote?.getAbsoluteTimestamp?.()) ??
    fractionToTicks(sourceNote?.ParentStaffEntry?.getAbsoluteTimestamp?.()) ??
    fallbackTicks;
};

const getSourceNoteMidi = (sourceNote: any): number | null => {
  return sourceNote?.Pitch ? sourceNote.Pitch.getHalfTone() + 12 : null;
};

const getArpeggio = (sourceNote: any): any | null => {
  return sourceNote?.arpeggio ?? sourceNote?.Arpeggio ?? sourceNote?.ParentVoiceEntry?.arpeggio ?? null;
};

const getArpeggioDirection = (arpeggio: any): 'up' | 'down' => (
  arpeggio?.type === OSMD_ARPEGGIO_TYPE_DOWN ? 'down' : 'up'
);

const getArpeggioGroupKey = (sourceNote: any, startTicks: number, staffId: number, voiceId: number): string | undefined => {
  const arpeggio = getArpeggio(sourceNote);
  if (!arpeggio) return undefined;
  const arpeggioNotes = Array.isArray(arpeggio.notes) ? arpeggio.notes : [];
  const midiSignature = arpeggioNotes
    .map((note: any) => getSourceNoteMidi(note))
    .filter((midi: number | null): midi is number => midi !== null)
    .sort((left: number, right: number) => left - right)
    .join(',');
  return ['arpeggio', startTicks, staffId, voiceId, midiSignature].join(':');
};

const applyTimelineWarp = <T extends { tick: number }>(items: T[], warpPoints: TimelineWarpPoint[]): T[] => {
  if (warpPoints.length === 0) return items;

  const sortedWarpPoints = [...warpPoints].sort((left, right) => left.boundaryTick - right.boundaryTick);
  return items.map((item) => {
    const offset = sortedWarpPoints.reduce((sum, warpPoint) => (
      item.tick >= warpPoint.boundaryTick ? sum + warpPoint.extraTicks : sum
    ), 0);
    return offset === 0 ? item : { ...item, tick: item.tick + offset };
  });
};

const applyWarpToTick = (tick: number, warpPoints: TimelineWarpPoint[]): number => {
  if (warpPoints.length === 0) return tick;
  return warpPoints.reduce((warpedTick, warpPoint) => (
    tick >= warpPoint.boundaryTick ? warpedTick + warpPoint.extraTicks : warpedTick
  ), tick);
};

const getNoteOffEventId = (noteOnEventId: string): string => noteOnEventId.replace(/-on$/, '-off');

const applyGraceNoteTiming = (
  events: PlaybackNoteEvent[],
  metadataByEventId: Map<string, PlaybackEventMetadata>
): PlaybackNoteEvent[] => {
  const graceGroups = new Map<string, PlaybackNoteEvent[]>();

  events.forEach((event) => {
    const metadata = metadataByEventId.get(event.id);
    if (event.type !== 'note-on' || !metadata?.isGraceNote || !metadata.graceGroupKey) return;
    const group = graceGroups.get(metadata.graceGroupKey) ?? [];
    group.push(event);
    graceGroups.set(metadata.graceGroupKey, group);
  });

  if (graceGroups.size === 0) return events;

  const adjustedTicksByEventId = new Map<string, number>();
  const insertionPoints = new Map<number, number>();

  graceGroups.forEach((group) => {
    const sortedGroup = [...group].sort((left, right) => left.id.localeCompare(right.id));
    const anchorTick = Math.min(...sortedGroup.map((event) => event.tick));
    const requestedLeadTicks = sortedGroup.length * GRACE_NOTE_DURATION_TICKS;
    const startBaseTick = Math.max(0, anchorTick - requestedLeadTicks);
    const insertedTicks = Math.max(0, requestedLeadTicks - anchorTick);
    if (insertedTicks > 0) {
      insertionPoints.set(anchorTick, Math.max(insertionPoints.get(anchorTick) ?? 0, insertedTicks));
    }

    sortedGroup.forEach((event, index) => {
      const noteOnTick = startBaseTick + index * GRACE_NOTE_DURATION_TICKS;
      adjustedTicksByEventId.set(event.id, noteOnTick);
      adjustedTicksByEventId.set(getNoteOffEventId(event.id), noteOnTick + GRACE_NOTE_DURATION_TICKS);
    });
  });

  const sortedInsertionPoints = Array.from(insertionPoints.entries())
    .map(([boundaryTick, extraTicks]) => ({ boundaryTick, extraTicks }))
    .sort((left, right) => left.boundaryTick - right.boundaryTick);

  const getInsertionOffset = (event: PlaybackNoteEvent): number => {
    const metadata = metadataByEventId.get(event.id);
    const graceAnchorTick = metadata?.graceAnchorTick ?? null;
    return sortedInsertionPoints.reduce((offset, insertionPoint) => {
      if (metadata?.isGraceNote) {
        return graceAnchorTick !== null && insertionPoint.boundaryTick < graceAnchorTick
          ? offset + insertionPoint.extraTicks
          : offset;
      }
      return event.tick >= insertionPoint.boundaryTick
        ? offset + insertionPoint.extraTicks
        : offset;
    }, 0);
  };

  return events.map((event) => {
    const adjustedTick = adjustedTicksByEventId.get(event.id);
    if (adjustedTick !== undefined) {
      const offset = getInsertionOffset(event);
      return { ...event, tick: adjustedTick + offset };
    }
    const offset = getInsertionOffset(event);
    return offset === 0 ? event : { ...event, tick: event.tick + offset };
  });
};

const applyArpeggioTiming = (
  events: PlaybackNoteEvent[],
  metadataByEventId: Map<string, PlaybackEventMetadata>
): PlaybackNoteEvent[] => {
  const arpeggioGroups = new Map<string, PlaybackNoteEvent[]>();

  events.forEach((event) => {
    const metadata = metadataByEventId.get(event.id);
    if (event.type !== 'note-on' || metadata?.isGraceNote || !metadata?.arpeggioGroupKey) return;
    const group = arpeggioGroups.get(metadata.arpeggioGroupKey) ?? [];
    group.push(event);
    arpeggioGroups.set(metadata.arpeggioGroupKey, group);
  });

  if (arpeggioGroups.size === 0) return events;

  const eventTicksById = new Map(events.map((event) => [event.id, event.tick]));
  const adjustedNoteOnTicksByEventId = new Map<string, number>();

  arpeggioGroups.forEach((group) => {
    const direction = metadataByEventId.get(group[0]?.id)?.arpeggioDirection ?? 'up';
    const sortedGroup = [...group].sort((left, right) => {
      const midiOrder = direction === 'down'
        ? right.sourceMidi - left.sourceMidi
        : left.sourceMidi - right.sourceMidi;
      return midiOrder !== 0 ? midiOrder : left.id.localeCompare(right.id);
    });

    sortedGroup.forEach((event, index) => {
      const noteOffTick = eventTicksById.get(getNoteOffEventId(event.id)) ?? event.tick;
      const maxOffsetTicks = Math.max(0, noteOffTick - event.tick - 1);
      const offsetTicks = Math.min(index * ARPEGGIO_STEP_TICKS, maxOffsetTicks);
      if (offsetTicks > 0) adjustedNoteOnTicksByEventId.set(event.id, event.tick + offsetTicks);
    });
  });

  return events.map((event) => {
    const adjustedTick = adjustedNoteOnTicksByEventId.get(event.id);
    return adjustedTick === undefined ? event : { ...event, tick: adjustedTick };
  });
};

const updateWarpedNoteDurations = (events: PlaybackNoteEvent[]): PlaybackNoteEvent[] => {
  const eventTicksById = new Map(events.map((event) => [event.id, event.tick]));
  return events.map((event) => {
    if (event.type !== 'note-on' || event.durationTicks === undefined) return event;
    const noteOffTick = eventTicksById.get(getNoteOffEventId(event.id));
    if (noteOffTick === undefined) return event;
    return { ...event, durationTicks: Math.max(1, noteOffTick - event.tick) };
  });
};

export type SourceNoteMidiMap = Map<any, number>;

export const extractSourceNoteMidiMap = (osmd: OpenSheetMusicDisplay): SourceNoteMidiMap => {
  const result: SourceNoteMidiMap = new Map();
  const sourceMeasures = osmd.Sheet?.SourceMeasures ?? (osmd.Sheet as any)?.sourceMeasures ?? [];

  sourceMeasures.forEach((measure: any) => {
    measure.VerticalSourceStaffEntryContainers?.forEach((container: any) => {
      container.StaffEntries?.forEach((staffEntry: any) => {
        staffEntry?.VoiceEntries?.forEach((voiceEntry: any) => {
          voiceEntry?.Notes?.forEach((sourceNote: any) => {
            const midi = getSourceNoteMidi(sourceNote);
            if (midi !== null) result.set(sourceNote, midi);
          });
        });
      });
    });
  });

  return result;
};

const normalizeBpm = (value: unknown): number | null => {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return Math.max(20, Math.min(300, Math.round(value)));
};

const getTempoExpressionBpm = (expression: any): number | null => {
  const candidates: unknown[] = [
    expression?.InstantaneousTempo?.TempoInBpm,
    expression?.instantaneousTempo?.TempoInBpm,
    expression?.instantaneousTempo?.tempoInBpm,
  ];

  expression?.EntriesList?.forEach((entry: any) => {
    candidates.push(entry?.Expression?.TempoInBpm, entry?.expression?.TempoInBpm, entry?.expression?.tempoInBpm);
  });
  expression?.entriesList?.forEach((entry: any) => {
    candidates.push(entry?.Expression?.TempoInBpm, entry?.expression?.TempoInBpm, entry?.expression?.tempoInBpm);
  });

  for (const candidate of candidates) {
    const bpm = normalizeBpm(candidate);
    if (bpm !== null) return bpm;
  }

  return null;
};

const getTempoExpressionTick = (expression: any): number | null => {
  const measureStartTicks = fractionToTicks(
    expression?.sourceMeasure?.AbsoluteTimestamp ??
    expression?.sourceMeasure?.absoluteTimestamp ??
    expression?.SourceMeasure?.AbsoluteTimestamp ??
    expression?.SourceMeasure?.absoluteTimestamp
  ) ?? 0;
  const localTicks = fractionToTicks(
    expression?.Timestamp ??
    expression?.timestamp ??
    expression?.AbsoluteTimestamp ??
    expression?.absoluteTimestamp
  );
  if (localTicks === null) return null;
  return measureStartTicks + localTicks;
};

const getContinuousTempo = (expression: any): any => {
  return expression?.ContinuousTempo ?? expression?.continuousTempo ?? null;
};

const getTempoExpressionLabels = (expression: any): string[] => {
  const continuousTempo = getContinuousTempo(expression);
  const labels: unknown[] = [
    continuousTempo?.Label,
    continuousTempo?.label,
    expression?.InstantaneousTempo?.Label,
    expression?.instantaneousTempo?.label,
    expression?.CombinedExpressionsText,
    expression?.combinedExpressionsText,
  ];
  expression?.EntriesList?.forEach((entry: any) => {
    labels.push(entry?.label, entry?.Expression?.Label);
  });
  expression?.entriesList?.forEach((entry: any) => {
    labels.push(entry?.label, entry?.expression?.label);
  });
  return labels.filter((label): label is string => typeof label === 'string');
};

const isSupportedRitardando = (expression: any): boolean => {
  return getTempoExpressionLabels(expression).some((label) =>
    /\brit(?:\.|ard(?:ando)?\.?)(?:\s|$)/i.test(label)
  );
};

const isATempo = (expression: any): boolean => {
  return getTempoExpressionLabels(expression).some((label) =>
    /\ba\s+tempo\b/i.test(label)
  );
};

const getContinuousTempoEndTick = (expression: any): number | null => {
  const continuousTempo = getContinuousTempo(expression);
  return fractionToTicks(
    continuousTempo?.AbsoluteEndTimestamp ??
    continuousTempo?.absoluteEndTimestamp
  );
};

const getTempoAtTick = (
  tempoEvents: PlaybackTempoEvent[],
  tick: number
): number | null => {
  let bpm: number | null = null;
  tempoEvents
    .filter((event) => event.tick <= tick)
    .sort((left, right) => left.tick - right.tick)
    .forEach((event) => {
      bpm = event.bpm;
    });
  return bpm;
};

const expandGradualTempoExpression = (
  expression: any,
  instantaneousTempoEvents: PlaybackTempoEvent[],
  explicitEndTick: number | null = null
): PlaybackTempoEvent[] => {
  if (!isSupportedRitardando(expression)) return [];
  const startTick = getTempoExpressionTick(expression);
  const endTick = explicitEndTick ?? getContinuousTempoEndTick(expression);
  if (startTick === null || endTick === null || endTick <= startTick) return [];

  const continuousTempo = getContinuousTempo(expression);
  const calculatedStartBpm = normalizeBpm(
    continuousTempo?.StartTempo ??
    continuousTempo?.startTempo
  );
  const startBpm = calculatedStartBpm ??
    getTempoAtTick(instantaneousTempoEvents, startTick);
  if (startBpm === null) return [];

  const targetBpm = Math.max(20, startBpm * GRADUAL_TEMPO_TARGET_RATIO);
  const events: PlaybackTempoEvent[] = [];
  const terminalTick = Math.max(startTick, endTick - 1);
  for (let tick = startTick; tick < terminalTick; tick += GRADUAL_TEMPO_STEP_TICKS) {
    const progress = (tick - startTick) / (endTick - startTick);
    events.push({
      tick,
      bpm: Math.round((startBpm + (targetBpm - startBpm) * progress) * 100) / 100,
    });
  }
  if (events[events.length - 1]?.tick !== terminalTick) {
    events.push({ tick: terminalTick, bpm: Math.round(targetBpm * 100) / 100 });
  }
  return events;
};

const extractTempoEvents = (osmd: OpenSheetMusicDisplay): PlaybackTempoEvent[] => {
  const sheet: any = osmd.Sheet;
  const instantaneousTempoEvents: PlaybackTempoEvent[] = [];

  const addTempoExpression = (expression: any) => {
    const bpm = getTempoExpressionBpm(expression);
    const tick = getTempoExpressionTick(expression);
    if (bpm === null || tick === null) return;
    instantaneousTempoEvents.push({ tick, bpm });
  };

  const timestampSortedExpressions = sheet?.TimestampSortedTempoExpressionsList ?? sheet?.timestampSortedTempoExpressionsList ?? [];
  timestampSortedExpressions.forEach(addTempoExpression);

  if (instantaneousTempoEvents.length === 0) {
    sheet?.SourceMeasures?.forEach((measure: any) => {
      measure?.TempoExpressions?.forEach(addTempoExpression);
      measure?.tempoExpressions?.forEach(addTempoExpression);
    });
  }

  const sortedExpressions: Array<{ expression: any; tick: number }> = timestampSortedExpressions
    .map((expression: any) => ({ expression, tick: getTempoExpressionTick(expression) }))
    .filter((entry: any): entry is { expression: any; tick: number } => entry.tick !== null)
    .sort((left: { tick: number }, right: { tick: number }) => left.tick - right.tick);
  const restoredTempoEvents: PlaybackTempoEvent[] = [];
  const gradualTempoEvents: PlaybackTempoEvent[] = sortedExpressions.flatMap((
    entry: { expression: any; tick: number },
    index: number
  ) => {
    if (!isSupportedRitardando(entry.expression)) return [];
    const nextBoundary = sortedExpressions.slice(index + 1).find((candidate: { expression: any; tick: number }) =>
      candidate.tick > entry.tick &&
      (isATempo(candidate.expression) || getTempoExpressionBpm(candidate.expression) !== null)
    );
    const startBpm = getTempoAtTick(
      [...instantaneousTempoEvents, ...restoredTempoEvents],
      entry.tick
    );
    if (startBpm === null) return [];
    if (nextBoundary && isATempo(nextBoundary.expression)) {
      restoredTempoEvents.push({ tick: nextBoundary.tick, bpm: startBpm });
    }
    return expandGradualTempoExpression(
      entry.expression,
      [...instantaneousTempoEvents, { tick: entry.tick, bpm: startBpm }],
      nextBoundary?.tick ?? null
    );
  });

  const byTick = new Map<number, number>();
  gradualTempoEvents
    .sort((left, right) => left.tick - right.tick)
    .forEach((event) => {
      byTick.set(event.tick, event.bpm);
    });
  restoredTempoEvents
    .sort((left, right) => left.tick - right.tick)
    .forEach((event) => {
      byTick.set(event.tick, event.bpm);
    });
  instantaneousTempoEvents
    .sort((left, right) => left.tick - right.tick)
    .forEach((event) => {
      byTick.set(event.tick, event.bpm);
    });

  const sortedEntries = Array.from(byTick.entries())
    .map(([tick, bpm]) => ({ tick, bpm }))
    .sort((left, right) => left.tick - right.tick);

  if (sortedEntries.length === 0) {
    return [{ tick: 0, bpm: FALLBACK_SCORE_BPM }];
  }

  if (!byTick.has(0)) {
    byTick.set(0, sortedEntries[0].bpm);
  }

  return Array.from(byTick.entries())
    .map(([tick, bpm]) => ({ tick, bpm }))
    .sort((left, right) => left.tick - right.tick);
};

export const getPixelPerUnit = (osmd: OpenSheetMusicDisplay, container: HTMLElement): number => {
  const graphicSheet = osmd.GraphicSheet;
  if (!graphicSheet || graphicSheet.MusicPages.length === 0) return 10.0;
  return 10.0 * osmd.Zoom; 
};

export const extractMeasureContexts = (osmd: OpenSheetMusicDisplay, pixelPerUnit: number): MeasureContext[] => {
  const graphicSheet = osmd.GraphicSheet;
  if (!graphicSheet || !osmd.Sheet) return [];
  const contexts: MeasureContext[] = [];
  const staffStates = new Map<number, { clef: string, key: number, mode: string, octaveShift: number }>();

  // 高速化のため、Stavesのインデックスを事前にマップ化
  const staffIndexMap = new Map<any, number>();
  osmd.Sheet.Staves.forEach((s, i) => staffIndexMap.set(s, i));

  graphicSheet.MusicPages.forEach((page, pIdx) => {
    page.MusicSystems.forEach((system, sIdx) => {
      system.StaffLines.forEach(staffLine => {
        const parentStaff = staffLine.ParentStaff;
        const staffId = parentStaff.idInMusicSheet;
        const staffIdx = staffIndexMap.get(parentStaff) ?? -1;

        if (!staffStates.has(staffId)) {
          staffStates.set(staffId, { clef: (staffId % 2 !== 0) ? 'F' : 'G', key: 0, mode: 'major', octaveShift: 0 });
        }
        const state = staffStates.get(staffId)!;

        staffLine.Measures.forEach((measure, mIdx) => {
          const source = measure.parentSourceMeasure;
          let endShiftAfterThisMeasure = false;
          
          // Use OSMD's computed active clef for this measure if available
          if (measure.InitiallyActiveClef) {
            const type = measure.InitiallyActiveClef.ClefType;
            state.clef = (type === ClefEnum.F) ? 'F' : 'G';
          }

          if (source && staffIdx >= 0) {
            // Check FirstInstructionsStaffEntries (Measure start instructions) for Key changes
            if (source.FirstInstructionsStaffEntries?.[staffIdx]) {
                source.FirstInstructionsStaffEntries[staffIdx].Instructions.forEach(instr => {
                  if (instr instanceof KeyInstruction) {
                    state.key = instr.Key;
                    // @ts-ignore: Accessing Mode if available, assuming private or typed enum
                    if (instr.Mode !== undefined) state.mode = instr.Mode === 0 ? 'major' : (instr.Mode === 1 ? 'minor' : 'major'); 
                    // Note: OSMD KeyModeEnum: Major=0, Minor=1, etc.
                  }
                });
            }

            // Check all StaffEntries in the measure for mid-measure Key changes
            source.VerticalSourceStaffEntryContainers.forEach(container => {
                const entry = container.StaffEntries[staffIdx];
                if (entry) {
                    entry.Instructions.forEach(instr => {
                        if (instr instanceof KeyInstruction) {
                            state.key = instr.Key;
                             // @ts-ignore
                            if (instr.Mode !== undefined) state.mode = instr.Mode === 0 ? 'major' : (instr.Mode === 1 ? 'minor' : 'major');
                        }
                    });
                }
            });

            if (source.StaffLinkedExpressions?.[staffIdx]) {
                source.StaffLinkedExpressions[staffIdx].forEach(expr => {
                    const start = (expr as any).octaveShiftStart;
                    if (start) {
                        const val = start.octaveValue;
                        let shift = 0;
                        if (val === 0) shift = -12;
                        else if (val === 1) shift = 12;
                        else if (val === 2) shift = -24;
                        else if (val === 3) shift = 24;
                        state.octaveShift = shift;
                    }
                    if ((expr as any).octaveShiftEnd) endShiftAfterThisMeasure = true;
                });
            }
          }

          let minMidi: number | null = null;
          let maxMidi: number | null = null;
          const columnDetailsMap = new Map<string, ColumnDetail>();
          const noteDetails: NoteDetail[] = [];
          const columnIndexMap = new Map<any, number>();

          if (source) {
            source.VerticalSourceStaffEntryContainers.forEach((container, index) => {
              columnIndexMap.set(container, index);
            });
          }

          measure.staffEntries.forEach((gse, gseIndex) => {
            const absTs = gse.getAbsoluteTimestamp();
            const [tsX] = graphicSheet.calculateXPositionFromTimestamp(absTs);
            const entryX = (Number.isFinite(tsX) ? tsX : gse.PositionAndShape.AbsolutePosition.x) * pixelPerUnit;
            const columnIndex = columnIndexMap.get(gse.parentVerticalContainer) ?? gseIndex;
            const columnKey = getColumnKeyFromTimestamp(absTs, source ? source.MeasureNumber : mIdx + 1, columnIndex);

            gse.graphicalVoiceEntries.forEach((gve, voiceEntryIndex) => {
              gve.notes.forEach((gn, index) => {
                if (gn.sourceNote && gn.sourceNote.Pitch) {
                  const renderedMidi = gn.sourceNote.Pitch.getHalfTone() + 12;
                  if (minMidi === null || renderedMidi < minMidi) minMidi = renderedMidi;
                  if (maxMidi === null || renderedMidi > maxMidi) maxMidi = renderedMidi;
                  const voiceId = gn.sourceNote.ParentVoiceEntry?.ParentVoice?.VoiceId ?? voiceEntryIndex;
                  const noteIdentity = [
                    'note',
                    source ? source.MeasureNumber : mIdx + 1,
                    staffId,
                    columnIndex,
                    voiceId,
                    index
                  ].join(':');

                  noteDetails.push({
                    midi: renderedMidi,
                    x: entryX,
                    columnKey,
                    noteIdentity,
                    graphicalNote: gn,
                    index: index
                  });
                }
              });
            });

            if (!columnDetailsMap.has(columnKey)) {
              columnDetailsMap.set(columnKey, {
                x: entryX,
                columnKey
              });
            }
          });

          const absMeasurePos = measure.PositionAndShape.AbsolutePosition;
          const absStaffPos = staffLine.PositionAndShape.AbsolutePosition;
          const measureSize = measure.PositionAndShape.Size;

          contexts.push({
            measureNumber: source ? source.MeasureNumber : mIdx + 1,
            staffId: staffId,
            systemId: pIdx * 10000 + sIdx,
            x: absMeasurePos.x * pixelPerUnit,
            y: absMeasurePos.y * pixelPerUnit,
            width: measureSize.width * pixelPerUnit,
            height: 4 * pixelPerUnit,
            staffY: absStaffPos.y * pixelPerUnit,
            clefType: state.clef as ClefType,
            keySig: state.key,
            keyMode: state.mode,
            minMidi,
            maxMidi,
            octaveShift: state.octaveShift,
            columnDetails: Array.from(columnDetailsMap.values()),
            noteDetails
          });

          if (endShiftAfterThisMeasure) state.octaveShift = 0;
        });
      });
    });
  });
  
  return contexts;
};

export const extractPlaybackTimeline = (
  osmd: OpenSheetMusicDisplay,
  contexts: MeasureContext[],
  sourceNoteMidiMap: SourceNoteMidiMap = extractSourceNoteMidiMap(osmd)
): PlaybackTimeline => {
  const events: PlaybackNoteEvent[] = [];
  const metadataByEventId = new Map<string, PlaybackEventMetadata>();
  const warpPointsByBoundaryTick = new Map<number, TimelineWarpPoint>();
  let durationTicks = 0;
  const sourceNoteMap = new Map<any, { ctx: MeasureContext; detail: NoteDetail }>();

  contexts.forEach((ctx) => {
    ctx.noteDetails.forEach((detail) => {
      const sourceNote = detail.graphicalNote?.sourceNote;
      if (sourceNote && !sourceNoteMap.has(sourceNote)) {
        sourceNoteMap.set(sourceNote, { ctx, detail });
      }
    });
  });

  const sourceMeasures = osmd.Sheet?.SourceMeasures ?? (osmd.Sheet as any)?.sourceMeasures ?? [];

  sourceMeasures.forEach((measure: any, measureIndex: number) => {
    const measureStartTicks = fractionToTicks(measure.AbsoluteTimestamp) ?? 0;
    const measureDurationTicks = fractionToTicks(measure.Duration) ?? 0;
    durationTicks = Math.max(durationTicks, measureStartTicks + measureDurationTicks);

    measure.VerticalSourceStaffEntryContainers?.forEach((container: any, containerIndex: number) => {
      const absoluteTimestamp = container.getAbsoluteTimestamp?.();
      const startTicks = fractionToTicks(absoluteTimestamp) ??
                         measureStartTicks + (fractionToTicks(container.Timestamp) ?? 0);
      const fallbackColumnKey = getColumnKeyFromTimestamp(
        absoluteTimestamp ?? container.Timestamp,
        measure.MeasureNumber ?? measureIndex + 1,
        containerIndex
      );

      container.StaffEntries?.forEach((staffEntry: any, staffIndex: number) => {
        staffEntry?.VoiceEntries?.forEach((voiceEntry: any, voiceIndex: number) => {
          voiceEntry?.Notes?.forEach((sourceNote: any, noteIndex: number) => {
            if (shouldSkipPlaybackNote(sourceNote)) return;

            const sourceIsGraceNote = isGraceNote(sourceNote);
            const noteDurationTicks = sourceIsGraceNote
              ? GRACE_NOTE_DURATION_TICKS
              : getSourceNoteDurationTicks(sourceNote);
            if (noteDurationTicks === null) return;

            const tieGroupNotes = sourceIsGraceNote ? [sourceNote] : getTieGroupNotes(sourceNote);
            if (tieGroupNotes.length > 1 && tieGroupNotes[0] !== sourceNote) return;

            const mapped = sourceNoteMap.get(sourceNote);
            const sourceMidi = sourceNoteMidiMap.get(sourceNote) ?? getSourceNoteMidi(sourceNote);
            if (sourceMidi === null) return;

            const columnKey = mapped?.detail.columnKey ?? fallbackColumnKey;
            const measureNumber = mapped?.ctx.measureNumber ?? measure.MeasureNumber ?? measureIndex + 1;
            const systemId = mapped?.ctx.systemId ?? 0;
            const staffId = mapped?.ctx.staffId ?? sourceNote.ParentStaff?.idInMusicSheet ?? staffIndex;
            const playbackModifiers = getPlaybackModifiers(sourceNote);
            const sourceHasFermata = !sourceIsGraceNote && tieGroupNotes.some((note) => hasFermata(note));
            const tiedEndTicks = sourceIsGraceNote
              ? startTicks + GRACE_NOTE_DURATION_TICKS
              : tieGroupNotes.reduce((endTick, tiedNote) => {
                const tiedNoteDurationTicks = getSourceNoteDurationTicks(tiedNote);
                if (tiedNoteDurationTicks === null) return endTick;
                const tiedNoteStartTicks = getSourceNoteStartTicks(tiedNote, startTicks);
                return Math.max(endTick, tiedNoteStartTicks + tiedNoteDurationTicks);
              }, startTicks + noteDurationTicks);
            const rawDurationTicks = Math.max(1, tiedEndTicks - startTicks);
            const adjustedDurationTicks = sourceIsGraceNote
              ? GRACE_NOTE_DURATION_TICKS
              : tieGroupNotes.length > 1
              ? rawDurationTicks
              : Math.max(1, Math.round(rawDurationTicks * playbackModifiers.durationMultiplier));
            const endTicks = startTicks + adjustedDurationTicks;
            const renderedMidi = mapped?.detail.midi ?? sourceMidi;
            const soundingMidi = renderedMidi;
            const voiceId = voiceEntry.ParentVoice?.VoiceId ?? voiceIndex;
            const noteIdentity = mapped?.detail.noteIdentity ?? [
              'note',
              measure.MeasureNumber ?? measureIndex + 1,
              staffId,
              containerIndex,
              voiceId,
              noteIndex
            ].join(':');
            const noteIdentities = Array.from(new Set(
              tieGroupNotes
                .map((tiedNote) => sourceNoteMap.get(tiedNote)?.detail.noteIdentity)
                .filter((identity: unknown): identity is string => typeof identity === 'string' && identity.length > 0)
            ));
            if (noteIdentities.length === 0) noteIdentities.push(noteIdentity);
            const idBase = `${measureIndex}-${containerIndex}-${staffIndex}-${voiceId}-${noteIndex}-${columnKey}-${sourceMidi}`;
            const arpeggio = getArpeggio(sourceNote);
            const eventMetadata: PlaybackEventMetadata = {
              isGraceNote: sourceIsGraceNote,
              graceAnchorTick: sourceIsGraceNote ? startTicks : undefined,
              graceGroupKey: sourceIsGraceNote ? ['grace', startTicks, staffId, voiceId].join(':') : undefined,
              arpeggioGroupKey: sourceIsGraceNote ? undefined : getArpeggioGroupKey(sourceNote, startTicks, staffId, voiceId),
              arpeggioDirection: sourceIsGraceNote || !arpeggio ? undefined : getArpeggioDirection(arpeggio),
            };

            events.push({
              id: `${idBase}-on`,
              type: 'note-on',
              tick: startTicks,
              columnKey,
              measureNumber,
              systemId,
              staffId,
              noteIdentity,
              noteIdentities,
              sourceMidi,
              soundingMidi,
              renderedMidi,
              durationTicks: adjustedDurationTicks,
              velocityRatio: playbackModifiers.velocityRatio,
            });
            metadataByEventId.set(`${idBase}-on`, eventMetadata);

            events.push({
              id: `${idBase}-off`,
              type: 'note-off',
              tick: endTicks,
              columnKey,
              measureNumber,
              systemId,
              staffId,
              noteIdentity,
              noteIdentities,
              sourceMidi,
              soundingMidi,
              renderedMidi,
            });
            metadataByEventId.set(`${idBase}-off`, eventMetadata);

            durationTicks = Math.max(durationTicks, endTicks);

            if (sourceHasFermata) {
              const extraTicks = Math.max(1, Math.round(rawDurationTicks * (FERMATA_DURATION_MULTIPLIER - 1)));
              const previousWarpPoint = warpPointsByBoundaryTick.get(endTicks);
              warpPointsByBoundaryTick.set(endTicks, {
                boundaryTick: endTicks,
                extraTicks: Math.max(previousWarpPoint?.extraTicks ?? 0, extraTicks),
              });
            }
          });
        });
      });
    });
  });

  const warpPoints = Array.from(warpPointsByBoundaryTick.values());
  const fermataWarpedEvents = applyTimelineWarp(events, warpPoints);
  const graceTimedEvents = applyGraceNoteTiming(fermataWarpedEvents, metadataByEventId);
  const arpeggioTimedEvents = applyArpeggioTiming(graceTimedEvents, metadataByEventId);
  const warpedEvents = updateWarpedNoteDurations(arpeggioTimedEvents);
  const warpedTempoEvents = applyTimelineWarp(extractTempoEvents(osmd), warpPoints);
  const warpedDurationTicks = Math.max(
    applyWarpToTick(durationTicks, warpPoints),
    ...warpedEvents.map((event) => event.tick),
    ...warpedTempoEvents.map((event) => event.tick)
  );

  warpedEvents.sort((left, right) => {
    if (left.tick !== right.tick) return left.tick - right.tick;
    if (left.type !== right.type) return left.type === 'note-off' ? -1 : 1;
    return left.id.localeCompare(right.id);
  });

  return {
    ppq: PLAYBACK_PPQ,
    durationTicks: warpedDurationTicks,
    events: warpedEvents,
    tempoEvents: warpedTempoEvents,
  };
};

export const getColumnKeyFromTimestamp = (timestamp: any, fallbackMeasureNumber?: number, fallbackColumnIndex?: number): string => {
  if (timestamp?.clone) {
    const normalized = timestamp.clone();
    if (normalized.simplify) normalized.simplify();
    return `${normalized.WholeValue}:${normalized.Numerator}/${normalized.Denominator}`;
  }

  if (fallbackMeasureNumber !== undefined && fallbackColumnIndex !== undefined) {
    return `${fallbackMeasureNumber}:${fallbackColumnIndex}`;
  }

  return '0:0/1';
};

export const getMeasureAtPoint = (x: number, y: number, contexts: MeasureContext[]): MeasureContext | null => {
  // まず X 座標の範囲内にある小節をすべて抽出
  const candidateMeasures = contexts.filter(ctx => x >= ctx.x && x <= ctx.x + ctx.width);
  if (candidateMeasures.length === 0) return null;

  // X 座標が一致する小節（通常は上下の譜進）の中で、Y 座標が最も近いものを探す
  let closestMeasure: MeasureContext | null = null;
  let minDistance = Infinity;

  candidateMeasures.forEach(ctx => {
    const centerY = ctx.y + ctx.height / 2;
    const distance = Math.abs(y - centerY);
    if (distance < minDistance) {
      minDistance = distance;
      closestMeasure = ctx;
    }
  });

  // 垂直方向の距離が遠すぎる場合は null を返す（五線の高さの3倍程度を閾値とする）
  // これにより、システム間の広い空白や、譜面の上下の大きな余白をクリックしたときに選択を外せるようになる
  if (closestMeasure && minDistance > (closestMeasure as MeasureContext).height * 3) {
    return null;
  }

  return closestMeasure;
};

export const calculateYForMidi = (midi: number, ctx: MeasureContext, ppu: number): number => {
  const space = ppu / 2;
  const visualMidi = midi + ctx.octaveShift;
  const pc = ((visualMidi % 12) + 12) % 12;
  const octave = Math.floor(visualMidi / 12);
  
  // Choose mapping based on Key Signature
  // Flats (keySig < 0): Map black keys to the upper note (e.g. Eb -> E position)
  // Sharps (keySig >= 0): Map black keys to the lower note (e.g. F# -> F position)
  const stepMapSharps = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
  const stepMapFlats  = [0, 1, 1, 2, 2, 3, 4, 4, 5, 5, 6, 6];
  const stepMap = ctx.keySig < 0 ? stepMapFlats : stepMapSharps;

  const step = octave * 7 + stepMap[pc];
  const baselineStep = ctx.clefType === 'F' ? 25 : 37;
  const bottomLineY = ctx.staffY + 4 * ppu;
  return bottomLineY - (step - baselineStep) * space;
};

export const isDiatonic = (midi: number, fifths: number, mode: string = 'major'): boolean => {
  const pc = ((midi % 12) + 12) % 12;
  const circlePos = (pc * 7) % 12;
  const start = (fifths - 1 + 120) % 12;
  const normalizedPos = (circlePos - start + 12) % 12;
  
  if (normalizedPos >= 0 && normalizedPos <= 6) return true;
  
  // Minor Key Extensions for Harmonic/Melodic Minor
  if (mode === 'minor') {
    // normalizedPos 7 corresponds to raised 6th (e.g., F# in A minor)
    // normalizedPos 9 corresponds to raised 7th (e.g., G# in A minor)
    if (normalizedPos === 7 || normalizedPos === 9) return true;
  }
  
  return false;
};
