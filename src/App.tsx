import { useState, useCallback, memo, useEffect, useRef, useMemo } from 'react'
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
const getPlaybackEventNoteKey = (event: PlaybackNoteEvent) => event.noteIdentity;

type PlaybackMode = 'full' | 'range';
type PlaybackErrorKind = 'timeline' | 'range' | 'audio';

interface PlaybackSchedulerState {
  startTick: number;
  startTime: number;
  nextEventIndex: number;
  loopStartTick: number;
  loopStartEventIndex: number;
  rangeEndTick: number | null;
  allowedEventIds: Set<string> | null;
  timelineGeneration: number | null;
}

interface PlaybackSession {
  id: number;
  status: PlaybackStatus;
  mode: PlaybackMode;
  range: ScoreRangeSelection | null;
  tick: number;
  currentColumnKey: string | null;
  activeEvents: Map<string, PlaybackNoteEvent>;
  scheduler: PlaybackSchedulerState;
}

const createPlaybackSchedulerState = (
  startTick: number = 0,
  startTime: number = 0,
  nextEventIndex: number = 0,
  rangeEndTick: number | null = null,
  allowedEventIds: Set<string> | null = null,
  timelineGeneration: number | null = null,
  loopStartTick: number = startTick,
  loopStartEventIndex: number = nextEventIndex
): PlaybackSchedulerState => ({
  startTick,
  startTime,
  nextEventIndex,
  loopStartTick,
  loopStartEventIndex,
  rangeEndTick,
  allowedEventIds,
  timelineGeneration,
});

const createPlaybackSession = (
  id: number,
  status: PlaybackStatus = 'stopped',
  mode: PlaybackMode = 'full',
  range: ScoreRangeSelection | null = null,
  tick: number = 0,
  scheduler: PlaybackSchedulerState = createPlaybackSchedulerState(tick)
): PlaybackSession => ({
  id,
  status,
  mode,
  range,
  tick,
  currentColumnKey: null,
  activeEvents: new Map(),
  scheduler,
});

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
  const [playbackErrorKind, setPlaybackErrorKind] = useState<PlaybackErrorKind | null>(null);
  const [playbackSession, setPlaybackSession] = useState<PlaybackSession>(() => createPlaybackSession(0));
  const playbackTimerRef = useRef<number | null>(null);
  const playbackSessionRef = useRef<PlaybackSession>(playbackSession);
  const nextPlaybackSessionIdRef = useRef(1);
  const playbackStartTokenRef = useRef(0);
  const expiredPlaybackNoteIdsRef = useRef<Set<string>>(new Set());
  const latestPlaybackTimelineGenerationRef = useRef(0);
  const playbackTimelineRef = useRef<PlaybackTimeline | null>(null);
  const playbackBpmRef = useRef(settings.playbackBpm);
  const playbackLoopRef = useRef(settings.playbackLoop);
  const scoreBpmSourceKeyRef = useRef<string | null>(null);

  const updatePlaybackSession = useCallback((updater: PlaybackSession | ((session: PlaybackSession) => PlaybackSession)) => {
    const current = playbackSessionRef.current;
    const next = typeof updater === 'function'
      ? (updater as (session: PlaybackSession) => PlaybackSession)(current)
      : updater;
    playbackSessionRef.current = next;
    setPlaybackSession(next);
  }, []);

  const setPlaybackIssue = useCallback((kind: PlaybackErrorKind, message: string) => {
    setPlaybackErrorKind(kind);
    setPlaybackError(message);
  }, []);

  const clearPlaybackIssue = useCallback(() => {
    setPlaybackErrorKind(null);
    setPlaybackError(null);
  }, []);

  const playbackStatus = playbackSession.status;
  const playbackTick = playbackSession.tick;
  const playbackColumnKey = playbackSession.currentColumnKey;
  const playbackRangeSelection = playbackSession.range;
  const activePlaybackEvents = useMemo(
    () => Array.from(playbackSession.activeEvents.values()),
    [playbackSession.activeEvents]
  );
  const playbackNotes = useMemo(
    () => new Set(activePlaybackEvents.map((event) => event.soundingMidi)),
    [activePlaybackEvents]
  );
  const playbackActiveNoteKeys = useMemo(
    () => new Set(activePlaybackEvents.map(getPlaybackEventNoteKey)),
    [activePlaybackEvents]
  );

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
    const session = playbackSessionRef.current;
    if (session.status !== 'playing') return session.tick;
    const elapsedMs = performance.now() - session.scheduler.startTime;
    const ticksPerMs = (playbackBpmRef.current * (playbackTimelineRef.current?.ppq ?? 480)) / 60000;
    return session.scheduler.startTick + elapsedMs * ticksPerMs;
  }, []);

  const clearActivePlaybackNotes = useCallback(() => {
    playbackSessionRef.current.activeEvents.forEach((event) => {
      playPlaybackNoteOff(event.soundingMidi);
    });
    stopPlaybackNotes();
  }, [playPlaybackNoteOff, stopPlaybackNotes]);

  const stopPlayback = useCallback((resetPosition: boolean = true) => {
    playbackStartTokenRef.current += 1;
    expiredPlaybackNoteIdsRef.current.clear();
    clearPlaybackTimer();
    clearActivePlaybackNotes();
    setSelected(null);
    updatePlaybackSession(createPlaybackSession(
      nextPlaybackSessionIdRef.current++,
      'stopped',
      'full',
      null,
      resetPosition ? 0 : playbackSessionRef.current.tick
    ));
  }, [clearActivePlaybackNotes, clearPlaybackTimer, updatePlaybackSession]);

  const pausePlayback = useCallback(() => {
    const currentTick = getCurrentPlaybackTick();
    playbackStartTokenRef.current += 1;
    expiredPlaybackNoteIdsRef.current.clear();
    clearPlaybackTimer();
    clearActivePlaybackNotes();
    setSelected(null);
    updatePlaybackSession((session) => ({
      ...session,
      status: 'paused',
      tick: currentTick,
      currentColumnKey: null,
      activeEvents: new Map(),
      scheduler: {
        ...session.scheduler,
        startTick: currentTick,
        startTime: 0,
      },
    }));
  }, [clearActivePlaybackNotes, clearPlaybackTimer, getCurrentPlaybackTick, updatePlaybackSession]);

  const finishPlayback = useCallback(() => {
    stopPlayback(true);
  }, [stopPlayback]);

  const processPlaybackEvent = useCallback((event: PlaybackNoteEvent) => {
    const eventBaseId = getPlaybackEventBaseId(event);
    if (event.type === 'note-off') {
      expiredPlaybackNoteIdsRef.current.add(eventBaseId);
      playPlaybackNoteOff(event.soundingMidi);
      updatePlaybackSession((session) => {
        const activeEvents = new Map(session.activeEvents);
        activeEvents.delete(eventBaseId);
        return {
          ...session,
          activeEvents,
          currentColumnKey: activeEvents.size > 0 ? session.currentColumnKey : null,
        };
      });
      return;
    }

    const startToken = playbackStartTokenRef.current;
    expiredPlaybackNoteIdsRef.current.delete(eventBaseId);
    void playPlaybackNoteOn(event.soundingMidi, 0.8, () =>
      playbackStartTokenRef.current === startToken &&
      playbackSessionRef.current.status === 'playing' &&
      !expiredPlaybackNoteIdsRef.current.has(eventBaseId)
    ).then((accepted) => {
      if (
        !accepted ||
        playbackStartTokenRef.current !== startToken ||
        playbackSessionRef.current.status !== 'playing' ||
        expiredPlaybackNoteIdsRef.current.has(eventBaseId)
      ) {
        return;
      }

      updatePlaybackSession((session) => {
        const activeEvents = new Map(session.activeEvents);
        activeEvents.set(eventBaseId, event);
        return {
          ...session,
          activeEvents,
          currentColumnKey: event.columnKey,
        };
      });
    });
  }, [playPlaybackNoteOff, playPlaybackNoteOn, updatePlaybackSession]);

  const restartPlaybackLoop = useCallback((session: PlaybackSession) => {
    clearActivePlaybackNotes();
    updatePlaybackSession((latestSession) => {
      if (latestSession.id !== session.id || latestSession.status !== 'playing') {
        return latestSession;
      }
      const { loopStartTick, loopStartEventIndex } = latestSession.scheduler;
      return {
        ...latestSession,
        tick: loopStartTick,
        currentColumnKey: null,
        activeEvents: new Map(),
        scheduler: {
          ...latestSession.scheduler,
          startTick: loopStartTick,
          startTime: performance.now(),
          nextEventIndex: loopStartEventIndex,
        },
      };
    });
  }, [clearActivePlaybackNotes, updatePlaybackSession]);

  const runPlaybackStep = useCallback((expectedSessionId?: number, expectedStartToken?: number) => {
    const session = playbackSessionRef.current;
    if (session.status !== 'playing') return;
    if (expectedSessionId !== undefined && session.id !== expectedSessionId) return;
    if (expectedStartToken !== undefined && playbackStartTokenRef.current !== expectedStartToken) return;

    const timeline = playbackTimelineRef.current;
    if (!timeline) {
      stopPlayback(true);
      return;
    }
    if (
      session.scheduler.timelineGeneration !== null &&
      timeline.generation !== session.scheduler.timelineGeneration
    ) {
      stopPlayback(true);
      return;
    }

    const currentTick = getCurrentPlaybackTick();
    let nextEventIndex = session.scheduler.nextEventIndex;
    const rangeEndTick = session.scheduler.rangeEndTick;
    const allowedEventIds = session.scheduler.allowedEventIds;

    while (
      nextEventIndex < timeline.events.length &&
      timeline.events[nextEventIndex].tick <= currentTick &&
      (rangeEndTick === null || timeline.events[nextEventIndex].tick <= rangeEndTick)
    ) {
      const nextEvent = timeline.events[nextEventIndex];
      if (allowedEventIds === null || allowedEventIds.has(getPlaybackEventBaseId(nextEvent))) {
        processPlaybackEvent(nextEvent);
      }
      nextEventIndex += 1;
    }

    const reachedRangeEnd = rangeEndTick !== null && currentTick >= rangeEndTick;
    const reachedScoreEnd = nextEventIndex >= timeline.events.length && currentTick >= timeline.durationTicks;

    if (reachedRangeEnd || reachedScoreEnd) {
      const loopEndTick = rangeEndTick ?? timeline.durationTicks;
      if (playbackLoopRef.current && loopEndTick > session.scheduler.loopStartTick) {
        restartPlaybackLoop(session);
        return;
      }
      finishPlayback();
      return;
    }

    updatePlaybackSession((latestSession) => ({
      ...latestSession,
      tick: currentTick,
      scheduler: {
        ...latestSession.scheduler,
        nextEventIndex,
      },
    }));
  }, [finishPlayback, getCurrentPlaybackTick, processPlaybackEvent, restartPlaybackLoop, stopPlayback, updatePlaybackSession]);

  const startPlayback = useCallback(async () => {
    const timeline = playbackTimelineRef.current;
    if (!timeline || timeline.events.length === 0) {
      setPlaybackIssue('timeline', 'No playable notes for simple playback.');
      updatePlaybackSession((session) => ({ ...session, range: null, mode: 'full' }));
      return;
    }

    const startToken = ++playbackStartTokenRef.current;
    try {
      await startAudio();
    } catch (error) {
      console.error('Failed to start playback audio:', error);
      if (startToken === playbackStartTokenRef.current) {
        stopPlayback(true);
        setPlaybackIssue('audio', 'Audio initialization failed. Check SoundFont and browser audio settings.');
      }
      return;
    }
    if (startToken !== playbackStartTokenRef.current) return;

    const currentSession = playbackSessionRef.current;
    const wasPaused = currentSession.status === 'paused' &&
      currentSession.scheduler.timelineGeneration === timeline.generation;
    const nextSessionId = wasPaused ? currentSession.id : nextPlaybackSessionIdRef.current++;
    const nextMode = wasPaused ? currentSession.mode : 'full';
    const nextRange = wasPaused ? currentSession.range : null;
    const startTick = wasPaused ? currentSession.tick : 0;
    const scheduler = wasPaused
      ? {
          ...currentSession.scheduler,
          startTick,
          startTime: performance.now(),
        }
      : createPlaybackSchedulerState(0, performance.now(), 0, null, null, timeline.generation ?? null);
    if (!wasPaused) {
      setSelected(null);
    }
    expiredPlaybackNoteIdsRef.current.clear();
    updatePlaybackSession(createPlaybackSession(
      nextSessionId,
      'playing',
      nextMode,
      nextRange,
      startTick,
      scheduler
    ));
    clearPlaybackIssue();

    clearPlaybackTimer();
    playbackTimerRef.current = window.setInterval(() => runPlaybackStep(nextSessionId, startToken), 25);
    runPlaybackStep(nextSessionId, startToken);
  }, [clearPlaybackIssue, clearPlaybackTimer, runPlaybackStep, setPlaybackIssue, startAudio, stopPlayback, updatePlaybackSession]);

  const startRangePlayback = useCallback(async (range: ScoreRangeSelection) => {
    const timeline = playbackTimelineRef.current;
    if (!timeline || timeline.events.length === 0) {
      setPlaybackIssue('timeline', 'No playable notes for simple playback.');
      stopPlayback(true);
      return;
    }

    const selectedColumnKeys = new Set(range.columnKeys);
    const selectedStaffIds = range.staffScope.type === 'staffs'
      ? new Set(range.staffScope.staffIds)
      : null;
    const noteOnEvents = timeline.events.filter((event) =>
      event.type === 'note-on' &&
      selectedColumnKeys.has(event.columnKey) &&
      (!selectedStaffIds || selectedStaffIds.has(event.staffId))
    );

    if (noteOnEvents.length === 0) {
      setPlaybackIssue('range', 'No playable notes in the selected range.');
      stopPlayback(true);
      return;
    }

    const selectedNoteIds = new Set(noteOnEvents.map(getPlaybackEventBaseId));
    const selectedEvents = timeline.events.filter((event) => selectedNoteIds.has(getPlaybackEventBaseId(event)));
    const startTick = Math.min(...noteOnEvents.map((event) => event.tick));
    const endTick = Math.max(...selectedEvents.map((event) => event.tick), startTick);
    const startEventIndex = timeline.events.findIndex((event) => event.tick >= startTick);

    const startToken = ++playbackStartTokenRef.current;
    try {
      await startAudio();
    } catch (error) {
      console.error('Failed to start range playback audio:', error);
      if (startToken === playbackStartTokenRef.current) {
        stopPlayback(true);
        setPlaybackIssue('audio', 'Audio initialization failed. Check SoundFont and browser audio settings.');
      }
      return;
    }
    if (startToken !== playbackStartTokenRef.current) return;

    clearPlaybackTimer();
    clearActivePlaybackNotes();
    expiredPlaybackNoteIdsRef.current.clear();
    setSelected(null);
    updatePlaybackSession(createPlaybackSession(
      nextPlaybackSessionIdRef.current++,
      'playing',
      'range',
      range,
      startTick,
      createPlaybackSchedulerState(
        startTick,
        performance.now(),
        startEventIndex === -1 ? timeline.events.length : startEventIndex,
        endTick,
        selectedNoteIds,
        timeline.generation ?? null
      )
    ));
    clearPlaybackIssue();

    const nextSessionId = playbackSessionRef.current.id;
    playbackTimerRef.current = window.setInterval(() => runPlaybackStep(nextSessionId, startToken), 25);
    runPlaybackStep(nextSessionId, startToken);
  }, [clearActivePlaybackNotes, clearPlaybackIssue, clearPlaybackTimer, runPlaybackStep, setPlaybackIssue, startAudio, stopPlayback, updatePlaybackSession]);

  const togglePlayback = useCallback(async () => {
    if (playbackSessionRef.current.status === 'playing') {
      pausePlayback();
      return;
    }
    await startPlayback();
  }, [pausePlayback, startPlayback]);

  const handlePlaybackTimelineReady = useCallback((timeline: PlaybackTimeline | null, error?: string, generation?: number) => {
    const nextGeneration = typeof generation === 'number'
      ? generation
      : latestPlaybackTimelineGenerationRef.current + 1;
    if (nextGeneration < latestPlaybackTimelineGenerationRef.current) return;
    latestPlaybackTimelineGenerationRef.current = nextGeneration;

    const nextTimeline = timeline ? { ...timeline, generation: nextGeneration } : null;
    if (
      playbackSessionRef.current.status === 'playing' &&
      playbackSessionRef.current.scheduler.timelineGeneration !== nextGeneration
    ) {
      stopPlayback(true);
    }
    playbackTimelineRef.current = nextTimeline;
    setPlaybackTimeline(nextTimeline);
    if (error) {
      setPlaybackIssue('timeline', error);
      return;
    }
    if (!nextTimeline || nextTimeline.events.length === 0) {
      setPlaybackIssue('timeline', 'No playable notes for simple playback.');
      return;
    }
    if (
      typeof nextTimeline.scoreBpm === 'number' &&
      scoreData &&
      scoreBpmSourceKeyRef.current !== scoreData
    ) {
      updateSetting('playbackBpm', nextTimeline.scoreBpm);
      playbackBpmRef.current = nextTimeline.scoreBpm;
      scoreBpmSourceKeyRef.current = scoreData;
    }
    clearPlaybackIssue();
  }, [clearPlaybackIssue, scoreData, setPlaybackIssue, stopPlayback, updateSetting]);

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
    scoreBpmSourceKeyRef.current = null;
  }, [scoreData]);

  useEffect(() => {
    const currentTick = getCurrentPlaybackTick();
    playbackBpmRef.current = settings.playbackBpm;
    if (playbackSessionRef.current.status === 'playing') {
      updatePlaybackSession((session) => ({
        ...session,
        tick: currentTick,
        scheduler: {
          ...session.scheduler,
          startTick: currentTick,
          startTime: performance.now(),
        },
      }));
    }
  }, [getCurrentPlaybackTick, settings.playbackBpm, updatePlaybackSession]);

  useEffect(() => {
    playbackLoopRef.current = settings.playbackLoop;
  }, [settings.playbackLoop]);

  useEffect(() => {
    playbackTimelineRef.current = null;
    setPlaybackTimeline(null);
    clearPlaybackIssue();
    if (playbackSessionRef.current.status !== 'stopped') {
      stopPlayback(true);
    }
  }, [scoreData, settings.visualTranspose, clearPlaybackIssue, stopPlayback]);

  useEffect(() => {
    if (!isAudioStarted || isSamplesLoaded) return;
    if (playbackSessionRef.current.status === 'playing') {
      stopPlayback(true);
      setPlaybackIssue('audio', 'Playback stopped while loading SoundFont.');
    }
  }, [isAudioStarted, isSamplesLoaded, setPlaybackIssue, stopPlayback]);

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
        void startAudio().catch((error) => {
          console.error('Failed to start audio after MIDI activity:', error);
        });
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
      void startAudio().catch((error) => {
        console.error('Failed to start uploaded SoundFont:', error);
      });
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

  const handleRangePreviewStart = useCallback(() => {
    if (playbackSessionRef.current.status === 'playing') {
      stopPlayback(true);
    }
  }, [stopPlayback]);

  const handleRangeProjectionInvalid = useCallback(() => {
    if (playbackSessionRef.current.mode === 'range') {
      stopPlayback(true);
      setPlaybackIssue('range', 'Selected range is no longer visible.');
    }
  }, [setPlaybackIssue, stopPlayback]);

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
    playbackErrorKind !== 'audio' &&
    playbackErrorKind !== 'timeline'
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
      }).catch((error) => {
        console.error('Failed to initialize audio on first interaction:', error);
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
              onRangePreviewStart={handleRangePreviewStart}
              onRangeSelectionComplete={handleRangeSelectionComplete}
              onTitleReady={handleTitleReady}
              onLoadingStateChange={handleLoadingStateChange}
              onPlaybackTimelineReady={handlePlaybackTimelineReady}
              onRangeProjectionInvalid={handleRangeProjectionInvalid}
              activeNotes={activeNotes}
              playbackColumnKey={playbackColumnKey}
              playbackActiveNoteKeys={playbackActiveNoteKeys}
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
