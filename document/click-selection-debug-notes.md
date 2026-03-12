# Click Selection Debug Notes

## Issue

In some piano scores, clicking a note on one staff selected a mismatched column on the other staff.

The mismatch remained even after switching same-column grouping from x-tolerance to `columnKey`.

## Root Cause

The original implementation used a custom x-based heuristic for both hit-testing and grouping.

The first fix corrected grouping by switching from x-tolerance to `columnKey`, but the click-resolution step was still incomplete:

- It still resolved the clicked column by a local x-distance heuristic
- It still used a project-defined `measure:index` style column identifier instead of OSMD's absolute timestamp
- It therefore remained separate from the time model used internally by OSMD for cursor and playback behavior

This caused failure modes in sparse or uneven notation:

- The click landed on a score object that already had a valid OSMD timestamp
- The app ignored that timestamp and re-guessed the column from x positions
- In passages with gaps, rests, or uneven staff layout, the guessed x-column could differ from the true OSMD time column
- As a result, an adjacent note group could still be selected

In short, the selection logic grouped notes structurally, but it did not yet resolve the click itself structurally.

## Countermeasure

When resolving a clickable column:

1. Identify the clicked measure first
2. Convert the click position into OSMD coordinates
3. Use `GraphicalMusicSheet.tryGetTimestampFromPosition()` first
4. Derive the selected `columnKey` from the returned absolute timestamp
5. Use `calculateXPositionFromTimestamp()` to keep the x-position tied to OSMD's own time axis
6. Fall back to nearest known timestamp-column only when no direct OSMD timestamp is available under the pointer
7. After choosing the column, collect notes structurally by `columnKey`
8. If the chosen column contains no notes, clear the selection

## Why This Works

- It uses the same time primitive that OSMD itself uses for cursor/playback-related behavior
- It keeps hit-testing aligned with what the user actually clicked
- It still allows cross-staff grouping through `columnKey`
- It avoids re-guessing a column from x when OSMD already knows the clicked timestamp

## Implementation Notes

- `src/components/ScoreDisplay.tsx`: use OSMD timestamp hit-testing first, then nearest timestamp-column fallback
- `src/utils/osmdCoordinates.ts`: derive `columnKey` from `GraphicalStaffEntry.getAbsoluteTimestamp()` and derive x from `calculateXPositionFromTimestamp()`
- `document/click-selection-spec.md`: keep the formal behavior spec in sync with the implementation
