import { OpenSheetMusicDisplay, KeyInstruction, ClefInstruction } from 'opensheetmusicdisplay';
import { MeasureContext, ClefType } from '../types/piano';

export const getPixelPerUnit = (osmd: OpenSheetMusicDisplay, container: HTMLElement): number => {
  const graphicSheet = osmd.GraphicSheet;
  if (!graphicSheet || graphicSheet.MusicPages.length === 0) return 10.0;
  const logicalWidth = graphicSheet.MusicPages[0].PositionAndShape.Size.width;
  const svgElement = container.querySelector('svg');
  if (!svgElement) return 10.0;
  return svgElement.getBoundingClientRect().width / logicalWidth;
};

export const extractMeasureContexts = (osmd: OpenSheetMusicDisplay, pixelPerUnit: number): MeasureContext[] => {
  const graphicSheet = osmd.GraphicSheet;
  if (!graphicSheet) return [];

  const contexts: MeasureContext[] = [];
  const staffState = new Map<number, { clef: string, key: number }>();

  graphicSheet.MusicPages.forEach(page => {
    const pageY = page.PositionAndShape.AbsolutePosition.y;
    page.MusicSystems.forEach(system => {
      const systemY = system.PositionAndShape.AbsolutePosition.y;
      system.StaffLines.forEach(staffLine => {
        const parentStaff = staffLine.ParentStaff;
        const staffId = parentStaff.idInMusicSheet;
        const staffIdx = osmd.Sheet.Staves.indexOf(parentStaff);

        if (!staffState.has(staffId)) {
          staffState.set(staffId, { clef: 'G', key: 0 });
        }
        const state = staffState.get(staffId)!;

        staffLine.Measures.forEach((measure, mIdx) => {
          const sourceMeasure = measure.parentSourceMeasure;
          
          if (sourceMeasure && staffIdx >= 0 && sourceMeasure.FirstInstructionsStaffEntries) {
            const entry = sourceMeasure.FirstInstructionsStaffEntries[staffIdx];
            if (entry && entry.Instructions) {
              entry.Instructions.forEach(instr => {
                if ('Key' in instr) {
                  state.key = (instr as KeyInstruction).Key;
                } else if ('ClefType' in instr) {
                  const typeStr = (instr as ClefInstruction).ClefType.toString();
                  if (typeStr === '1' || typeStr.toLowerCase().includes('f')) state.clef = 'F';
                  else if (typeStr === '2' || typeStr.toLowerCase().includes('c')) state.clef = 'C';
                  else state.clef = 'G';
                }
              });
            }
          }

          const measureAbsPos = measure.PositionAndShape.AbsolutePosition;
          const measureSize = measure.PositionAndShape.Size;

          // システムとページのオフセットを合算
          const finalStaffY = (pageY + systemY + staffLine.PositionAndShape.RelativePosition.y) * pixelPerUnit;
          const finalMeasureY = (pageY + systemY + measure.PositionAndShape.RelativePosition.y) * pixelPerUnit;

          contexts.push({
            measureNumber: sourceMeasure ? sourceMeasure.MeasureNumber : (mIdx + 1),
            staffId: staffId,
            x: measureAbsPos.x * pixelPerUnit,
            y: finalMeasureY,
            width: measureSize.width * pixelPerUnit,
            height: measureSize.height * pixelPerUnit,
            staffY: finalStaffY,
            clefType: state.clef as ClefType,
            keySig: state.key
          });
        });
      });
    });
  });

  return contexts;
};

/**
 * MIDI pitch class (0-11) と調号(fifths)から、五線譜上のステップ位置(0.0-6.5)を算出する
 */
const getPitchStepInfo = (pc: number, fifths: number): { step: number, isDiatonic: boolean } => {
  // 基本ステップ: C, D, E, F, G, A, B
  const steps = [0, 0, 1, 1, 2, 3, 3, 4, 4, 5, 5, 6];
  const isBlack = [false, true, false, true, false, false, true, false, true, false, true, false];

  let step = steps[pc];
  let isDiatonic = !isBlack[pc];

  // 調号に基づく吸着ロジック
  const sharps = [5, 0, 7, 2, 9, 4, 11]; // F, C, G, D, A, E, B
  const flats = [11, 4, 9, 2, 7, 0, 5];  // B, E, A, D, G, C, F

  if (fifths > 0) {
    // シャープ系の調: 特定の音(pc)が調号に含まれるなら、下のステップに吸着
    for (let i = 0; i < fifths; i++) {
        const sharpedPc = (sharps[i] + 1) % 12;
        if (pc === sharpedPc) {
            step = steps[sharps[i]]; // 例: F#(6) -> F(3)
            isDiatonic = true;
            break;
        }
    }
  } else if (fifths < 0) {
    // フラット系の調: 特定の音(pc)が調号に含まれるなら、上のステップに吸着
    for (let i = 0; i < Math.abs(fifths); i++) {
        const flattedPc = (flats[i] - 1 + 12) % 12;
        if (pc === flattedPc) {
            step = (steps[flats[i]]) % 7; // 例: Bb(10) -> B(6)
            isDiatonic = true;
            break;
        }
    }
  }

  // 調外音（臨時記号が必要な音）なら 0.5 ステップずらして「線の間」に表示
  const finalStep = isDiatonic ? step : step + 0.5;
  return { step: finalStep, isDiatonic };
};

export const isDiatonic = (midi: number, fifths: number): boolean => {
  return getPitchStepInfo(midi % 12, fifths).isDiatonic;
};

export const calculateYForMidi = (midi: number, ctx: MeasureContext, pixelPerUnit: number): number => {
  const staffHeightPx = 4.0 * pixelPerUnit;
  const spaceHeightPx = staffHeightPx / 4;

  // 中央ド(C4, MIDI 60) を Octave 4, Step 0 と定義
  // G Clef 最上線 F5 (MIDI 77) = 5*7 + 3 = 38
  // F Clef 最上線 A3 (MIDI 57) = 3*7 + 5 = 26
  const topStepRef = ctx.clefType === 'F' ? 26 : 38;

  const octave = Math.floor(midi / 12) - 1; // MIDI 60 -> Octave 4
  const info = getPitchStepInfo(midi % 12, ctx.keySig);
  
  const targetStepAbsolute = octave * 7 + info.step;
  const stepDiffFromTop = topStepRef - targetStepAbsolute;

  return ctx.staffY + (stepDiffFromTop * (spaceHeightPx / 2));
};