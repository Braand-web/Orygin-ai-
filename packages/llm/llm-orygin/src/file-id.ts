/** Orygin Files API identifiers. @module dsh-llm-orygin/file-id */

import type { Branded } from '@orygin-ai/dsh-brand'

/** Opaque identifier returned by the Orygin Files API. */
export type OryginFileId = Branded<'OryginFileId'>

/**
 * Brand a provider-returned file identifier after wire validation.
 * @param id - non-empty Files API identifier.
 * @returns the same string with its provider identity attached at type level.
 */
export function OryginFileId(id: string): OryginFileId {
  return id as OryginFileId
}

/** Non-secret digest identifying one endpoint and API-key file namespace. */
export type OryginFileScope = Branded<'OryginFileScope'>

/**
 * Brand a locally derived namespace digest.
 * @param scope - SHA-256 digest of endpoint and API key.
 * @returns the same string with namespace identity attached at type level.
 */
export function OryginFileScope(scope: string): OryginFileScope {
  return scope as OryginFileScope
}
