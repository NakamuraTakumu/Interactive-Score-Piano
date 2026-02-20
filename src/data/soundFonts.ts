export interface SoundFontPreset {
  id: string;
  name: string;
  fileName: string;
}

export interface SoundFontOption {
  id: string;
  name: string;
  source: 'bundled' | 'user';
}

export const SOUND_FONT_PRESETS: SoundFontPreset[] = [
  {
    id: 'generaluser-gs',
    name: 'GeneralUser GS',
    fileName: 'GeneralUser-GS.sf2',
  },
];

export const DEFAULT_SOUND_FONT_ID = SOUND_FONT_PRESETS[0].id;

export const getSoundFontPreset = (id: string): SoundFontPreset =>
  SOUND_FONT_PRESETS.find((preset) => preset.id === id) ?? SOUND_FONT_PRESETS[0];

export const findSoundFontPreset = (id: string): SoundFontPreset | null =>
  SOUND_FONT_PRESETS.find((preset) => preset.id === id) ?? null;
