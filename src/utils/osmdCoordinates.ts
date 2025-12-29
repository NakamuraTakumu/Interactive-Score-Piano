import { OpenSheetMusicDisplay, KeyInstruction, ClefInstruction } from 'opensheetmusicdisplay';
import { MeasureContext, ClefType } from '../types/piano';

export const getPixelPerUnit = (osmd: OpenSheetMusicDisplay, container: HTMLElement): number => {
  const graphicSheet = osmd.GraphicSheet;
  if (!graphicSheet || graphicSheet.MusicPages.length === 0) return 10.0;
  return 10.0 * osmd.Zoom; 
};

export const extractMeasureContexts = (osmd: OpenSheetMusicDisplay, pixelPerUnit: number): MeasureContext[] => {
  const graphicSheet = osmd.GraphicSheet;
  if (!graphicSheet) return [];
  const contexts: MeasureContext[] = [];
  const staffStates = new Map<number, { clef: string, key: number, octaveShift: number }>();

  graphicSheet.MusicPages.forEach((page, pIdx) => {
    page.MusicSystems.forEach((system, sIdx) => {
      system.StaffLines.forEach(staffLine => {
        const parentStaff = staffLine.ParentStaff;
        const staffId = parentStaff.idInMusicSheet;
        const staffIdx = osmd.Sheet.Staves.indexOf(parentStaff);

        if (!staffStates.has(staffId)) {
          staffStates.set(staffId, { clef: (staffId % 2 !== 0) ? 'F' : 'G', key: 0, octaveShift: 0 });
        }
        const state = staffStates.get(staffId)!;

        staffLine.Measures.forEach((measure, mIdx) => {
          const source = measure.parentSourceMeasure;
          let endShiftAfterThisMeasure = false;
          
          if (source && staffIdx >= 0) {
            // Key / Clef の更新
            if (source.FirstInstructionsStaffEntries?.[staffIdx]) {
                source.FirstInstructionsStaffEntries[staffIdx].Instructions.forEach(instr => {
                  if (instr instanceof KeyInstruction) {
                    state.key = instr.Key;
                  } else if (instr instanceof ClefInstruction) {
                    const c = instr.ClefType.toString();
                    state.clef = (c.includes('1') || c.includes('F')) ? 'F' : 'G';
                  }
                });
            }
            
            // OctaveShift の更新 (StaffLinkedExpressions)
            if (source.StaffLinkedExpressions?.[staffIdx]) {
                source.StaffLinkedExpressions[staffIdx].forEach(expr => {
                    // @ts-ignore
                    const start = expr.octaveShiftStart;
                    if (start) {
                        // OSMD OctaveEnum: 0=VA8, 1=VB8, 2=MA15, 3=MB15
                        // @ts-ignore
                        const val = start.octaveValue;
                        
                        let shift = 0;
                        if (val === 0) shift = -12;      // 8va: 記譜は実音より1オクターブ下
                        else if (val === 1) shift = 12;  // 8vb: 記譜は実音より1オクターブ上
                        else if (val === 2) shift = -24; // 15ma
                        else if (val === 3) shift = 24;  // 15mb
                        
                        state.octaveShift = shift;
                    }
                    // @ts-ignore
                    if (expr.octaveShiftEnd) {
                        endShiftAfterThisMeasure = true;
                    }
                });
            }
          }

          let minMidi: number | null = null;
          let maxMidi: number | null = null;

          // 音符の解析
          measure.staffEntries.forEach(entry => {
            entry.sourceStaffEntry.VoiceEntries.forEach(ve => {
                ve.Notes.forEach(note => {
                  if (note.Pitch) {
                    const baseMidi = note.Pitch.getHalfTone() + 12;
                    const soundingMidi = baseMidi;
                    if (minMidi === null || soundingMidi < minMidi) minMidi = soundingMidi;
                    if (maxMidi === null || soundingMidi > maxMidi) maxMidi = soundingMidi;
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
            height: measureSize.height * pixelPerUnit,
            staffY: absStaffPos.y * pixelPerUnit,
            clefType: state.clef as ClefType,
            keySig: state.key,
            minMidi,
            maxMidi,
            octaveShift: state.octaveShift
          });

          if (endShiftAfterThisMeasure) {
              state.octaveShift = 0;
          }
        });
      });
    });
  });
  
  return contexts;
};

export const calculateYForMidi = (midi: number, ctx: MeasureContext, ppu: number): number => {
  const space = ppu / 2;
  // 実音(midi)に octaveShift (-12など) を加えて記譜上の高さに変換
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
