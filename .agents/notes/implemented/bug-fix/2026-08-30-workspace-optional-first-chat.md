# Agent Note: Workspace-optional first chat

Status: implemented

English | [中文](2026-08-30-workspace-optional-first-chat.zh.md)

## Problem

The web composer treated Workspace selection as a prerequisite for every conversation. With no current Session, and even with a blank Session no longer owned by a Workspace, the resident textarea became a read-only Workspace-picker trigger. A new account therefore had to understand and create filesystem state before it could send a simple question to the model.

The runtime reinforced the same coupling: initial selection stayed idle when the Workspace registry was empty, and the global New Session action cleared the current selection instead of creating a conversation.

## Decision

The no-session composer is now a start-conversation control rather than a Workspace control. Its first pointer or keyboard action asks the runtime to materialize a chat-only Session against the deployment default. Delaying creation until a user gesture preserves the hosted rule that authentication appears only at a protected action, never merely because the application loaded.

The runtime first reuses an unarchived blank Session that is not accounted under any Workspace, and single-flights a new `session.create({})` request when no reusable Session exists. The global New Session action uses the same path, while passive initial selection remains idle when no Workspace exists.

An ungrouped blank Session keeps the hero composer fully interactive. The Workspace chip remains visible as an optional transition into repository and filesystem work, but it no longer locks chat or outranks a genuine model block.

## Alternatives considered

**Create a default Workspace automatically.** Rejected because it preserves the product-level fiction that every conversation owns a repository or filesystem project and creates registry state the user did not request.

**Allow typing before a Session exists and migrate the draft afterward.** Rejected because the input machine is deliberately Session-scoped. Using the no-session composer as a one-gesture start control preserves the existing ownership and submission contracts.

**Keep New Session as an empty Workspace picker.** Rejected because the primary chat action would still lead to setup instead of a conversation.

## Testing

Runtime tests cover passive cold-start behavior, reuse of an unaccounted blank Session, single-flight creation from repeated New Session gestures, and the existing explicit/current/recent Workspace precedence. Conversation tests cover the no-session start control and prove that an ungrouped blank Session accepts and submits text, keeps the optional Workspace chip, and still exposes an actionable model-selection block.

## Consequences

Users can start chatting immediately without understanding Workspaces. A Workspace remains necessary only when a task needs repository or filesystem context. Chat-only Sessions appear in the existing ungrouped conversation surface until the future cloud workspace layer gives them a richer product label.
