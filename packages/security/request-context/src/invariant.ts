/** Package invariant companion for the server request identity boundary. */

import type { Context } from '@orygin-ai/cordis'
import type { InvariantInstaller } from '@orygin-ai/dsh-invariants'

const PACKAGE_NAME = '@orygin-ai/dsh-request-context'

/** Cordis companion plugin name. */
export const name = 'request-context-invariant'
/** Service required before reserving package invariant ownership. */
export const inject = ['invariants']

const install: InvariantInstaller = () => {
  // No runtime invariant: AsyncLocalStorage owns one immutable principal per operation.
}

/** Register this package's invariant ownership. */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
