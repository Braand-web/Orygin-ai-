import { createHmac } from 'node:crypto'
import type { IncomingMessage } from 'node:http'
import { afterEach, describe, expect, it } from 'vitest'
import { authenticateNodeRequest, LOCAL_AUTH_PRINCIPAL } from '../src/auth.ts'
import { currentAuthPrincipal, requireAuthPrincipal, withAuthPrincipal } from '../src/request-context.ts'

const originalAuthRequired = process.env.ORYGIN_AUTH_REQUIRED
const originalEdgeSecret = process.env.ORYGIN_EDGE_IDENTITY_SECRET

afterEach(() => {
  if (originalAuthRequired === undefined) delete process.env.ORYGIN_AUTH_REQUIRED
  else process.env.ORYGIN_AUTH_REQUIRED = originalAuthRequired
  if (originalEdgeSecret === undefined) delete process.env.ORYGIN_EDGE_IDENTITY_SECRET
  else process.env.ORYGIN_EDGE_IDENTITY_SECRET = originalEdgeSecret
})

function request(headers: Record<string, string>, url = '/api/events.mux'): IncomingMessage {
  return { headers, url } as IncomingMessage
}

describe('host authentication principal', () => {
  it('uses an explicit local principal only when cloud auth is disabled', async () => {
    delete process.env.ORYGIN_AUTH_REQUIRED
    await expect(authenticateNodeRequest(request({}))).resolves.toBe(LOCAL_AUTH_PRINCIPAL)
  })

  it('never accepts a Supabase bearer from a URL query', async () => {
    process.env.ORYGIN_AUTH_REQUIRED = '1'
    await expect(authenticateNodeRequest(request(
      {},
      '/api/events.mux?access_token=must-not-be-read',
    ))).resolves.toBeUndefined()
  })

  it('accepts a fresh Cloudflare-signed edge identity and rejects tampering', async () => {
    process.env.ORYGIN_AUTH_REQUIRED = '1'
    process.env.ORYGIN_EDGE_IDENTITY_SECRET = 'edge-secret-with-at-least-thirty-two-bytes'
    const timestamp = String(Date.now())
    const fields = {
      'x-orygin-edge-timestamp': timestamp,
      'x-orygin-user-id': 'user-a',
      'x-orygin-tenant-id': 'tenant-a',
      'x-orygin-auth-session-id': 'session-a',
      'x-orygin-roles': 'owner',
      'x-orygin-email-verified': '1',
    }
    const canonical = [
      'v1', timestamp, 'user-a', 'tenant-a', 'session-a', 'owner', '1',
    ].join('\n')
    const signature = createHmac('sha256', process.env.ORYGIN_EDGE_IDENTITY_SECRET)
      .update(canonical)
      .digest('base64url')

    await expect(authenticateNodeRequest(request({
      ...fields,
      'x-orygin-edge-signature': signature,
    }))).resolves.toEqual({
      userId: 'user-a',
      tenantId: 'tenant-a',
      authSessionId: 'session-a',
      roles: ['owner'],
      emailVerified: true,
    })
    await expect(authenticateNodeRequest(request({
      ...fields,
      'x-orygin-tenant-id': 'tenant-b',
      'x-orygin-edge-signature': signature,
    }))).resolves.toBeUndefined()
  })

  it('propagates a principal through asynchronous descendants without leaking it', async () => {
    expect(currentAuthPrincipal()).toBeUndefined()
    await withAuthPrincipal(LOCAL_AUTH_PRINCIPAL, async () => {
      await Promise.resolve()
      expect(requireAuthPrincipal()).toBe(LOCAL_AUTH_PRINCIPAL)
    })
    expect(currentAuthPrincipal()).toBeUndefined()
  })
})
