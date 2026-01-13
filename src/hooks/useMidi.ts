import { useState, useEffect, useCallback, useRef } from 'react';

export interface MidiDevice {
  id: string;
  name: string;
  manufacturer?: string;
}

/**
 * Hook to manage currently pressed MIDI note numbers and MIDI devices
 * Receives MIDI events from the Main Thread (Web MIDI API) and forwards to AudioWorklet
 */
export const useMidi = (workletNode: AudioWorkletNode | null = null) => {
  const [activeNotes, setActiveNotes] = useState<Set<number>>(new Set());
  const [availableDevices, setAvailableDevices] = useState<MidiDevice[]>([]);
  const [selectedDeviceId, setSelectedDeviceId] = useState<string>('all');

  const midiAccessRef = useRef<any>(null); // Use any for MIDIAccess to avoid type issues

  // Handle MIDI Message
  const handleMidiMessage = useCallback((event: any) => {
    if (!event.data) return;
    const [command, data1, data2] = event.data;
    const timestamp = event.timeStamp;

    // 1. Forward to AudioWorklet for low-latency sound
    if (workletNode) {
      // Note On
      if (command >= 0x90 && command <= 0x9F && data2 > 0) {
        workletNode.port.postMessage({ type: 'note-on', payload: { midi: data1, velocity: data2 / 127 } });
      } 
      // Note Off
      else if ((command >= 0x80 && command <= 0x8F) || (command >= 0x90 && command <= 0x9F && data2 === 0)) {
        workletNode.port.postMessage({ type: 'note-off', payload: { midi: data1 } });
      }
      // Sustain Pedal (CC 64)
      else if (command === 0xB0 && data1 === 64) {
        workletNode.port.postMessage({ type: 'sustain', payload: { active: data2 >= 64 } });
      }
    }

    // 2. Update UI State (Active Notes)
    // Note On
    if (command >= 144 && command <= 159) {
      if (data2 > 0) {
        setActiveNotes((prev) => new Set(prev).add(data1));
      } else {
        setActiveNotes((prev) => {
          const next = new Set(prev);
          next.delete(data1);
          return next;
        });
      }
    }
    // Note Off
    else if (command >= 128 && command <= 143) {
      setActiveNotes((prev) => {
        const next = new Set(prev);
        next.delete(data1);
        return next;
      });
    }
  }, [workletNode]);

  // Refresh Device List and Re-attach Listeners
  const refreshDevices = useCallback(() => {
    if (!midiAccessRef.current) return;
    
    const devices: MidiDevice[] = [];
    for (const input of midiAccessRef.current.inputs.values()) {
      devices.push({
        id: input.id,
        name: input.name,
        manufacturer: input.manufacturer
      });
    }
    setAvailableDevices(devices);

    // Re-attach listeners based on selection
    for (const input of midiAccessRef.current.inputs.values()) {
      if (selectedDeviceId === 'all' || input.id === selectedDeviceId) {
        input.onmidimessage = handleMidiMessage;
      } else {
        input.onmidimessage = null;
      }
    }
  }, [selectedDeviceId, handleMidiMessage]);

  // Init MIDI Access
  useEffect(() => {
    if (!navigator.requestMIDIAccess) {
      console.warn('Web MIDI API not supported in this browser.');
      return;
    }

    navigator.requestMIDIAccess().then((access) => {
      midiAccessRef.current = access;
      console.log('MIDI Access granted in Main Thread');
      
      refreshDevices();
      
      access.onstatechange = (e: any) => {
        refreshDevices();
      };
    }).catch(err => {
      console.error('Failed to get MIDI access', err);
    });

  }, []); // Run once on mount

  // Update listeners when device selection changes or midiAccess is ready
  useEffect(() => {
    if (midiAccessRef.current) {
      refreshDevices();
    }
  }, [selectedDeviceId, refreshDevices]);

  return {
    activeNotes,
    availableDevices,
    selectedDeviceId,
    selectDevice: setSelectedDeviceId
  };
};