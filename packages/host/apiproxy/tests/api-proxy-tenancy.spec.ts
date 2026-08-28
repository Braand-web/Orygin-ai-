import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@orygin-ai/cordis'
import AgentRegistry, { Inbox, type Agent } from '@orygin-ai/dsh-agent'
import { createUserMessage } from '@orygin-ai/dsh-llm'
import SessionStore, { SessionId, type Session } from '@orygin-ai/dsh-session'
import UserQuestionService from '@orygin-ai/dsh-user-questions'
import { createApiProxy } from '@orygin-ai/dsh-host-apiproxy'
import { RpcId, type RpcRequest } from '@orygin-ai/dsh-host-apiproxy/api'
import { withAuthPrincipal, type AuthPrincipal } from '@orygin-ai/dsh-request-context'

const TENANT_A = '11111111-1111-4111-8111-111111111111'
const USER_A = '22222222-2222-4222-8222-222222222222'
const TENANT_B = '33333333-3333-4333-8333-333333333333'
const USER_B = '44444444-4444-4444-8444-444444444444'

const principal = (tenantId: string, userId: string): AuthPrincipal => ({
  tenantId,
  userId,
  authSessionId: `session:${userId}`,
  roles: ['owner'],
  emailVerified: true,
})

const request = <P>(payload: P): RpcRequest<P> => ({ rpcId: RpcId('tenant-test'), payload })

function register(ctx: Context, id: string, tenantId: string, userId: string): Session {
  const session = ctx.sessions.create(SessionId(id))
  const agent = {
    id: session.id,
    session,
    options: {
      provider: 'mock',
      model: 'mock',
      billingIdentity: { tenantId, userId, billingMode: 'orygin' as const },
    },
    inbox: new Inbox(session, { inserted: () => {}, discarded: () => {}, claimed: () => {} }),
    status: 'idle',
    ctx,
  } as Agent
  ctx.agents.register(agent)
  return session
}

async function setup() {
  vi.stubEnv('ORYGIN_SAAS_PROFILE', '1')
  const ctx = new Context()
  await ctx.plugin(SessionStore)
  await ctx.plugin(AgentRegistry)
  await ctx.plugin(UserQuestionService)
  const sessionA = register(ctx, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', TENANT_A, USER_A)
  const sessionB = register(ctx, 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', TENANT_B, USER_B)
  const api = createApiProxy(ctx, {
    defaultModelSelection: () => ({ provider: 'mock', model: 'mock' }),
    cwd: '/railway/private',
  })
  return { api, sessionA, sessionB }
}

afterEach(() => { vi.unstubAllEnvs() })

describe('ApiProxy tenant isolation', () => {
  it('lists only sessions stamped for the current verified principal', async () => {
    const { api, sessionA } = await setup()
    const response = await withAuthPrincipal(principal(TENANT_A, USER_A), () =>
      api.sessions.list(request({})))

    expect(response.result.ok).toBe(true)
    if (!response.result.ok) throw new Error('unreachable')
    expect(response.result.value.items.map(item => item.sessionId)).toEqual([sessionA.id])
    expect(response.result.value.items[0]).not.toHaveProperty('cwd')
  })

  it('does not expose Railway filesystem paths or another tenant session count', async () => {
    const { api } = await setup()
    const response = await withAuthPrincipal(principal(TENANT_A, USER_A), () =>
      api.host.describe(request({})))

    expect(response.result).toMatchObject({
      ok: true,
      value: { attachedSessions: 1, canOpenPath: false },
    })
    if (!response.result.ok) throw new Error('unreachable')
    expect(response.result.value).not.toHaveProperty('cwd')
    expect(response.result.value).not.toHaveProperty('home')
  })

  it('returns not-found for another tenant session without confirming it exists', async () => {
    const { api, sessionB } = await setup()
    const response = await withAuthPrincipal(principal(TENANT_A, USER_A), () =>
      api.sessions.history(request({ sessionId: sessionB.id })))

    expect(response.result).toMatchObject({
      ok: false,
      error: { code: 'session-not-found' },
    })
  })

  it('rejects cross-tenant mutations and derived session reads at the RPC boundary', async () => {
    const { api, sessionB } = await setup()
    const runAsTenantA = <T>(operation: () => Promise<T>): Promise<T> =>
      withAuthPrincipal(principal(TENANT_A, USER_A), operation)

    const [cancelled, forked, skills] = await Promise.all([
      runAsTenantA(() => api.sessions.cancel(request({ sessionId: sessionB.id }))),
      runAsTenantA(() => api.sessions.fork(request({ sessionId: sessionB.id }))),
      runAsTenantA(() => api.skills.list(request({ sessionId: sessionB.id }))),
    ])

    for (const response of [cancelled, forked, skills]) {
      expect(response.result).toMatchObject({
        ok: false,
        error: { code: 'session-not-found' },
      })
    }
  })

  it('filters live mux events before they enter the tenant queue', async () => {
    const { api, sessionA, sessionB } = await setup()
    const abort = new AbortController()
    const iterator = withAuthPrincipal(principal(TENANT_A, USER_A), () =>
      api.events.mux(request({}), abort.signal)[Symbol.asyncIterator]())

    const subscribed = await withAuthPrincipal(principal(TENANT_A, USER_A), () => iterator.next())
    expect(subscribed.value).toMatchObject({
      payload: { type: 'session/subscribed', sessionId: sessionA.id },
    })

    sessionB.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'tenant B secret' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })
    sessionA.append('user/message', createUserMessage({
      content: [{ type: 'text', text: 'tenant A visible' }],
      source: { kind: 'user' },
    }), { surfaceOp: 'append' })

    const event = await withAuthPrincipal(principal(TENANT_A, USER_A), () => iterator.next())
    expect(event.value).toMatchObject({
      payload: { type: 'session/event', sessionId: sessionA.id },
    })
    expect(JSON.stringify(event.value)).not.toContain('tenant B secret')
    abort.abort()
    await iterator.return?.()
  })
})
