import { useState, useEffect } from 'react';

export const usePianoSettings = () => {
  const [showAllLines, setShowAllLines] = useState<boolean>(() => {
    const saved = localStorage.getItem('piano_show_all_lines');
    return saved === 'true';
  });

  const [showGuideLines, setShowGuideLines] = useState<boolean>(() => {
    const saved = localStorage.getItem('piano_show_guide_lines');
    return saved === null ? true : saved === 'true';
  });

  // Persist settings to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('piano_show_all_lines', showAllLines.toString());
      localStorage.setItem('piano_show_guide_lines', showGuideLines.toString());
    } catch (e) {
      console.warn('Failed to save settings to localStorage:', e);
    }
  }, [showAllLines, showGuideLines]);

  return {
    showAllLines,
    setShowAllLines,
    showGuideLines,
    setShowGuideLines
  };
};
