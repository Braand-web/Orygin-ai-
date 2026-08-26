import assert from 'node:assert/strict'
import test from 'node:test'

import { createUpstreamRequest, isTrustedPublicRequest } from './orygin-gateway.mjs'

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

test('preserves a WebSocket upgrade and its authentication query', () => {
  const request = new Request('https://www.orygin.fun/api/events.mux?access_token=test-token', {
    headers: {
      connection: 'Upgrade',
      origin: 'https://www.orygin.fun',
      upgrade: 'websocket',
    },
  })

  assert.equal(isTrustedPublicRequest(request), true)
  const upstream = createUpstreamRequest(request)
  assert.equal(
    upstream.url,
    'https://orygin-web-production.up.railway.app/api/events.mux?access_token=test-token',
  )
  assert.equal(upstream.headers.get('upgrade'), 'websocket')
  assert.equal(upstream.headers.get('origin'), 'https://orygin-web-production.up.railway.app')
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
