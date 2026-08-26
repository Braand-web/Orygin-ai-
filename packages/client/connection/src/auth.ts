/** Supabase Auth boundary for public Web deployments. */

import type { IncomingHttpHeaders, IncomingMessage } from 'node:http'
import { createClient, type SupabaseClient } from '@supabase/supabase-js'

const AUTH_REQUIRED_ENV = 'ORYGIN_AUTH_REQUIRED'
const SUPABASE_URL_ENV = 'SUPABASE_URL'
const SUPABASE_PUBLISHABLE_KEY_ENV = 'SUPABASE_PUBLISHABLE_KEY'

let cachedClient: SupabaseClient | undefined
let cachedConfig: string | undefined

/** Whether this process must authenticate every non-loopback API request. */
export function supabaseAuthRequired(): boolean {
  return process.env[AUTH_REQUIRED_ENV] === '1'
}

/** Validate a Node HTTP request against Supabase Auth using its bearer token. */
export async function authenticateNodeRequest(request: IncomingMessage): Promise<boolean> {
  if (!supabaseAuthRequired()) return true
  const token = tokenFromNodeRequest(request)
  if (token === undefined) return false
  return authenticateToken(token)
}

/** Validate a Fetch request against Supabase Auth using its bearer token. */
export async function authenticateFetchRequest(request: Request): Promise<boolean> {
  if (!supabaseAuthRequired()) return true
  const token = tokenFromFetchRequest(request)
  if (token === undefined) return false
  return authenticateToken(token)
}

function tokenFromNodeRequest(request: IncomingMessage): string | undefined {
  const authorization = headerValue(request.headers, 'authorization')
  const bearer = bearerToken(authorization)
  if (bearer !== undefined) return bearer
  return accessTokenFromUrl(request.url)
}

function tokenFromFetchRequest(request: Request): string | undefined {
  const bearer = bearerToken(request.headers.get('authorization'))
  if (bearer !== undefined) return bearer
  return accessTokenFromUrl(request.url)
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

function accessTokenFromUrl(rawUrl: string | undefined): string | undefined {
  if (rawUrl === undefined) return undefined
  try {
    return new URL(rawUrl, 'http://orygin.internal').searchParams.get('access_token') ?? undefined
  } catch {
    return undefined
  }
}

async function authenticateToken(token: string): Promise<boolean> {
  const supabase = getSupabaseClient()
  if (supabase === undefined) return false
  const { error } = await supabase.auth.getUser(token)
  return error === null
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
