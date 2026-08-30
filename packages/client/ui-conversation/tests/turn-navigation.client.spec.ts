import type {
  ChatConversationViewNode, ChatLocationNodeIndex, ChatNodeStore,
} from '@orygin-ai/dsh-client-runtime/client'
import { describe, expect, it } from 'vitest'
import { deriveTurnNavigationItems } from '../src/client/chat/turn-navigation.ts'

function node(
  key: string,
  kind: string,
  turn: number,
  data: unknown,
  visibility: 'visible' | 'hidden' = 'visible',
): ChatConversationViewNode {
  return {
    key, kind, id: key, target: 'chat', anchorSeq: Number(key.replace(/\D/g, '')),
    location: { kind: 'turn', turn: { turn, start: undefined, end: undefined, status: 'closed', steps: [], data: { get: () => undefined } } },
    visibility, data,
  }
}

describe('turn navigation projection', () => {
  it('keeps visible turns, uses the user as anchor, and bounds previews', () => {
    const user = node('user-1', 'user', 1, { content: [{ type: 'text', text: '  Build   a dashboard  ' }] })
    const answer = node('assistant-1', 'assistant-step', 1, { blocks: [{ kind: 'text', text: 'The dashboard is ready.' }] })
    const hidden = node('user-2', 'user', 2, { content: [{ type: 'text', text: 'hidden' }] }, 'hidden')
    const nodes = new Map([['user-1', user], ['assistant-1', answer], ['user-2', hidden]])
    const nodeStore: ChatNodeStore = { get: key => nodes.get(key), values: () => [...nodes.values()] }
    const locations: ChatLocationNodeIndex = {
      getTurn: turn => turn === 1 ? ['user-1', 'assistant-1'] : ['user-2'],
      getStep: () => [],
    }
    expect(deriveTurnNavigationItems({
      timeline: { turnOrder: [1, 2], turns: new Map() }, locations, nodes: nodeStore,
    })).toEqual([{ turn: 1, anchorKey: 'user-1', prompt: 'Build a dashboard', response: 'The dashboard is ready.' }])
  })
})
