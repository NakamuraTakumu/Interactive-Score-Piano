export type ClefType = 'G' | 'F' | 'C';

export interface MeasureContext {
  measureNumber: number;
  staffId: number;
  systemId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  staffY: number;
  clefType: ClefType;
  keySig: number;
  minMidi: number | null;
  maxMidi: number | null;
  octaveShift: number; // 視覚的な高さ補正（半音単位）。8vaなら-12
  noteDetails: {
    midi: number;
    graphicalNote: any; // GraphicalNote
  }[];
}
