import { useState, useEffect, useRef, useCallback } from 'react';
import { SoundType, PianoSettings } from '../types/piano';

/**
 * Hook to play synthesized or sampled piano sounds with low latency using native Web Audio API
 */
export const usePianoSound = (settings: PianoSettings, onSettingsChange: <K extends keyof PianoSettings>(key: K, value: PianoSettings[K]) => void) => {
  const [isAudioStarted, setIsAudioStarted] = useState(false);
  const [isSamplesLoaded, setIsSamplesLoaded] = useState(false);
  
  const { soundType, volume, reverb, transpose, sustainEnabled, velocitySensitivity } = settings;

  const audioContextRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  const reverbGainRef = useRef<GainNode | null>(null);
  
  // Sustain management
  const sustainActiveRef = useRef(false);
  const notesPendingReleaseRef = useRef<Set<number>>(new Set());

  // Active nodes management
  const activeNodes = useRef<Map<number, { node: AudioScheduledSourceNode, gain: GainNode, startTime: number }>>(new Map());
  
  // AudioBuffer cache for sampled piano
  const pianoSamplesRef = useRef<Map<number, AudioBuffer>>(new Map());

  // Convert volume (dB) to linear gain value (0.0-1.0)
  const dbToGain = (db: number) => Math.pow(10, db / 20);

  // Reverb Impulse Response Generator
  const createImpulseResponse = useCallback((ctx: AudioContext, duration: number, decay: number) => {
    const sampleRate = ctx.sampleRate;
    const length = sampleRate * duration;
    const impulse = ctx.createBuffer(2, length, sampleRate);
    const left = impulse.getChannelData(0);
    const right = impulse.getChannelData(1);

    for (let i = 0; i < length; i++) {
      const n = i / length;
      const val = (Math.random() * 2 - 1) * Math.pow(1 - n, decay);
      left[i] = val;
      right[i] = val;
    }
    return impulse;
  }, []);

  // Load piano samples
  const loadSamples = useCallback(async (ctx: AudioContext) => {
    if (isSamplesLoaded) return;
    
    const baseUrl = 'https://gleitz.github.io/midi-js-soundfonts/FluidR3_GM/acoustic_grand_piano-mp3';
    const notesToLoad = [21, 24, 27, 30, 33, 36, 39, 42, 45, 48, 51, 54, 57, 60, 63, 66, 69, 72, 75, 78, 81, 84, 87, 90, 93, 96, 99, 102, 105, 108];
    const noteNames: Record<number, string> = {
      21: 'A0', 24: 'C1', 27: 'Eb1', 30: 'Gb1', 33: 'A1', 36: 'C2', 39: 'Eb2', 42: 'Gb2', 45: 'A2', 48: 'C3', 51: 'Eb3', 54: 'Gb3', 57: 'A3', 60: 'C4', 63: 'Eb4', 66: 'Gb4', 69: 'A4', 72: 'C5', 75: 'Eb5', 78: 'Gb5', 81: 'A5', 84: 'C6', 87: 'Eb6', 90: 'Gb6', 93: 'A6', 96: 'C7', 99: 'Eb7', 102: 'Gb7', 105: 'A7', 108: 'C8'
    };

    const loadNote = async (midi: number) => {
      const name = noteNames[midi];
      try {
        const response = await fetch(`${baseUrl}/${name}.mp3`);
        const arrayBuffer = await response.arrayBuffer();
        const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
        pianoSamplesRef.current.set(midi, audioBuffer);
      } catch (e) { console.error(`Failed sample ${name}:`, e); }
    };

    await Promise.all(notesToLoad.map(loadNote));
    setIsSamplesLoaded(true);
  }, [isSamplesLoaded]);

  // Initialize AudioContext
  const initAudioContext = useCallback(() => {
    if (audioContextRef.current) return audioContextRef.current;

    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ latencyHint: 'interactive' });
    
    const masterGain = ctx.createGain();
    masterGain.gain.value = dbToGain(volume);
    masterGain.connect(ctx.destination);
    
    const reverbNode = ctx.createConvolver();
    reverbNode.buffer = createImpulseResponse(ctx, 2.5, 3.0);
    
    const reverbGain = ctx.createGain();
    reverbGain.gain.value = reverb;
    
    reverbGain.connect(reverbNode);
    reverbNode.connect(masterGain);
    
    audioContextRef.current = ctx;
    masterGainRef.current = masterGain;
    reverbGainRef.current = reverbGain;

    setIsAudioStarted(true);
    loadSamples(ctx);
    return ctx;
  }, [volume, reverb, loadSamples, createImpulseResponse]);

  const startAudio = useCallback(async () => {
    const ctx = initAudioContext();
    if (ctx.state === 'suspended') await ctx.resume();
  }, [initAudioContext]);

  // Settings Updates
  useEffect(() => {
    if (masterGainRef.current) {
      masterGainRef.current.gain.setTargetAtTime(dbToGain(volume), audioContextRef.current?.currentTime || 0, 0.05);
    }
  }, [volume]);

  useEffect(() => {
    if (reverbGainRef.current) {
      reverbGainRef.current.gain.setTargetAtTime(reverb, audioContextRef.current?.currentTime || 0, 0.05);
    }
  }, [reverb]);

  useEffect(() => {
    sustainActiveRef.current = sustainEnabled;
    if (!sustainEnabled) {
      // Release pending notes when sustain is turned off manually
      notesPendingReleaseRef.current.forEach(midi => triggerRelease(midi, true));
      notesPendingReleaseRef.current.clear();
    }
  }, [sustainEnabled]);

  const triggerAttack = useCallback((midi: number, velocity: number = 1.0) => {
    const ctx = audioContextRef.current;
    if (!ctx || !masterGainRef.current || !reverbGainRef.current) return;

    // Transpose
    const actualMidi = midi + transpose;
    if (actualMidi < 0 || actualMidi > 127) return;

    if (activeNodes.current.has(midi)) triggerRelease(midi, true);

    const t = ctx.currentTime;
    const gain = ctx.createGain();
    let node: AudioScheduledSourceNode;

    // Apply Velocity Sensitivity
    const adjustedVelocity = 1.0 - velocitySensitivity + (velocity * velocitySensitivity);

    if (soundType === 'piano' && isSamplesLoaded) {
      const loadedMidis = Array.from(pianoSamplesRef.current.keys()).sort((a, b) => a - b);
      const closestMidi = loadedMidis.reduce((prev, curr) => 
        Math.abs(curr - actualMidi) < Math.abs(prev - actualMidi) ? curr : prev
      );
      const source = ctx.createBufferSource();
      source.buffer = pianoSamplesRef.current.get(closestMidi)!;
      source.playbackRate.value = Math.pow(2, (actualMidi - closestMidi) / 12);
      node = source;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(adjustedVelocity, t + 0.005);
      gain.gain.exponentialRampToValueAtTime(adjustedVelocity * 0.3, t + 0.4);
    } else {
      const osc = ctx.createOscillator();
      osc.frequency.setValueAtTime(440 * Math.pow(2, (actualMidi - 69) / 12), t);
      osc.type = 'triangle';
      node = osc;
      gain.gain.setValueAtTime(0, t);
      gain.gain.linearRampToValueAtTime(adjustedVelocity, t + 0.005);
      gain.gain.exponentialRampToValueAtTime(adjustedVelocity * 0.3, t + 0.1);
    }

    node.connect(gain);
    gain.connect(masterGainRef.current);
    gain.connect(reverbGainRef.current);
    node.start(t);
    activeNodes.current.set(midi, { node, gain, startTime: t });
    notesPendingReleaseRef.current.delete(midi);
  }, [soundType, isSamplesLoaded, transpose, velocitySensitivity]);

  const triggerRelease = useCallback((midi: number, force: boolean = false) => {
    const active = activeNodes.current.get(midi);
    if (!active || !audioContextRef.current) return;

    if (sustainActiveRef.current && !force) {
      notesPendingReleaseRef.current.add(midi);
      return;
    }

    const { node, gain } = active;
    const t = audioContextRef.current.currentTime;
    const release = soundType === 'piano' ? 0.8 : 0.5;

    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + release);
    node.stop(t + release);
    node.onended = () => {
      if (activeNodes.current.get(midi)?.node === node) activeNodes.current.delete(midi);
      node.disconnect();
      gain.disconnect();
    };
    notesPendingReleaseRef.current.delete(midi);
  }, [soundType]);

  const playNotes = useCallback(async (midiNotes: number[]) => {
    if (!audioContextRef.current) await startAudio();
    midiNotes.forEach(note => {
      triggerAttack(note, 1.0);
      setTimeout(() => triggerRelease(note), 500);
    });
  }, [startAudio, triggerAttack, triggerRelease]);

  const handleMidiMessage = useCallback((message: any) => {
    const [command, data1, data2] = message.data;
    
    // Sustain Pedal (CC 64)
    if (command === 0xB0 && data1 === 64) {
      const active = data2 >= 64;
      sustainActiveRef.current = active || sustainEnabled;
      if (!active && !sustainEnabled) {
        notesPendingReleaseRef.current.forEach(midi => triggerRelease(midi, true));
        notesPendingReleaseRef.current.clear();
      }
      return;
    }

    if (command >= 0x90 && command <= 0x9F && data2 > 0) {
      if (!audioContextRef.current) initAudioContext();
      triggerAttack(data1, data2 / 127);
    } else if ((command >= 0x80 && command <= 0x8F) || (command >= 0x90 && command <= 0x9F && data2 === 0)) {
      triggerRelease(data1);
    }
  }, [initAudioContext, triggerAttack, triggerRelease, sustainEnabled]);

  const midiHandlerRef = useRef(handleMidiMessage);
  useEffect(() => { midiHandlerRef.current = handleMidiMessage; }, [handleMidiMessage]);

  useEffect(() => {
    let midiAccessObj: MIDIAccess | null = null;
    const savedInputs: any[] = [];
    const setupInputs = (access: MIDIAccess) => {
      savedInputs.forEach(i => i.removeEventListener('midimessage', (e: any) => midiHandlerRef.current(e)));
      savedInputs.length = 0;
      for (const input of access.inputs.values()) {
        input.addEventListener('midimessage', (e: any) => midiHandlerRef.current(e));
        savedInputs.push(input);
      }
    };
    if (navigator.requestMIDIAccess) {
      navigator.requestMIDIAccess().then(access => {
        midiAccessObj = access;
        setupInputs(access);
        access.onstatechange = () => setupInputs(access);
      });
    }
    return () => {
      if (midiAccessObj) midiAccessObj.onstatechange = null;
      activeNodes.current.forEach(({ node, gain }) => { try { node.stop(); node.disconnect(); gain.disconnect(); } catch(e) {} });
    };
  }, []);

  return { isAudioStarted, isSamplesLoaded, startAudio, playNotes };
};