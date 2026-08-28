/** Supabase-backed tenant resource authorization. @module @orygin-ai/dsh-authorization-supabase */

import { Context } from '@orygin-ai/cordis'
import {
  ResourceAuthorizationService,
  type AuthPrincipal,
  type AuthorizedResourceKind,
  type ResourceAction,
} from '@orygin-ai/dsh-request-context'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

/** Server-only transport used by the authorization provider. */
export interface SupabaseAuthorizationTransport {
  readonly url: string
  readonly serviceRoleKey: string
  readonly fetch: typeof globalThis.fetch
}

/** Stable Cordis plugin name. */
export const name = 'authorization-supabase'

/** No service prerequisites; the implementation supplies `ctx.resourceAuthorization`. */
export const inject: string[] = []

/** Fail-closed Supabase implementation of tenant resource authorization. */
export class SupabaseResourceAuthorization extends ResourceAuthorizationService {
  /**
   * @param ctx - host context receiving the authorization service.
   * @param config - validated server-only Supabase transport.
   */
  constructor(ctx: Context, private readonly config: SupabaseAuthorizationTransport) {
    super(ctx)
  }

  /** @inheritdoc */
  async authorize(
    principal: AuthPrincipal,
    kind: AuthorizedResourceKind,
    resourceId: string,
    action: ResourceAction,
  ): Promise<boolean> {
    assertUuid(principal.tenantId, 'tenantId')
    assertUuid(principal.userId, 'userId')
    assertUuid(resourceId, 'resourceId')
    let response: Response
    try {
      response = await this.config.fetch(
        new URL('/rest/v1/rpc/authorize_tenant_resource', this.config.url),
        {
          method: 'POST',
          headers: {
            apikey: this.config.serviceRoleKey,
            authorization: `Bearer ${this.config.serviceRoleKey}`,
            'content-type': 'application/json',
          },
          body: JSON.stringify({
            p_tenant_id: principal.tenantId,
            p_user_id: principal.userId,
            p_resource_kind: kind,
            p_resource_id: resourceId,
            p_action: action,
          }),
        },
      )
    } catch (cause) {
      throw new Error('Supabase authorization transport failed', { cause })
    }
    if (!response.ok) throw new Error(`Supabase authorization failed with HTTP ${String(response.status)}`)
    const decision: unknown = await response.json()
    if (typeof decision !== 'boolean') throw new Error('Supabase authorization returned an invalid decision')
    return decision
  }
}

/**
 * Mount the cloud provider from server-only environment variables.
 * @param ctx - host context receiving the authorization service.
 */
export function apply(ctx: Context): void {
  if (process.env.ORYGIN_SAAS_PROFILE !== '1') return
  const url = requiredEnvironment('SUPABASE_URL')
  const serviceRoleKey = requiredEnvironment('SUPABASE_SERVICE_ROLE_KEY')
  if (url === undefined || serviceRoleKey === undefined) {
    throw new Error('Supabase authorization environment is incomplete')
  }
  new SupabaseResourceAuthorization(ctx, { url, serviceRoleKey, fetch: globalThis.fetch })
}

function assertUuid(value: string, label: string): void {
  if (!UUID_PATTERN.test(value)) throw new Error(`${label} must be a UUID`)
}

function requiredEnvironment(name: string): string | undefined {
  const value = process.env[name]
  return value === undefined || value === '' ? undefined : value
}

export default SupabaseResourceAuthorization
