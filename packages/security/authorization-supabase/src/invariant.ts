/** Package invariant companion. @module @orygin-ai/dsh-authorization-supabase/invariant */

/* jscpd:ignore-start */
import type { Context } from '@orygin-ai/cordis'
import type { InvariantInstaller } from '@orygin-ai/dsh-invariants'

const PACKAGE_NAME = '@orygin-ai/dsh-authorization-supabase'
/** Cordis companion plugin name. */
export const name = 'authorization-supabase-invariant'
/** Services required before package ownership can be reserved. */
export const inject = ['invariants', 'resourceAuthorization']
/** PostgreSQL membership and ownership checks are tested transactionally. */
const install: InvariantInstaller = () => {
  // No runtime invariant: PostgreSQL owns the authoritative membership and resource checks.
}
/**
 * Register this package's ownership.
 * @param ctx - context carrying the invariant service.
 * @returns the registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
