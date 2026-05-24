import { OpenSheetMusicDisplay, KeyInstruction, ClefInstruction, ClefEnum } from 'opensheetmusicdisplay';
import { ColumnDetail, MeasureContext, ClefType, NoteDetail, PlaybackNoteEvent, PlaybackTimeline } from '../types/piano';

const PLAYBACK_PPQ = 480;

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
  if (sourceNote.IsGraceNote || sourceNote.IsCueNote || sourceNote.PrintObject === false) return true;
  return false;
};

const getSourceNoteMidi = (sourceNote: any): number | null => {
  return sourceNote?.Pitch ? sourceNote.Pitch.getHalfTone() + 12 : null;
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

const extractScoreBpm = (osmd: OpenSheetMusicDisplay): number | undefined => {
  const sheet: any = osmd.Sheet;
  const candidates: unknown[] = [];

  const tempoExpressions = sheet?.TimestampSortedTempoExpressionsList ?? [];
  tempoExpressions.forEach((expression: any) => {
    candidates.push(expression?.InstantaneousTempo?.TempoInBpm);
    expression?.EntriesList?.forEach((entry: any) => {
      candidates.push(entry?.Expression?.TempoInBpm);
    });
  });

  sheet?.SourceMeasures?.forEach((measure: any) => {
    candidates.push(measure?.TempoInBPM);
    measure?.TempoExpressions?.forEach((expression: any) => {
      candidates.push(expression?.InstantaneousTempo?.TempoInBpm);
      expression?.EntriesList?.forEach((entry: any) => {
        candidates.push(entry?.Expression?.TempoInBpm);
      });
    });
  });

  candidates.push(
    sheet?.getExpressionsStartTempoInBPM?.(),
    sheet?.DefaultStartTempoInBpm,
    sheet?.userStartTempoInBPM,
  );

  for (const candidate of candidates) {
    const bpm = normalizeBpm(candidate);
    if (bpm !== null) return bpm;
  }

  return undefined;
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

            const noteDurationTicks = getSourceNoteDurationTicks(sourceNote);
            if (noteDurationTicks === null) return;

            const mapped = sourceNoteMap.get(sourceNote);
            const sourceMidi = sourceNoteMidiMap.get(sourceNote) ?? getSourceNoteMidi(sourceNote);
            if (sourceMidi === null) return;

            const columnKey = mapped?.detail.columnKey ?? fallbackColumnKey;
            const measureNumber = mapped?.ctx.measureNumber ?? measure.MeasureNumber ?? measureIndex + 1;
            const systemId = mapped?.ctx.systemId ?? 0;
            const staffId = mapped?.ctx.staffId ?? sourceNote.ParentStaff?.idInMusicSheet ?? staffIndex;
            const endTicks = startTicks + noteDurationTicks;
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
            const idBase = `${measureIndex}-${containerIndex}-${staffIndex}-${voiceId}-${noteIndex}-${columnKey}-${sourceMidi}`;

            events.push({
              id: `${idBase}-on`,
              type: 'note-on',
              tick: startTicks,
              columnKey,
              measureNumber,
              systemId,
              staffId,
              noteIdentity,
              sourceMidi,
              soundingMidi,
              renderedMidi,
              durationTicks: noteDurationTicks,
            });

            events.push({
              id: `${idBase}-off`,
              type: 'note-off',
              tick: endTicks,
              columnKey,
              measureNumber,
              systemId,
              staffId,
              noteIdentity,
              sourceMidi,
              soundingMidi,
              renderedMidi,
            });

            durationTicks = Math.max(durationTicks, endTicks);
          });
        });
      });
    });
  });

  events.sort((left, right) => {
    if (left.tick !== right.tick) return left.tick - right.tick;
    if (left.type !== right.type) return left.type === 'note-off' ? -1 : 1;
    return left.id.localeCompare(right.id);
  });

  return {
    ppq: PLAYBACK_PPQ,
    durationTicks,
    events,
    scoreBpm: extractScoreBpm(osmd),
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
