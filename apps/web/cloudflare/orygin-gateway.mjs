/** Cloudflare security gateway for the public Orygin Web application. */

const UPSTREAM_ORIGIN = new URL('https://orygin-web-production.up.railway.app')
const PUBLIC_HOSTS = new Set(['orygin.fun', 'www.orygin.fun'])
const WEBSOCKET_PATHS = new Set(['/api/events.mux', '/api/events.host'])
const TICKET_PATH = '/api/auth/ws-ticket'
const TICKET_TTL_SECONDS = 60
const EDGE_SIGNATURE_VERSION = 'v1'
const EDGE_IDENTITY_HEADERS = [
  'x-orygin-edge-signature',
  'x-orygin-edge-timestamp',
  'x-orygin-user-id',
  'x-orygin-tenant-id',
  'x-orygin-auth-session-id',
  'x-orygin-roles',
  'x-orygin-email-verified',
]

function isApiPath(pathname) {
  return pathname === '/api' || pathname.startsWith('/api/')
}

function isWebSocketUpgrade(request) {
  return request.headers.get('upgrade')?.toLowerCase() === 'websocket'
}

/**
 * Decide whether a public request may cross the browser-trust fence.
 * @param {Request} request - Request received on an Orygin public domain.
 * @returns {boolean} Whether its Host, Fetch Metadata, and Origin are trusted.
 */
export function isTrustedPublicRequest(request) {
  const incoming = new URL(request.url)
  if (!PUBLIC_HOSTS.has(incoming.hostname)) return false
  if (!isApiPath(incoming.pathname)) return true
  if (request.headers.get('sec-fetch-site') === 'cross-site') return false

  const origin = request.headers.get('origin')
  if (origin === null) return true
  try {
    return new URL(origin).host === incoming.host
  } catch {
    return false
  }
}

/**
 * Preserve the request while translating public proxy identity to Railway.
 * Query credentials are removed before the upstream request is created.
 * @param {Request} request - Trusted request received by the Worker.
 * @param {HeadersInit} [identityHeaders] - Gateway-signed identity for a WebSocket.
 * @returns {Request} Streaming upstream request with proxy metadata.
 */
export function createUpstreamRequest(request, identityHeaders = undefined) {
  const incoming = new URL(request.url)
  const target = new URL(UPSTREAM_ORIGIN)
  target.pathname = incoming.pathname
  incoming.searchParams.delete('access_token')
  incoming.searchParams.delete('ticket')
  target.search = incoming.search

  const headers = new Headers(request.headers)
  const originalOrigin = headers.get('origin')
  headers.delete('host')
  for (const name of EDGE_IDENTITY_HEADERS) headers.delete(name)
  headers.set('x-forwarded-host', incoming.host)
  headers.set('x-forwarded-proto', incoming.protocol.slice(0, -1))
  if (originalOrigin !== null) {
    headers.set('x-forwarded-origin', originalOrigin)
    headers.set('origin', UPSTREAM_ORIGIN.origin)
  }
  if (identityHeaders !== undefined) {
    const trusted = new Headers(identityHeaders)
    for (const name of EDGE_IDENTITY_HEADERS) {
      const value = trusted.get(name)
      if (value !== null) headers.set(name, value)
    }
  }

  const upstream = new Request(target, request)
  return new Request(upstream, { headers, redirect: 'manual' })
}

/** Single-ticket Durable Object. A named instance serializes atomic consumption. */
export class WebSocketTicketStore {
  constructor(state) {
    this.state = state
  }

  async fetch(request) {
    const url = new URL(request.url)
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
    if (url.pathname === '/issue') {
      const principal = await request.json()
      await this.state.storage.put('principal', principal)
      await this.state.storage.setAlarm(principal.expiresAt)
      return new Response(null, { status: 204 })
    }
    if (url.pathname === '/consume') {
      const expectedOrigin = request.headers.get('x-orygin-ticket-origin')
      return this.state.storage.transaction(async (transaction) => {
        const principal = await transaction.get('principal')
        if (principal === undefined) return new Response('Unauthorized', { status: 401 })
        await transaction.delete('principal')
        if (principal.expiresAt < Date.now() || expectedOrigin !== principal.origin) {
          return new Response('Unauthorized', { status: 401 })
        }
        return Response.json(principal, {
          headers: { 'cache-control': 'no-store' },
        })
      })
    }
    return new Response('Not Found', { status: 404 })
  }

  async alarm() {
    await this.state.storage.deleteAll()
  }
}

async function issueWebSocketTicket(request, env) {
  if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
  const authorization = request.headers.get('authorization')
  if (authorization === null || !/^Bearer\s+\S+$/i.test(authorization)) {
    return unauthorized()
  }
  if (!env.SUPABASE_URL || !env.SUPABASE_PUBLISHABLE_KEY || !env.WS_TICKETS) {
    return unavailable('WebSocket authentication is not configured')
  }

  const authResponse = await fetch(new URL('/auth/v1/user', env.SUPABASE_URL), {
    headers: {
      authorization,
      apikey: env.SUPABASE_PUBLISHABLE_KEY,
    },
  })
  if (!authResponse.ok) return unauthorized()
  const user = await authResponse.json()
  if (typeof user.id !== 'string' || user.id === '') return unauthorized()

  const principalResponse = await fetch(
    new URL('/rest/v1/rpc/resolve_auth_principal', env.SUPABASE_URL),
    {
      method: 'POST',
      headers: {
        authorization,
        apikey: env.SUPABASE_PUBLISHABLE_KEY,
        'content-type': 'application/json',
      },
      body: '{}',
    },
  )
  if (!principalResponse.ok) return unauthorized()
  const principals = await principalResponse.json()
  if (!Array.isArray(principals) || principals.length !== 1) return unauthorized()
  const resolved = principals[0]
  if (resolved.user_id !== user.id || typeof resolved.tenant_id !== 'string'
    || !Array.isArray(resolved.roles) || resolved.roles.length === 0
    || resolved.roles.some(role => !['owner', 'admin', 'support'].includes(role))) {
    return unauthorized()
  }

  const token = authorization.replace(/^Bearer\s+/i, '')
  const ticket = randomTicket()
  const principal = {
    userId: user.id,
    tenantId: resolved.tenant_id,
    authSessionId: sessionIdFromJwt(token) ?? `token:${await sha256(token)}`,
    roles: resolved.roles,
    emailVerified: resolved.email_verified === true && typeof user.email_confirmed_at === 'string',
    origin: new URL(request.url).origin,
    expiresAt: Date.now() + TICKET_TTL_SECONDS * 1000,
  }
  const id = env.WS_TICKETS.idFromName(ticket)
  const stored = await env.WS_TICKETS.get(id).fetch('https://ticket.internal/issue', {
    method: 'POST',
    body: JSON.stringify(principal),
  })
  if (!stored.ok) return unavailable('WebSocket ticket storage failed')
  return Response.json({ ticket, expiresIn: TICKET_TTL_SECONDS }, {
    headers: {
      'cache-control': 'no-store',
      'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    },
  })
}

async function consumeWebSocketTicket(request, env) {
  if (!env.WS_TICKETS || !env.EDGE_IDENTITY_SECRET || env.EDGE_IDENTITY_SECRET.length < 32) {
    return undefined
  }
  const incoming = new URL(request.url)
  const ticket = incoming.searchParams.get('ticket')
  const origin = request.headers.get('origin')
  if (ticket === null || ticket.length < 32 || origin === null) return undefined
  const id = env.WS_TICKETS.idFromName(ticket)
  const response = await env.WS_TICKETS.get(id).fetch('https://ticket.internal/consume', {
    method: 'POST',
    headers: { 'x-orygin-ticket-origin': origin },
  })
  if (!response.ok) return undefined
  const principal = await response.json()
  return signEdgeIdentity(principal, env.EDGE_IDENTITY_SECRET)
}

async function signEdgeIdentity(principal, secret) {
  const timestamp = String(Date.now())
  const roles = principal.roles.join(',')
  const emailVerified = principal.emailVerified ? '1' : '0'
  const canonical = [
    EDGE_SIGNATURE_VERSION,
    timestamp,
    principal.userId,
    principal.tenantId,
    principal.authSessionId,
    roles,
    emailVerified,
  ].join('\n')
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = base64Url(new Uint8Array(await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(canonical),
  )))
  return {
    'x-orygin-edge-signature': signature,
    'x-orygin-edge-timestamp': timestamp,
    'x-orygin-user-id': principal.userId,
    'x-orygin-tenant-id': principal.tenantId,
    'x-orygin-auth-session-id': principal.authSessionId,
    'x-orygin-roles': roles,
    'x-orygin-email-verified': emailVerified,
  }
}

function randomTicket() {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return base64Url(bytes)
}

function base64Url(bytes) {
  let binary = ''
  for (const value of bytes) binary += String.fromCharCode(value)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

async function sha256(value) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')
}

function sessionIdFromJwt(token) {
  const payload = token.split('.')[1]
  if (payload === undefined) return undefined
  try {
    const normalized = payload.replaceAll('-', '+').replaceAll('_', '/')
    const parsed = JSON.parse(atob(normalized))
    return typeof parsed.session_id === 'string' && parsed.session_id !== ''
      ? parsed.session_id
      : undefined
  } catch {
    return undefined
  }
}

function unauthorized() {
  return new Response('Unauthorized', {
    status: 401,
    headers: { 'www-authenticate': 'Bearer', 'cache-control': 'no-store' },
  })
}

function unavailable(message) {
  return Response.json({ code: 'auth-unavailable', message }, {
    status: 503,
    headers: { 'cache-control': 'no-store' },
  })
}

function withSecurityHeaders(response, noStore = false) {
  const headers = new Headers(response.headers)
  headers.set('strict-transport-security', 'max-age=31536000; includeSubDomains; preload')
  headers.set('x-content-type-options', 'nosniff')
  headers.set('x-frame-options', 'DENY')
  headers.set('referrer-policy', 'strict-origin-when-cross-origin')
  headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=(), payment=(self)')
  if (noStore) headers.set('cache-control', 'no-store')
  return new Response(response.body, { status: response.status, statusText: response.statusText, headers })
}

const worker = {
  /**
   * Authenticate ticket issuance, consume WebSocket tickets, then proxy to Railway.
   * @param {Request} request - Incoming Cloudflare request.
   * @param {Record<string, any>} env - Worker bindings and secrets.
   * @returns {Promise<Response>} Gateway or upstream response.
   */
  async fetch(request, env) {
    const incoming = new URL(request.url)
    if (!isTrustedPublicRequest(request)) return new Response('Forbidden', { status: 403 })

    if (incoming.hostname === 'www.orygin.fun' && !isWebSocketUpgrade(request)) {
      incoming.hostname = 'orygin.fun'
      return Response.redirect(incoming, 308)
    }
    if (incoming.pathname === TICKET_PATH) {
      return withSecurityHeaders(await issueWebSocketTicket(request, env), true)
    }

    let identityHeaders
    if (isWebSocketUpgrade(request) && WEBSOCKET_PATHS.has(incoming.pathname)) {
      identityHeaders = await consumeWebSocketTicket(request, env)
      if (identityHeaders === undefined) return unauthorized()
    }

    try {
      const response = await fetch(createUpstreamRequest(request, identityHeaders))
      return isWebSocketUpgrade(request)
        ? response
        : withSecurityHeaders(response, isApiPath(incoming.pathname))
    } catch (error) {
      console.error(JSON.stringify({
        event: 'upstream_fetch_failed',
        path: incoming.pathname,
        message: error instanceof Error ? error.message : 'unknown error',
      }))
      return new Response('Bad Gateway', { status: 502 })
    }
  },
}

export default worker
