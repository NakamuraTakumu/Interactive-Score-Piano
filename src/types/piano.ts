export interface SavedScore {
  id: string;
  name: string;
  data: string;
  timestamp: number;
}

export type ClefType = 'G' | 'F' | 'C';
export type SoundType = 'piano' | 'synth';
export const SCORE_DRAWING_PARAMETER_VALUES = [
  'default',
  'compact',
  'compacttight',
] as const;
export type ScoreDrawingParameters = typeof SCORE_DRAWING_PARAMETER_VALUES[number];

export const isScoreDrawingParameters = (value: unknown): value is ScoreDrawingParameters =>
  typeof value === 'string' && SCORE_DRAWING_PARAMETER_VALUES.includes(value as ScoreDrawingParameters);

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
  scoreDrawingParameters: ScoreDrawingParameters;
  playbackBpm: number;
  playbackLoop: boolean;
}

export interface NoteDetail {
  midi: number; // current rendered score pitch used for hit-test and notehead state
  x: number; // 音符列の代表 x 座標（ピクセル）
  columnKey: string; // OSMD absolute timestamp ベースの列識別子
  noteIdentity: string; // source note / rendered notehead を対応付ける識別子
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

export type StaffScope =
  | { type: 'all' }
  | { type: 'staffs'; staffIds: number[] };

export interface ScoreRangeDraft {
  startColumnKey: string;
  endColumnKey: string;
  columnKeys: string[];
  staffScope: StaffScope;
}

export interface ScoreRangeSelection extends ScoreRangeDraft {}

export type PlaybackStatus = 'stopped' | 'playing' | 'paused';

export interface PlaybackNoteEvent {
  id: string;
  type: 'note-on' | 'note-off';
  tick: number;
  columnKey: string;
  measureNumber: number;
  systemId: number;
  staffId: number;
  noteIdentity: string;
  sourceMidi: number;
  soundingMidi: number;
  renderedMidi: number;
  durationTicks?: number;
}

export interface PlaybackTimeline {
  ppq: number;
  durationTicks: number;
  events: PlaybackNoteEvent[];
  generation?: number;
  scoreBpm?: number;
}
