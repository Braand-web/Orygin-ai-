import { afterEach, describe, expect, it } from 'vitest'
import { Context } from '@orygin-ai/cordis'
import LlmRuntime, { createUserMessage, CallId, ReasoningEffortId  } from '@orygin-ai/dsh-llm'
import type { Message, ToolSchema } from '@orygin-ai/dsh-llm'
import * as LlmPiAi from '@orygin-ai/dsh-llm-pi-ai'
import type { PiAiProviderProfile } from '@orygin-ai/dsh-llm-pi-ai'
import * as LlmOrygin from '@orygin-ai/dsh-llm-orygin'
import { assemble, type AssembledResult } from './assemble.ts'

/**
 * Real-API e2e for the pi-ai-backed adapter: V4 Flash + V4 Pro with provider
 * defaults and representative off/high/max reasoning. Mirrors the native
 * adapter's StreamChunk contract and exercises a replayed tool follow-up.
 * Key-gated.
 */

const FLASH = 'orygin-v4-flash'
const PRO = 'orygin-v4-pro'
const contexts: Context[] = []

async function harness(_model: string, config: Partial<PiAiProviderProfile> = {}) {
  const ctx = new Context()
  contexts.push(ctx)
  await ctx.plugin(LlmRuntime)
  await ctx.plugin(LlmPiAi, {
    providers: {
      orygin: {
        ...process.env.ORYGIN_API_KEY === undefined ? {} : { apiKey: process.env.ORYGIN_API_KEY },
        ...process.env.ORYGIN_BASE_URL === undefined ? {} : { baseURL: process.env.ORYGIN_BASE_URL },
        ...config,
      },
    },
  })
  return ctx
}

afterEach(async () => {
  await Promise.all(contexts.splice(0).map(ctx => ctx.fiber.dispose()))
})

function ask(text: string): Message[] {
  return [createUserMessage({
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: 'test' },
  })]
}

function textOf(result: AssembledResult): string {
  return result.message.content
    .filter(block => block.type === 'text')
    .map(block => block.text)
    .join('')
}

function blockKinds(result: AssembledResult): string[] {
  return result.message.content.map(block => block.type)
}

const weatherTool: ToolSchema = {
  name: 'get_weather',
  description: 'Get the current weather for a city.',
  parameters: {
    type: 'object',
    properties: { city: { type: 'string', description: 'City name' } },
    required: ['city'],
  },
}

describe.skipIf(!process.env.ORYGIN_API_KEY)('llm-pi-ai e2e (real API)', () => {
  it.each([FLASH, PRO])('%s + provider-default reasoning: plain text generation', async (model) => {
    const ctx = await harness(model)
    const result = await assemble(ctx,{
      model,
      messages: ask('Reply with exactly the word: pong'),
      maxTokens: 50,
    })
    expect(result.finish.kind).toBe('stop')
    expect(textOf(result).toLowerCase()).toContain('pong')
  })

  it('flash + reasoning off: plain text without reasoning blocks', async () => {
    const ctx = await harness(FLASH)
    const result = await assemble(ctx,{
      model: FLASH,
      reasoningEffort: ReasoningEffortId('off'),
      messages: ask('Reply with exactly the word: pong'),
      maxTokens: 50,
    })
    expect(result.finish.kind).toBe('stop')
    expect(result.message.content.some(block => block.type === 'reasoning')).toBe(false)
    expect(textOf(result).toLowerCase()).toContain('pong')
  })

  it.each([FLASH, PRO])('%s + reasoning high: reasoning blocks present', async (model) => {
    const ctx = await harness(model)
    const result = await assemble(ctx,{
      model,
      reasoningEffort: ReasoningEffortId('high'),
      messages: ask('Which is larger, 9.11 or 9.8? Answer with just the number.'),
      maxTokens: 2000,
    })
    expect(result.finish.kind).toBe('stop')
    expect(result.message.content.some(block => block.type === 'reasoning')).toBe(true)
    expect(textOf(result)).toContain('9.8')
  })

  it('pro + reasoning max: tool-call round trip', async () => {
    const ctx = await harness(PRO)

    const first = await assemble(ctx,{
      model: PRO,
      reasoningEffort: ReasoningEffortId('max'),
      messages: ask('What is the weather in Paris right now? Use the get_weather tool.'),
      tools: [weatherTool],
      maxTokens: 2000,
    })
    expect(first.finish.kind).toBe('tool-calls')
    const call = first.message.content.find(block => block.type === 'tool-call')
    expect(call).toBeDefined()
    expect(call!.name).toBe('get_weather')
    expect(JSON.parse(call!.arguments)).toMatchObject({ city: expect.stringMatching(/paris/i) as string })

    const second = await assemble(ctx,{
      model: PRO,
      reasoningEffort: ReasoningEffortId('max'),
      messages: [
        ...ask('What is the weather in Paris right now? Use the get_weather tool.'),
        first.message,
        createUserMessage({
          content: [{
            type: 'tool-result',
            toolCallId: CallId(call!.id),
            content: [{ type: 'text', text: 'Sunny, 22°C' }],
          }],
          source: { kind: 'plugin', plugin: 'test' },
        }),
      ],
      tools: [weatherTool],
      maxTokens: 2000,
    })
    expect(second.finish.kind).toBe('stop')
    expect(textOf(second).toLowerCase()).toMatch(/sunny|22/)
  })

  it('produces the same block structure as llm-orygin for the same prompt', async () => {
    // Loose structural equivalence between the two independent adapters:
    // same block KINDS in the same order for a deterministic prompt — the
    // cross-implementation check that the StreamChunk design holds.
    const oryginCtx = new Context()
    contexts.push(oryginCtx)
    await oryginCtx.plugin(LlmRuntime)
    await oryginCtx.plugin(LlmOrygin, { thinking: 'disabled' })

    const piCtx = await harness(FLASH)

    const prompt = ask('Reply with exactly the word: pong')
    const [fromOrygin, fromPiAi] = await Promise.all([
      assemble(oryginCtx, { provider: 'orygin-official', model: FLASH, messages: prompt, maxTokens: 50 }),
      assemble(piCtx, { model: FLASH, messages: prompt, maxTokens: 50 }),
    ])
    expect(blockKinds(fromPiAi)).toEqual(blockKinds(fromOrygin))
    expect(fromPiAi.finish.kind).toBe(fromOrygin.finish.kind)
  })
})
