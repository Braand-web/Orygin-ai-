# Agent Note: Stable composer during session loading

Status: implemented

English | [中文](2026-08-26-stable-composer-during-session-loading.zh.md)

## Problem

When a session began replaying history, its final empty-state or active placement was not yet known. The conversation shell kept the composer mounted but applied `visibility: hidden` to the whole seat during that interval. On session switches, reconnects, and slower history requests, the chat input visibly appeared, disappeared, and then repainted.

## Decision

Keep the resident composer visible and docked during the settling phase. It uses the same textarea DOM node, is disabled with the existing localized loading-history copy, and suppresses its stats dock until replay determines the final phase. Active behavior resumes in place, while an empty session can still move the same node into the centered hero.

## Alternatives considered

- Keeping `visibility: hidden` was rejected because it directly caused the reported primary-input flash.
- Rendering a separate loading composer was rejected because swapping trees would lose DOM identity, focus, and draft stability.
- Enabling the composer during replay was rejected because a prompt could race session hydration and use incomplete state.

## Consequences

The chat input remains continuously painted across session loading, switching, and reconnecting. Users see a disabled loading state instead of an empty footer. The component keeps one composer and textarea tree, and no request can be submitted until replay settles.

## Testing

- Conversation skeleton tests assert that unresolved and summary-less loading sessions render a disabled textarea with localized loading copy.
- Existing startup auto-selection E2E continues to assert stable textarea identity for known blank sessions.
