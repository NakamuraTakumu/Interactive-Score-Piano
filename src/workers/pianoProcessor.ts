// Piano AudioWorkletProcessor
// Runs in the audio thread. Handles sample playback and mixing.

interface AudioWorkletProcessor {
  readonly port: MessagePort;
  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean;
}

declare var AudioWorkletProcessor: {
  prototype: AudioWorkletProcessor;
  new (options?: any): AudioWorkletProcessor;
};

declare function registerProcessor(name: string, processorCtor: (new (options?: any) => AudioWorkletProcessor)): void;

class PianoProcessor extends AudioWorkletProcessor {
  private samples: Map<number, Float32Array> = new Map();
  private sampleMap: Map<number, number> = new Map();
  
  // Sustain State
  private sustainActive = false;
  private notesPendingRelease: Set<number> = new Set();

  // Settings
  private volume = 1.0;
  private velocitySensitivity = 1.0;
  private transpose = 0;

  // Active Voices
  private voices: {
    id: number;
    midi: number;
    sampleMidi: number;
    sample: Float32Array;
    position: number;
    rate: number;
    velocity: number;
    isPlaying: boolean;
    isReleasing: boolean;
    releaseVolume: number;
    releaseCount: number;
  }[] = [];

  private nextVoiceId = 0;
  private midiPort: MessagePort | null = null;

  constructor() {
    super();
    this.port.onmessage = (event) => {
      this.handleMessage(event.data);
    };
  }

  private handleMessage(data: any) {
    const { type, payload } = data;
    switch (type) {
      case 'init-midi-port':
        if (payload.port) {
          this.midiPort = payload.port;
          payload.port.onmessage = (event: MessageEvent) => {
            this.handleMessage(event.data);
          };
          console.log('[Piano Processor] MIDI Port established');
        }
        break;
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
        if (payload.volume !== undefined) {
          // Convert dB to linear gain: 10^(db/20)
          this.volume = Math.pow(10, payload.volume / 20);
        }
        if (payload.velocitySensitivity !== undefined) {
          this.velocitySensitivity = payload.velocitySensitivity;
        }
        if (payload.transpose !== undefined) {
          this.transpose = payload.transpose;
        }
        break;
    }
  }

  handleNoteOn(midi: number, velocity: number) {
    const effectiveMidi = midi + this.transpose;
    const sampleMidi = this.sampleMap.get(effectiveMidi);
    
    // Fallback or silence if out of range/not found
    if (sampleMidi === undefined) return;
    
    const sample = this.samples.get(sampleMidi);
    if (!sample) return;

    // Stop existing voice for this note if any (monophonic per key)
    const existing = this.voices.find(v => v.midi === midi && v.isPlaying);
    if (existing) {
        existing.isReleasing = true;
        existing.isPlaying = false;
    }

    // Calculate playback rate based on effective pitch
    const rate = Math.pow(2, (effectiveMidi - sampleMidi) / 12);

    this.voices.push({
      id: this.nextVoiceId++,
      midi, // Store original MIDI for NoteOff matching
      sampleMidi,
      sample,
      position: 0,
      rate,
      velocity,
      isPlaying: true,
      isReleasing: false,
      releaseVolume: 1.0,
      releaseCount: 0
    });

    this.notesPendingRelease.delete(midi);
  }

  handleNoteOff(midi: number) {
    if (this.sustainActive) {
      this.notesPendingRelease.add(midi);
      return;
    }

    // Find all voices for this midi
    this.voices.forEach(v => {
      if (v.midi === midi && v.isPlaying && !v.isReleasing) {
        v.isReleasing = true;
        v.releaseVolume = 1.0;
        v.releaseCount = 0;
      }
    });
  }

  handleSustain(active: boolean) {
    this.sustainActive = active;
    if (!active) {
      // Release all pending notes
      this.notesPendingRelease.forEach(midi => {
        this.voices.forEach(v => {
          if (v.midi === midi && v.isPlaying && !v.isReleasing) {
            v.isReleasing = true;
            v.releaseVolume = 1.0;
            v.releaseCount = 0;
          }
        });
      });
      this.notesPendingRelease.clear();
    }
  }

  process(inputs: Float32Array[][], outputs: Float32Array[][], parameters: Record<string, Float32Array>): boolean {
    const output = outputs[0];
    const channelCount = output.length;
    
    // Clear output
    for (let c = 0; c < channelCount; c++) {
      output[c].fill(0);
    }

    const outputL = output[0];
    const outputR = output.length > 1 ? output[1] : null;

    // Mix voices
    // We iterate backwards to allow removal
    for (let i = this.voices.length - 1; i >= 0; i--) {
      const voice = this.voices[i];
      
      // Safety check
      if (!voice.isPlaying && !voice.isReleasing) {
        this.voices.splice(i, 1);
        continue;
      }

      const sample = voice.sample;
      const maxPos = sample.length - 1;
      
      // Process block
      for (let n = 0; n < outputL.length; n++) {
        if (!voice.isPlaying) break; // Should be removed later

        // Simple Linear Interpolation
        const pos = voice.position;
        const index = Math.floor(pos);
        const frac = pos - index;
        
        if (index >= maxPos) {
          voice.isPlaying = false;
          break;
        }

        const val1 = sample[index];
        const val2 = sample[index + 1];
        const rawSample = val1 + frac * (val2 - val1);

        // Envelopes
        // Attack (very quick)
        // Release
        let gain = voice.velocity;
        
        if (voice.isReleasing) {
            // Release envelope: Exponential decay
            // Typically release time ~0.5s. 
            // 44100 samples/sec. 0.5s = 22050 samples.
            // Decay factor per sample? 
            // Let's simply reduce gain linearly or exponentially based on releaseCount
            // Exponential: gain *= 0.999x
            // Exponential decay: reduce gain by a factor each sample
            // For ~0.5s release, we need gain to drop significantly.
            // 0.9994^22050 is about 0.000001
            voice.releaseVolume *= 0.9994;
            gain *= voice.releaseVolume;
            
            if (voice.releaseVolume < 0.001) {
                voice.isPlaying = false;
            }
            voice.releaseCount++;
        }

        // Add to output
        const finalVal = rawSample * gain * this.volume;
        outputL[n] += finalVal;
        if (outputR) outputR[n] += finalVal;

        // Advance position
        voice.position += voice.rate;
      }
      
      if (!voice.isPlaying) {
        this.voices.splice(i, 1);
      }
    }

    return true;
  }
}

registerProcessor('piano-processor', PianoProcessor);
