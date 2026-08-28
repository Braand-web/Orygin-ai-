/** Package-owned invariant companion for the Supabase billing provider. @module @orygin-ai/dsh-billing-supabase/invariant */

/* jscpd:ignore-start */
import type { Context } from '@orygin-ai/cordis'
import type { InvariantInstaller } from '@orygin-ai/dsh-invariants'

const PACKAGE_NAME = '@orygin-ai/dsh-billing-supabase'
/** Cordis companion plugin name. */
export const name = 'billing-supabase-invariant'
/** Services required before package ownership can be reserved. */
export const inject = ['invariants', 'billing']
/** No runtime invariant: PostgreSQL functions and append-only tables enforce transactional ownership. */
const install: InvariantInstaller = () => {}
/**
 * Register the package invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the registration disposer.
 */
export const apply = (ctx: Context): Promise<() => void> => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
