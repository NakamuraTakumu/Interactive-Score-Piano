import { useState, useEffect } from 'react';

/**
 * Hook to manage currently pressed MIDI note numbers
 */
export const useMidi = () => {
  const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set());

  useEffect(() => {
    let midiAccessObj: MIDIAccess | null = null;
    const savedInputs: any[] = [];

    const handleMidiMessage = (message: any) => {
      const [command, note, velocity] = message.data;
      
      // Note On (0x90) and Note Off (0x80)
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

    const cleanupInputs = () => {
      savedInputs.forEach((input) => {
        input.removeEventListener('midimessage', handleMidiMessage);
      });
      savedInputs.length = 0;
    };

    const setupInputs = (access: MIDIAccess) => {
      cleanupInputs();
      for (const input of access.inputs.values()) {
        input.addEventListener('midimessage', handleMidiMessage);
        savedInputs.push(input);
      }
    };

    const onMIDISuccess = (midiAccess: MIDIAccess) => {
      midiAccessObj = midiAccess;
      setupInputs(midiAccess);

      midiAccess.onstatechange = () => {
        setupInputs(midiAccess);
      };
    };

    const onMIDIFailure = (err: any) => {
      console.warn('MIDI access failed:', err);
      // Ideally alerts should be handled by the UI, but logging here for development
    };

    if (navigator.requestMIDIAccess) {
      navigator.requestMIDIAccess({ sysex: false }).then(onMIDISuccess, onMIDIFailure);
    } else {
      console.warn('Web MIDI API is not supported in this browser.');
    }

    return () => {
      cleanupInputs();
      if (midiAccessObj) {
        midiAccessObj.onstatechange = null;
      }
    };
  }, []);

  return activeNotes;
};
