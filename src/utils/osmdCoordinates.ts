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
  const staffStates = new Map<number, { clef: string, key: number }>();

  graphicSheet.MusicPages.forEach(page => {
    const pageY = page.PositionAndShape.AbsolutePosition.y;
    page.MusicSystems.forEach(system => {
      const systemY = system.PositionAndShape.AbsolutePosition.y;
      system.StaffLines.forEach(staffLine => {
        const parentStaff = staffLine.ParentStaff;
        const staffId = parentStaff.idInMusicSheet;
        const staffIdx = osmd.Sheet.Staves.indexOf(parentStaff);

        if (!staffStates.has(staffId)) {
          staffStates.set(staffId, { clef: (staffId % 2 !== 0) ? 'F' : 'G', key: 0 });
        }
        const state = staffStates.get(staffId)!;

        staffLine.Measures.forEach((measure, mIdx) => {
          const source = measure.parentSourceMeasure;
          if (source && staffIdx >= 0 && source.FirstInstructionsStaffEntries?.[staffIdx]) {
            source.FirstInstructionsStaffEntries[staffIdx].Instructions.forEach(instr => {
              if ('Key' in instr) state.key = (instr as KeyInstruction).Key;
              else if ('ClefType' in instr) {
                const c = (instr as ClefInstruction).ClefType.toString();
                state.clef = (c.includes('1') || c.includes('F')) ? 'F' : 'G';
              }
            });
          }

          const absMeasurePos = measure.PositionAndShape.AbsolutePosition;
          const absStaffPos = staffLine.PositionAndShape.AbsolutePosition;
          const measureSize = measure.PositionAndShape.Size;

          contexts.push({
            measureNumber: source ? source.MeasureNumber : mIdx + 1,
            staffId: staffId,
            x: absMeasurePos.x * pixelPerUnit,
            y: absMeasurePos.y * pixelPerUnit,
            width: measureSize.width * pixelPerUnit,
            height: measureSize.height * pixelPerUnit,
            staffY: absStaffPos.y * pixelPerUnit,
            clefType: state.clef as ClefType,
            keySig: state.key
          });
        });
      });
    });
  });
  return contexts;
};

export const calculateYForMidi = (midi: number, ctx: MeasureContext, ppu: number): number => {
  const space = ppu / 2;
  const nominalMidi = midi - ctx.keySig;
  const octave = Math.floor(nominalMidi / 12);
  const pc = ((nominalMidi % 12) + 12) % 12;
  const stepMap = [0, 0.5, 1, 1.5, 2, 3, 3.5, 4, 4.5, 5, 5.5, 6];
  const step = octave * 7 + stepMap[pc];
  
  // 基準線（第1線）のステップ数をオクターブ分（+7）修正
  // ト音記号: 第1線(E4, MIDI 64) -> Step 37 (5*7 + 2)
  // ヘ音記号: 第1線(G2, MIDI 43) -> Step 25 (3*7 + 4)
  const baselineStep = ctx.clefType === 'F' ? 25 : 37;
  const bottomLineY = ctx.staffY + 4 * ppu;

  return bottomLineY - (step - baselineStep) * space;
};

export const isDiatonic = (midi: number, fifths: number): boolean => {
  const nominalPc = ((midi - fifths) % 12 + 12) % 12;
  return [0, 2, 4, 5, 7, 9, 11].includes(nominalPc);
};