/** Browser API carrier: HTTP upstream plus one WebSocket per downstream event stream. */

import type { ApiProxy, HostFrame, MuxFrame, RpcRequest, ServerRequest } from './api.ts'
import { AbstractApiClient } from './api.ts'
import { hostFrameSchema, muxFrameSchema } from '@orygin-ai/dsh-host-apiproxy/api/events.schema'
import { serverRequestSchema } from '@orygin-ai/dsh-host-apiproxy/api/rpc.schema'
import { HOST_EVENTS_PATH, MUX_EVENTS_PATH } from '../api-path.ts'
import { getAccessToken, isAuthEnabled, notifyAuthRequired, withAuth, withAuthQuery } from './auth.ts'

/** Unary calls that represent a user action rather than an initial read. */
const AUTH_ACTION_PATHS = new Set([
  '/api/session.create', '/api/session.prompt', '/api/session.rename', '/api/session.fork',
  '/api/session.selectModel', '/api/session.attachment', '/api/session.updateQueue', '/api/session.cancel',
  '/api/subagent.prompt', '/api/subagent.interrupt', '/api/respond',
  '/api/workspace.create', '/api/workspace.rename', '/api/workspace.delete',
  '/api/workspace.insertBefore', '/api/workspace.insertSessionBefore', '/api/workspace.archiveSession',
  '/api/goal.create', '/api/goal.edit', '/api/goal.pause', '/api/goal.resume',
  '/api/goal.complete', '/api/goal.clear',
  '/api/settings.update', '/api/settings.replace', '/api/settings.mutate',
  '/api/settings.openDocument', '/api/credentials.set', '/api/credentials.unset', '/api/host.pickDirectory',
  '/api/host.listDirectory', '/api/host.createDirectory', '/api/host.openPath',
  '/api/agentPreset.select', '/api/agentPreset.read', '/api/agentPreset.copy',
  '/api/agentPreset.openDocument', '/api/agentPreset.remove', '/api/llm.discoverModels',
])

/**
 * Sanitized boot reads for the signed-out product shell. These values are
 * produced in the browser: a guest never reaches the authenticated Host and
 * cannot observe its filesystem, sessions, settings, credentials, or models.
 */
const GUEST_RPC_VALUES = new Map<string, unknown>([
  ['/api/host.describe', {
    version: 'Orygin', cwd: '', attachedSessions: 0, home: '', canOpenPath: false,
  }],
  ['/api/dynamicCordisRunner/syncInspectManifest', null],
  ['/api/dynamicCordisRunner/inventory', []],
  ['/api/session.list', { items: [] }],
  ['/api/workspace.list', { items: [], archivedSessionIds: [] }],
  ['/api/agentPreset.list', { presets: [], authorable: false, hasDocument: false }],
  ['/api/skill.list', { skills: [] }],
  ['/api/settings.describe', { writable: false, hasDocument: false, namespaces: [] }],
  ['/api/credentials.describe', { credentials: {} }],
  ['/api/llm.providers', { providers: [] }],
  ['/api/llm.models', { groups: [], failures: [] }],
])

type SocketItem<F> = { kind: 'frame'; envelope: RpcRequest<F> } | { kind: 'end' }
type Parser<F> = { parse(value: unknown): F }

/** Browser platform subclass: unary/respond use fetch; mux/host use downlink-only WebSockets. */
export class WebApiClient extends AbstractApiClient {
  protected doFetch(input: URL, init?: RequestInit): Promise<Response> {
    if (isAuthEnabled() && getAccessToken() === undefined) {
      if (AUTH_ACTION_PATHS.has(input.pathname)) {
        notifyAuthRequired()
        return Promise.resolve(new Response('authentication required', { status: 401 }))
      }
      if (GUEST_RPC_VALUES.has(input.pathname)) {
        const response = this.guestRpcResponse(init, GUEST_RPC_VALUES.get(input.pathname))
        if (response !== undefined) return Promise.resolve(response)
      }
    }
    return globalThis.fetch(input, withAuth(init)).then((response) => {
      if (response.status === 401 && AUTH_ACTION_PATHS.has(input.pathname)) notifyAuthRequired()
      return response
    })
  }

  protected override openMux(
    _payload: Parameters<ApiProxy['events']['mux']>[0]['payload'],
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<MuxFrame>> {
    if (isAuthEnabled() && getAccessToken() === undefined) return this.readGuestStream<MuxFrame>(signal, onOpen)
    return this.readWebSocket(MUX_EVENTS_PATH, signal, muxFrameSchema, onOpen)
  }

  protected override openHost(
    _payload: Parameters<ApiProxy['events']['host']>[0]['payload'],
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncIterable<RpcRequest<HostFrame>> {
    if (isAuthEnabled() && getAccessToken() === undefined) return this.readGuestStream<HostFrame>(signal, onOpen)
    return this.readWebSocket(HOST_EVENTS_PATH, signal, hostFrameSchema, onOpen)
  }

  private guestRpcResponse(init: RequestInit | undefined, value: unknown): Response | undefined {
    if (typeof init?.body !== 'string') return undefined
    try {
      const request = JSON.parse(init.body) as { rpcId?: unknown }
      if (typeof request.rpcId !== 'string') return undefined
      return Response.json({
        type: 'server-response',
        rpcId: request.rpcId,
        result: { ok: true, value },
      })
    } catch {
      return undefined
    }
  }

  private async *readGuestStream<F>(
    signal: AbortSignal,
    onOpen?: () => void,
  ): AsyncGenerator<RpcRequest<F>> {
    onOpen?.()
    if (signal.aborted) return
    await new Promise<void>((resolve) => {
      signal.addEventListener('abort', () => { resolve() }, { once: true })
    })
  }

  private async *readWebSocket<F extends MuxFrame | HostFrame>(
    path: string,
    signal: AbortSignal,
    frameSchema: Parser<F>,
    onOpen?: () => void,
  ): AsyncGenerator<RpcRequest<F>> {
    const url = withAuthQuery(new URL(path, this.resolveBase()))
    url.protocol = url.protocol === 'https:' ? 'wss:' : 'ws:'
    const socket = new WebSocket(url)
    const inbox: SocketItem<F>[] = []
    let wake: (() => void) | undefined
    const enqueue = (item: SocketItem<F>): void => {
      inbox.push(item)
      wake?.()
      wake = undefined
    }
    const handleOpen = (): void => { onOpen?.() }
    const handleMessage = (event: MessageEvent): void => {
      let full: ServerRequest
      let frame: F
      try {
        if (typeof event.data !== 'string') throw new Error('binary WebSocket frame')
        full = serverRequestSchema.parse(JSON.parse(event.data))
        frame = frameSchema.parse(full.payload)
      } catch (error) {
        console.error(`[client-connection] dropping malformed WebSocket frame on ${path}:`, error)
        return
      }
      this.onEnvelope(full)
      enqueue({ kind: 'frame', envelope: { rpcId: full.rpcId, payload: frame } })
    }
    const handleClose = (): void => { enqueue({ kind: 'end' }) }
    const handleAbort = (): void => {
      if (socket.readyState === WebSocket.CONNECTING || socket.readyState === WebSocket.OPEN) socket.close()
    }
    socket.addEventListener('open', handleOpen)
    socket.addEventListener('message', handleMessage)
    socket.addEventListener('close', handleClose, { once: true })
    signal.addEventListener('abort', handleAbort, { once: true })
    if (signal.aborted) handleAbort()
    try {
      while (true) {
        while (inbox.length > 0) {
          const item = inbox.shift() as SocketItem<F>
          if (item.kind === 'end') return
          yield item.envelope
        }
        await new Promise<void>((resolve) => { wake = resolve })
      }
    } finally {
      signal.removeEventListener('abort', handleAbort)
      socket.removeEventListener('open', handleOpen)
      socket.removeEventListener('message', handleMessage)
      socket.removeEventListener('close', handleClose)
      handleAbort()
    }
  }
}
