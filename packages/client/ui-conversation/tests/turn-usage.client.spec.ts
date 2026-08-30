import type { SessionEvent } from '@orygin-ai/dsh-session/types'
import { describe, expect, it } from 'vitest'
import { deriveTurnTokenUsage } from '../src/client/conversation-nodes/turn-usage.ts'

function event(type: string, seq: number, data: unknown): SessionEvent {
  return { type, seq, time: seq, data } as SessionEvent
}

function assistantMessage(seq: number, usage?: unknown): SessionEvent {
  return event('assistant/message', seq, {
    turn: 1,
    step: 1,
    message: {
      id: `message-${seq}`,
      role: 'assistant',
      content: [{ type: 'text', text: 'answer' }],
      source: { kind: 'model', provider: 'openrouter', model: 'orygin-test' },
    },
    ...(usage === undefined ? {} : { usage }),
  })
}

describe('turn usage disclosure fold', () => {
  it('aggregates exact provider buckets without counting the usage chunk twice', () => {
    const usage = deriveTurnTokenUsage([
      event('turn/start', 0, { turn: 1 }),
      event('step/start', 1, { turn: 1, step: 1 }),
      event('assistant/chunk', 2, { turn: 1, step: 1, chunk: { type: 'usage', usage: { inputTokens: 10, outputTokens: 4, cacheReadTokens: 6, cacheWriteTokens: 2, reasoningTokens: 1 } } }),
      assistantMessage(3),
      event('step/end', 4, { turn: 1, step: 1 }),
      event('turn/end', 5, { turn: 1, reason: { kind: 'stop' } }),
    ])
    expect(usage).toEqual({
      uncachedInputTokens: 10,
      outputTokens: 4,
      totalTokens: 22,
      cacheReadTokens: 6,
      cacheWriteTokens: 2,
      reasoningTokens: 1,
      routes: [{ provider: 'openrouter', model: 'orygin-test' }],
    })
  })

  it('withholds disclosure when a turn has no completed provider usage', () => {
    const usage = deriveTurnTokenUsage([
      event('turn/start', 0, { turn: 1 }),
      event('turn/end', 1, { turn: 1, reason: { kind: 'stop' } }),
    ])
    expect(usage).toBeUndefined()
  })
})
