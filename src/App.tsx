import { useState, useCallback, memo, useEffect, useRef } from 'react'
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
import { PlaybackNoteEvent, PlaybackStatus, PlaybackTimeline, SavedScore, ScoreRangeSelection, SelectionResult } from './types/piano'
import { DEFAULT_SOUND_FONT_ID, SOUND_FONT_PRESETS, SoundFontOption } from './data/soundFonts'
import { deleteUserSoundFont, listUserSoundFonts, saveUserSoundFont } from './utils/soundFontStorage'

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
const getPlaybackEventBaseId = (event: PlaybackNoteEvent) => event.id.replace(/-(on|off)$/, '');
const getPlaybackEventStaffKey = (event: PlaybackNoteEvent) => `${event.systemId}:${event.measureNumber}:${event.staffId}`;

function App() {
  const { settings, updateSetting, resetSettings, showAllLines, showGuideLines } = usePianoSettings();
  const [soundFontOptions, setSoundFontOptions] = useState<SoundFontOption[]>(
    SOUND_FONT_PRESETS.map((preset) => ({ id: preset.id, name: preset.name, source: 'bundled' as const }))
  );
  const [isSoundFontOptionsReady, setIsSoundFontOptionsReady] = useState(false);
  
  const { 
    isAudioStarted, isSamplesLoaded, audioEngine, startAudio, playNotes,
    playPlaybackNoteOn, playPlaybackNoteOff, stopPlaybackNotes, handleMidiEvent
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
  const [playbackTimeline, setPlaybackTimeline] = useState<PlaybackTimeline | null>(null);
  const [playbackError, setPlaybackError] = useState<string | null>(null);
  const [playbackStatus, setPlaybackStatus] = useState<PlaybackStatus>('stopped');
  const [playbackTick, setPlaybackTick] = useState(0);
  const [playbackColumnKey, setPlaybackColumnKey] = useState<string | null>(null);
  const [playbackNotes, setPlaybackNotes] = useState<Set<number>>(new Set());
  const [playbackStaffKeys, setPlaybackStaffKeys] = useState<Set<string>>(new Set());
  const [playbackRangeSelection, setPlaybackRangeSelection] = useState<ScoreRangeSelection | null>(null);
  const playbackTimerRef = useRef<number | null>(null);
  const playbackStatusRef = useRef<PlaybackStatus>('stopped');
  const playbackTickRef = useRef(0);
  const playbackStartTickRef = useRef(0);
  const playbackStartTimeRef = useRef(0);
  const playbackNextEventIndexRef = useRef(0);
  const playbackRangeEndTickRef = useRef<number | null>(null);
  const playbackAllowedEventIdsRef = useRef<Set<string> | null>(null);
  const playbackTimelineRef = useRef<PlaybackTimeline | null>(null);
  const playbackBpmRef = useRef(settings.playbackBpm);
  const activePlaybackNotesRef = useRef<Set<number>>(new Set());
  const activePlaybackStaffCountsRef = useRef<Map<string, number>>(new Map());

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

  const clearPlaybackTimer = useCallback(() => {
    if (playbackTimerRef.current !== null) {
      window.clearInterval(playbackTimerRef.current);
      playbackTimerRef.current = null;
    }
  }, []);

  const getCurrentPlaybackTick = useCallback(() => {
    if (playbackStatusRef.current !== 'playing') return playbackTickRef.current;
    const elapsedMs = performance.now() - playbackStartTimeRef.current;
    const ticksPerMs = (playbackBpmRef.current * (playbackTimelineRef.current?.ppq ?? 480)) / 60000;
    return playbackStartTickRef.current + elapsedMs * ticksPerMs;
  }, []);

  const setPlaybackTickState = useCallback((tick: number) => {
    playbackTickRef.current = tick;
    setPlaybackTick(tick);
  }, []);

  const clearActivePlaybackNotes = useCallback(() => {
    activePlaybackNotesRef.current.forEach((note) => {
      playPlaybackNoteOff(note);
    });
    activePlaybackNotesRef.current.clear();
    activePlaybackStaffCountsRef.current.clear();
    stopPlaybackNotes();
    setPlaybackNotes(new Set());
    setPlaybackStaffKeys(new Set());
  }, [playPlaybackNoteOff, stopPlaybackNotes]);

  const stopPlayback = useCallback((resetPosition: boolean = true) => {
    clearPlaybackTimer();
    clearActivePlaybackNotes();
    playbackStatusRef.current = 'stopped';
    setPlaybackStatus('stopped');
    setSelected(null);
    setPlaybackRangeSelection(null);
    if (resetPosition) {
      setPlaybackTickState(0);
      playbackNextEventIndexRef.current = 0;
      playbackRangeEndTickRef.current = null;
      playbackAllowedEventIdsRef.current = null;
    }
    setPlaybackColumnKey(null);
  }, [clearActivePlaybackNotes, clearPlaybackTimer, setPlaybackTickState]);

  const pausePlayback = useCallback(() => {
    const currentTick = getCurrentPlaybackTick();
    clearPlaybackTimer();
    clearActivePlaybackNotes();
    playbackStatusRef.current = 'paused';
    setPlaybackStatus('paused');
    setSelected(null);
    setPlaybackRangeSelection(null);
    setPlaybackTickState(currentTick);
  }, [clearActivePlaybackNotes, clearPlaybackTimer, getCurrentPlaybackTick, setPlaybackTickState]);

  const finishPlayback = useCallback(() => {
    stopPlayback(true);
  }, [stopPlayback]);

  const processPlaybackEvent = useCallback((event: PlaybackNoteEvent) => {
    if (event.type === 'note-off') {
      const staffKey = getPlaybackEventStaffKey(event);
      const nextCount = (activePlaybackStaffCountsRef.current.get(staffKey) ?? 0) - 1;
      if (nextCount > 0) activePlaybackStaffCountsRef.current.set(staffKey, nextCount);
      else activePlaybackStaffCountsRef.current.delete(staffKey);
      playPlaybackNoteOff(event.displayMidi);
      activePlaybackNotesRef.current.delete(event.displayMidi);
      setPlaybackNotes(new Set(activePlaybackNotesRef.current));
      setPlaybackStaffKeys(new Set(activePlaybackStaffCountsRef.current.keys()));
      if (activePlaybackNotesRef.current.size === 0) setPlaybackColumnKey(null);
      return;
    }

    const staffKey = getPlaybackEventStaffKey(event);
    activePlaybackStaffCountsRef.current.set(staffKey, (activePlaybackStaffCountsRef.current.get(staffKey) ?? 0) + 1);
    void playPlaybackNoteOn(event.displayMidi);
    activePlaybackNotesRef.current.add(event.displayMidi);
    setPlaybackNotes(new Set(activePlaybackNotesRef.current));
    setPlaybackStaffKeys(new Set(activePlaybackStaffCountsRef.current.keys()));
    setPlaybackColumnKey(event.columnKey);
  }, [playPlaybackNoteOff, playPlaybackNoteOn]);

  const runPlaybackStep = useCallback(() => {
    const timeline = playbackTimelineRef.current;
    if (!timeline) {
      stopPlayback(true);
      return;
    }

    const currentTick = getCurrentPlaybackTick();
    setPlaybackTickState(currentTick);

    const rangeEndTick = playbackRangeEndTickRef.current;

    while (
      playbackNextEventIndexRef.current < timeline.events.length &&
      timeline.events[playbackNextEventIndexRef.current].tick <= currentTick &&
      (rangeEndTick === null || timeline.events[playbackNextEventIndexRef.current].tick <= rangeEndTick)
    ) {
      const nextEvent = timeline.events[playbackNextEventIndexRef.current];
      const allowedEventIds = playbackAllowedEventIdsRef.current;
      if (allowedEventIds === null || allowedEventIds.has(getPlaybackEventBaseId(nextEvent))) {
        processPlaybackEvent(nextEvent);
      }
      playbackNextEventIndexRef.current += 1;
    }

    const reachedRangeEnd = rangeEndTick !== null && currentTick >= rangeEndTick;
    const reachedScoreEnd = playbackNextEventIndexRef.current >= timeline.events.length && currentTick >= timeline.durationTicks;

    if (reachedRangeEnd || reachedScoreEnd) {
      finishPlayback();
    }
  }, [finishPlayback, getCurrentPlaybackTick, processPlaybackEvent, setPlaybackTickState, stopPlayback]);

  const startPlayback = useCallback(async () => {
    const timeline = playbackTimelineRef.current;
    if (!timeline || timeline.events.length === 0) {
      setPlaybackError('No playable notes for simple playback.');
      setPlaybackRangeSelection(null);
      return;
    }

    await startAudio();
    const wasPaused = playbackStatusRef.current === 'paused';
    playbackStatusRef.current = 'playing';
    setPlaybackStatus('playing');
    playbackStartTickRef.current = wasPaused ? playbackTickRef.current : 0;
    playbackStartTimeRef.current = performance.now();
    if (!wasPaused) {
      playbackRangeEndTickRef.current = null;
      playbackAllowedEventIdsRef.current = null;
      playbackNextEventIndexRef.current = 0;
      setPlaybackTickState(0);
      setSelected(null);
      setPlaybackRangeSelection(null);
      setPlaybackColumnKey(null);
      setPlaybackNotes(new Set());
      setPlaybackStaffKeys(new Set());
      activePlaybackNotesRef.current.clear();
      activePlaybackStaffCountsRef.current.clear();
    }

    clearPlaybackTimer();
    playbackTimerRef.current = window.setInterval(runPlaybackStep, 25);
    runPlaybackStep();
  }, [clearPlaybackTimer, runPlaybackStep, setPlaybackTickState, startAudio]);

  const startRangePlayback = useCallback(async (range: ScoreRangeSelection) => {
    const timeline = playbackTimelineRef.current;
    if (!timeline || timeline.events.length === 0) {
      setPlaybackError('No playable notes for simple playback.');
      setPlaybackRangeSelection(null);
      return;
    }

    const selectedColumnKeys = new Set(range.columnKeys);
    const selectedStaffKeys = new Set(range.selectedStaffKeys);
    const usesStaffFilter = selectedStaffKeys.size > 0;
    const noteOnEvents = timeline.events.filter((event) =>
      event.type === 'note-on' &&
      selectedColumnKeys.has(event.columnKey) &&
      (!usesStaffFilter || selectedStaffKeys.has(getPlaybackEventStaffKey(event)))
    );

    if (noteOnEvents.length === 0) {
      setPlaybackError('No playable notes in the selected range.');
      setPlaybackRangeSelection(null);
      return;
    }

    const selectedNoteIds = new Set(noteOnEvents.map(getPlaybackEventBaseId));
    const selectedEvents = timeline.events.filter((event) => selectedNoteIds.has(getPlaybackEventBaseId(event)));
    const startTick = Math.min(...noteOnEvents.map((event) => event.tick));
    const endTick = Math.max(...selectedEvents.map((event) => event.tick), startTick);
    const startEventIndex = timeline.events.findIndex((event) => event.tick >= startTick);

    await startAudio();
    clearPlaybackTimer();
    clearActivePlaybackNotes();
    playbackStatusRef.current = 'playing';
    setPlaybackStatus('playing');
    playbackStartTickRef.current = startTick;
    playbackStartTimeRef.current = performance.now();
    playbackNextEventIndexRef.current = startEventIndex === -1 ? timeline.events.length : startEventIndex;
    playbackRangeEndTickRef.current = endTick;
    playbackAllowedEventIdsRef.current = selectedNoteIds;
    setPlaybackTickState(startTick);
    setSelected(null);
    setPlaybackRangeSelection(range);
    setPlaybackColumnKey(null);
    setPlaybackNotes(new Set());
    setPlaybackStaffKeys(new Set());
    activePlaybackNotesRef.current.clear();
    activePlaybackStaffCountsRef.current.clear();
    setPlaybackError(null);

    playbackTimerRef.current = window.setInterval(runPlaybackStep, 25);
    runPlaybackStep();
  }, [clearActivePlaybackNotes, clearPlaybackTimer, runPlaybackStep, setPlaybackTickState, startAudio]);

  const togglePlayback = useCallback(async () => {
    if (playbackStatusRef.current === 'playing') {
      pausePlayback();
      return;
    }
    await startPlayback();
  }, [pausePlayback, startPlayback]);

  const handlePlaybackTimelineReady = useCallback((timeline: PlaybackTimeline | null, error?: string) => {
    stopPlayback(true);
    playbackTimelineRef.current = timeline;
    setPlaybackTimeline(timeline);
    if (error) {
      setPlaybackError(error);
      return;
    }
    if (!timeline || timeline.events.length === 0) {
      setPlaybackError('No playable notes for simple playback.');
      return;
    }
    if (typeof timeline.scoreBpm === 'number' && timeline.scoreBpm !== settings.playbackBpm) {
      updateSetting('playbackBpm', timeline.scoreBpm);
      playbackBpmRef.current = timeline.scoreBpm;
    }
    setPlaybackError(null);
  }, [settings.playbackBpm, stopPlayback, updateSetting]);

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

  useEffect(() => {
    const currentTick = getCurrentPlaybackTick();
    playbackBpmRef.current = settings.playbackBpm;
    if (playbackStatusRef.current === 'playing') {
      playbackStartTickRef.current = currentTick;
      playbackStartTimeRef.current = performance.now();
      setPlaybackTickState(currentTick);
    }
  }, [getCurrentPlaybackTick, settings.playbackBpm, setPlaybackTickState]);

  useEffect(() => {
    return () => {
      clearPlaybackTimer();
      clearActivePlaybackNotes();
    };
  }, [clearActivePlaybackNotes, clearPlaybackTimer]);

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
    stopPlayback(true);
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
    stopPlayback(true);
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

  const handleSoundFontDelete = async (id: string) => {
    try {
      await deleteUserSoundFont(id);
      await refreshUserSoundFonts();
      if (settings.selectedSoundFontId === id) {
        updateSetting('selectedSoundFontId', DEFAULT_SOUND_FONT_ID);
      }
    } catch (error) {
      console.error('Failed to delete user SoundFont:', error);
      alert('Failed to delete SoundFont.');
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
      if (forcePlay && nextSelection.midiNotes.size > 0) playNotes(Array.from(nextSelection.midiNotes));
    }
  }, [playNotes, selected, resetSelection]);

  const handleRangeSelectionComplete = useCallback((range: ScoreRangeSelection) => {
    void startRangePlayback(range);
  }, [startRangePlayback]);

  const handleRangeSelectionStart = useCallback(() => {
    if (playbackRangeSelection !== null && playbackStatusRef.current === 'playing') {
      stopPlayback(true);
    }
  }, [playbackRangeSelection, stopPlayback]);

  const handleTitleReady = useCallback((title: string) => {
    updateScoreNameFromTitle(currentScoreId, title);
  }, [currentScoreId, updateScoreNameFromTitle]);

  const handleLoadingStateChange = useCallback((loading: boolean) => {
    setIsLoading(loading);
  }, [setIsLoading]);

  const canPlayback = Boolean(
    scoreData &&
    playbackTimeline &&
    playbackTimeline.events.length > 0 &&
    (!isAudioStarted || isSamplesLoaded) &&
    !playbackError
  );

  const keyboardHighlightNotes = new Set(selected?.midiNotes ?? EMPTY_NOTES);
  playbackNotes.forEach((note) => keyboardHighlightNotes.add(note));

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
            onResetSettings={resetSettings}
            isAudioStarted={isAudioStarted}
            onStartAudio={startAudio}
            onFileUpload={(e) => {
              stopPlayback(true);
              handleFileUpload(e, resetSelection);
            }}
            soundFontOptions={soundFontOptions}
            onSoundFontUpload={handleSoundFontUpload}
            onDeleteSoundFont={handleSoundFontDelete}
            isSamplesLoaded={isSamplesLoaded}
            audioEngine={audioEngine}
            availableMidiDevices={availableDevices}
            selectedMidiDeviceId={selectedDeviceId}
            onMidiDeviceChange={selectDevice}
            activeNotes={activeNotes}
            playbackStatus={playbackStatus}
            canPlayback={canPlayback}
            playbackError={playbackError}
            onTogglePlayback={togglePlayback}
            onStopPlayback={() => stopPlayback(true)}
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
              showMidiMatchLines={settings.showMidiMatchLines}
              onSelectionChange={handleSelectionChange}
              onRangeSelectionStart={handleRangeSelectionStart}
              onRangeSelectionComplete={handleRangeSelectionComplete}
              onTitleReady={handleTitleReady}
              onLoadingStateChange={handleLoadingStateChange}
              onPlaybackTimelineReady={handlePlaybackTimelineReady}
              selection={selected}
              activeNotes={activeNotes}
              playbackColumnKey={playbackColumnKey}
              playbackNotes={playbackNotes}
              playbackStaffKeys={playbackStaffKeys}
              playbackRangeSelection={playbackRangeSelection}
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
            highlightNotes={keyboardHighlightNotes}
            keySig={selected?.measure.keySig ?? null}
          />
        </Box>
      </Box>
    </ThemeProvider>
  )
}

export default App;
