import { useState, useEffect, useCallback } from 'react';

export interface MidiDevice {
  id: string;
  name: string;
  manufacturer?: string;
}

/**
 * Hook to manage currently pressed MIDI note numbers and MIDI devices
 */
export const useMidi = () => {
  const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set());
  const [availableDevices, setAvailableDevices] = useState<MidiDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('all');
  const [midiAccess, setMidiAccess] = useState<MIDIAccess | null>(null);

  useEffect(() => {
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

    const updateDevices = (access: MIDIAccess) => {
      const devices: MidiDevice[] = [];
      access.inputs.forEach((input) => {
        devices.push({
          id: input.id,
          name: input.name || 'Unknown Device',
          manufacturer: input.manufacturer ?? undefined
        });
      });
      setAvailableDevices(devices);
    };

    const setupInputs = (access: MIDIAccess, deviceId: string) => {
      access.inputs.forEach((input) => {
        // 全てのデバイス、または選択されたIDのデバイスのみ購読
        if (deviceId === 'all' || input.id === deviceId) {
          input.onmidimessage = handleMidiMessage;
        } else {
          input.onmidimessage = null;
        }
      });
    };

    const onMIDISuccess = (access: MIDIAccess) => {
      setMidiAccess(access);
      updateDevices(access);
      setupInputs(access, selectedDeviceId);

      access.onstatechange = () => {
        updateDevices(access);
        setupInputs(access, selectedDeviceId);
      };
    };

    const onMIDIFailure = (err: any) => {
      console.warn('MIDI access failed:', err);
    };

    if (navigator.requestMIDIAccess) {
      navigator.requestMIDIAccess({ sysex: false }).then(onMIDISuccess, onMIDIFailure);
    } else {
      console.warn('Web MIDI API is not supported in this browser.');
    }

    return () => {
      if (midiAccess) {
        midiAccess.inputs.forEach((input) => {
          input.onmidimessage = null;
        });
        midiAccess.onstatechange = null;
      }
    };
  }, [selectedDeviceId, midiAccess]);

  const selectDevice = useCallback((id: string) => {
    setSelectedDeviceId(id);
  }, []);

  return {
    activeNotes,
    availableDevices,
    selectedDeviceId,
    selectDevice
  };
};
