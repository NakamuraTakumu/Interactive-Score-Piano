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

  // 初回のみMIDIアクセス権を取得
  useEffect(() => {
    if (navigator.requestMIDIAccess) {
      navigator.requestMIDIAccess().then(
        (access) => {
          setMidiAccess(access);
        },
        (err) => {
          console.warn('MIDI access failed:', err);
        }
      );
    }
  }, []);

  // デバイスリストの更新とメッセージ購読の管理
  useEffect(() => {
    if (!midiAccess) return;

    const handleMidiMessage = (message: any) => {
      const [command, note, velocity] = message.data;
      
      // Note On: 0x90 to 0x9F (144-159)
      if (command >= 144 && command <= 159) {
        if (velocity > 0) {
          setActiveNotes((prev) => new Set(prev).add(note));
        } else {
          setActiveNotes((prev) => {
            const next = new Set(prev);
            next.delete(note);
            return next;
          });
        }
      }
      // Note Off: 0x80 to 0x8F (128-143)
      else if (command >= 128 && command <= 143) {
        setActiveNotes((prev) => {
          const next = new Set(prev);
          next.delete(note);
          return next;
        });
      }
    };

    const updateDevices = () => {
      const devices: MidiDevice[] = [];
      midiAccess.inputs.forEach((input) => {
        devices.push({
          id: input.id,
          name: input.name || 'Unknown Device',
          manufacturer: input.manufacturer ?? undefined
        });
      });
      setAvailableDevices(devices);
    };

    const setupInputs = () => {
      midiAccess.inputs.forEach((input) => {
        if (selectedDeviceId === 'all' || input.id === selectedDeviceId) {
          input.onmidimessage = handleMidiMessage;
        } else {
          input.onmidimessage = null;
        }
      });
    };

    // 初期実行
    updateDevices();
    setupInputs();

    // 接続状態の変化を監視
    midiAccess.onstatechange = () => {
      updateDevices();
      setupInputs();
    };

    return () => {
      midiAccess.inputs.forEach((input) => {
        input.onmidimessage = null;
      });
      midiAccess.onstatechange = null;
    };
  }, [midiAccess, selectedDeviceId]);

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