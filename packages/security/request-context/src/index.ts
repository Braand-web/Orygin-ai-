/** Server-authoritative identity propagation for multi-tenant Orygin work. */

import { AsyncLocalStorage } from 'node:async_hooks'
import { Context, Service } from '@orygin-ai/cordis'

/** Roles resolved by the server from active tenant membership. */
export type AuthRole = 'owner' | 'admin' | 'support'

/** Authenticated identity propagated through every cloud operation. */
export interface AuthPrincipal {
  readonly userId: string
  readonly tenantId: string
  readonly authSessionId: string
  readonly roles: readonly AuthRole[]
  readonly emailVerified: boolean
}

/** Request-scoped security metadata; raw IP and user-agent values never enter it. */
export interface RequestContext {
  readonly principal: AuthPrincipal
  readonly requestId: string
  readonly ipHash: string
  readonly userAgentHash: string
}

/** Resource families protected by the central cloud authorization service. */
export type AuthorizedResourceKind = 'workspace' | 'session' | 'run' | 'credential'

/** Operations evaluated without revealing whether a denied resource exists. */
export type ResourceAction = 'read' | 'write' | 'delete' | 'execute'

declare module '@orygin-ai/cordis' {
  interface Context {
    resourceAuthorization: ResourceAuthorizationService
  }
}

/** Server-only ownership checks for cold or database-backed tenant resources. */
export abstract class ResourceAuthorizationService extends Service {
  /**
   * Register the central authorization capability.
   * @param ctx - host context receiving `ctx.authorization`.
   */
  constructor(ctx: Context) {
    super(ctx, 'resourceAuthorization')
  }

  /**
   * Decide whether a verified principal may address one resource.
   * @param principal - server-derived tenant membership.
   * @param kind - resource family being addressed.
   * @param resourceId - opaque UUID supplied as an address, never as authority.
   * @param action - requested operation.
   * @returns `true` only when active ownership and membership both hold.
   */
  abstract authorize(
    principal: AuthPrincipal,
    kind: AuthorizedResourceKind,
    resourceId: string,
    action: ResourceAction,
  ): Promise<boolean>
}

/** Explicit non-billable identity used only when cloud authentication is disabled. */
export const LOCAL_AUTH_PRINCIPAL: AuthPrincipal = Object.freeze({
  userId: 'local',
  tenantId: 'local',
  authSessionId: 'local',
  roles: Object.freeze(['owner'] as const),
  emailVerified: true,
})

const principalStorage = new AsyncLocalStorage<AuthPrincipal>()

/**
 * Run one operation and all asynchronous descendants as a verified principal.
 * @param principal - server-derived identity.
 * @param operation - work inheriting the identity.
 * @returns the operation's exact return value.
 */
export function withAuthPrincipal<T>(principal: AuthPrincipal, operation: () => T): T {
  return principalStorage.run(principal, operation)
}

/**
 * Read the principal for the active host operation, when one exists.
 * @returns the verified principal or `undefined` outside an authenticated scope.
 */
export function currentAuthPrincipal(): AuthPrincipal | undefined {
  return principalStorage.getStore()
}

/**
 * Require a verified principal at a cloud authorization boundary.
 * @returns the verified principal for the active operation.
 */
export function requireAuthPrincipal(): AuthPrincipal {
  const principal = currentAuthPrincipal()
  if (principal === undefined) throw new Error('authenticated request context is required')
  return principal
}
