import { useState, useEffect, useRef } from 'react';
import * as Tone from 'tone';

/**
 * MIDI入力に合わせてTone.jsで音を鳴らすためのフック
 */
export const usePianoSound = () => {
  const [isAudioStarted, setIsAudioStarted] = useState(false);
  const [volume, setVolume] = useState(0);
  // Sampler または PolySynth を保持できる型定義ですが、
  // ここでは Sampler をメインに使うため any または Tone.Sampler | Tone.PolySynth とします。
  // Tone.js の型定義上、共通の Instrument インターフェースで操作可能です。
  const samplerRef = useRef<Tone.Sampler | null>(null);

  // AudioContextの開始（ユーザーインタラクションが必要）
  const startAudio = async () => {
    try {
      await Tone.start();
      setIsAudioStarted(true);
      console.log('Audio Context Started');
    } catch (error) {
      console.error('Failed to start audio context:', error);
    }
  };

  // ピアノサンプラーの初期化
  useEffect(() => {
    const sampler = new Tone.Sampler({
      urls: {
        "A0": "A0.mp3",
        "C1": "C1.mp3",
        "D#1": "Ds1.mp3",
        "F#1": "Fs1.mp3",
        "A1": "A1.mp3",
        "C2": "C2.mp3",
        "D#2": "Ds2.mp3",
        "F#2": "Fs2.mp3",
        "A2": "A2.mp3",
        "C3": "C3.mp3",
        "D#3": "Ds3.mp3",
        "F#3": "Fs3.mp3",
        "A3": "A3.mp3",
        "C4": "C4.mp3",
        "D#4": "Ds4.mp3",
        "F#4": "Fs4.mp3",
        "A4": "A4.mp3",
        "C5": "C5.mp3",
        "D#5": "Ds5.mp3",
        "F#5": "Fs5.mp3",
        "A5": "A5.mp3",
        "C6": "C6.mp3",
        "D#6": "Ds6.mp3",
        "F#6": "Fs6.mp3",
        "A6": "A6.mp3",
        "C7": "C7.mp3",
        "D#7": "Ds7.mp3",
        "F#7": "Fs7.mp3",
        "A7": "A7.mp3",
        "C8": "C8.mp3"
      },
      release: 1,
      baseUrl: "https://tonejs.github.io/audio/salamander/",
      onload: () => {
        console.log("Piano samples loaded");
      }
    }).toDestination();
    
    // 初期音量設定
    sampler.volume.value = volume;

    samplerRef.current = sampler;

    return () => {
      sampler.dispose();
    };
  }, []);

  // 音量変更の監視
  useEffect(() => {
    if (samplerRef.current) {
      samplerRef.current.volume.value = volume;
    }
  }, [volume]);

  // MIDIイベントの監視
  useEffect(() => {
    const onMIDISuccess = (midiAccess: MIDIAccess) => {
      for (const input of midiAccess.inputs.values()) {
        input.onmidimessage = (message: any) => {
          if (!samplerRef.current) return;
          if (!Tone.context.state || Tone.context.state !== 'running') {
            // コンテキストが動いていない場合は無視（startAudio待ち）
            return; 
          }

          const [command, note, velocity] = message.data;
          // Note On
          if (command >= 0x90 && command <= 0x9F && velocity > 0) {
            const vel = velocity / 127;
            // Sampler.triggerAttack(note, time, velocity)
            // noteは MIDI番号ではなく音名（"C4"など）または周波数が推奨されるが、
            // Tone.Frequency(midi, "midi") で変換して渡す
            const frequency = Tone.Frequency(note, "midi").toNote();
            samplerRef.current.triggerAttack(frequency, Tone.now(), vel);
          } 
          // Note Off
          else if ((command >= 0x80 && command <= 0x8F) || (command >= 0x90 && command <= 0x9F && velocity === 0)) {
            const frequency = Tone.Frequency(note, "midi").toNote();
            samplerRef.current.triggerRelease(frequency);
          }
        };
      }
    };

    const onMIDIFailure = (err: any) => {
      console.warn('MIDI access failed in usePianoSound:', err);
    };

    if (navigator.requestMIDIAccess) {
      navigator.requestMIDIAccess().then(onMIDISuccess, onMIDIFailure);
    }

    return () => {
      if (samplerRef.current) {
        samplerRef.current.releaseAll();
      }
    };
  }, []);

  return {
    isAudioStarted,
    startAudio,
    volume,
    setVolume
  };
};
