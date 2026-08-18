/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-turn-loss-notice`.
 * @module @deepseek-ai/dsh-turn-loss-notice/invariant
 */

/* jscpd:ignore-start */
import type { Context } from '@deepseek-ai/cordis'
import type { InvariantInstaller } from '@deepseek-ai/dsh-invariants'

const PACKAGE_NAME = '@deepseek-ai/dsh-turn-loss-notice'

/** Cordis companion plugin name. */
export const name = 'turn-loss-notice-invariant'
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants']

/**
 * No runtime invariant: the notice is a stateless pre-step derivation over the
 * session log and exposes no package-owned event or snapshot that an
 * independent companion can observe.
 */
const install: InvariantInstaller = () => {}

/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx: Context): Promise<() => void> =>
  Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install))
/* jscpd:ignore-end */
