import { Context } from '@orygin-ai/cordis'
import { describe, expect, it } from 'vitest'
import { SupabaseResourceAuthorization } from '../src/index.ts'

const TENANT_ID = '11111111-1111-4111-8111-111111111111'
const USER_ID = '22222222-2222-4222-8222-222222222222'
const SESSION_ID = '33333333-3333-4333-8333-333333333333'

const principal = {
  tenantId: TENANT_ID,
  userId: USER_ID,
  authSessionId: 'auth-session',
  roles: ['owner'] as const,
  emailVerified: true,
}

describe('SupabaseResourceAuthorization', () => {
  it('sends only server-derived scope and returns the database decision', async () => {
    let body: Record<string, unknown> | undefined
    const service = new SupabaseResourceAuthorization(new Context(), {
      url: 'https://project.supabase.co',
      serviceRoleKey: 'server-secret',
      fetch: async (_input, init) => {
        if (typeof init?.body !== 'string') throw new Error('expected JSON request body')
        body = JSON.parse(init.body) as Record<string, unknown>
        return Response.json(true)
      },
    })

    await expect(service.authorize(principal, 'session', SESSION_ID, 'read')).resolves.toBe(true)
    expect(body).toEqual({
      p_tenant_id: TENANT_ID,
      p_user_id: USER_ID,
      p_resource_kind: 'session',
      p_resource_id: SESSION_ID,
      p_action: 'read',
    })
  })

  it('fails closed on malformed identities and malformed responses', async () => {
    const service = new SupabaseResourceAuthorization(new Context(), {
      url: 'https://project.supabase.co',
      serviceRoleKey: 'server-secret',
      fetch: async () => Response.json({ allowed: true }),
    })
    await expect(service.authorize(principal, 'session', SESSION_ID, 'read'))
      .rejects.toThrow(/invalid decision/)
    await expect(service.authorize({ ...principal, tenantId: 'client-value' }, 'session', SESSION_ID, 'read'))
      .rejects.toThrow(/tenantId must be a UUID/)
  })
})
