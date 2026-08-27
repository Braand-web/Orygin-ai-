/** Browser-side Supabase session bridge used by HTTP and WebSocket carriers. */

interface AuthGlobal {
  __ORYGIN_AUTH__?: {
    getAccessToken?: () => string | undefined
    requestAuth?: () => void
  }
}

/** Whether the web application installed an authentication boundary. */
export function isAuthEnabled(): boolean {
  return (globalThis as AuthGlobal).__ORYGIN_AUTH__ !== undefined
}

/** Read the current short-lived Supabase access token without storing it here. */
export function getAccessToken(): string | undefined {
  return (globalThis as AuthGlobal).__ORYGIN_AUTH__?.getAccessToken?.()
}

/** Add the current user's bearer token to a browser request. */
export function authHeaders(): Record<string, string> {
  const token = getAccessToken()
  return token === undefined ? {} : { authorization: `Bearer ${token}` }
}

/** Merge auth headers into an optional RequestInit while preserving caller headers. */
export function withAuth(init?: RequestInit): RequestInit | undefined {
  const token = getAccessToken()
  if (token === undefined) return init
  const headers = new Headers(init?.headers)
  headers.set('authorization', `Bearer ${token}`)
  return { ...init, headers }
}

/** Add a token query parameter for browser WebSocket handshakes (custom headers are unavailable). */
export function withAuthQuery(url: URL): URL {
  const token = getAccessToken()
  if (token !== undefined) url.searchParams.set('access_token', token)
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
