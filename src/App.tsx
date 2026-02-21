import { useState, useCallback, memo, useEffect } from 'react'
import { Box, Typography, CssBaseline, ThemeProvider, createTheme, Paper, Backdrop, CircularProgress, Stack } from '@mui/material'
import ScoreDisplay from './components/ScoreDisplay'
import PianoKeyboard from './components/PianoKeyboard'
import ControlPanel from './components/ControlPanel'
import ScoreRenameDialog from './components/ScoreRenameDialog'
import { useMidi } from './hooks/useMidi'
import { usePianoSound } from './hooks/usePianoSound'
import { useWakeLock } from './hooks/useWakeLock'
import { useScoreLibrary } from './hooks/useScoreLibrary'
import { usePianoSettings } from './hooks/usePianoSettings'
import { SavedScore, SelectionResult } from './types/piano'
import { DEFAULT_SOUND_FONT_ID, SOUND_FONT_PRESETS, SoundFontOption } from './data/soundFonts'
import { listUserSoundFonts, saveUserSoundFont } from './utils/soundFontStorage'

const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#1976d2',
    },
  },
})

// Memoized ScoreDisplay to prevent unnecessary re-renders
const MemoizedScoreDisplay = memo(ScoreDisplay);
const EMPTY_NOTES = new Set<number>();

function App() {
  const { settings, updateSetting, showAllLines, showGuideLines } = usePianoSettings();
  const [soundFontOptions, setSoundFontOptions] = useState<SoundFontOption[]>(
    SOUND_FONT_PRESETS.map((preset) => ({ id: preset.id, name: preset.name, source: 'bundled' as const }))
  );
  const [isSoundFontOptionsReady, setIsSoundFontOptionsReady] = useState(false);
  
  const { 
    isAudioStarted, isSamplesLoaded, audioEngine, startAudio, playNotes, handleMidiEvent
  } = usePianoSound(settings, updateSetting);

  const { activeNotes, availableDevices, selectedDeviceId, selectDevice } = useMidi(handleMidiEvent, startAudio);
  const { keepAwake } = useWakeLock();
  
  // Custom Hooks
  const { 
    scoreLibrary, currentScoreId, scoreData, isLoading, setIsLoading,
    handleFileUpload, handleScoreChange, handleDeleteScore, renameScore, updateScoreNameFromTitle
  } = useScoreLibrary();

  // Local State for Interaction
  const [selected, setSelected] = useState<SelectionResult | null>(null);

  // Rename dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingScoreId, setEditingScoreId] = useState<string | null>(null);
  const [newScoreName, setNewScoreName] = useState('');

  const refreshUserSoundFonts = useCallback(async () => {
    const bundled = SOUND_FONT_PRESETS.map((preset) => ({ id: preset.id, name: preset.name, source: 'bundled' as const }));
    try {
      const userFonts = await listUserSoundFonts();
      const mappedUsers: SoundFontOption[] = userFonts.map((font) => ({
        id: font.id,
        name: font.name,
        source: 'user',
      }));
      setSoundFontOptions([...bundled, ...mappedUsers]);
    } catch (error) {
      console.error('Failed to read user SoundFonts from IndexedDB:', error);
      setSoundFontOptions(bundled);
    } finally {
      setIsSoundFontOptionsReady(true);
    }
  }, []);

  useEffect(() => {
    void refreshUserSoundFonts();
  }, [refreshUserSoundFonts]);

  useEffect(() => {
    if (!isSoundFontOptionsReady) return;
    if (soundFontOptions.length === 0) return;
    const exists = soundFontOptions.some((font) => font.id === settings.selectedSoundFontId);
    if (!exists) {
      updateSetting('selectedSoundFontId', DEFAULT_SOUND_FONT_ID);
    }
  }, [settings.selectedSoundFontId, soundFontOptions, isSoundFontOptionsReady, updateSetting]);

  // Keep screen awake when MIDI activity is detected
  useEffect(() => {
    if (activeNotes.size > 0) {
      keepAwake();
      if (!isAudioStarted) {
        void startAudio();
      }
    }
  }, [activeNotes, keepAwake, isAudioStarted, startAudio]);

  // Reset selection when score changes
  const resetSelection = useCallback(() => {
    setSelected(null);
  }, []);

  const onScoreChangeWrapper = (id: string) => {
    handleScoreChange(id, resetSelection);
  };
  
  const handleOpenEditDialog = (e: React.MouseEvent, score: SavedScore) => {
    e.stopPropagation();
    setEditingScoreId(score.id);
    setNewScoreName(score.name);
    setEditDialogOpen(true);
  };

  const handleSaveNewName = () => {
    if (editingScoreId && newScoreName.trim()) {
      renameScore(editingScoreId, newScoreName);
    }
    setEditDialogOpen(false);
  };

  const handleDeleteScoreWrapper = (e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    handleDeleteScore(id);
    if (currentScoreId === id) resetSelection();
  };

  const handleSoundFontUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;

    if (!file.name.toLowerCase().endsWith('.sf2')) {
      alert('Please select a .sf2 file.');
      return;
    }

    try {
      const saved = await saveUserSoundFont(file);
      await refreshUserSoundFonts();
      updateSetting('selectedSoundFontId', saved.id);
      void startAudio();
    } catch (error) {
      console.error('Failed to store user SoundFont:', error);
      alert('Failed to register SoundFont.');
    }
  };

  const handleSelectionChange = useCallback((
    nextSelection: SelectionResult | null,
    forcePlay: boolean = false
  ) => {
    if (!nextSelection) {
      resetSelection();
      return;
    }

    const isDifferentColumn = nextSelection.columnKey !== selected?.columnKey;
    const prevMidiNotes = selected?.midiNotes ?? EMPTY_NOTES;
    const isDifferentMidi = nextSelection.midiNotes.size !== prevMidiNotes.size || 
                            Array.from(nextSelection.midiNotes).some(n => !prevMidiNotes.has(n));
    const isNewSelection = isDifferentColumn || isDifferentMidi;

    if (isNewSelection || forcePlay) {
      setSelected(nextSelection);
      if (nextSelection.midiNotes.size > 0) playNotes(Array.from(nextSelection.midiNotes));
    }
  }, [playNotes, selected, resetSelection]);

  const handleTitleReady = useCallback((title: string) => {
    updateScoreNameFromTitle(currentScoreId, title);
  }, [currentScoreId, updateScoreNameFromTitle]);

  const handleLoadingStateChange = useCallback((loading: boolean) => {
    setIsLoading(loading);
  }, [setIsLoading]);

  // Initialize audio context on first interaction
  useEffect(() => {
    if (isAudioStarted) return;
    const initAudioOnFirstInteraction = () => {
      startAudio().then(() => {
        ['click', 'keydown', 'touchstart', 'mousedown'].forEach(event => {
          window.removeEventListener(event, initAudioOnFirstInteraction);
        });
      });
    };
    ['click', 'keydown', 'touchstart', 'mousedown'].forEach(event => {
      window.addEventListener(event, initAudioOnFirstInteraction, { once: true });
    });
    return () => {
      ['click', 'keydown', 'touchstart', 'mousedown'].forEach(event => {
        window.removeEventListener(event, initAudioOnFirstInteraction);
      });
    };
  }, [isAudioStarted, startAudio]);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Box 
        sx={{ 
          display: 'flex', 
          flexDirection: 'column', 
          minHeight: '100vh', 
          pb: '140px',
          bgcolor: '#f5f5f5' // 背景を少しグレーにしてPaperを際立たせる
        }}
        onClick={resetSelection}
      >
        <Box sx={{ px: { xs: 1, sm: 2, md: 4 }, py: 2, width: '100%' }}>
          <Typography variant="h5" component="h1" gutterBottom align="center" sx={{ fontWeight: 'bold', mb: 2 }}>
            Interactive Score Piano
          </Typography>
          
          <ControlPanel 
            scoreLibrary={scoreLibrary}
            currentScoreId={currentScoreId}
            onScoreChange={onScoreChangeWrapper}
            onOpenEditDialog={handleOpenEditDialog}
            onDeleteScore={handleDeleteScoreWrapper}
            settings={settings}
            updateSetting={updateSetting}
            isAudioStarted={isAudioStarted}
            onStartAudio={startAudio}
            onFileUpload={(e) => handleFileUpload(e, resetSelection)}
            soundFontOptions={soundFontOptions}
            onSoundFontUpload={handleSoundFontUpload}
            isSamplesLoaded={isSamplesLoaded}
            audioEngine={audioEngine}
            availableMidiDevices={availableDevices}
            selectedMidiDeviceId={selectedDeviceId}
            onMidiDeviceChange={selectDevice}
            activeNotes={activeNotes}
          />

          <Paper 
            elevation={2} 
            sx={{ 
              p: 1, 
              minHeight: '70vh', 
              position: 'relative',
              width: '100%',
              overflow: 'hidden'
            }}
            onClick={resetSelection}
          >
            <MemoizedScoreDisplay 
              data={scoreData} 
              showAllLines={showAllLines} 
              showGuideLines={showGuideLines}
              onSelectionChange={handleSelectionChange}
              onTitleReady={handleTitleReady}
              onLoadingStateChange={handleLoadingStateChange}
              selection={selected}
              activeNotes={activeNotes}
              highlightBlackKeys={settings.highlightBlackKeys}
              visualTranspose={settings.visualTranspose}
            />
          </Paper>
        </Box>
        
        <ScoreRenameDialog 
          open={editDialogOpen}
          onClose={() => setEditDialogOpen(false)}
          newScoreName={newScoreName}
          setNewScoreName={setNewScoreName}
          onSave={handleSaveNewName}
        />

        {/* Loading Overlay */}
        <Backdrop
          sx={{ color: '#fff', zIndex: (theme) => theme.zIndex.drawer + 1, position: 'absolute' }}
          open={isLoading}
        >
          <Stack alignItems="center" spacing={2}>
            <CircularProgress color="inherit" />
            <Typography variant="h6">Loading score...</Typography>
          </Stack>
        </Backdrop>

        <Box sx={{ position: 'fixed', bottom: 0, left: 0, right: 0, zIndex: 1100 }}>
          <PianoKeyboard 
            activeNotes={activeNotes} 
            highlightNotes={selected?.midiNotes ?? EMPTY_NOTES}
            keySig={selected?.measure.keySig ?? null}
          />
        </Box>
      </Box>
    </ThemeProvider>
  )
}

export default App;
