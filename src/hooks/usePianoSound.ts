import { useState, useEffect, useRef, useCallback } from 'react';

/**
 * Web Audio APIを直接使用して低遅延でピアノ音（シンセサイズ）を鳴らすフック
 */
export const usePianoSound = () => {
  const [isAudioStarted, setIsAudioStarted] = useState(false);
  
  // 初期値をlocalStorageから取得
  const [volume, setVolume] = useState(() => {
    const saved = localStorage.getItem('piano_volume');
    return saved !== null ? parseFloat(saved) : 0; // dB単位 (-60 to 0)
  });

  const audioContextRef = useRef<AudioContext | null>(null);
  const masterGainRef = useRef<GainNode | null>(null);
  // 鳴っている音を管理するためのMap: MIDI番号 -> { オシレーター, ゲインノード }
  const activeOscillators = useRef<Map<number, { osc: OscillatorNode, gain: GainNode }>>(new Map());

  // 音量(dB)をリニアなゲイン値(0.0-1.0)に変換
  const dbToGain = (db: number) => {
    return Math.pow(10, db / 20);
  };

  // AudioContextの初期化
  const initAudioContext = useCallback(() => {
    if (audioContextRef.current) return audioContextRef.current;

    const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
    const ctx = new AudioContextClass({ latencyHint: 'interactive' });
    
    // マスターゲインノード作成
    const masterGain = ctx.createGain();
    masterGain.gain.value = dbToGain(volume);
    masterGain.connect(ctx.destination);
    
    audioContextRef.current = ctx;
    masterGainRef.current = masterGain;

    setIsAudioStarted(true);
    console.log('Web Audio API Context Started');
    return ctx;
  }, [volume]);

  // AudioContextの開始（ユーザーインタラクションが必要）
  const startAudio = useCallback(async () => {
    const ctx = initAudioContext();
    if (ctx.state === 'suspended') {
      await ctx.resume();
    }
  }, [initAudioContext]);

  // 音量の更新
  useEffect(() => {
    if (masterGainRef.current) {
      // 急激な音量変化によるノイズを防ぐため、少し時間をかけて変更
      const now = audioContextRef.current?.currentTime || 0;
      masterGainRef.current.gain.setTargetAtTime(dbToGain(volume), now, 0.05);
    }
    localStorage.setItem('piano_volume', volume.toString());
  }, [volume]);

  // ノートオン処理（発音）
  const triggerAttack = useCallback((midi: number, velocity: number = 1.0) => {
    const ctx = audioContextRef.current;
    const masterGain = masterGainRef.current;
    if (!ctx || !masterGain) return;

    // 既に鳴っている同じ音があれば止める
    if (activeOscillators.current.has(midi)) {
      triggerRelease(midi);
    }

    const osc = ctx.createOscillator();
    const gain = ctx.createGain();

    // 周波数計算
    const frequency = 440 * Math.pow(2, (midi - 69) / 12);
    osc.frequency.setValueAtTime(frequency, ctx.currentTime);
    osc.type = 'triangle'; // Tone.jsのデフォルトに近い音色

    // エンベロープ設定 (ADSR)
    // Tone.js default: attack: 0.005, decay: 0.1, sustain: 0.3, release: 1
    const t = ctx.currentTime;
    const attack = 0.005;
    const decay = 0.1;
    const sustain = 0.3;

    osc.connect(gain);
    gain.connect(masterGain);

    osc.start(t);

    // アタック
    gain.gain.setValueAtTime(0, t);
    gain.gain.linearRampToValueAtTime(velocity, t + attack);
    // ディケイ -> サステイン
    gain.gain.exponentialRampToValueAtTime(velocity * sustain, t + attack + decay);

    activeOscillators.current.set(midi, { osc, gain });
  }, []);

  // ノートオフ処理（止音）
  const triggerRelease = useCallback((midi: number) => {
    const ctx = audioContextRef.current;
    const active = activeOscillators.current.get(midi);
    if (!ctx || !active) return;

    const { osc, gain } = active;
    const t = ctx.currentTime;
    const release = 1.0; // リリース時間

    // リリースエンベロープ
    // クリックノイズを防ぐため、現在のゲイン値から0へ向かう
    gain.gain.cancelScheduledValues(t);
    gain.gain.setValueAtTime(gain.gain.value, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + release);

    osc.stop(t + release);
    
    // ガベージコレクションのために一定時間後にMapから削除
    // (厳密には stop イベントで消すべきだが簡易実装)
    setTimeout(() => {
      // まだ同じオシレーターが登録されていれば削除
      if (activeOscillators.current.get(midi)?.osc === osc) {
        activeOscillators.current.delete(midi);
        osc.disconnect();
        gain.disconnect();
      }
    }, release * 1000 + 100);
  }, []);

  // 指定した音を一定時間鳴らす（スコアクリック用）
  const playNotes = useCallback(async (midiNotes: number[], durationStr: string = "4n") => {
    if (!audioContextRef.current) await startAudio();
    const ctx = audioContextRef.current;
    if (!ctx) return;
    if (ctx.state !== 'running') await ctx.resume();

    // durationStr ("4n") を秒数に変換 (簡易計算: BPM=120想定)
    // 4n = 0.5s
    const duration = 0.5; 

    midiNotes.forEach(note => {
      triggerAttack(note, 1.0);
      setTimeout(() => {
        triggerRelease(note);
      }, duration * 1000);
    });
  }, [startAudio, triggerAttack, triggerRelease]);

  // MIDIイベント処理の本体（常に最新の状態を参照できるようにRef経由で呼び出す）
  const handleMidiMessage = useCallback((message: any) => {
    // AudioContextの準備
    if (!audioContextRef.current) {
      if (isAudioStarted) {
        initAudioContext();
      }
    }
    
    // サスペンド状態なら復帰を試みる
    if (audioContextRef.current?.state === 'suspended') {
      audioContextRef.current.resume().catch(e => console.warn('Failed to resume AudioContext on MIDI:', e));
    }

    const [command, note, velocity] = message.data;
    
    // Note On
    if (command >= 0x90 && command <= 0x9F && velocity > 0) {
      // コンテキストがない場合は作成を試みる（ただしユーザー操作が必要な場合があるため失敗する可能性あり）
      if (!audioContextRef.current) {
         try {
           initAudioContext();
         } catch(e) {
           console.warn('Could not init AudioContext from MIDI event:', e);
         }
      }
      triggerAttack(note, velocity / 127);
    } 
    // Note Off
    else if ((command >= 0x80 && command <= 0x8F) || (command >= 0x90 && command <= 0x9F && velocity === 0)) {
      triggerRelease(note);
    }
  }, [isAudioStarted, initAudioContext, triggerAttack, triggerRelease]);

  // MIDIハンドラをRefに保持（イベントリスナーからはこれを呼ぶ）
  const midiHandlerRef = useRef(handleMidiMessage);
  useEffect(() => {
    midiHandlerRef.current = handleMidiMessage;
  }, [handleMidiMessage]);

  // MIDI初期化（マウント時のみ実行）
  useEffect(() => {
    const onMIDISuccess = (midiAccess: MIDIAccess) => {
      console.log('MIDI Access Granted');
      
      const setupInputs = () => {
        for (const input of midiAccess.inputs.values()) {
          // 既存のリスナーを上書きしないように注意が必要だが、
          // ここではシンプルに全ての入力に対してRef経由のハンドラを設定する
          input.onmidimessage = (event) => {
            midiHandlerRef.current(event);
          };
        }
      };

      setupInputs();
      
      // 接続機器の変更を監視
      midiAccess.onstatechange = (e) => {
        console.log('MIDI State Changed:', e);
        setupInputs();
      };
    };

    const onMIDIFailure = (err: any) => {
      console.warn('MIDI access failed:', err);
    };

    if (navigator.requestMIDIAccess) {
      navigator.requestMIDIAccess().then(onMIDISuccess, onMIDIFailure);
    } else {
      console.warn('Web MIDI API is not supported in this browser.');
    }

    return () => {
      // クリーンアップ: 全ての音を止める
      activeOscillators.current.forEach(({ osc, gain }) => {
        try {
          osc.stop();
          osc.disconnect();
          gain.disconnect();
        } catch(e) {}
      });
      activeOscillators.current.clear();
    };
  }, []); // 依存配列を空にして一度だけ実行

  return {
    isAudioStarted,
    startAudio,
    volume,
    setVolume,
    playNotes
  };
};