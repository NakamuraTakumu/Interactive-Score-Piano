// MIDI Web Worker
// Handles MIDI access and messages off the main thread to reduce latency.

let audioPort: MessagePort | null = null;
let midiAccess: MIDIAccess | null = null;
let selectedDeviceId: string = 'all';

/**
 * Handle messages from the main thread
 */
self.onmessage = (event) => {
  const { type, payload } = event.data;

  switch (type) {
    case 'init':
      // Receive MessagePort for direct communication with AudioWorklet
      if (payload.port) {
        audioPort = payload.port;
        console.log('[MIDI Worker] AudioPort established');
      }
      // initMidi(); // MIDI Access moved to Main Thread due to lack of support in Workers
      break;
    
    case 'set-device':
      if (payload.deviceId) {
        selectedDeviceId = payload.deviceId;
        console.log('[MIDI Worker] Selected device:', selectedDeviceId);
        setupInputs();
      }
      break;

    case 'get-devices':
      if (midiAccess) {
        sendDeviceList();
      }
      break;
  }
};

/**
 * Initialize MIDI Access
 */
async function initMidi() {
  if (!navigator.requestMIDIAccess) {
    console.error('[MIDI Worker] MIDI not supported in this environment');
    return;
  }

  try {
    midiAccess = await navigator.requestMIDIAccess();
    console.log('[MIDI Worker] MIDI Access granted');

    setupInputs();
    sendDeviceList();

    midiAccess.onstatechange = (e: any) => {
      // Refresh inputs and notify main thread of device changes
      setupInputs();
      sendDeviceList();
    };

  } catch (err) {
    console.error('[MIDI Worker] Failed to get MIDI access', err);
  }
}

/**
 * Setup MIDI Input listeners based on selected device
 */
function setupInputs() {
  if (!midiAccess) return;

  // Cleanup existing listeners if needed? 
  // In WebMIDI, we can just overwrite onmidimessage.
  // But we need to make sure we clear listeners from devices that are no longer selected.
  
  for (const input of midiAccess.inputs.values()) {
    if (selectedDeviceId === 'all' || (input as any).id === selectedDeviceId) {
      (input as any).onmidimessage = handleMidiMessage;
    } else {
      (input as any).onmidimessage = null;
    }
  }
}

/**
 * Send the list of available devices to the main thread
 */
function sendDeviceList() {
  if (!midiAccess) return;

  const devices = Array.from(midiAccess.inputs.values()).map((input: any) => ({
    id: input.id,
    name: input.name,
    manufacturer: input.manufacturer
  }));

  self.postMessage({
    type: 'devices-update',
    payload: { devices }
  });
}

/**
 * Process MIDI messages and forward to AudioWorklet and Main Thread
 */
function handleMidiMessage(event: MIDIMessageEvent) {
  if (!event.data) return;
  const [command, data1, data2] = event.data;

  // 1. Forward to AudioWorklet for low-latency sound
  if (audioPort) {
    // Note On
    if (command >= 0x90 && command <= 0x9F && data2 > 0) {
      audioPort.postMessage({ type: 'note-on', payload: { midi: data1, velocity: data2 / 127 } });
    } 
    // Note Off
    else if ((command >= 0x80 && command <= 0x8F) || (command >= 0x90 && command <= 0x9F && data2 === 0)) {
      audioPort.postMessage({ type: 'note-off', payload: { midi: data1 } });
    }
    // Sustain Pedal (CC 64)
    else if (command === 0xB0 && data1 === 64) {
      // AudioWorklet will need to handle sustain logic
      audioPort.postMessage({ type: 'sustain', payload: { active: data2 >= 64 } });
    }
  }

  // 2. Forward to Main Thread for UI updates (active notes display, etc.)
  // We send the raw data to keep it consistent
  self.postMessage({
    type: 'midi-event',
    payload: {
      data: Array.from(event.data),
      timestamp: event.timeStamp
    }
  });
}
