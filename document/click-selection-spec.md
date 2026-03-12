# Click Selection Specification

## Overview

Clicking on the score does not directly select a single notehead. Instead, the implementation finds the note column closest to the click position and treats the notes in that column as the selected note group.

The resulting selection is used by these three features:

1. Score note highlighting
2. Piano key highlighting
3. Click-triggered playback

The core logic lives in `updateSelectionAtPoint()` in `src/components/ScoreDisplay.tsx`.

## Terms

- Click position: The screen coordinate `(x, y)` clicked by the user on the score
- Target measure: The measure determined to correspond to the click position
- Note column: A horizontal position representing notes placed at the same musical timing
- `columnDetails`: The list of clickable time columns extracted from `staffEntry` timestamps
- `columnKey`: A rendering-independent identifier for a note column. In the current implementation it is derived from the OSMD absolute timestamp
- `closestX`: The x-coordinate of the note column closest to the click position

## 1. Determining the Target Measure from the Click Position

The first step is to determine a single target measure from the clicked `(x, y)` position.

This is handled by `getMeasureAtPoint()` in `src/utils/osmdCoordinates.ts`.

1. Collect all measures whose horizontal range contains the clicked `x`
2. Among those candidates, choose the measure whose vertical position is closest to the clicked `y`
3. If the vertical distance from the staff center is too large, treat the click as invalid and clear the selection

This allows the implementation to choose the visually nearer staff even when the upper and lower staves share the same x-range.

## 2. Finding the Note Column Closest to the Click Position

Once the target measure is determined, the implementation searches across all staves that share the same `measureNumber` and `systemId`.

This is necessary so that notes aligned in time across the upper and lower piano staves can be treated as one selectable group.

The implementation keeps two parallel representations:

- `columnDetails` for click hit-testing across time columns
- `noteDetails` for collecting actual sounding notes after a column is selected

The implementation aligns click selection with OSMD's own time model:

- `tryGetTimestampFromPosition()` is used first to read the clicked timestamp directly from the score object under the pointer
- `calculateXPositionFromTimestamp()` is used to compute the display x-position for a timestamp
- `columnKey` is derived from that absolute timestamp

The search works as follows:

1. Merge `columnDetails` from the related staves by `columnKey`
2. Try to obtain the clicked absolute timestamp directly from OSMD using `tryGetTimestampFromPosition()`
3. If that succeeds, use the corresponding `columnKey` immediately without applying the x-distance threshold
4. If that fails, fall back to the nearest known column by comparing `abs(column.x - clickX)`
5. Use the minimum-distance column's `x` as `closestX`
6. Use that column's `columnKey` as the selected note-column identifier
7. Accept the result only if the minimum distance is below `NOTE_SELECTION_THRESHOLD`

The current threshold is:

- `NOTE_SELECTION_THRESHOLD = 20`

If the click position is 20px or more away from the nearest note column, the implementation treats the click as not being close enough to any note column.

## 3. Finding Notes in the Same Musical Column as the Selected Column

After the nearest note column is identified, the implementation scans the same related staves again and collects every note whose `columnKey` matches the selected one.

The check is based on structural equality:

This allows one selection result to include:

- Notes sounding at the same time across the upper and lower staves
- Notes belonging to a chord at the same position
- Notes that should be treated as the same column even if notehead placement differs visually between staves

The collected notes are stored in `targetMidiNotes` as a `Set<number>` and returned as part of `SelectionResult`.

If the nearest clickable column contains no notes after collection, the implementation clears the selection instead of keeping an empty selected column.

## 4. How the Selection Result Is Used

### 4.1 Score Note Highlighting

The selection is stored as `selection.columnKey`, `selection.noteX`, and `selection.midiNotes`.

On the score side, a note group is treated as selected when it belongs to the same `measureNumber` and `systemId` and contains at least one note whose `columnKey` matches `selection.columnKey`.

This produces the following visuals:

- A light green rectangle over the selected measure
- Green noteheads for the selected note column

### 4.2 Piano Key Highlighting

`selection.midiNotes` is passed to `PianoKeyboard` as `highlightNotes`.

As a result, the piano keys corresponding to the selected notes are shown in green.

The current color priority on the keyboard is:

1. Actually active notes: red
2. Click-selected notes: green
3. In-scale highlighting: blue-toned
4. Default key color

### 4.3 Click-Triggered Playback

On click, selection updates are emitted with `forcePlay = true`.

In `App.tsx`, `handleSelectionChange()` calls `playNotes()` when the selection is new or when `forcePlay` is enabled.

Because of that, clicking the same place again still replays the sound.

Playback uses all notes in `selection.midiNotes`.

The current click-play behavior is:

- All selected notes are played at the same time
- Each note is automatically turned off after about 500ms
- Notes triggered by click playback are not inserted into MIDI input `activeNotes`

Because of that last point, click playback keeps the UI in the green selected state rather than switching it to the red active-note state.

### 4.4 MIDI Match Indicator

Live MIDI input also drives a separate score-side indicator.

This indicator can be turned on and off from the settings UI and is off by default.

`ScoreDisplay.tsx` groups visible notes by `(systemId, measureNumber, columnKey)` and builds a MIDI-note set for each score column.

If a column's note set exactly matches the current `activeNotes` set, the score overlays a vertical red line at that notehead column.

The indicator uses the same red stroke style as the existing active-note horizontal guide line.

The line spans the full vertical extent of the related measure group in the same system, so on a piano grand staff it runs continuously from the upper measure through the lower measure.

The implementation uses actual rendered notehead positions when available and falls back to score-coordinate estimates only when the SVG notehead element cannot be read.

## 5. Additional Notes

- During drag selection updates, `forcePlay = false`, so moving within the same column does not retrigger playback repeatedly
- If the click is judged to be outside any measure, the selection is cleared
- Even inside a measure, the selection is cleared if the nearest note column is beyond the distance threshold
- Even inside the threshold, the selection is cleared if the chosen time column contains no notes
- `selection.noteX` is kept only as the representative x-position of the selected column; same-column grouping does not depend on x-tolerance
- The MIDI match indicator is independent of click selection and can appear at multiple score positions if the same note set exists more than once on screen

## Reference Implementation

- `src/components/ScoreDisplay.tsx`
- `src/utils/osmdCoordinates.ts`
- `src/App.tsx`
- `src/components/PianoKeyboard.tsx`
- `src/hooks/usePianoSound.ts`
