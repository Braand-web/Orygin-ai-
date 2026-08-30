import type {
  ChatLocationNodeIndex, ChatNodeStore, ConversationTimelineSnapshot,
} from '@orygin-ai/dsh-client-runtime/client'
import type { ChatNode } from '../contract/chat-nodes.ts'

/** One loaded turn projected into the compact conversation navigation rail. */
export interface TurnNavigationItem {
  readonly turn: number
  readonly anchorKey: string
  readonly prompt: string
  readonly response: string
}

function compactText(parts: readonly string[]): string {
  return parts.join(' ').replace(/\s+/g, ' ').trim().slice(0, 280)
}

function promptText(node: ChatNode): string {
  if (node.kind !== 'user') return ''
  return compactText(node.data.content.flatMap(block => block.type === 'text' ? [block.text] : []))
}

function responseText(node: ChatNode): string {
  if (node.kind !== 'assistant-step') return ''
  return compactText(node.data.blocks.flatMap(block => block.kind === 'text' ? [block.text] : []))
}

/**
 * Project the currently loaded Chat window into stable navigation items.
 * Hidden nodes and turns without a visible anchor are intentionally omitted.
 */
export function deriveTurnNavigationItems(input: {
  readonly timeline: ConversationTimelineSnapshot
  readonly locations: ChatLocationNodeIndex
  readonly nodes: ChatNodeStore
}): readonly TurnNavigationItem[] {
  return input.timeline.turnOrder.flatMap((turn): TurnNavigationItem[] => {
    const nodes = input.locations.getTurn(turn)
      .map(key => input.nodes.get(key))
      .filter((node): node is ChatNode => node !== undefined && node.visibility === 'visible')
    const user = nodes.find(node => node.kind === 'user')
    const anchor = user ?? nodes[0]
    if (anchor === undefined) return []
    const response = nodes.findLast(node => responseText(node) !== '')
    return [{
      turn,
      anchorKey: anchor.key,
      prompt: user === undefined ? '' : promptText(user),
      response: response === undefined ? '' : responseText(response),
    }]
  })
}
