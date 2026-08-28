import assert from 'node:assert/strict'
import test from 'node:test'

import worker, {
  createUpstreamRequest,
  isTrustedPublicRequest,
  WebSocketTicketStore,
} from './orygin-gateway.mjs'

test('translates a same-origin authenticated API request to Railway', async () => {
  const request = new Request('https://orygin.fun/api/llm.providers?refresh=1', {
    method: 'POST',
    headers: {
      authorization: 'Bearer test-token',
      'content-type': 'application/json',
      origin: 'https://orygin.fun',
      'sec-fetch-site': 'same-origin',
    },
    body: '{"request":"list"}',
  })

  assert.equal(isTrustedPublicRequest(request), true)
  const upstream = createUpstreamRequest(request)
  assert.equal(upstream.url, 'https://orygin-web-production.up.railway.app/api/llm.providers?refresh=1')
  assert.equal(upstream.headers.get('authorization'), 'Bearer test-token')
  assert.equal(upstream.headers.get('origin'), 'https://orygin-web-production.up.railway.app')
  assert.equal(upstream.headers.get('x-forwarded-host'), 'orygin.fun')
  assert.equal(upstream.headers.get('x-forwarded-origin'), 'https://orygin.fun')
  assert.equal(upstream.headers.get('x-forwarded-proto'), 'https')
  assert.equal(await upstream.text(), '{"request":"list"}')
})

test('strips WebSocket credentials before proxying a gateway-signed identity', () => {
  const request = new Request('https://www.orygin.fun/api/events.mux?ticket=one-use-ticket&access_token=legacy', {
    headers: {
      connection: 'Upgrade',
      origin: 'https://www.orygin.fun',
      upgrade: 'websocket',
      'x-orygin-user-id': 'spoofed',
    },
  })

  assert.equal(isTrustedPublicRequest(request), true)
  const upstream = createUpstreamRequest(request, {
    'x-orygin-user-id': 'verified-user',
    'x-orygin-edge-signature': 'signature',
  })
  assert.equal(
    upstream.url,
    'https://orygin-web-production.up.railway.app/api/events.mux',
  )
  assert.equal(upstream.headers.get('upgrade'), 'websocket')
  assert.equal(upstream.headers.get('origin'), 'https://orygin-web-production.up.railway.app')
  assert.equal(upstream.headers.get('x-orygin-user-id'), 'verified-user')
  assert.equal(upstream.headers.get('x-orygin-edge-signature'), 'signature')
})

test('rejects cross-site and malformed browser API origins', () => {
  assert.equal(
    isTrustedPublicRequest(
      new Request('https://orygin.fun/api/llm.providers', {
        headers: { origin: 'https://attacker.example' },
      }),
    ),
    false,
  )
  assert.equal(
    isTrustedPublicRequest(
      new Request('https://orygin.fun/api/llm.providers', {
        headers: { origin: 'not a URL' },
      }),
    ),
    false,
  )
  assert.equal(
    isTrustedPublicRequest(
      new Request('https://orygin.fun/api/llm.providers', {
        headers: { 'sec-fetch-site': 'cross-site' },
      }),
    ),
    false,
  )
})

test('rejects unlisted hosts but allows cross-site navigation to the app shell', () => {
  assert.equal(isTrustedPublicRequest(new Request('https://preview.example/api/host.describe')), false)
  assert.equal(
    isTrustedPublicRequest(
      new Request('https://orygin.fun/', {
        headers: { 'sec-fetch-site': 'cross-site' },
      }),
    ),
    true,
  )
})

test('exchanges a bearer for an origin-bound one-use WebSocket ticket', async () => {
  const objects = new Map()
  const namespace = {
    idFromName(name) { return name },
    get(id) {
      let object = objects.get(id)
      if (object === undefined) {
        const values = new Map()
        const storage = {
          async put(key, value) { values.set(key, value) },
          async setAlarm() {},
          async deleteAll() { values.clear() },
          async transaction(operation) {
            return operation({
              async get(key) { return values.get(key) },
              async delete(key) { values.delete(key) },
            })
          },
        }
        object = new WebSocketTicketStore({ storage })
        objects.set(id, object)
      }
      return { fetch: (input, init) => object.fetch(new Request(input, init)) }
    },
  }
  const env = {
    WS_TICKETS: namespace,
    SUPABASE_URL: 'https://project.supabase.co',
    SUPABASE_PUBLISHABLE_KEY: 'publishable',
    EDGE_IDENTITY_SECRET: 'edge-secret-with-at-least-thirty-two-bytes',
  }
  const originalFetch = globalThis.fetch
  const upstream = []
  globalThis.fetch = async (input, init) => {
    const request = input instanceof Request ? input : new Request(input, init)
    if (new URL(request.url).hostname === 'project.supabase.co') {
      if (new URL(request.url).pathname === '/rest/v1/rpc/resolve_auth_principal') {
        return Response.json([{
          user_id: 'user-a',
          tenant_id: 'tenant-a',
          roles: ['owner'],
          email_verified: true,
        }])
      }
      return Response.json({
        id: 'user-a',
        email_confirmed_at: '2026-08-27T00:00:00Z',
      })
    }
    upstream.push(request)
    return Response.json({ proxied: true })
  }
  try {
    const payload = Buffer.from(JSON.stringify({ session_id: 'session-a' })).toString('base64url')
    const token = 'header.' + payload + '.signature'
    const issued = await worker.fetch(new Request('https://orygin.fun/api/auth/ws-ticket', {
      method: 'POST',
      headers: {
        authorization: 'Bearer ' + token,
        origin: 'https://orygin.fun',
        'sec-fetch-site': 'same-origin',
      },
    }), env)
    assert.equal(issued.status, 200)
    const { ticket } = await issued.json()
    assert.equal(typeof ticket, 'string')
    assert.equal(ticket.length, 43)

    const connect = () => worker.fetch(new Request(
      'https://orygin.fun/api/events.mux?ticket=' + ticket,
      {
        headers: {
          connection: 'Upgrade',
          origin: 'https://orygin.fun',
          upgrade: 'websocket',
        },
      },
    ), env)
    assert.equal((await connect()).status, 200)
    assert.equal(upstream.length, 1)
    assert.equal(upstream[0].url, 'https://orygin-web-production.up.railway.app/api/events.mux')
    assert.equal(upstream[0].headers.get('x-orygin-user-id'), 'user-a')
    assert.equal(upstream[0].headers.get('x-orygin-tenant-id'), 'tenant-a')
    assert.equal(upstream[0].headers.get('x-orygin-auth-session-id'), 'session-a')
    assert.equal(upstream[0].headers.get('authorization'), null)
    assert.equal((await connect()).status, 401)
  } finally {
    globalThis.fetch = originalFetch
  }
})
