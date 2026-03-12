export interface SavedScore {
  id: string;
  name: string;
  data: string;
  timestamp: number;
}

export type ClefType = 'G' | 'F' | 'C';
export type SoundType = 'piano' | 'synth';

export interface PianoSettings {
  showAllLines: boolean;
  showGuideLines: boolean;
  showMidiMatchLines: boolean;
  soundType: SoundType;
  selectedSoundFontId: string;
  gmProgram: number;
  volume: number;
  reverbEnabled: boolean;
  chorusEnabled: boolean;
  reverb: number;
  transpose: number;
  visualTranspose: number;
  sustainEnabled: boolean;
  velocitySensitivity: number;
  highlightBlackKeys: boolean;
}

export interface NoteDetail {
  midi: number;
  x: number; // 音符列の代表 x 座標（ピクセル）
  columnKey: string; // OSMD absolute timestamp ベースの列識別子
  graphicalNote: any; // GraphicalNote
  index: number;
}

export interface ColumnDetail {
  x: number; // クリック判定用の列 x 座標（ピクセル）
  columnKey: string; // OSMD absolute timestamp ベースの列識別子
}

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
  keyMode: string;
  minMidi: number | null;
  maxMidi: number | null;
  octaveShift: number; // 視覚的な高さ補正（半音単位）。8vaなら-12
  columnDetails: ColumnDetail[];
  noteDetails: NoteDetail[];
}

export interface SelectionResult {
  measure: MeasureContext;
  midiNotes: Set<number>;
  noteX: number | null;
  columnKey: string | null;
}
