import { useState, useEffect, useRef, useCallback } from 'react';
import { SoundType, PianoSettings } from '../types/piano';
// @ts-ignore - Vite special import
import pianoProcessorUrl from '../workers/pianoProcessor?worker&url';

/**
 * Hook to play synthesized or sampled piano sounds with low latency using AudioWorklet and Web Workers
 */
export const usePianoSound = (settings: PianoSettings, onSettingsChange: <K extends keyof PianoSettings>(key: K, value: PianoSettings[K]) => void) => {
  const [isAudioStarted, setIsAudioStarted] = useState(false);
  const [isSamplesLoaded, setIsSamplesLoaded] = useState(false);
  
  const { soundType, volume, reverb, transpose, sustainEnabled, velocitySensitivity } = settings;

  const audioContextRef = useRef<AudioContext | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);

  // Cache for MIDI note to sample mapping
  const sampleMapRef = useRef<Map<number, number>>(new Map());

  // Convert volume (dB) to linear gain value (0.0-1.0)
  const dbToGain = (db: number) => Math.pow(10, db / 20);

  // Load piano samples and transfer to worklet
  const loadSamples = useCallback(async (ctx: AudioContext, workletNode: AudioWorkletNode) => {
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
        
        // Extract raw data and transfer to worklet
        // Use channel 0 (mono) for the piano sample
        const channelData = audioBuffer.getChannelData(0);
        workletNode.port.postMessage({
          type: 'load-sample',
          payload: { midi, data: channelData }
        }, [channelData.buffer]);
        
      } catch (e) { console.error(`Failed sample ${name}:`, e); }
    };

    await Promise.all(notesToLoad.map(loadNote));
    
    // Pre-calculate sample mapping and send to worklet
    const loadedMidis = notesToLoad.sort((a, b) => a - b);
    const mapping: Record<number, number> = {};
    for (let i = 0; i < 128; i++) {
      const closest = loadedMidis.reduce((prev, curr) => 
        Math.abs(curr - i) < Math.abs(prev - i) ? curr : prev
      );
      mapping[i] = closest;
    }
    workletNode.port.postMessage({ type: 'update-map', payload: { map: mapping } });

    setIsSamplesLoaded(true);
  }, [isSamplesLoaded]);

  // Initialize Audio and Workers
  const initAudio = useCallback(async () => {
    if (audioContextRef.current) return;

    const ctx = new (window.AudioContext || (window as any).webkitAudioContext)({ latencyHint: 'interactive' });
    
    try {
      // 1. Load AudioWorklet using the Vite-processed URL
      await ctx.audioWorklet.addModule(pianoProcessorUrl);
      const workletNode = new AudioWorkletNode(ctx, 'piano-processor');

      workletNode.connect(ctx.destination);
      workletNodeRef.current = workletNode;

      // 2. Setup MessageChannel for Direct Bypass
      const channel = new MessageChannel();
      // We don't have a MIDI worker anymore, so we don't need this channel setup for now.
      // But if we wanted to connect another worker later, we could.
      // For now, let's skip the complicated channel setup and just use workletNode.port from main thread.
      
      // But wait, the previous code had:
      // workletNode.port.postMessage({ type: 'init-midi-port', payload: { port: channel.port2 } }, [channel.port2]);
      // If we remove this, we need to make sure pianoProcessor handles messages from its main port too.
      // pianoProcessor constructor: this.port.onmessage = ... (This listens to main thread)
      // pianoProcessor handleMessage 'init-midi-port': sets up midiPort.
      
      // Since we are moving MIDI to main thread, we will send NoteOn/Off via workletNode.port directly.
      // So no need for extra ports.

      audioContextRef.current = ctx;
      setIsAudioStarted(true);
      
      // Load samples
      loadSamples(ctx, workletNode);
      
    } catch (e) {
      console.error('Failed to initialize audio system:', e);
    }
  }, [loadSamples]);

  const startAudio = useCallback(async () => {
    if (!audioContextRef.current) {
      await initAudio();
    }
    if (audioContextRef.current?.state === 'suspended') {
      await audioContextRef.current.resume();
    }
  }, [initAudio]);

  // Handle manual note playing (e.g. from UI)
  const playNotes = useCallback(async (midiNotes: number[]) => {
    if (!workletNodeRef.current) await startAudio();
    midiNotes.forEach(note => {
      workletNodeRef.current?.port.postMessage({ type: 'note-on', payload: { midi: note, velocity: 0.8 } });
      setTimeout(() => {
        workletNodeRef.current?.port.postMessage({ type: 'note-off', payload: { midi: note } });
      }, 500);
    });
  }, [startAudio]);

  // Update worklet settings when they change
  useEffect(() => {
    if (workletNodeRef.current) {
      workletNodeRef.current.port.postMessage({ 
        type: 'config', 
        payload: { 
          volume, 
          reverb, 
          transpose, 
          sustainEnabled, 
          velocitySensitivity 
        } 
      });
    }
  }, [volume, reverb, transpose, sustainEnabled, velocitySensitivity]);

  return { isAudioStarted, isSamplesLoaded, startAudio, playNotes, workletNode: workletNodeRef.current };
};