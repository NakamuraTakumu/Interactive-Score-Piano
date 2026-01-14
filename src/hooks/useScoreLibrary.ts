import { useState, useEffect, useMemo, ChangeEvent } from 'react';
import { SavedScore } from '../types/piano';
import { sampleMusicXML, clefChangeSampleXML } from '../data/sampleScores';

export const useScoreLibrary = () => {
  const [scoreLibrary, setScoreLibrary] = useState<SavedScore[]>(() => {
    const saved = localStorage.getItem('piano_score_library');
    return saved ? JSON.parse(saved) : [];
  });

  const [currentScoreId, setCurrentScoreId] = useState<string>(() => {
    return localStorage.getItem('piano_current_score_id') || 'sample';
  });

  const [scoreData, setScoreData] = useState<string>(() => {
    if (currentScoreId === 'sample') return sampleMusicXML;
    if (currentScoreId === 'clef-sample') return clefChangeSampleXML;
    const saved = localStorage.getItem('piano_score_library');
    if (saved) {
      const library: SavedScore[] = JSON.parse(saved);
      const current = library.find(s => s.id === currentScoreId);
      return current ? current.data : sampleMusicXML;
    }
    return sampleMusicXML;
  });

  const [isLoading, setIsLoading] = useState(false);

  // Save library and state to localStorage
  useEffect(() => {
    try {
      localStorage.setItem('piano_score_library', JSON.stringify(scoreLibrary));
      localStorage.setItem('piano_current_score_id', currentScoreId);
    } catch (e) {
      console.warn('Failed to save score library to localStorage:', e);
    }
  }, [scoreLibrary, currentScoreId]);

  // Extract title from MusicXML
  const extractTitleFromXML = (xmlString: string, fallbackName: string): string => {
    try {
      if (!xmlString.includes('<?xml')) return fallbackName.replace(/\.[^/.]+$/, "").trim();
      const parser = new DOMParser();
      const xmlDoc = parser.parseFromString(xmlString, "text/xml");
      const workTitle = xmlDoc.getElementsByTagName("work-title")[0]?.textContent;
      const movementTitle = xmlDoc.getElementsByTagName("movement-title")[0]?.textContent;
      const creditText = xmlDoc.getElementsByTagName("credit-words")[0]?.textContent;
      const title = workTitle || movementTitle || creditText || fallbackName.replace(/\.[^/.]+$/, "");
      return title.trim();
    } catch (e) {
      return fallbackName.replace(/\.[^/.]+$/, "").trim();
    }
  };

  const handleFileUpload = (event: ChangeEvent<HTMLInputElement>, onComplete?: () => void) => {
    const file = event.target.files?.[0];
    if (!file) return;
    
    setIsLoading(true);
    const isMxl = file.name.toLowerCase().endsWith('.mxl');
    const reader = new FileReader();
    
    reader.onload = (e) => {
      const result = e.target?.result;
      if (typeof result === 'string') {
        const rawTitle = isMxl ? file.name.replace(/\.[^/.]+$/, "") : extractTitleFromXML(result, file.name);
        const title = rawTitle.trim();
        
        const newScore: SavedScore = {
          id: Math.random().toString(36).substr(2, 9),
          name: title,
          data: result,
          timestamp: Date.now()
        };

        try {
          setScoreLibrary(prev => [newScore, ...prev]);
          setScoreData(result);
          setCurrentScoreId(newScore.id);
          onComplete?.();
        } catch (err) {
          alert('Storage is full. Please delete some scores.');
        } finally {
          setIsLoading(false);
        }
      }
    };

    if (isMxl) {
      reader.readAsBinaryString(file);
    } else {
      reader.readAsText(file, 'UTF-8');
    }
  };

  const handleScoreChange = (id: string, onBeforeChange?: () => void) => {
    if (id === currentScoreId) return;
    setIsLoading(true);
    onBeforeChange?.();
    
    if (id === 'sample') {
      setScoreData(sampleMusicXML);
      setCurrentScoreId('sample');
    } else if (id === 'clef-sample') {
      setScoreData(clefChangeSampleXML);
      setCurrentScoreId('clef-sample');
    } else {
      const score = scoreLibrary.find(s => s.id === id);
      if (score) {
        setScoreData(score.data);
        setCurrentScoreId(id);
      }
    }
  };

  const handleDeleteScore = (id: string) => {
    if (id === 'sample' || id === 'clef-sample') return;
    
    const newLibrary = scoreLibrary.filter(s => s.id !== id);
    setScoreLibrary(newLibrary);
    
    if (currentScoreId === id) {
      handleScoreChange('sample');
    }
  };

  const renameScore = (id: string, newName: string) => {
    const trimmedName = newName.trim();
    if (!trimmedName) return;
    
    setScoreLibrary(prev => {
      // Prevent exact duplicates by adding a suffix if needed
      let finalName = trimmedName;
      let counter = 1;
      while (prev.some(s => s.id !== id && s.name === finalName)) {
        finalName = `${trimmedName} (${counter++})`;
      }

      return prev.map(s => s.id === id ? { ...s, name: finalName } : s);
    });
  };

  const updateScoreNameFromTitle = (id: string, title: string) => {
    if (!title || title === "Untitled" || title === "Unknown") return;
    const trimmedTitle = title.trim();
    setScoreLibrary(prev => {
      const score = prev.find(s => s.id === id);
      if (score && (score.name.includes('.') || score.name === 'Grand Staff Sample')) {
        if (score.name !== trimmedTitle) {
          return prev.map(s => s.id === id ? { ...s, name: trimmedTitle } : s);
        }
      }
      return prev;
    });
  };

  return {
    scoreLibrary,
    currentScoreId,
    scoreData,
    isLoading,
    setIsLoading,
    handleFileUpload,
    handleScoreChange,
    handleDeleteScore,
    renameScore,
    updateScoreNameFromTitle
  };
};

