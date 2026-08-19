/**
 * @deepseek-ai/dsh-macos-jsonrpc — macOS JSON-RPC bundle plugin.
 * The package's substance is `cordis.patch.yml`, declared by the
 * `dsh.bundle.patch` manifest field; this module is a named-export no-op plugin.
 *
 * @module @deepseek-ai/dsh-macos-jsonrpc
 */

import type { Context } from '@deepseek-ai/cordis'

/** Stable Cordis plugin name. */
export const name = 'macos-jsonrpc'

/**
 * Mount the macos-jsonrpc bundle plugin (no-op).
 * @param _ctx - Cordis context.
 */
export function apply(_ctx: Context): void {}
