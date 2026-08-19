/**
 * Copying, reading, and deleting locally authored presets.
 *
 * Authoring is confined to a `user` root: the shipped `.system` set is part of
 * the deployment, and letting a browser rewrite it would turn "reset to a known
 * preset" into something the same caller could have broken first.
 *
 * The only authoring write is a whole-directory copy of an existing preset.
 * No caller supplies composition text: the inputs are ids the host resolves
 * against its own roots plus an optional display name, so authoring grants no
 * capability the copied preset did not already carry.
 * @module @deepseek-ai/dsh-agent-presets/authoring
 */

import { chmod, cp, readdir, readFile, rm, stat } from 'node:fs/promises'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { writeFileAtomic } from '@deepseek-ai/dsh-atomic-write'
import { entryListSchema } from '@deepseek-ai/cordis-plugin-include'
import { expandHomePath } from '@deepseek-ai/dsh-home-paths'
import yaml from 'js-yaml'
import { METADATA_FILE, renderPresetMetadata } from './metadata.ts'
import { PRESET_ID, type AgentPreset, type PresetRoot } from './preset.ts'

/** A preset id that cannot be used as a directory name under a root. */
export class InvalidPresetIdError extends Error {
  constructor(
    /** The rejected id. */
    readonly presetId: string,
  ) {
    super(
      `agent-presets: preset id ${JSON.stringify(presetId)} must match ${String(PRESET_ID)} — `
      + 'the id is a directory name, so anything else could escape the preset root',
    )
  }
}

/** A copy target that is already occupied — a copy never overwrites. */
export class PresetExistsError extends Error {
  constructor(
    /** The id that is already taken. */
    readonly presetId: string,
  ) {
    super(
      `agent-presets: preset "${presetId}" already exists — `
      + 'a copy never overwrites; delete the existing preset first or choose another id',
    )
  }
}

/** Authoring was attempted where the deployment allows none. */
export class PresetNotWritableError extends Error {
  constructor(
    /** What the caller tried to change, for the diagnostic. */
    readonly presetId: string,
    reason: string,
  ) {
    super(`agent-presets: preset "${presetId}" cannot be written: ${reason}`)
  }
}

/**
 * The root locally authored presets are written to.
 * @param roots - the configured roots in precedence order.
 * @returns the absolute path of the first `user` root.
 * @throws when the deployment configured no writable root.
 */
export function writableRoot(roots: readonly PresetRoot[]): string {
  const root = roots.find(candidate => candidate.trust === 'user')
  if (root === undefined) {
    throw new PresetNotWritableError('', 'this deployment configures no user-writable preset root')
  }
  return resolve(expandHomePath(root.path))
}

/**
 * Read one preset's composition text.
 * @param preset - the resolved preset.
 * @returns the file's contents.
 */
export async function readComposition(preset: AgentPreset): Promise<string> {
  return await readFile(preset.path, 'utf8')
}

/** Whether anything occupies the path (cp's own errorOnExist backstops races). */
async function occupied(path: string): Promise<boolean> {
  let present = true
  try {
    await stat(path)
  } catch {
    // Every stat failure means the same thing here: nothing usable occupies
    // the path, so the copy may claim it.
    present = false
  }
  return present
}

/**
 * Re-tighten a copied tree to owner-only. A shipped preset is world-readable
 * in its install and `cp` preserves that; the copy carries the same weight as
 * the settings document beside it, so group/other access is stripped. A
 * file's owner-execute bit survives — a preset may ship runnable helpers.
 */
async function tightenModes(dir: string): Promise<void> {
  await chmod(dir, 0o700)
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const target = join(dir, entry.name)
    if (entry.isDirectory()) {
      await tightenModes(target)
    } else {
      /* v8 ignore next -- Windows exposes no POSIX owner-execute bit; the POSIX lane covers both file modes. */
      await chmod(target, ((await stat(target)).mode & 0o100) === 0 ? 0o600 : 0o700)
    }
  }
}

/**
 * Create a preset by copying an existing one's whole directory.
 *
 * The copy carries everything the source directory holds — composition,
 * metadata, skill directories, assets — because a preset is its directory,
 * not one file. Symlinks are dereferenced so the copy is self-contained
 * rather than a set of links back into the install it was copied from.
 *
 * The copied metadata is then rewritten: the source's description is kept
 * (the file is the author's to edit afterwards), but its name and roster
 * `order` are not — a copy presenting itself identically to its source, or
 * sorted into the shipped set's declared order, would make the roster stop
 * distinguishing them. With no name given and no description to keep, the
 * file is removed so the copy publishes nothing rather than a blank.
 * @param roots - the configured roots; the first `user` one receives the copy.
 * @param source - the resolved preset the copy starts from.
 * @param id - the new preset's id, which becomes its directory name.
 * @param name - display name for the copy; omitted falls back to the id.
 * @returns the absolute path of the new preset directory.
 * @throws when the id is unusable or already occupied on disk, or the
 * deployment configures no writable root.
 */
export async function copyComposition(
  roots: readonly PresetRoot[],
  source: AgentPreset,
  id: string,
  name?: string,
): Promise<string> {
  if (!PRESET_ID.test(id)) throw new InvalidPresetIdError(id)
  const dir = join(writableRoot(roots), id)
  // The roster check upstream only sees discovered presets; a directory with
  // no composition file still occupies the name and deserves a readable
  // refusal rather than a filesystem error code.
  if (await occupied(dir)) throw new PresetExistsError(id)
  try {
    await cp(dirname(source.path), dir, {
      recursive: true, dereference: true, force: false, errorOnExist: true,
    })
    await tightenModes(dir)
    const rendered = renderPresetMetadata({
      ...name === undefined ? {} : { name },
      ...source.description === undefined ? {} : { description: source.description },
    })
    const metadataPath = join(dir, METADATA_FILE)
    if (rendered === undefined) {
      await rm(metadataPath, { force: true })
    } else {
      await writeFileAtomic(metadataPath, rendered, { mode: 0o600, dirMode: 0o700 })
    }
  } catch (error) {
    // A half-copied directory would be invisible to discovery at best and a
    // mountable-but-incomplete preset at worst; a failed copy leaves nothing.
    await rm(dir, { recursive: true, force: true })
    throw error
  }
  return dir
}

/**
 * Delete a locally authored preset.
 *
 * A shipped preset is refused: it belongs to the deployment. A preset a live
 * session mounted is NOT refused — the composition was read at creation and is
 * never re-read, so that session keeps running exactly as it was.
 * @param roots - the configured roots.
 * @param preset - the resolved preset to remove.
 * @throws when the preset ships with the deployment or lies outside the writable root.
 */
export async function deleteComposition(
  roots: readonly PresetRoot[],
  preset: AgentPreset,
): Promise<void> {
  if (preset.trust !== 'user') {
    throw new PresetNotWritableError(preset.id, 'it ships with the deployment')
  }
  const dir = join(writableRoot(roots), preset.id)
  // Belt and braces over the id pattern: the resolved directory must still be
  // the one the writable root owns, whatever discovery reported.
  if (!isAbsolute(preset.path) || !preset.path.startsWith(dir)) {
    throw new PresetNotWritableError(preset.id, 'it does not live under the writable preset root')
  }
  await rm(dir, { recursive: true, force: true })
}

/**
 * Whether one parsed plugin row is a persona row.
 *
 * Matches an entry whose `id` is `'persona'` and whose `name` is
 * `'@deepseek-ai/dsh-persona'` or `'persona'`.
 */
function isPersonaRow(row: unknown): boolean {
  if (typeof row !== 'object' || row === null || Array.isArray(row)) return false
  const candidate = row as { id?: unknown; name?: unknown }
  return candidate.id === 'persona' && (candidate.name === '@deepseek-ai/dsh-persona' || candidate.name === 'persona')
}

/** Locate the persona plugin row across top-level and grouped entries. */
function findPersonaRow(rows: unknown[]): Record<string, unknown> | undefined {
  for (const row of rows) {
    if (isPersonaRow(row)) return row as Record<string, unknown>
    if (typeof row === 'object' && row !== null && (row as { group?: unknown }).group === true) {
      const config = (row as { config?: unknown }).config
      if (Array.isArray(config)) {
        const nested = findPersonaRow(config)
        if (nested !== undefined) return nested
      }
    }
  }
  return undefined
}

/**
 * Replace only the persona plugin row's `config.text` on a locally authored preset.
 *
 * This writes only the persona row's text configuration, never replacing or
 * authoring arbitrary composition rows.
 * @param preset - the resolved preset to modify.
 * @param text - the new persona text.
 * @throws when `text` is not a string, `preset` is not a user-trust preset, or
 * the preset has no persona row.
 */
export async function setPersonaText(preset: AgentPreset, text: string): Promise<void> {
  if (typeof text !== 'string') {
    throw new TypeError(`agent-presets: persona text must be a string, got ${typeof text}`)
  }
  if (preset.trust !== 'user') {
    throw new PresetNotWritableError(preset.id, 'it ships with the deployment')
  }
  const raw = await readFile(preset.path, 'utf8')
  let rows: unknown
  try {
    rows = yaml.load(raw, { schema: entryListSchema })
  } catch (error) {
    throw new Error(`agent-presets: preset "${preset.id}" composition is not valid YAML: ${String(error)}`, { cause: error })
  }
  if (!Array.isArray(rows)) {
    throw new Error(`agent-presets: preset "${preset.id}" has no persona row (expected a top-level list of plugin rows)`)
  }
  const personaRow = findPersonaRow(rows)
  if (personaRow === undefined) {
    throw new Error(`agent-presets: preset "${preset.id}" has no persona row (id: persona, name: @deepseek-ai/dsh-persona)`)
  }
  if (typeof personaRow.config !== 'object' || personaRow.config === null || Array.isArray(personaRow.config)) {
    personaRow.config = {}
  }
  (personaRow.config as Record<string, unknown>).text = text
  const dumped = yaml.dump(rows, { schema: entryListSchema, noRefs: true, lineWidth: -1 })
  await writeFileAtomic(preset.path, dumped, { mode: 0o600, dirMode: 0o700 })
}
