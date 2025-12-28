export type ClefType = 'G' | 'F' | 'C';

export interface MeasureContext {
  measureNumber: number;
  staffId: number;
  x: number;
  y: number;
  width: number;
  height: number;
  staffY: number;
  clefType: ClefType;
  keySig: number;
}
