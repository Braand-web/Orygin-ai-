/** Browser-side Supabase session bridge used by HTTP and WebSocket carriers. */

interface AuthGlobal {
  __ORYGIN_AUTH__?: {
    getAccessToken?: () => string | undefined
    requestAuth?: () => void
  }
}

/** A stale browser session could not be exchanged for a WebSocket ticket. */
export class AuthenticationRequiredError extends Error {
  constructor(message = 'Authentication is required') {
    super(message)
    this.name = 'AuthenticationRequiredError'
  }
}

/**
 * Whether the web application installed an authentication boundary.
 * @returns current installation state.
 */
export function isAuthEnabled(): boolean {
  return (globalThis as AuthGlobal).__ORYGIN_AUTH__ !== undefined
}

/**
 * Read the current short-lived Supabase access token without storing it here.
 * @returns the current token when signed in.
 */
export function getAccessToken(): string | undefined {
  return (globalThis as AuthGlobal).__ORYGIN_AUTH__?.getAccessToken?.()
}

/**
 * Add the current user's bearer token to a browser request.
 * @returns request headers for the current session.
 */
export function authHeaders(): Record<string, string> {
  const token = getAccessToken()
  return token === undefined ? {} : { authorization: `Bearer ${token}` }
}

/**
 * Merge auth headers into an optional RequestInit while preserving caller headers.
 * @param init - caller request options.
 * @returns authenticated options, or the unchanged optional input when signed out.
 */
export function withAuth(init?: RequestInit): RequestInit | undefined {
  const token = getAccessToken()
  if (token === undefined) return init
  const headers = new Headers(init?.headers)
  headers.set('authorization', `Bearer ${token}`)
  return { ...init, headers }
}

/**
 * Exchange the bearer token for a short-lived, one-use WebSocket ticket.
 * @param url - WebSocket URL to authorize without a bearer query parameter.
 * @returns a URL carrying only the one-use ticket.
 */
export async function withWebSocketTicket(url: URL): Promise<URL> {
  const token = getAccessToken()
  if (token === undefined) return url
  const endpoint = new URL('/api/auth/ws-ticket', url)
  // Ticket exchange is an ordinary HTTP request, but it must preserve the
  // page's transport security. `url` is the WebSocket endpoint (`ws:` or
  // `wss:`) after it has been resolved against the page origin (`http:` or
  // `https:`). The previous check only handled `wss:` and therefore turned an
  // HTTPS page into `http://...`, which browsers block as mixed content before
  // the gateway can issue a ticket.
  endpoint.protocol = endpoint.protocol === 'wss:' || endpoint.protocol === 'https:'
    ? 'https:'
    : 'http:'
  const response = await globalThis.fetch(endpoint, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}` },
    credentials: 'omit',
  })
  if (!response.ok) {
    if (response.status === 401) {
      notifyAuthRequired()
      throw new AuthenticationRequiredError('WebSocket ticket request was rejected')
    }
    throw new Error(`WebSocket ticket request failed with HTTP ${String(response.status)}`)
  }
  const payload = await response.json() as { ticket?: unknown }
  if (typeof payload.ticket !== 'string' || payload.ticket.length < 32) {
    throw new Error('WebSocket ticket response is invalid')
  }
  url.searchParams.set('ticket', payload.ticket)
  return url
}

/** Notify the application shell that a protected action needs sign-in. */
export function notifyAuthRequired(): void {
  try {
    ;(globalThis as AuthGlobal).__ORYGIN_AUTH__?.requestAuth?.()
  } catch (error) {
    // Authentication UX must never turn a transport rejection into another
    // uncaught error in the RPC carrier.
    console.error('[client-connection] auth prompt callback failed:', error)
  }
}
