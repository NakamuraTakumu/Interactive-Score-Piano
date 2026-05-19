# Autoplay Feasibility Notes

## Conclusion

Adding score-driven autoplay to this workspace is a medium-high to high complexity change.

The main difficulty is not audio output itself. The harder part is building a stable playback timeline that stays consistent across:

- MusicXML timing
- score coordinates and column selection
- audio scheduling
- UI playback state and note highlighting

The current app already has good score hit-testing and live MIDI handling, but it does not yet have a transport layer.

## Why It Is Hard In This Workspace

### 1. The current score model is spatial, not playback-oriented

`extractMeasureContexts()` currently extracts:

- measure bounds
- clef and key state
- octave-shift state
- clickable column keys
- note MIDI numbers per rendered column

This is enough for click selection and visual overlays, but not enough for autoplay. There is no extracted model for:

- note durations
- rest durations
- voice ordering inside a measure
- resolved tempo changes
- repeat and jump expansion
- pedal or articulation playback state

Relevant code:

- `src/utils/osmdCoordinates.ts`
- `src/components/ScoreDisplay.tsx`

### 2. Playback is currently "instant trigger", not scheduled transport

`usePianoSound()` supports two real-time paths:

- live MIDI events forwarded directly to the synth
- click playback using `playNotes()`

The click path uses fixed-length note-offs via `setTimeout(..., 500)`. That is suitable for previewing a selected chord, but not for score playback with pause, seek, tempo changes, or reliable note lengths.

Relevant code:

- `src/hooks/usePianoSound.ts`
- `src/App.tsx`

### 3. UI state assumes human input, not autonomous playback

`activeNotes` currently means "notes pressed by incoming MIDI". `selected` means "clicked score column". Those two states drive:

- red score/key highlighting for active input
- green score/key highlighting for clicked selection
- MIDI-match guide lines

Autoplay introduces a third meaning: "notes currently sounding because the transport is running". Reusing `activeNotes` blindly would blur live input and playback state, while keeping it separate requires reworking highlight priority and guide-line rules.

Relevant code:

- `src/hooks/useMidi.ts`
- `src/components/ScoreDisplay.tsx`
- `src/components/PianoKeyboard.tsx`

### 4. Transpose is split across visual and audio layers

The app already separates:

- `transpose`: audio transpose
- `visualTranspose`: score transpose

Click selection compensates for `visualTranspose` before calling playback, and audio playback then applies `transpose` again. For autoplay this needs a single clear source of truth per stage:

- source score pitch
- visually displayed pitch
- sounding pitch

Without that separation, autoplay can easily drift into off-by-semitone bugs between score color, keyboard highlight, and actual audio.

Relevant code:

- `src/hooks/usePianoSettings.ts`
- `src/components/ScoreDisplay.tsx`
- `src/hooks/usePianoSound.ts`
- `src/components/ControlPanel.tsx`

### 5. Browser audio policy prevents truly automatic start

The current code already works around browser autoplay restrictions by starting or resuming the `AudioContext` from user interaction or MIDI activity. A new autoplay feature still needs an explicit user gesture such as a Play button; opening a score alone is not enough.

Relevant code:

- `src/App.tsx`
- `src/hooks/usePianoSound.ts`

### 6. MusicXML playback semantics are broader than the current implementation

Even a "simple" autoplay feature eventually runs into playback semantics such as:

- tempo changes
- repeats and `time-only`
- `dacapo`, `dalsegno`, `tocoda`, `fine`
- pedal and playback-only directives
- instrument and MIDI changes
- swing and other playback interpretation data

If the first implementation ignores these, some files will render correctly but play incorrectly.

## Practical Risk Areas

### If you build the scheduler yourself

Pros:

- full control over score synchronization
- easier to keep `columnKey` aligned with the score UI

Cons:

- you must derive a complete event timeline from MusicXML or OSMD internals
- repeats and tempo mapping become your responsibility
- main-thread timing jitter becomes a real concern

### If you use `js-synthesizer` player or sequencer

Pros:

- better support for timed event playback than repeated `setTimeout`
- clearer transport primitives such as start, stop, tempo, and queued events

Cons:

- you still need a score-to-event conversion layer
- if you go through SMF/MIDI data, you must keep score columns synchronized with the generated event stream
- visual transpose and score cursor alignment still remain app-level problems

## Lowest-Risk Implementation Path

1. Add a dedicated playback model rather than reusing click selection.
2. Build a timeline object with:
   - event type (`note-on`, `note-off`, pedal, tempo)
   - absolute tick
   - resolved score `columnKey`
   - source MIDI pitch
   - sounding MIDI pitch
3. Add a transport state separate from live MIDI:
   - stopped
   - playing
   - paused
   - current tick or current column
4. Drive the score highlight from playback state, not from click selection.
5. Start with a narrow support policy:
   - no repeats or jumps in v1, or
   - support only files whose repeats are already expanded
6. Add explicit Play/Pause/Stop controls instead of trying to start from score load.

## Recommended Scope Split

### Phase 1

- single tempo only
- no repeats or jump marks
- no pedal interpretation
- note on/off scheduling only
- playback cursor/highlight for one resolved score column at a time

### Phase 2

- tempo map
- pause/seek
- repeat handling
- playback-state overlays separated from live MIDI overlays

### Phase 3

- playback directives from MusicXML (`sound`, `play`, swing, MIDI changes)
- better transport UX and scrolling

## Sources

- OSMD README: renderer focus, playback still called work in progress / early access
  - https://github.com/opensheetmusicdisplay/opensheetmusicdisplay
- js-synthesizer README: SMF player and sequencer APIs exist, but require explicit event/player integration
  - https://github.com/jet2jet/js-synthesizer
- MDN Web Audio best practices: audio contexts must be created or resumed from a user gesture under autoplay policy
  - https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API/Best_practices
- MusicXML 4.0 `<sound>` reference: playback semantics include tempo, repeats, jumps, and playback directives
  - https://www.w3.org/2021/06/musicxml40/musicxml-reference/elements/sound/
