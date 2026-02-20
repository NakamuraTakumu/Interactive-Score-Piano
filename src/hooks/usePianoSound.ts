import { useState, useEffect, useRef, useCallback } from 'react';
import * as JSSynth from 'js-synthesizer';
import { PianoSettings } from '../types/piano';

interface MidiEventPayload {
  type: 'note-on' | 'note-off' | 'sustain';
  payload: { midi?: number; velocity?: number; active?: boolean };
}

const CHANNEL = 0;
const BASE_URL = import.meta.env.BASE_URL || '/';
const SOUNDFONT_FILE = 'ChoriumRevA.sf2';
const SOUNDFONT_CANDIDATES = [
  `${BASE_URL}soundfonts/${SOUNDFONT_FILE}`,
  `/soundfonts/${SOUNDFONT_FILE}`,
];
const LIBFLUIDSYNTH_CANDIDATES = [
  `${BASE_URL}vendor/libfluidsynth-2.4.6-with-libsndfile.js`,
  '/vendor/libfluidsynth-2.4.6-with-libsndfile.js',
];
const JSSYNTH_WORKLET_CANDIDATES = [
  `${BASE_URL}vendor/js-synthesizer.worklet.js`,
  '/vendor/js-synthesizer.worklet.js',
];
const MAINTHREAD_LIBFLUIDSYNTH_CANDIDATES = LIBFLUIDSYNTH_CANDIDATES;

let mainThreadFluidSynthReadyPromise: Promise<void> | null = null;

const addWorkletModuleWithFallback = async (ctx: AudioContext, paths: string[], label: string) => {
  for (const path of paths) {
    try {
      await ctx.audioWorklet.addModule(path);
      return;
    } catch {
      // Try next path
    }
  }
  throw new Error(`Failed to load ${label} from: ${paths.join(', ')}`);
};

const ensureMainThreadFluidSynthLoaded = () => {
  if (mainThreadFluidSynthReadyPromise) return mainThreadFluidSynthReadyPromise;

  mainThreadFluidSynthReadyPromise = new Promise<void>((resolve, reject) => {
    const existing = document.querySelector<HTMLScriptElement>('script[data-main-libfluidsynth="true"]');
    if (existing) {
      if (existing.dataset.loaded === 'true') resolve();
      else {
        existing.addEventListener('load', () => resolve(), { once: true });
        existing.addEventListener('error', () => reject(new Error('Failed to load main-thread libfluidsynth script')), { once: true });
      }
      return;
    }

    const tryLoad = (index: number) => {
      if (index >= MAINTHREAD_LIBFLUIDSYNTH_CANDIDATES.length) {
        reject(new Error(`Failed to load main-thread libfluidsynth script from: ${MAINTHREAD_LIBFLUIDSYNTH_CANDIDATES.join(', ')}`));
        return;
      }

      const script = document.createElement('script');
      script.src = MAINTHREAD_LIBFLUIDSYNTH_CANDIDATES[index];
      script.async = true;
      script.dataset.mainLibfluidsynth = 'true';
      script.addEventListener('load', () => {
        script.dataset.loaded = 'true';
        resolve();
      }, { once: true });
      script.addEventListener('error', () => {
        script.remove();
        tryLoad(index + 1);
      }, { once: true });
      document.head.appendChild(script);
    };

    tryLoad(0);
  });

  return mainThreadFluidSynthReadyPromise;
};

/**
 * Hook to play piano sounds using js-synthesizer (FluidSynth + SoundFont).
 */
export const usePianoSound = (
  settings: PianoSettings,
  _onSettingsChange: <K extends keyof PianoSettings>(key: K, value: PianoSettings[K]) => void
) => {
  const [isAudioStarted, setIsAudioStarted] = useState(false);
  const [isSamplesLoaded, setIsSamplesLoaded] = useState(false);

  const { volume, reverb, transpose, sustainEnabled, velocitySensitivity } = settings;
  const settingsRef = useRef(settings);

  const audioContextRef = useRef<AudioContext | null>(null);
  const synthRef = useRef<JSSynth.Synthesizer | JSSynth.AudioWorkletNodeSynthesizer | null>(null);
  const sfontIdRef = useRef<number | null>(null);
  const activeNotesRef = useRef<Map<number, number>>(new Map());
  const isSamplesLoadedRef = useRef(false);
  const initAudioPromiseRef = useRef<Promise<void> | null>(null);

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    isSamplesLoadedRef.current = isSamplesLoaded;
  }, [isSamplesLoaded]);

  const dbToGain = (db: number) => Math.max(0, Math.min(10, Math.pow(10, db / 20)));

  const applyCurrentSettings = useCallback(() => {
    const synth = synthRef.current;
    if (!synth) return;

    const current = settingsRef.current;
    synth.setGain(dbToGain(current.volume));
    synth.midiControl(CHANNEL, 91, Math.round(current.reverb * 127));
    synth.midiControl(CHANNEL, 93, 0);
    synth.midiControl(CHANNEL, 64, current.sustainEnabled ? 127 : 0);
  }, []);

  const initAudio = useCallback(async () => {
    if (audioContextRef.current && synthRef.current) return;
    if (initAudioPromiseRef.current) {
      await initAudioPromiseRef.current;
      return;
    }

    initAudioPromiseRef.current = (async () => {
      const ctx = new (window.AudioContext || (window as Window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext)({
        latencyHint: 'interactive'
      });

      let synth: JSSynth.Synthesizer | JSSynth.AudioWorkletNodeSynthesizer;
      try {
        await addWorkletModuleWithFallback(ctx, LIBFLUIDSYNTH_CANDIDATES, 'libfluidsynth worklet module');
        await addWorkletModuleWithFallback(ctx, JSSYNTH_WORKLET_CANDIDATES, 'js-synthesizer worklet module');

        synth = new JSSynth.AudioWorkletNodeSynthesizer();
        synth.init(ctx.sampleRate);

        const audioNode = synth.createAudioNode(ctx);
        audioNode.connect(ctx.destination);
      } catch (workletError) {
        console.warn('Worklet synth init failed. Falling back to main-thread Synthesizer.', workletError);
        await ensureMainThreadFluidSynthLoaded();
        await JSSynth.waitForReady();

        synth = new JSSynth.Synthesizer();
        synth.init(ctx.sampleRate);
        const audioNode = synth.createAudioNode(ctx, 256);
        audioNode.connect(ctx.destination);
      }

      audioContextRef.current = ctx;
      synthRef.current = synth;
      setIsAudioStarted(true);
      applyCurrentSettings();

      let soundFontBuffer: ArrayBuffer | null = null;
      for (const path of SOUNDFONT_CANDIDATES) {
        try {
          const response = await fetch(path);
          if (!response.ok) continue;
          soundFontBuffer = await response.arrayBuffer();
          break;
        } catch {
          // Try next path
        }
      }

      if (!soundFontBuffer) {
        throw new Error(`Failed to load SoundFont from: ${SOUNDFONT_CANDIDATES.join(', ')}`);
      }

      const sfontId = await synth.loadSFont(soundFontBuffer);
      sfontIdRef.current = sfontId;
      synth.midiProgramSelect(CHANNEL, sfontId, 0, 0);
      setIsSamplesLoaded(true);
    })();

    try {
      await initAudioPromiseRef.current;
    } catch (error) {
      console.error('Failed to load SoundFont:', error);
      setIsSamplesLoaded(false);
      throw error;
    } finally {
      initAudioPromiseRef.current = null;
    }
  }, [applyCurrentSettings]);

  const startAudio = useCallback(async () => {
    if (!audioContextRef.current || !synthRef.current) {
      await initAudio();
    }

    if (audioContextRef.current?.state === 'suspended') {
      await audioContextRef.current.resume();
    }
  }, [initAudio]);

  const processMidiEvent = useCallback((type: MidiEventPayload['type'], payload: MidiEventPayload['payload']) => {
    const synth = synthRef.current;
    if (!synth) return;

    const current = settingsRef.current;

    if (type === 'sustain') {
      const sustainValue = current.sustainEnabled ? 127 : (payload.active ? 127 : 0);
      synth.midiControl(CHANNEL, 64, sustainValue);
      return;
    }

    const originalMidi = payload.midi;
    if (typeof originalMidi !== 'number') return;

    if (type === 'note-on') {
      const shiftedMidi = Math.max(0, Math.min(127, originalMidi + current.transpose));
      const velocity = Math.max(1, Math.min(127, Math.round((payload.velocity ?? 1) * current.velocitySensitivity * 127)));
      activeNotesRef.current.set(originalMidi, shiftedMidi);
      synth.midiNoteOn(CHANNEL, shiftedMidi, velocity);
      return;
    }

    const shiftedMidi = activeNotesRef.current.get(originalMidi) ?? Math.max(0, Math.min(127, originalMidi + current.transpose));
    activeNotesRef.current.delete(originalMidi);
    synth.midiNoteOff(CHANNEL, shiftedMidi);
  }, []);

  const handleMidiEvent = useCallback(({ type, payload }: MidiEventPayload) => {
    const ctx = audioContextRef.current;
    if (synthRef.current && ctx?.state === 'running' && isSamplesLoadedRef.current) {
      processMidiEvent(type, payload);
      return;
    }

    // Do not replay old MIDI events after async init/resume.
    // Replaying stale key presses feels like lag.
    void startAudio();
  }, [processMidiEvent, startAudio]);

  const playNotes = useCallback(async (midiNotes: number[]) => {
    await startAudio();
    const synth = synthRef.current;
    if (!synth) return;

    const current = settingsRef.current;
    midiNotes.forEach(note => {
      const shiftedMidi = Math.max(0, Math.min(127, note + current.transpose));
      const velocity = Math.max(1, Math.min(127, Math.round(0.8 * current.velocitySensitivity * 127)));
      synth.midiNoteOn(CHANNEL, shiftedMidi, velocity);
      window.setTimeout(() => {
        synth.midiNoteOff(CHANNEL, shiftedMidi);
      }, 500);
    });
  }, [startAudio]);

  useEffect(() => {
    applyCurrentSettings();
  }, [applyCurrentSettings, volume, reverb, sustainEnabled, velocitySensitivity]);

  useEffect(() => {
    return () => {
      const synth = synthRef.current;
      if (synth) {
        synth.midiAllSoundsOff(CHANNEL);
        if (sfontIdRef.current !== null) {
          synth.unloadSFontAsync(sfontIdRef.current).catch(() => {});
        }
        synth.close();
      }
      audioContextRef.current?.close().catch(() => {});
      synthRef.current = null;
      audioContextRef.current = null;
      sfontIdRef.current = null;
    };
  }, []);

  return { isAudioStarted, isSamplesLoaded, startAudio, playNotes, handleMidiEvent };
};
