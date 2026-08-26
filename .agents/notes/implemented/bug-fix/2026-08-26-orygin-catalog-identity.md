# Agent Note: Orygin catalog identity boundary

Status: implemented

English | [中文](2026-08-26-orygin-catalog-identity.zh.md)

## Problem

The product configured and selected an `orygin` route, but the generic pi-ai adapter indexed the compatible source catalog without translating it. The provider directory therefore omitted Orygin, model discovery returned source model identifiers, and any direct catalog fallback retained the source display name, endpoint, and credential environment variable. This broke the Models settings flow and could route a default request away from the Orygin API.

## Decision

Translate the compatible source provider exactly once while building the installed catalog index. The public provider is `orygin`, is displayed as Orygin, resolves stored keys or `ORYGIN_API_KEY`, defaults to `https://api.orygin.fun`, and exposes `orygin-v4-*` models with Orygin names. The provider's compatible stream implementations and protocol metadata remain intact so the translated models continue to use the supported wire format.

## Alternatives considered

- Renaming only the settings and web UI was rejected because backend discovery, login, and default dispatch would still expose or contact the source provider.
- Duplicating the source catalog in repository data was rejected because it would drift from the installed pi-ai capacities and protocol metadata.
- Rebuilding the provider from protocol factories was rejected because installed providers own implementation details that the generic adapter should preserve.

## Consequences

Orygin is now a first-class installed catalog route throughout discovery, model selection, login, credential resolution, and dispatch. The source route is absent from the public provider list. Upstream catalog upgrades continue to supply capacities and compatibility metadata, while the translation tests deliberately assert the product-owned identity at the boundary.

## Testing

- Focused catalog, discovery, login, and adapter suite: 145 tests pass.
- Web Models settings E2E expects and selects `orygin`.
- Production probes verify the authenticated API trust boundary separately.
