import { useState, useEffect } from 'react';
import { PianoSettings, SoundType } from '../types/piano';
import { DEFAULT_SOUND_FONT_ID } from '../data/soundFonts';

const DEFAULT_SETTINGS: PianoSettings = {
  showAllLines: false,
  showGuideLines: true,
  soundType: 'piano',
  selectedSoundFontId: DEFAULT_SOUND_FONT_ID,
  gmProgram: 0,
  volume: 0,
  reverbEnabled: true,
  chorusEnabled: false,
  reverb: 0.1,
  transpose: 0,
  visualTranspose: 0,
  sustainEnabled: false,
  velocitySensitivity: 1,
  highlightBlackKeys: true
};

export const usePianoSettings = () => {
  const [settings, setSettings] = useState<PianoSettings>(() => {
    const saved = localStorage.getItem('piano_app_settings');
    if (saved) {
      try {
        return { ...DEFAULT_SETTINGS, ...JSON.parse(saved) };
      } catch (e) {
        return DEFAULT_SETTINGS;
      }
    }
    return DEFAULT_SETTINGS;
  });

  const updateSetting = <K extends keyof PianoSettings>(key: K, value: PianoSettings[K]) => {
    setSettings(prev => ({ ...prev, [key]: value }));
  };

  const resetSettings = () => {
    setSettings(DEFAULT_SETTINGS);
  };

  // Persist settings to localStorage
  useEffect(() => {
    localStorage.setItem('piano_app_settings', JSON.stringify(settings));
  }, [settings]);

  return {
    settings,
    updateSetting,
    resetSettings,
    // Helper accessors for convenience
    showAllLines: settings.showAllLines,
    setShowAllLines: (val: boolean) => updateSetting('showAllLines', val),
    showGuideLines: settings.showGuideLines,
    setShowGuideLines: (val: boolean) => updateSetting('showGuideLines', val),
    soundType: settings.soundType,
    setSoundType: (val: SoundType) => updateSetting('soundType', val),
    volume: settings.volume,
    setVolume: (val: number) => updateSetting('volume', val)
  };
};
