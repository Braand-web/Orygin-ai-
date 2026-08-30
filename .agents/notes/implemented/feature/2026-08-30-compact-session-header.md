# Agent Note: Compact session header

Status: implemented

English | [中文](2026-08-30-compact-session-header.zh.md)

## Problem

The active conversation header used a two-row layout for the session title, mode, view tabs, and utilities. It consumed a large portion of the conversation column before the user reached the transcript and composer.

## Decision

Keep the session title, lineage controls, view tabs, and utilities in one compact row. Preserve the existing tab semantics and session-scoped slot contributions, but move the tablist into the title row and reduce its spacing and vertical padding. Blank sessions continue to hide the header entirely.

## Consequences

Active conversations expose the same controls with less vertical chrome. The transcript and composer gain usable space without changing session state, tab selection, or utility slot ownership.

## Testing

The conversation skeleton test continues to verify the active header, tablist accessibility name, and Chat/Trajectory controls. The GUI and assembled web checks cover the updated client bundle.
