/**
 * Signed Railway-to-Cloudflare control plane for isolated Orygin workspaces.
 */

import { getSandbox, type DirectoryBackup, type Sandbox as SandboxType } from '@cloudflare/sandbox'

export { Sandbox } from '@cloudflare/sandbox'

const WORKSPACE_ROOT = '/workspace'
const MAX_BODY_BYTES = 10 * 1024 * 1024
const MAX_OUTPUT_CHARS = 1024 * 1024
const MAX_EXEC_TIMEOUT_MS = 5 * 60 * 1000
const SIGNATURE_MAX_AGE_MS = 30_000

interface DurableObjectIdLike {}
interface DurableObjectStubLike {
  fetch(input: string | Request, init?: RequestInit): Promise<Response>
}
interface DurableObjectNamespaceLike<T = unknown> {
  idFromName(name: string): DurableObjectIdLike
  get(id: DurableObjectIdLike): DurableObjectStubLike & T
}
interface DurableObjectTransactionLike {
  get(key: string): Promise<unknown>
  put(key: string, value: unknown): Promise<void>
}
interface DurableObjectStorageLike {
  transaction<T>(operation: (transaction: DurableObjectTransactionLike) => Promise<T>): Promise<T>
  setAlarm(scheduledTime: number): Promise<void>
  deleteAll(): Promise<void>
}
interface DurableObjectStateLike {
  storage: DurableObjectStorageLike
}

interface Env {
  readonly Sandbox: Parameters<typeof getSandbox>[0]
  readonly CONTROL_NONCES: DurableObjectNamespaceLike
  readonly SANDBOX_CONTROL_SECRET?: string
  readonly SANDBOX_ID_SECRET?: string
}

interface WorkspaceScope {
  readonly tenantId: string
  readonly workspaceId: string
}

interface ControlPayload extends WorkspaceScope {
  readonly action: 'ensure' | 'exec' | 'readFile' | 'writeFile' | 'listFiles' | 'checkpoint' | 'restore' | 'destroy'
  readonly path?: string
  readonly command?: string
  readonly cwd?: string
  readonly timeoutMs?: number
  readonly content?: string
  readonly encoding?: 'utf8' | 'base64'
  readonly recursive?: boolean
  readonly backup?: DirectoryBackup
  readonly retentionDays?: number
}

/** Durable replay fence: one object per HMAC nonce. */
export class ControlNonceStore {
  constructor(private readonly state: DurableObjectStateLike) {}

  async fetch(request: Request): Promise<Response> {
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 })
    const accepted = await this.state.storage.transaction(async (transaction) => {
      if (await transaction.get('seen') === true) return false
      await transaction.put('seen', true)
      return true
    })
    if (!accepted) return new Response('Conflict', { status: 409 })
    await this.state.storage.setAlarm(Date.now() + SIGNATURE_MAX_AGE_MS * 2)
    return new Response(null, { status: 204 })
  }

  async alarm(): Promise<void> {
    await this.state.storage.deleteAll()
  }
}

const worker = {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    if (request.method === 'GET' && url.pathname === '/health/live') {
      return Response.json({ status: 'ok' }, { headers: noStoreHeaders() })
    }
    if (request.method !== 'POST' || url.pathname !== '/v1/workspace') {
      return apiError(404, 'resource-not-found', 'Resource not found')
    }

    const body = await readBoundedBody(request)
    if (body === undefined) return apiError(413, 'invalid-request', 'Request body is too large')
    const controlSecret = env.SANDBOX_CONTROL_SECRET
    const sandboxIdSecret = env.SANDBOX_ID_SECRET
    if (controlSecret === undefined || controlSecret.length < 32
      || sandboxIdSecret === undefined || sandboxIdSecret.length < 32) {
      return apiError(503, 'sandbox-unavailable', 'Sandbox control is not configured')
    }
    if (!(await authenticateControlRequest(request, env.CONTROL_NONCES, controlSecret, body))) {
      return apiError(401, 'auth-required', 'Authentication required')
    }

    let payload: ControlPayload
    try {
      payload = parsePayload(JSON.parse(body))
    } catch (error) {
      return apiError(400, 'invalid-request', error instanceof Error ? error.message : 'Invalid request')
    }

    try {
      const sandboxId = await opaqueSandboxId(payload, sandboxIdSecret)
      const sandbox = getSandbox(env.Sandbox, sandboxId, {
        sleepAfter: '10m',
        keepAlive: false,
        normalizeId: true,
        transport: 'rpc',
      })

      switch (payload.action) {
        case 'ensure':
          await sandbox.mkdir(WORKSPACE_ROOT, { recursive: true })
          return apiResult({ status: 'ready' })
        case 'exec': {
          const cwd = workspacePath(payload.cwd ?? WORKSPACE_ROOT)
          await assertExistingWorkspacePath(sandbox, cwd)
          const result = await sandbox.exec(requireString(payload.command, 'command'), {
            cwd,
            timeout: boundedTimeout(payload.timeoutMs),
            env: {},
          })
          return apiResult({
            success: result.success,
            exitCode: result.exitCode,
            stdout: boundedOutput(result.stdout),
            stderr: boundedOutput(result.stderr),
          })
        }
        case 'readFile': {
          const path = workspacePath(payload.path)
          const safePath = await assertExistingWorkspacePath(sandbox, path)
          const result = await sandbox.readFile(safePath, { encoding: payload.encoding ?? 'utf8' })
          if (result.content.length > MAX_OUTPUT_CHARS) {
            return apiError(413, 'output-limit', 'File exceeds the response limit')
          }
          return apiResult({
            content: result.content,
            encoding: result.encoding,
            mediaType: result.mimeType,
            size: result.size,
          })
        }
        case 'writeFile': {
          const path = workspacePath(payload.path)
          await assertExistingWorkspacePath(sandbox, parentPath(path))
          const content = requireString(payload.content, 'content')
          if (content.length > MAX_BODY_BYTES) throw new Error('content exceeds the write limit')
          await sandbox.writeFile(path, content, { encoding: payload.encoding ?? 'utf8' })
          return apiResult({ written: true })
        }
        case 'listFiles': {
          const path = workspacePath(payload.path ?? WORKSPACE_ROOT)
          const safePath = await assertExistingWorkspacePath(sandbox, path)
          const result = await sandbox.listFiles(safePath, {
            recursive: payload.recursive === true,
            includeHidden: true,
          })
          return apiResult({
            files: result.files.map(file => ({
              name: file.name,
              path: file.absolutePath,
              type: file.type,
              size: file.size,
              modifiedAt: file.modifiedAt,
            })),
          })
        }
        case 'checkpoint': {
          const retentionDays = boundedRetentionDays(payload.retentionDays)
          const backup = await sandbox.createBackup({
            dir: WORKSPACE_ROOT,
            gitignore: true,
            ttl: retentionDays * 24 * 60 * 60,
            excludes: ['node_modules', '.cache', 'dist'],
          })
          return apiResult({ backup })
        }
        case 'restore': {
          if (payload.backup === undefined || payload.backup.dir !== WORKSPACE_ROOT) {
            throw new Error('a /workspace backup handle is required')
          }
          const result = await sandbox.restoreBackup(payload.backup)
          return apiResult({ restored: result.success, backupId: result.id })
        }
        case 'destroy':
          await sandbox.destroy()
          return apiResult({ destroyed: true })
      }
    } catch (error) {
      console.error(JSON.stringify({
        event: 'sandbox_control_failed',
        action: payload.action,
        tenantHash: await shortHash(payload.tenantId),
        workspaceHash: await shortHash(payload.workspaceId),
        message: error instanceof Error ? error.message : 'unknown error',
      }))
      return apiError(503, 'sandbox-unavailable', 'Sandbox operation failed')
    }
  },
}

async function authenticateControlRequest(
  request: Request,
  nonces: DurableObjectNamespaceLike,
  controlSecret: string,
  body: string,
): Promise<boolean> {
  const timestamp = request.headers.get('x-orygin-timestamp')
  const nonce = request.headers.get('x-orygin-nonce')
  const signature = request.headers.get('x-orygin-signature')
  if (timestamp === null || nonce === null || signature === null || nonce.length < 16) return false
  const issuedAt = Number(timestamp)
  if (!Number.isSafeInteger(issuedAt) || Math.abs(Date.now() - issuedAt) > SIGNATURE_MAX_AGE_MS) return false

  const canonical = [
    request.method,
    new URL(request.url).pathname,
    timestamp,
    nonce,
    await sha256(body),
  ].join('\n')
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(controlSecret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['verify'],
  )
  let signatureBytes: Uint8Array
  try {
    signatureBytes = fromBase64Url(signature)
  } catch {
    return false
  }
  const valid = await crypto.subtle.verify(
    'HMAC',
    key,
    new Uint8Array(signatureBytes).buffer,
    new TextEncoder().encode(canonical),
  )
  if (!valid) return false
  const nonceId = nonces.idFromName(nonce)
  const replay = await nonces.get(nonceId).fetch('https://nonce.internal/', { method: 'POST' })
  return replay.ok
}

async function opaqueSandboxId(scope: WorkspaceScope, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const digest = await crypto.subtle.sign(
    'HMAC',
    key,
    new TextEncoder().encode(`${scope.tenantId}:${scope.workspaceId}`),
  )
  return `ows-${base64Url(new Uint8Array(digest)).slice(0, 48)}`
}

function parsePayload(value: unknown): ControlPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new Error('JSON object required')
  const input = value as Record<string, unknown>
  const tenantId = requireString(input.tenantId, 'tenantId')
  const workspaceId = requireString(input.workspaceId, 'workspaceId')
  const action = requireString(input.action, 'action')
  const actions = new Set<ControlPayload['action']>([
    'ensure', 'exec', 'readFile', 'writeFile', 'listFiles', 'checkpoint', 'restore', 'destroy',
  ])
  if (!actions.has(action as ControlPayload['action'])) throw new Error('unsupported action')
  return { ...input, tenantId, workspaceId, action } as unknown as ControlPayload
}

function workspacePath(value: unknown): string {
  const requested = value === undefined ? WORKSPACE_ROOT : requireString(value, 'path')
  if (requested.includes('\\') || requested.includes('\0')) throw new Error('invalid workspace path')
  const absolute = requested.startsWith('/') ? requested : `${WORKSPACE_ROOT}/${requested}`
  const segments = absolute.split('/')
  if (segments.some(segment => segment === '..')) throw new Error('path traversal is forbidden')
  const normalized = '/' + segments.filter(segment => segment !== '' && segment !== '.').join('/')
  if (normalized !== WORKSPACE_ROOT && !normalized.startsWith(`${WORKSPACE_ROOT}/`)) {
    throw new Error('path must remain under /workspace')
  }
  return normalized
}

async function assertExistingWorkspacePath(
  sandbox: SandboxType,
  path: string,
): Promise<string> {
  const result = await sandbox.exec(`realpath -e -- ${shellQuote(path)}`, {
    cwd: WORKSPACE_ROOT,
    timeout: 5_000,
    env: {},
  })
  const realPath = result.stdout.trim()
  if (!result.success || (realPath !== WORKSPACE_ROOT && !realPath.startsWith(`${WORKSPACE_ROOT}/`))) {
    throw new Error('workspace path does not exist or escapes its root')
  }
  return realPath
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`
}

function parentPath(path: string): string {
  const slash = path.lastIndexOf('/')
  return slash <= 0 ? WORKSPACE_ROOT : path.slice(0, slash)
}

function requireString(value: unknown, name: string): string {
  if (typeof value !== 'string' || value === '') throw new Error(`${name} must be a non-empty string`)
  return value
}

function boundedTimeout(value: number | undefined): number {
  if (value === undefined) return 60_000
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error('timeoutMs must be a positive integer')
  return Math.min(value, MAX_EXEC_TIMEOUT_MS)
}

function boundedRetentionDays(value: number | undefined): number {
  if (value === undefined) return 7
  if (!Number.isSafeInteger(value) || value < 1 || value > 180) {
    throw new Error('retentionDays must be between 1 and 180')
  }
  return value
}

function boundedOutput(value: string): string {
  return value.length <= MAX_OUTPUT_CHARS
    ? value
    : `${value.slice(0, MAX_OUTPUT_CHARS)}\n[output truncated]`
}

async function readBoundedBody(request: Request): Promise<string | undefined> {
  const declared = Number(request.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) return undefined
  const body = await request.text()
  return new TextEncoder().encode(body).byteLength <= MAX_BODY_BYTES ? body : undefined
}

function apiResult(value: unknown): Response {
  return Response.json({ ok: true, value }, { headers: noStoreHeaders() })
}

function apiError(status: number, code: string, message: string): Response {
  return Response.json({ ok: false, error: { code, message } }, {
    status,
    headers: noStoreHeaders(),
  })
}

function noStoreHeaders(): HeadersInit {
  return {
    'cache-control': 'no-store',
    'content-security-policy': "default-src 'none'; frame-ancestors 'none'",
    'x-content-type-options': 'nosniff',
  }
}

async function sha256(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value))
  return [...new Uint8Array(digest)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}

async function shortHash(value: string): Promise<string> {
  return (await sha256(value)).slice(0, 16)
}

function base64Url(bytes: Uint8Array): string {
  let binary = ''
  for (const value of bytes) binary += String.fromCharCode(value)
  return btoa(binary).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function fromBase64Url(value: string): Uint8Array {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const binary = atob(normalized)
  return Uint8Array.from(binary, character => character.charCodeAt(0))
}

export default worker
