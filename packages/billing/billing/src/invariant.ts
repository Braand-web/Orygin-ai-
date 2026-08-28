/** Package invariant companion for the billing service definition. */

import type { Context } from '@orygin-ai/cordis'
import type { InvariantInstaller } from '@orygin-ai/dsh-invariants'

const PACKAGE_NAME = '@orygin-ai/dsh-billing'

/** Cordis companion plugin name. */
export const name = 'billing-invariant'
/** Service required before reserving package invariant ownership. */
export const inject = ['invariants']

/** Provider implementations enforce ledger invariants at their durable boundary. */
const install: InvariantInstaller = () => {
  // No runtime invariant: this package declares only the provider interface;
  // each durable provider owns its transaction and ledger relationships.
}

/** Register this package's invariant ownership. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
