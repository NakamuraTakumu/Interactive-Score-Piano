import { OpenSheetMusicDisplay, KeyInstruction, ClefInstruction, ClefEnum } from 'opensheetmusicdisplay';
import { MeasureContext, ClefType } from '../types/piano';

export const getPixelPerUnit = (osmd: OpenSheetMusicDisplay, container: HTMLElement): number => {
  const graphicSheet = osmd.GraphicSheet;
  if (!graphicSheet || graphicSheet.MusicPages.length === 0) return 10.0;
  return 10.0 * osmd.Zoom; 
};

export const extractMeasureContexts = (osmd: OpenSheetMusicDisplay, pixelPerUnit: number): MeasureContext[] => {
  const graphicSheet = osmd.GraphicSheet;
  if (!graphicSheet || !osmd.Sheet) return [];
  const contexts: MeasureContext[] = [];
  const staffStates = new Map<number, { clef: string, key: number, octaveShift: number }>();

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
          staffStates.set(staffId, { clef: (staffId % 2 !== 0) ? 'F' : 'G', key: 0, octaveShift: 0 });
        }
        const state = staffStates.get(staffId)!;

        staffLine.Measures.forEach((measure, mIdx) => {
          const source = measure.parentSourceMeasure;
          let endShiftAfterThisMeasure = false;
          
          if (source && staffIdx >= 0) {
            // Check FirstInstructionsStaffEntries (Measure start instructions)
            if (source.FirstInstructionsStaffEntries?.[staffIdx]) {
                source.FirstInstructionsStaffEntries[staffIdx].Instructions.forEach(instr => {
                  if (instr instanceof KeyInstruction) state.key = instr.Key;
                  else if (instr instanceof ClefInstruction) {
                    const type = instr.ClefType;
                    if (type === ClefEnum.F) state.clef = 'F';
                    else state.clef = 'G';
                  }
                });
            }

            // Also check all StaffEntries in the measure for instructions
            source.VerticalSourceStaffEntryContainers.forEach(container => {
                const entry = container.StaffEntries[staffIdx];
                if (entry) {
                    entry.Instructions.forEach(instr => {
                        if (instr instanceof KeyInstruction) {
                            state.key = instr.Key;
                        } else if (instr instanceof ClefInstruction) {
                            const type = instr.ClefType;
                            if (type === ClefEnum.F) state.clef = 'F';
                            else state.clef = 'G';
                        }
                    });
                }
            });

            if (source.StaffLinkedExpressions?.[staffIdx]) {
                source.StaffLinkedExpressions[staffIdx].forEach(expr => {
                    // @ts-ignore
                    const start = expr.octaveShiftStart;
                    if (start) {
                        // @ts-ignore
                        const val = start.octaveValue;
                        let shift = 0;
                        if (val === 0) shift = -12;
                        else if (val === 1) shift = 12;
                        else if (val === 2) shift = -24;
                        else if (val === 3) shift = 24;
                        state.octaveShift = shift;
                    }
                    // @ts-ignore
                    if (expr.octaveShiftEnd) endShiftAfterThisMeasure = true;
                });
            }
          }

          let minMidi: number | null = null;
          let maxMidi: number | null = null;
          const noteDetails: { midi: number, x: number, graphicalNote: any, index: number }[] = [];

          measure.staffEntries.forEach(gse => {
            const entryX = gse.PositionAndShape.AbsolutePosition.x * pixelPerUnit;
            gse.graphicalVoiceEntries.forEach(gve => {
              gve.notes.forEach((gn, index) => {
                if (gn.sourceNote && gn.sourceNote.Pitch) {
                  const soundingMidi = gn.sourceNote.Pitch.getHalfTone() + 12;
                  if (minMidi === null || soundingMidi < minMidi) minMidi = soundingMidi;
                  if (maxMidi === null || soundingMidi > maxMidi) maxMidi = soundingMidi;

                  noteDetails.push({
                    midi: soundingMidi,
                    x: entryX,
                    graphicalNote: gn,
                    index: index
                  });
                }
              });
            });
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
            minMidi,
            maxMidi,
            octaveShift: state.octaveShift,
            noteDetails
          });

          if (endShiftAfterThisMeasure) state.octaveShift = 0;
        });
      });
    });
  });
  
  return contexts;
};

export const getMeasureAtPoint = (x: number, y: number, contexts: MeasureContext[]): MeasureContext | null => {
  return contexts.find(ctx => x >= ctx.x && x <= ctx.x + ctx.width && y >= ctx.y && y <= ctx.y + ctx.height) || null;
};

export const calculateYForMidi = (midi: number, ctx: MeasureContext, ppu: number): number => {
  const space = ppu / 2;
  const displayMidi = midi + ctx.octaveShift;
  const pc = ((displayMidi % 12) + 12) % 12;
  const octave = Math.floor(displayMidi / 12);
  const stepMap = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
  const step = octave * 7 + stepMap[pc];
  const baselineStep = ctx.clefType === 'F' ? 25 : 37;
  const bottomLineY = ctx.staffY + 4 * ppu;
  return bottomLineY - (step - baselineStep) * space;
};

export const isDiatonic = (midi: number, fifths: number): boolean => {
  const pc = ((midi % 12) + 12) % 12;
  const circlePos = (pc * 7) % 12;
  const start = (fifths - 1 + 120) % 12;
  const normalizedPos = (circlePos - start + 12) % 12;
  return normalizedPos >= 0 && normalizedPos <= 6;
};