/** Host HTTP bridge for browser-client RPC. */
import type { Context } from '@orygin-ai/cordis'
import z from '@orygin-ai/schemastery'
import type {} from '@orygin-ai/dsh-attachment'
// Activates the webServer Context merge used below.
import type { WebRoute, WebUpgradeRoute } from '@orygin-ai/dsh-host-webserver'
import { toFetchHandler } from '@orygin-ai/dsh-host-apiproxy'
import { API_PATH, HOST_EVENTS_PATH, MUX_EVENTS_PATH } from './api-path.ts'
import { bridge, DEFAULT_MAX_REQUEST_BODY_BYTES } from './http-bridge.ts'
import { assertTrustedAuthority, isTrustedApiRequest } from './api-request-trust.ts'
import { HostConnectionService } from './rpc-host.ts'
import { rejectWebSocketUpgrade, WebSocketDownlinks } from './websocket-downlink.ts'
import { authenticateFetchRequest, authenticateNodeRequest, supabaseAuthRequired } from './auth.ts'
import type { AuthPrincipal } from './auth.ts'
import { withAuthPrincipal } from './request-context.ts'
import { handlePaddleWebhook, paddleWebhookConfigured } from './paddle-webhook.ts'

export type {
  ConnectionRpcAuthority,
  ConnectionRpcEndpointMatcher,
  ConnectionRpcHandler,
  ConnectionRpcHandlerOptions,
  HostConnectionHandle,
  HostConnectionRpc,
} from './rpc.ts'
export { HostConnectionService } from './rpc-host.ts'
export { currentAuthPrincipal, requireAuthPrincipal } from './request-context.ts'
export type { AuthPrincipal, AuthRole, RequestContext } from './auth.ts'

export { API_PATH, HOST_EVENTS_PATH, MUX_EVENTS_PATH } from './api-path.ts'

/** Stable Cordis plugin name. */
export const name = 'client-connection'

/** Headroom for RPC JSON fields around aggregate base64 image payloads. */
const REQUEST_ENVELOPE_HEADROOM_BYTES = 1024 * 1024
const SAAS_PROFILE_ENV = 'ORYGIN_SAAS_PROFILE'
const CLOUD_EXECUTION_READY_ENV = 'ORYGIN_CLOUD_EXECUTION_READY'
const CLOUD_WORKSPACE_API_READY_ENV = 'ORYGIN_CLOUD_WORKSPACE_API_READY'

const CLOUD_EXECUTION_METHODS = new Set([
  'session.create',
  'session.prompt',
  'session.fork',
  'subagent.prompt',
  'goal.create',
  'goal.resume',
  'workspace.create',
])

function assertImageBodyCapacity(ctx: Context, maxRequestBodyBytes: number): void {
  const attachments = ctx.get('attachments')
  if (attachments === undefined) return
  const requiredImageBodyBytes = Math.ceil(
    attachments.imageLimits.maxMessageImageBytes * 4 / 3,
  ) + REQUEST_ENVELOPE_HEADROOM_BYTES
  if (maxRequestBodyBytes < requiredImageBodyBytes) {
    throw new Error(
      `client-connection maxRequestBodyBytes (${String(maxRequestBodyBytes)}) must be at least `
      + `${String(requiredImageBodyBytes)} for the configured aggregate image limit`,
    )
  }
}

/** Services required before providing Connection; API Proxy is an optional `/api` fallback. */
export const inject = ['webServer']

/** Plugin config: the deployment's non-loopback serving authorities. */
export interface ConnectionConfig {
  /**
   * Authorities this deployment serves beyond loopback: exact `host:port`, or
   * port-less `host` matching any port. The /api trust fence refuses any
   * request whose Host is neither loopback nor listed here, so a
   * non-loopback (`0.0.0.0`) deployment must declare the names it is reached
   * by (the dsh CLI derives the machine's LAN IP literals itself). An entry
   * that is not a bare, canonical authority fails the plugin load.
   */
  trustedHosts?: string[]
  /** Maximum buffered JSON body for every `/api` request. Default: 300 MiB. */
  maxRequestBodyBytes?: number
}

export const Config: z<ConnectionConfig> = z.object({
  trustedHosts: z.array(String).default([]),
  maxRequestBodyBytes: z.natural().min(1).default(DEFAULT_MAX_REQUEST_BODY_BYTES),
})

/**
 * Methods gated to loopback even on a trusted-host deployment. Native dialogs
 * act on the host machine; the settings and credential domains mutate the
 * user's configuration and secret store, and READING them is equally
 * privileged — `settings.describe` returns every exposed namespace's
 * configuration and `credentials.describe` reports whether an arbitrary
 * environment-variable name is configured and where from, which is
 * reconnaissance no anonymous caller should have. `trustedHosts` is a
 * DNS-rebinding fence, explicitly not authentication, so the whole
 * configuration plane stays loopback-same-origin until a real authentication
 * layer exists. `llm.discoverModels` belongs to that plane on both counts: it
 * carries a draft credential, and it makes the HOST issue a GET to a URL the
 * caller chose and reports back the status or the parsed body — an anonymous
 * LAN caller would have a probe for whatever the host can reach and the
 * browser cannot.
 *
 * The model catalog (`llm.providers`, `llm.models`) is deliberately NOT here:
 * it carries provider ids, display names, and model lists — no endpoints,
 * keys, or key state — and a LAN client's model picker legitimately needs it.
 */
const PRIVILEGED_METHODS = new Set([
  // A preset composition names the plugins a session runs, so reading one is
  // reconnaissance; copy and remove rearrange what the deployment offers, and
  // openDocument drives the host desktop — all more than the roster beside
  // them. (Authoring is copy-only, so no method here accepts composition text
  // or a path; the pin is about who may manage the roster at all.)
  //
  // CHOOSING one is not pinned, and `agentPreset.list` is not either. Picking a
  // preset looks like escalation — one of them mounts the toolset that edits the
  // live runtime — but `session.create` already takes an `agentPreset`, so
  // pinning only the switch would leave the same capability one method over.
  // The deeper reason is that the capability is not the preset's to grant: the
  // deployment's own default already carries `bash` and the filesystem tools, so
  // any caller that may start a session at all can already run commands as this
  // process. Pinning the switch would be a fence beside an open gate.
  'agentPreset.read',
  'agentPreset.copy',
  'agentPreset.openDocument',
  'agentPreset.remove',
  'host.pickDirectory',
  'host.openPath',
  'settings.describe',
  'settings.openDocument',
  'settings.update',
  'settings.replace',
  'settings.mutate',
  'credentials.describe',
  'credentials.set',
  'credentials.unset',
  'llm.discoverModels',
])

/**
 * Mounts the API gateway under the browser transport prefix. Every request on
 * the prefix passes the browser-trust fence first (DNS-rebinding and
 * cross-site defense — [api-request-trust](./api-request-trust.ts));
 * privileged methods additionally pass it with an empty trust list, which
 * pins them to loopback.
 * @param ctx - Host plugin context.
 * @param config - resolved plugin config (schema defaults applied).
 */
export function apply(ctx: Context, config?: ConnectionConfig): void {
  // The Loader resolves schema defaults; hand-built test contexts may pass none.
  const trustedHosts = config?.trustedHosts ?? []
  const maxRequestBodyBytes = config?.maxRequestBodyBytes ?? DEFAULT_MAX_REQUEST_BODY_BYTES
  // Config boundary: a malformed entry fails the load loudly here rather than
  // silently authorizing its hostname prefix at request time.
  for (const entry of trustedHosts) assertTrustedAuthority(entry)
  if (ctx.get('apiProxy') !== undefined) assertImageBodyCapacity(ctx, maxRequestBodyBytes)
  const connection = new HostConnectionService(ctx, trustedHosts)
  const liveRoute: WebRoute = {
    kind: 'exact',
    path: '/health/live',
    handler: (_req, res) => {
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' })
      res.end('{"status":"ok"}')
    },
  }
  const readyRoute: WebRoute = {
    kind: 'exact',
    path: '/health/ready',
    handler: (_req, res) => {
      const missing = readinessFailures()
      res.writeHead(missing.length === 0 ? 200 : 503, {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      })
      res.end(JSON.stringify({ status: missing.length === 0 ? 'ready' : 'not-ready', missing }))
    },
  }
  const paddleWebhookRoute: WebRoute = {
    kind: 'exact',
    path: '/webhooks/paddle',
    handler: (req, res) => handlePaddleWebhook(req, res),
  }
  ctx.effect(() => ctx.webServer.register(liveRoute), 'client-connection: live health route')
  ctx.effect(() => ctx.webServer.register(readyRoute), 'client-connection: ready health route')
  ctx.effect(() => ctx.webServer.register(paddleWebhookRoute), 'client-connection: Paddle webhook route')
  const fetchHandler = connection.createSharedFetchHandler(API_PATH, {
    async fetch(request) {
      const principal = await authenticateFetchRequest(request)
      if (principal === undefined) {
        return new Response('unauthorized', {
          status: 401,
          headers: { 'www-authenticate': 'Bearer' },
        })
      }
      return withAuthPrincipal(principal, () => {
        const pathname = new URL(request.url).pathname
        const method = pathname.startsWith(`${API_PATH}/`)
          ? pathname.slice(API_PATH.length + 1)
          : undefined
        if (process.env[SAAS_PROFILE_ENV] === '1'
          && method !== undefined
          && PRIVILEGED_METHODS.has(method)) {
          return new Response('not found', { status: 404 })
        }
        if (process.env[SAAS_PROFILE_ENV] === '1'
          && process.env[CLOUD_EXECUTION_READY_ENV] !== '1'
          && method !== undefined
          && CLOUD_EXECUTION_METHODS.has(method)) {
          return Response.json({
            code: 'sandbox-unavailable',
            message: 'Cloud workspace execution is not enabled',
          }, { status: 503 })
        }
        if (process.env[SAAS_PROFILE_ENV] === '1'
          && process.env[CLOUD_WORKSPACE_API_READY_ENV] !== '1'
          && method?.startsWith('workspace.') === true) {
          return Response.json({
            code: 'sandbox-unavailable',
            message: 'Tenant-scoped cloud workspaces are not enabled',
          }, { status: 503 })
        }
        if (method !== undefined
          && PRIVILEGED_METHODS.has(method)
          && !isTrustedApiRequest(request, [])) {
          return new Response('forbidden', { status: 403 })
        }
        if (request.method === 'GET' && (pathname === MUX_EVENTS_PATH || pathname === HOST_EVENTS_PATH)) {
          return new Response('upgrade required', {
            status: 426,
            headers: { connection: 'Upgrade', upgrade: 'websocket' },
          })
        }
        const apiProxy = ctx.get('apiProxy')
        if (apiProxy === undefined) return new Response('not found', { status: 404 })
        return toFetchHandler(apiProxy).fetch(request)
      })
    },
  })
  const route: WebRoute = {
    kind: 'prefix',
    path: API_PATH,
    handler: async (req, res) => {
      if (!isTrustedApiRequest(req, trustedHosts)) {
        res.writeHead(403)
        res.end('forbidden')
        return
      }
      const principal = await authenticateNodeRequest(req)
      if (principal === undefined) {
        res.writeHead(401, { 'www-authenticate': 'Bearer' })
        res.end('unauthorized')
        return
      }
      await withAuthPrincipal(principal, () => bridge(req, res, fetchHandler, maxRequestBodyBytes))
    },
  }
  ctx.effect(() => ctx.webServer.register(route), 'client-connection: /api route')
  ctx.inject(['apiProxy'], (apiCtx) => {
    assertImageBodyCapacity(apiCtx, maxRequestBodyBytes)
    const downlinks = new WebSocketDownlinks(apiCtx.apiProxy)
    const registerDownlink = (
      path: string,
      handle: (
        req: Parameters<WebUpgradeRoute['handler']>[0],
        socket: Parameters<WebUpgradeRoute['handler']>[1],
        head: Parameters<WebUpgradeRoute['handler']>[2],
        principal: AuthPrincipal,
      ) => void | Promise<void>,
    ): void => {
      apiCtx.effect(() => apiCtx.webServer.registerUpgrade({
        path,
        handler: async (req, socket, head) => {
          if (!isTrustedApiRequest(req, trustedHosts)) {
            rejectWebSocketUpgrade(socket)
            return
          }
          const principal = await authenticateNodeRequest(req)
          if (principal === undefined) {
            rejectWebSocketUpgrade(socket)
            return
          }
          return withAuthPrincipal(principal, () => handle(req, socket, head, principal))
        },
      }), `client-connection: ${path} WebSocket`)
    }
    apiCtx.effect(() => () => downlinks.close(), 'client-connection: WebSocket downlinks')
    registerDownlink(MUX_EVENTS_PATH, (req, socket, head, principal) => {
      downlinks.handleMux(req, socket, head, principal)
    })
    registerDownlink(HOST_EVENTS_PATH, (req, socket, head, principal) => {
      downlinks.handleHost(req, socket, head, principal)
    })
  })
}

function readinessFailures(): string[] {
  const missing: string[] = []
  if (supabaseAuthRequired()) {
    if (!process.env.SUPABASE_URL) missing.push('supabase-url')
    if (!process.env.SUPABASE_PUBLISHABLE_KEY) missing.push('supabase-publishable-key')
  }
  if (process.env[SAAS_PROFILE_ENV] === '1') {
    if ((process.env.ORYGIN_EDGE_IDENTITY_SECRET?.length ?? 0) < 32) missing.push('edge-identity-secret')
    if (!process.env.SUPABASE_SERVICE_ROLE_KEY) missing.push('supabase-service-role-key')
    if (process.env[CLOUD_EXECUTION_READY_ENV] !== '1') missing.push('cloud-execution')
    if (process.env[CLOUD_WORKSPACE_API_READY_ENV] !== '1') missing.push('cloud-workspace-api')
    if (process.env.PADDLE_CHECKOUT === '1' && !paddleWebhookConfigured()) missing.push('paddle-webhook')
  }
  return missing
}
