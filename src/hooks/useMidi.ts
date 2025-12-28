import { useState, useEffect } from 'react';

/**
 * 現在押されているMIDIノート番号を管理するフック
 */
export const useMidi = () => {
  const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set());

  useEffect(() => {
    const onMIDISuccess = (midiAccess: MIDIAccess) => {
      for (const input of midiAccess.inputs.values()) {
        input.onmidimessage = (message: any) => {
          const [command, note, velocity] = message.data;
          
          // Note On (0x90) and Note Off (0x80)
          // velocity が 0 の Note On も Note Off とみなす
          if (command >= 0x90 && command <= 0x9F && velocity > 0) {
            setActiveNotes(prev => new Set(prev).add(note));
          } else if ((command >= 0x80 && command <= 0x8F) || (command >= 0x90 && command <= 0x9F && velocity === 0)) {
            setActiveNotes(prev => {
              const next = new Set(prev);
              next.delete(note);
              return next;
            });
          }
        };
      }
    };

    const onMIDIFailure = (err: any) => {
      console.warn('MIDI access failed:', err);
      // ユーザー向けのアラート等はUI側で行うのが理想ですが、開発中はここでもログを出します
    };

    if (navigator.requestMIDIAccess) {
      navigator.requestMIDIAccess({ sysex: false }).then(onMIDISuccess, onMIDIFailure);
    } else {
      console.warn('Web MIDI API is not supported in this browser.');
    }

    return () => {
      // クリーンアップ
    };
  }, []);

  return activeNotes;
};
