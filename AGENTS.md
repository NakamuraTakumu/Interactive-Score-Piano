# AGENTS.md

## Scope
- This file contains workspace-specific rules for `gemini_piano`.

## Knowledge Capture
- When a bug fix or failed fix reveals a reusable cause, failure mode, or mitigation pattern for this workspace, record the cause and countermeasure in `document/` in addition to updating any implementation-specific specification.

## Visual Consistency
- When adding new score overlay indicators, match the visual style of existing score guide lines unless the user requests a different appearance.
- When a score indicator refers to a note column shared across staves, span the full related measure group vertically instead of only the local notehead bounds.

## Feature Defaults
- New optional score overlay indicators should default to off unless the user requests a different default.
