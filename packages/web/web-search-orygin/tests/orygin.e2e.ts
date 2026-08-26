import { describe, expect, it } from 'vitest'
import {
  OryginSearchProvider,
  ORYGIN_DEFAULT_API_VERSION,
  ORYGIN_DEFAULT_BASE_URL,
  ORYGIN_DEFAULT_MAX_TOKENS,
  ORYGIN_DEFAULT_MAX_USES,
  ORYGIN_DEFAULT_MODEL,
} from '@orygin-ai/dsh-web-search-orygin'

/** Construct the provider over a fixed options value; production passes a live thunk. */
import type { OryginSearchProviderOptions } from '@orygin-ai/dsh-web-search-orygin'

const searchProvider = (options: OryginSearchProviderOptions): OryginSearchProvider =>
  new OryginSearchProvider(() => options)

/**
 * Disabled real-API probe for the Orygin search provider. The live endpoint
 * can complete without structured source blocks, so this is not a reliable
 * merge signal. Its body remains because mocks cannot confirm the wire shape.
 */
const apiKey = process.env.ORYGIN_API_KEY
const maybe = apiKey !== undefined && apiKey.length > 0 ? describe : describe.skip

maybe('OryginSearchProvider real API', () => {
  it.skip('returns citeable sources for a live query via native web_search', async () => {
    const provider = searchProvider({
      apiKey: apiKey!,
      baseURL: process.env.ORYGIN_SEARCH_BASE_URL ?? ORYGIN_DEFAULT_BASE_URL,
      model: process.env.ORYGIN_SEARCH_MODEL ?? ORYGIN_DEFAULT_MODEL,
      apiVersion: ORYGIN_DEFAULT_API_VERSION,
      maxTokens: ORYGIN_DEFAULT_MAX_TOKENS,
      maxUses: ORYGIN_DEFAULT_MAX_USES,
    })
    const result = await provider.search({ query: 'What is Orygin?', maxResults: 5 })
    expect(result.sources.length).toBeGreaterThan(0)
    for (const source of result.sources) expect(source.url).toMatch(/^https?:\/\//)
  }, 60_000)
})
