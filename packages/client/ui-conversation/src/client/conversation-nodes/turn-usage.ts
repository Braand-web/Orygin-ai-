import type { AssistantMessage, TokenUsage } from '@orygin-ai/dsh-llm/types'
import type { SessionEvent } from '@orygin-ai/dsh-session/types'
import type {} from '@orygin-ai/dsh-llm-retry/types'
import type { TurnTokenUsage, TurnTokenUsageRoute } from '../contract/chat-nodes.ts'

interface Attempt {
  inputTokens: number
  outputTokens: number
  totalTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  reasoningTokens?: number
  route?: TurnTokenUsageRoute
}
type State =
  | { kind: 'idle' }
  | { kind: 'open'; turn: number; step: number; usage?: TokenUsage }
  | { kind: 'settled'; turn: number; step: number; by: 'message' | 'retry' }
const count = (value: unknown): value is number =>
  typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
function sum(values: readonly number[]): number | undefined {
  let total = 0
  for (const value of values) {
    total += value
    if (!Number.isSafeInteger(total)) return undefined
  }
  return total
}

function normalize(usage: TokenUsage, route?: TurnTokenUsageRoute): Attempt | undefined {
  if (!count(usage.inputTokens) || !count(usage.outputTokens)) return undefined
  if (usage.cacheReadTokens !== undefined && !count(usage.cacheReadTokens)) return undefined
  if (usage.cacheWriteTokens !== undefined && !count(usage.cacheWriteTokens)) return undefined
  if (usage.reasoningTokens !== undefined && (!count(usage.reasoningTokens) || usage.reasoningTokens > usage.outputTokens)) return undefined
  const prompt = sum([
    usage.inputTokens,
    ...(usage.cacheReadTokens === undefined ? [] : [usage.cacheReadTokens]),
    ...(usage.cacheWriteTokens === undefined ? [] : [usage.cacheWriteTokens]),
  ])
  const total = prompt === undefined ? undefined : sum([prompt, usage.outputTokens])
  if (total === undefined) return undefined
  return {
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    totalTokens: total,
    ...(usage.cacheReadTokens === undefined ? {} : { cacheReadTokens: usage.cacheReadTokens }),
    ...(usage.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: usage.cacheWriteTokens }),
    ...(usage.reasoningTokens === undefined ? {} : { reasoningTokens: usage.reasoningTokens }),
    ...(route === undefined ? {} : { route }),
  }
}

function routeOf(message: AssistantMessage): TurnTokenUsageRoute | undefined {
  return message.source.provider !== '' && message.source.model !== ''
    ? { provider: message.source.provider, model: message.source.model }
    : undefined
}

function aggregate(attempts: readonly Attempt[]): TurnTokenUsage | undefined {
  if (attempts.length === 0) return undefined
  const input = sum(attempts.map(item => item.inputTokens))
  const output = sum(attempts.map(item => item.outputTokens))
  const total = sum(attempts.map(item => item.totalTokens))
  if (input === undefined || output === undefined || total === undefined) return undefined
  const readValues = attempts.map(item => item.cacheReadTokens).filter(count)
  const writeValues = attempts.map(item => item.cacheWriteTokens).filter(count)
  const reasoningValues = attempts.map(item => item.reasoningTokens).filter(count)
  const read = readValues.length === attempts.length ? sum(readValues) : undefined
  const write = writeValues.length === attempts.length ? sum(writeValues) : undefined
  const reasoning = reasoningValues.length === attempts.length ? sum(reasoningValues) : undefined
  const routes = attempts.map(item => item.route)
  let uniqueRoutes: readonly TurnTokenUsageRoute[] | undefined
  if (routes.every((item): item is TurnTokenUsageRoute => item !== undefined)) {
    const seen = new Map<string, TurnTokenUsageRoute>()
    for (const item of routes) seen.set(`${item.provider}\0${item.model}`, item)
    uniqueRoutes = [...seen.values()]
  }
  return {
    uncachedInputTokens: input,
    outputTokens: output,
    totalTokens: total,
    ...(read === undefined ? {} : { cacheReadTokens: read }),
    ...(write === undefined ? {} : { cacheWriteTokens: write }),
    ...(reasoning === undefined ? {} : { reasoningTokens: reasoning }),
    ...(uniqueRoutes === undefined ? {} : { routes: uniqueRoutes }),
  }
}

/** Derive a disclosure only from a complete, ordered turn lifecycle. */
export function deriveTurnTokenUsage(events: readonly SessionEvent[]): TurnTokenUsage | undefined {
  let state: State = { kind: 'idle' }
  const attempts: Attempt[] = []
  let turn: number | undefined
  let ended = false
  let invalid = false
  const same = (
    candidate: Exclude<State, { kind: 'idle' }>, eventTurn: number, eventStep: number,
  ): boolean => candidate.turn === eventTurn && candidate.step === eventStep
  const close = (route?: TurnTokenUsageRoute): boolean => {
    if (state.kind !== 'open' || state.usage === undefined) return false
    const item = normalize(state.usage, route)
    if (item === undefined) return false
    attempts.push(item)
    return true
  }
  for (const event of events) {
    if (invalid) break
    if (event.type === 'turn/start') {
      if (turn !== undefined || state.kind !== 'idle') invalid = true
      else turn = event.data.turn
      continue
    }
    if (turn === undefined) { invalid = true; continue }
    if (event.type === 'turn/end') {
      if (event.data.turn !== turn || state.kind !== 'idle' || ended) invalid = true
      else ended = true
      continue
    }
    if (ended) { invalid = true; continue }
    if (event.type === 'step/start') {
      if (state.kind !== 'idle' || event.data.turn !== turn) invalid = true
      else state = { kind: 'open', turn, step: event.data.step }
      continue
    }
    if (event.type === 'llm/retry-started') {
      if (state.kind !== 'settled' || state.by !== 'retry' || !same(state, event.data.turn, event.data.step)) invalid = true
      else state = { kind: 'open', turn, step: event.data.step }
      continue
    }
    if (event.type === 'assistant/chunk') {
      if (state.kind !== 'open' || !same(state, event.data.turn, event.data.step)) {
        invalid = true
        continue
      }
      if (event.data.chunk.type === 'usage') state = { ...state, usage: event.data.chunk.usage }
      else if (event.data.chunk.type === 'finish'
        && (event.data.chunk.reason.kind === 'error' || event.data.chunk.reason.kind === 'aborted')) {
        if (!close()) invalid = true
        else state = { kind: 'settled', turn, step: event.data.step, by: 'retry' }
      }
      continue
    }
    if (event.type === 'assistant/message') {
      if (state.kind !== 'open' || !same(state, event.data.turn, event.data.step)) {
        invalid = true
        continue
      }
      if (event.data.usage !== undefined) state = { ...state, usage: event.data.usage }
      if (!close(routeOf(event.data.message))) invalid = true
      else state = { kind: 'settled', turn, step: event.data.step, by: 'message' }
      continue
    }
    if (event.type === 'llm/retry') {
      if (state.kind === 'open' && same(state, event.data.turn, event.data.step)) {
        if (!close()) invalid = true
      } else if (state.kind !== 'settled' || !same(state, event.data.turn, event.data.step)) invalid = true
      if (!invalid) state = { kind: 'settled', turn, step: event.data.step, by: 'retry' }
      continue
    }
    if (event.type === 'step/end') {
      if (state.kind === 'idle' || !same(state, event.data.turn, event.data.step)) invalid = true
      else state = { kind: 'idle' }
    }
  }
  return invalid || !ended || state.kind !== 'idle' ? undefined : aggregate(attempts)
}
