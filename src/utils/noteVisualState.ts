interface ResolveNoteVisualStateInput {
  midi: number;
  keySig: number;
  highlightBlackKeys: boolean;
  isMidiActive: boolean;
  isPlaybackActive: boolean;
}

export interface NoteVisualState {
  color: string | null;
}

const isBlackKey = (midi: number) => [1, 3, 6, 8, 10].includes(midi % 12);

export const resolveNoteVisualState = ({
  midi,
  keySig,
  highlightBlackKeys,
  isMidiActive,
  isPlaybackActive,
}: ResolveNoteVisualStateInput): NoteVisualState => {
  if (isMidiActive) return { color: '#ff0000' };
  if (isPlaybackActive) return { color: '#4caf50' };
  if (!highlightBlackKeys || !isBlackKey(midi)) return { color: null };

  return {
    color: keySig >= 0 ? '#fb8c00' : '#03a9f4',
  };
};
