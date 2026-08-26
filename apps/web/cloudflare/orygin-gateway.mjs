/** Cloudflare reverse proxy from the public Orygin domains to the Railway Web runtime. */

const UPSTREAM_ORIGIN = new URL('https://orygin-web-production.up.railway.app')
const PUBLIC_HOSTS = new Set(['orygin.fun', 'www.orygin.fun'])

function isApiPath(pathname) {
  return pathname === '/api' || pathname.startsWith('/api/')
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
 * @param {Request} request - Trusted request received by the Worker.
 * @returns {Request} Streaming upstream request with proxy metadata.
 */
export function createUpstreamRequest(request) {
  const incoming = new URL(request.url)
  const target = new URL(UPSTREAM_ORIGIN)
  target.pathname = incoming.pathname
  target.search = incoming.search

  const headers = new Headers(request.headers)
  const originalOrigin = headers.get('origin')
  headers.delete('host')
  headers.set('x-forwarded-host', incoming.host)
  headers.set('x-forwarded-proto', incoming.protocol.slice(0, -1))
  if (originalOrigin !== null) {
    headers.set('x-forwarded-origin', originalOrigin)
    headers.set('origin', UPSTREAM_ORIGIN.origin)
  }

  const upstream = new Request(target, request)
  return new Request(upstream, { headers, redirect: 'manual' })
}

const worker = {
  /**
   * Proxy one public Orygin request to the Railway runtime.
   * @param {Request} request - Incoming Cloudflare request.
   * @returns {Promise<Response>} Upstream response or a bounded proxy error.
   */
  async fetch(request) {
    const incoming = new URL(request.url)
    if (!isTrustedPublicRequest(request)) return new Response('Forbidden', { status: 403 })

    try {
      return await fetch(createUpstreamRequest(request))
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'upstream_fetch_failed',
          path: incoming.pathname,
          message: error instanceof Error ? error.message : 'unknown error',
        }),
      )
      return new Response('Bad Gateway', { status: 502 })
    }
  },
}

export default worker
