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
import { MeasureContext, SavedScore } from './types/piano'

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

function App() {
  const { settings, updateSetting, showAllLines, showGuideLines } = usePianoSettings();
  
  const { 
    isAudioStarted, isSamplesLoaded, startAudio, playNotes, workletNode
  } = usePianoSound(settings, updateSetting);

  const { activeNotes, availableDevices, selectedDeviceId, selectDevice } = useMidi(workletNode, startAudio);
  const { keepAwake } = useWakeLock();
  
  // Custom Hooks
  const { 
    scoreLibrary, currentScoreId, scoreData, isLoading, setIsLoading,
    handleFileUpload, handleScoreChange, handleDeleteScore, renameScore, updateScoreNameFromTitle
  } = useScoreLibrary();

  // Local State for Interaction
  const [selectedMeasure, setSelectedMeasure] = useState<MeasureContext | null>(null);
  const [selectedMidiNotes, setSelectedMidiNotes] = useState<Set<number>>(new Set());
  const [selectedNoteX, setSelectedNoteX] = useState<number | null>(null);

  // Rename dialog state
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingScoreId, setEditingScoreId] = useState<string | null>(null);
  const [newScoreName, setNewScoreName] = useState('');

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
    setSelectedMeasure(null);
    setSelectedMidiNotes(new Set());
    setSelectedNoteX(null);
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

  const handleMeasureClick = useCallback((measure: MeasureContext | null, midiNotes: Set<number>, noteX: number | null, forcePlay: boolean = false) => {
    if (!measure) {
      resetSelection();
      return;
    }

    const isDifferentX = noteX !== selectedNoteX;
    const isDifferentMidi = midiNotes.size !== selectedMidiNotes.size || 
                            Array.from(midiNotes).some(n => !selectedMidiNotes.has(n));
    const isNewSelection = isDifferentX || isDifferentMidi;

    if (isNewSelection || forcePlay) {
      setSelectedMeasure(measure);
      setSelectedMidiNotes(midiNotes);
      setSelectedNoteX(noteX);
      if (midiNotes.size > 0) playNotes(Array.from(midiNotes));
    }
  }, [playNotes, selectedNoteX, selectedMidiNotes, resetSelection]);

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
            isSamplesLoaded={isSamplesLoaded}
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
              onMeasureClick={handleMeasureClick}
              onTitleReady={handleTitleReady}
              onLoadingStateChange={handleLoadingStateChange}
              selectedMeasureNumber={selectedMeasure?.measureNumber}
              selectedMidiNotes={selectedMidiNotes}
              selectedNoteX={selectedNoteX}
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
            highlightNotes={selectedMidiNotes}
            keySig={selectedMeasure?.keySig}
          />
        </Box>
      </Box>
    </ThemeProvider>
  )
}

export default App;
