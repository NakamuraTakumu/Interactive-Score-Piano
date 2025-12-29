import { useState, useEffect, useRef } from 'react';
import * as Tone from 'tone';

/**
 * MIDI入力に合わせてTone.jsで音を鳴らすためのフック
 */
export const usePianoSound = () => {
  const [isAudioStarted, setIsAudioStarted] = useState(false);
  const [volume, setVolume] = useState(0);
  const synthRef = useRef<Tone.PolySynth | null>(null);

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

  // シンセサイザーの初期化
  useEffect(() => {
    // 低遅延を優先し、シンセサイザー方式を採用
    const synth = new Tone.PolySynth(Tone.Synth, {
      oscillator: {
        type: "triangle"
      },
      envelope: {
        attack: 0.005, // アタックを速くして打鍵感を出す
        decay: 0.1,
        sustain: 0.3,
        release: 1
      }
    }).toDestination();
    
    // 初期音量設定
    synth.volume.value = volume;

    synthRef.current = synth;

    return () => {
      synth.dispose();
    };
  }, []);

  // 音量変更の監視
  useEffect(() => {
    if (synthRef.current) {
      synthRef.current.volume.value = volume;
    }
  }, [volume]);

  // MIDIイベントの監視
  useEffect(() => {
    const onMIDISuccess = (midiAccess: MIDIAccess) => {
      for (const input of midiAccess.inputs.values()) {
        input.onmidimessage = (message: any) => {
          if (!synthRef.current) return;
          // AudioContextの状態確認は省略し、Tone.js内部の処理に任せる（start済みなら鳴る）

          const [command, note, velocity] = message.data;
          // Note On
          if (command >= 0x90 && command <= 0x9F && velocity > 0) {
            const vel = velocity / 127;
            const frequency = Tone.Frequency(note, "midi").toFrequency();
            synthRef.current.triggerAttack(frequency, Tone.now(), vel);
          } 
          // Note Off
          else if ((command >= 0x80 && command <= 0x8F) || (command >= 0x90 && command <= 0x9F && velocity === 0)) {
            const frequency = Tone.Frequency(note, "midi").toFrequency();
            synthRef.current.triggerRelease(frequency);
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
      if (synthRef.current) {
        synthRef.current.releaseAll();


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
