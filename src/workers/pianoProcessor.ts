// Piano AudioWorkletProcessor
// Optimized for low-latency and natural decay using standard DSP principles.

interface AudioWorkletProcessor {
  readonly port: MessagePort;
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

declare var AudioWorkletProcessor: {
  prototype: AudioWorkletProcessor;
  new (options?: any): AudioWorkletProcessor;
};

declare function registerProcessor(name: string, processorCtor: (new (options?: any) => AudioWorkletProcessor)): void;

/**
 * Constants for DSP
 */
const SAMPLE_RATE = 44100; // Expected sample rate
const RELEASE_TIME = 1.0;  // Seconds for a natural piano decay
const ANTI_CLICK_TIME = 0.005; // 5ms fade to prevent clicks
const DECAY_FACTOR = Math.exp(-1.0 / (SAMPLE_RATE * 0.2)); // Faster decay for re-strikes
const RELEASE_FACTOR = Math.exp(-Math.log(1000) / (SAMPLE_RATE * RELEASE_TIME)); // Natural decay factor

/**
 * Simple Feedback Comb Filter for Reverb
 */
class CombFilter {
  private buffer: Float32Array;
  private writeIndex = 0;
  constructor(delaySamples: number, private feedback: number) {
    this.buffer = new Float32Array(delaySamples);
  }
  process(input: number): number {
    const output = this.buffer[this.writeIndex];
    this.buffer[this.writeIndex] = input + output * this.feedback;
    this.writeIndex = (this.writeIndex + 1) % this.buffer.length;
    return output;
  }
}

class PianoProcessor extends AudioWorkletProcessor {
  private samples: Map<number, Float32Array> = new Map();
  private sampleMap: Map<number, number> = new Map();
  
  // Reverb components
  private reverbWet = 0;
  private combFilters: CombFilter[] = [];
  
  // State
  private sustainActive = false;
  private notesPendingRelease: Set<number> = new Set();

  // Master Settings
  private volume = 1.0;
  private velocitySensitivity = 1.0;
  private transpose = 0;

  // Active Voices
  private voices: {
    midi: number;
    sample: Float32Array;
    position: number;
    rate: number;
    velocity: number;
    currentGain: number;
    isReleasing: boolean;
    isStopping: boolean; // Very fast fade for re-strikes
  }[] = [];

  constructor() {
    super();
    // Initialize reverb comb filters with prime-ish delay lengths
    const baseDelay = Math.floor(SAMPLE_RATE * 0.03);
    this.combFilters = [
      new CombFilter(baseDelay + 113, 0.8),
      new CombFilter(baseDelay + 227, 0.78),
      new CombFilter(baseDelay + 331, 0.75),
      new CombFilter(baseDelay + 443, 0.72)
    ];
    this.port.onmessage = (event) => {
      this.handleMessage(event.data);
    };
  }

  private handleMessage(data: any) {
    const { type, payload } = data;
    switch (type) {
      case 'load-sample':
        this.samples.set(payload.midi, payload.data);
        break;
      case 'update-map':
        for (const [key, val] of Object.entries(payload.map)) {
          this.sampleMap.set(Number(key), Number(val));
        }
        break;
      case 'note-on':
        this.handleNoteOn(payload.midi, payload.velocity);
        break;
      case 'note-off':
        this.handleNoteOff(payload.midi);
        break;
      case 'sustain':
        this.handleSustain(payload.active);
        break;
      case 'config':
        if (payload.volume !== undefined) this.volume = Math.pow(10, payload.volume / 20);
        if (payload.velocitySensitivity !== undefined) this.velocitySensitivity = payload.velocitySensitivity;
        if (payload.transpose !== undefined) this.transpose = payload.transpose;
        if (payload.sustainEnabled !== undefined) this.handleSustain(payload.sustainEnabled);
        if (payload.reverb !== undefined) this.reverbWet = payload.reverb;
        break;
    }
  }

  handleNoteOn(midi: number, velocity: number) {
    const effectiveMidi = midi + this.transpose;
    const sampleMidi = this.sampleMap.get(effectiveMidi);
    
    if (sampleMidi === undefined) return;
    const sample = this.samples.get(sampleMidi);
    if (!sample) return;

    // Handle polyphony: If the same note is already playing, 
    // mark it for quick release (anti-click) instead of immediate cut.
    this.voices.forEach(v => {
      if (v.midi === midi && !v.isStopping) {
        v.isStopping = true;
      }
    });

    const rate = Math.pow(2, (effectiveMidi - sampleMidi) / 12);

    this.voices.push({
      midi,
      sample,
      position: 0,
      rate,
      velocity,
      currentGain: velocity,
      isReleasing: false,
      isStopping: false
    });

    this.notesPendingRelease.delete(midi);
  }

  handleNoteOff(midi: number) {
    if (this.sustainActive) {
      this.notesPendingRelease.add(midi);
      return;
    }

    this.voices.forEach(v => {
      if (v.midi === midi && !v.isReleasing) {
        v.isReleasing = true;
      }
    });
  }

  handleSustain(active: boolean) {
    const previouslyActive = this.sustainActive;
    this.sustainActive = active;
    
    if (previouslyActive && !active) {
      // Pedal released: trigger release for all notes that were held by sustain
      this.notesPendingRelease.forEach(midi => {
        this.voices.forEach(v => {
          if (v.midi === midi && !v.isReleasing) {
            v.isReleasing = true;
          }
        });
      });
      this.notesPendingRelease.clear();
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
    const output = outputs[0];
    const channelCount = output.length;
    const bufferLength = output[0].length;
    
    // Clear buffers
    for (let c = 0; c < channelCount; c++) {
      output[c].fill(0);
    }

    // Process all active voices
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const voice = this.voices[i];
      const sample = voice.sample;
      const maxPos = sample.length - 2; // -2 for interpolation safety

      for (let n = 0; n < bufferLength; n++) {
        const pos = voice.position;
        const index = Math.floor(pos);
        
        if (index >= maxPos || voice.currentGain < 0.001) {
          voice.currentGain = 0; // Final kill
          break;
        }

        // Linear Interpolation
        const frac = pos - index;
        const val1 = sample[index];
        const val2 = sample[index + 1];
        const rawSample = val1 + frac * (val2 - val1);

        // Apply Envelope (Exponential Decay)
        if (voice.isStopping) {
          voice.currentGain *= DECAY_FACTOR; // Fast fade
        } else if (voice.isReleasing) {
          voice.currentGain *= RELEASE_FACTOR; // Natural fade
        }

        // Apply volume
        const monoSignal = rawSample * voice.currentGain * this.volume;

        // Apply Reverb
        let reverbSignal = 0;
        if (this.reverbWet > 0) {
          // Parallel comb filters
          this.combFilters.forEach(cf => {
            reverbSignal += cf.process(monoSignal);
          });
          reverbSignal *= 0.25; // Average
        }

        // Mix to output (Dry/Wet)
        const finalSignal = monoSignal * (1 - this.reverbWet * 0.5) + reverbSignal * this.reverbWet;

        for (let c = 0; c < channelCount; c++) {
          output[c][n] += finalSignal;
        }

        voice.position += voice.rate;
      }

      // Cleanup finished voices
      if (voice.currentGain <= 0 || voice.position >= maxPos) {
        this.voices.splice(i, 1);
      }
    }

    return true;
  }
}

registerProcessor('piano-processor', PianoProcessor);