/**
 * Pure `@path` token helpers for cwd autocomplete. Listing I/O stays in the
 * controller so tests can exercise matching without touching the filesystem.
 * @module @deepseek-ai/dsh-tui/files
 */

/** One cwd-relative path row for the `@` overlay. */
export interface FileRow {
  readonly path: string
  readonly dir: boolean
}

/** The `@token` under the caret, if any. */
export interface AtToken {
  readonly start: number
  readonly end: number
  readonly query: string
}

/**
 * Find the `@path` token at `cursor`. The token starts at `@` after a start
 * or whitespace and runs through non-whitespace characters.
 * @param input - editor contents.
 * @param cursor - caret index.
 * @returns the token, or undefined when the caret is not in one.
 */
export function parseAtToken(input: string, cursor: number): AtToken | undefined {
  const at = Math.max(0, Math.min(cursor, input.length))
  const before = input.slice(0, at)
  const match = /(^|[\s])@([^\s]*)$/.exec(before)
  if (match === null || match.index === undefined) return undefined
  const atIndex = match.index + match[1]!.length
  let end = at
  while (end < input.length && !/\s/.test(input.charAt(end))) end += 1
  return { start: atIndex, end, query: input.slice(atIndex + 1, end) }
}

/**
 * Filter listed paths by the token query (prefix of the last segment).
 * @param rows - candidate paths.
 * @param query - text after `@`.
 * @returns matching rows in original order.
 */
export function filterFileRows(rows: readonly FileRow[], query: string): FileRow[] {
  const slash = query.lastIndexOf('/')
  const prefix = slash === -1 ? query : query.slice(slash + 1)
  const dir = slash === -1 ? '' : query.slice(0, slash + 1)
  return rows.filter(row => row.path.startsWith(dir) && row.path.slice(dir.length).startsWith(prefix))
}

/**
 * Replace the `@token` at `cursor` with `@completion`.
 * @param input - editor contents.
 * @param cursor - caret index.
 * @param completion - path including a trailing `/` for directories.
 * @returns the edited buffer, or undefined when no token is present.
 */
export function applyAtCompletion(input: string, cursor: number, completion: string): { input: string; cursor: number } | undefined {
  const token = parseAtToken(input, cursor)
  if (token === undefined) return undefined
  const next = `${input.slice(0, token.start)}@${completion}${input.slice(token.end)}`
  const caret = token.start + 1 + completion.length
  return { input: next, cursor: caret }
}

/**
 * Split a `@` query into the directory prefix and the basename filter.
 * @param query - text after `@`.
 * @returns directory relative to cwd and basename prefix.
 */
export function splitAtQuery(query: string): { dir: string; base: string } {
  const slash = query.lastIndexOf('/')
  if (slash === -1) return { dir: '', base: query }
  return { dir: query.slice(0, slash + 1), base: query.slice(slash + 1) }
}
