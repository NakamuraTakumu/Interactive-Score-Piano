import { useState, useCallback, memo, useEffect } from 'react'
import { Box, Container, Typography, CssBaseline, ThemeProvider, createTheme, Paper, Backdrop, CircularProgress, Stack } from '@mui/material'
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
  const activeNotes = useMidi();
  const { isAudioStarted, startAudio, volume, setVolume, playNotes } = usePianoSound();
  const { keepAwake } = useWakeLock();
  
  // Custom Hooks
  const { 
    scoreLibrary, currentScoreId, scoreData, isLoading, setIsLoading,
    handleFileUpload, handleScoreChange, handleDeleteScore, renameScore, updateScoreNameFromTitle
  } = useScoreLibrary();

  const {
    showAllLines, setShowAllLines, showGuideLines, setShowGuideLines
  } = usePianoSettings();

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
    }
  }, [activeNotes, keepAwake]);

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
    // If deleted current score, it defaults back to sample in the hook, but we might need to reset selection
    if (currentScoreId === id) {
       resetSelection();
    }
  };

  const handleVolumeChange = (_event: Event, newValue: number | number[]) => {
    setVolume(newValue as number);
  };

  const handleMeasureClick = useCallback((measure: MeasureContext, midiNotes: Set<number>, noteX: number | null, forcePlay: boolean = false) => {
    // Check if selection changed
    const isDifferentX = noteX !== selectedNoteX;
    const isDifferentMidi = midiNotes.size !== selectedMidiNotes.size || 
                            Array.from(midiNotes).some(n => !selectedMidiNotes.has(n));
    
    const isNewSelection = isDifferentX || isDifferentMidi;

    if (isNewSelection || forcePlay) {
      setSelectedMeasure(measure);
      setSelectedMidiNotes(midiNotes);
      setSelectedNoteX(noteX);

      // Play sound
      if (midiNotes.size > 0) {
        playNotes(Array.from(midiNotes));
      }
    }
  }, [playNotes, selectedNoteX, selectedMidiNotes]);

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
      <Box sx={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', pb: '140px' }}>
        <Container maxWidth="lg">
          <Box sx={{ my: 4 }}>
            <Typography variant="h4" component="h1" gutterBottom align="center">
              Interactive Score Piano
            </Typography>
            
            <ControlPanel 
              scoreLibrary={scoreLibrary}
              currentScoreId={currentScoreId}
              onScoreChange={onScoreChangeWrapper}
              onOpenEditDialog={handleOpenEditDialog}
              onDeleteScore={handleDeleteScoreWrapper}
              showAllLines={showAllLines}
              setShowAllLines={setShowAllLines}
              showGuideLines={showGuideLines}
              setShowGuideLines={setShowGuideLines}
              volume={volume}
              onVolumeChange={handleVolumeChange}
              isAudioStarted={isAudioStarted}
              onStartAudio={startAudio}
              onFileUpload={(e) => handleFileUpload(e, resetSelection)}
            />

            <Paper elevation={3} sx={{ p: 2, minHeight: '600px', position: 'relative' }}>
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
              />
            </Paper>
          </Box>
        </Container>
        
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

