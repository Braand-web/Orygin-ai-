/** Supabase Auth and signed-edge identity boundary for Web deployments. */

import { createHash, createHmac, timingSafeEqual } from 'node:crypto'
import type { IncomingHttpHeaders, IncomingMessage } from 'node:http'
import { createClient, type SupabaseClient, type User } from '@supabase/supabase-js'
import { LOCAL_AUTH_PRINCIPAL } from '@orygin-ai/dsh-request-context'
import type { AuthPrincipal, AuthRole, RequestContext } from '@orygin-ai/dsh-request-context'

export { LOCAL_AUTH_PRINCIPAL }
export type { AuthPrincipal, AuthRole, RequestContext }

const AUTH_REQUIRED_ENV = 'ORYGIN_AUTH_REQUIRED'
const SUPABASE_URL_ENV = 'SUPABASE_URL'
const SUPABASE_PUBLISHABLE_KEY_ENV = 'SUPABASE_PUBLISHABLE_KEY'
const EDGE_IDENTITY_SECRET_ENV = 'ORYGIN_EDGE_IDENTITY_SECRET'
const EDGE_SIGNATURE_VERSION = 'v1'
const EDGE_IDENTITY_MAX_AGE_MS = 60_000

const EDGE_HEADERS = {
  signature: 'x-orygin-edge-signature',
  timestamp: 'x-orygin-edge-timestamp',
  userId: 'x-orygin-user-id',
  tenantId: 'x-orygin-tenant-id',
  authSessionId: 'x-orygin-auth-session-id',
  roles: 'x-orygin-roles',
  emailVerified: 'x-orygin-email-verified',
} as const

let cachedClient: SupabaseClient | undefined
let cachedConfig: string | undefined

/**
 * Whether this process must authenticate every non-loopback API request.
 * @returns true only when cloud authentication is required.
 */
export function supabaseAuthRequired(): boolean {
  return process.env[AUTH_REQUIRED_ENV] === '1'
}

/**
 * Authenticate a Node HTTP request and return its server-derived principal.
 * @param request - inbound host request.
 * @returns the verified principal, or undefined when authentication fails.
 */
export async function authenticateNodeRequest(
  request: IncomingMessage,
): Promise<AuthPrincipal | undefined> {
  if (!supabaseAuthRequired()) return LOCAL_AUTH_PRINCIPAL
  const edgePrincipal = authenticateSignedEdgeHeaders(name => headerValue(request.headers, name))
  if (edgePrincipal !== undefined) return edgePrincipal
  const token = bearerToken(headerValue(request.headers, 'authorization'))
  return token === undefined ? undefined : authenticateToken(token)
}

/**
 * Authenticate a Fetch request and return its server-derived principal.
 * @param request - inbound Fetch request.
 * @returns the verified principal, or undefined when authentication fails.
 */
export async function authenticateFetchRequest(request: Request): Promise<AuthPrincipal | undefined> {
  if (!supabaseAuthRequired()) return LOCAL_AUTH_PRINCIPAL
  const edgePrincipal = authenticateSignedEdgeHeaders(name => request.headers.get(name) ?? undefined)
  if (edgePrincipal !== undefined) return edgePrincipal
  const token = bearerToken(request.headers.get('authorization'))
  return token === undefined ? undefined : authenticateToken(token)
}

function headerValue(headers: IncomingHttpHeaders, name: string): string | undefined {
  const value = headers[name]
  if (Array.isArray(value)) return value[0]
  return value
}

function bearerToken(value: string | null | undefined): string | undefined {
  if (value === undefined || value === null) return undefined
  const match = /^Bearer\s+([^\s]+)$/i.exec(value.trim())
  return match?.[1]
}

async function authenticateToken(token: string): Promise<AuthPrincipal | undefined> {
  const supabase = getSupabaseClient()
  if (supabase === undefined) return undefined
  const { data, error } = await supabase.auth.getUser(token)
  if (error !== null) return undefined
  const membership = await resolvePrincipalMembership(token)
  if (membership === undefined || membership.userId !== data.user.id) return undefined
  return principalFromSupabaseUser(data.user, token, membership)
}

interface PrincipalMembership {
  readonly userId: string
  readonly tenantId: string
  readonly roles: readonly AuthRole[]
  readonly emailVerified: boolean
}

async function resolvePrincipalMembership(token: string): Promise<PrincipalMembership | undefined> {
  const url = process.env[SUPABASE_URL_ENV]
  const key = process.env[SUPABASE_PUBLISHABLE_KEY_ENV]
  if (url === undefined || key === undefined || url === '' || key === '') return undefined
  try {
    const response = await fetch(new URL('/rest/v1/rpc/resolve_auth_principal', url), {
      method: 'POST',
      headers: {
        apikey: key,
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: '{}',
    })
    if (!response.ok) return undefined
    const rows = await response.json() as unknown
    if (!Array.isArray(rows) || rows.length !== 1) return undefined
    const row = rows[0] as Record<string, unknown>
    const roles = Array.isArray(row.roles) ? row.roles.filter(isAuthRole) : []
    if (typeof row.user_id !== 'string' || typeof row.tenant_id !== 'string' || roles.length === 0) {
      return undefined
    }
    return {
      userId: row.user_id,
      tenantId: row.tenant_id,
      roles,
      emailVerified: row.email_verified === true,
    }
  } catch {
    return undefined
  }
}

function principalFromSupabaseUser(
  user: User,
  token: string,
  membership: PrincipalMembership,
): AuthPrincipal {
  return Object.freeze({
    userId: user.id,
    tenantId: membership.tenantId,
    authSessionId: sessionIdFromJwt(token) ?? `token:${sha256(token)}`,
    roles: Object.freeze([...membership.roles]),
    emailVerified: membership.emailVerified && typeof user.email_confirmed_at === 'string',
  })
}

function sessionIdFromJwt(token: string): string | undefined {
  const payload = token.split('.')[1]
  if (payload === undefined) return undefined
  try {
    const parsed = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as { session_id?: unknown }
    return typeof parsed.session_id === 'string' && parsed.session_id !== ''
      ? parsed.session_id
      : undefined
  } catch {
    return undefined
  }
}

function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex')
}

function authenticateSignedEdgeHeaders(
  readHeader: (name: string) => string | undefined,
): AuthPrincipal | undefined {
  const secret = process.env[EDGE_IDENTITY_SECRET_ENV]
  if (secret === undefined || secret.length < 32) return undefined

  const signature = readHeader(EDGE_HEADERS.signature)
  const timestamp = readHeader(EDGE_HEADERS.timestamp)
  const userId = readHeader(EDGE_HEADERS.userId)
  const tenantId = readHeader(EDGE_HEADERS.tenantId)
  const authSessionId = readHeader(EDGE_HEADERS.authSessionId)
  const rolesValue = readHeader(EDGE_HEADERS.roles)
  const emailVerifiedValue = readHeader(EDGE_HEADERS.emailVerified)
  if ([signature, timestamp, userId, tenantId, authSessionId, rolesValue, emailVerifiedValue]
    .some(value => value === undefined)) return undefined

  const issuedAt = Number(timestamp)
  if (!Number.isSafeInteger(issuedAt) || Math.abs(Date.now() - issuedAt) > EDGE_IDENTITY_MAX_AGE_MS) {
    return undefined
  }

  const canonical = edgeIdentityCanonical({
    timestamp: timestamp as string,
    userId: userId as string,
    tenantId: tenantId as string,
    authSessionId: authSessionId as string,
    roles: rolesValue as string,
    emailVerified: emailVerifiedValue as string,
  })
  const expected = createHmac('sha256', secret).update(canonical).digest()
  let received: Buffer
  try {
    received = Buffer.from(signature as string, 'base64url')
  } catch {
    return undefined
  }
  if (received.length !== expected.length || !timingSafeEqual(received, expected)) return undefined

  const roles = (rolesValue as string).split(',').filter(isAuthRole)
  if (roles.length === 0) return undefined
  return Object.freeze({
    userId: userId as string,
    tenantId: tenantId as string,
    authSessionId: authSessionId as string,
    roles: Object.freeze(roles),
    emailVerified: emailVerifiedValue === '1',
  })
}

function isAuthRole(value: string): value is AuthRole {
  return value === 'owner' || value === 'admin' || value === 'support'
}

function edgeIdentityCanonical(identity: {
  readonly timestamp: string
  readonly userId: string
  readonly tenantId: string
  readonly authSessionId: string
  readonly roles: string
  readonly emailVerified: string
}): string {
  return [
    EDGE_SIGNATURE_VERSION,
    identity.timestamp,
    identity.userId,
    identity.tenantId,
    identity.authSessionId,
    identity.roles,
    identity.emailVerified,
  ].join('\n')
}

function getSupabaseClient(): SupabaseClient | undefined {
  const url = process.env[SUPABASE_URL_ENV]
  const key = process.env[SUPABASE_PUBLISHABLE_KEY_ENV]
  if (url === undefined || key === undefined || url === '' || key === '') return undefined
  const config = `${url}\u0000${key}`
  if (cachedClient !== undefined && cachedConfig === config) return cachedClient
  cachedClient = createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  })
  cachedConfig = config
  return cachedClient
}
