/**
 * Crush command palette and slash-line routing over DSH `ctx.commands`.
 * Chrome commands (sessions, model, help, new, quit, interrupt) live here;
 * registered harness commands are merged at render time.
 * @module @deepseek-ai/dsh-tui/commands
 */

import { parseCommand, type CommandDescriptor } from '@deepseek-ai/dsh-commands'

/** One palette row: Crush chrome or a DSH-registered command. */
export interface PaletteItem {
  /** Stable id (`chrome:<name>` or `dsh:<name>`). */
  readonly id: string
  /** Slash name without the leading `/`. */
  readonly name: string
  /** Crush-style one-line description. */
  readonly description: string
  /** Palette group, matching Crush's System / chrome split. */
  readonly group: 'chrome' | 'system'
  /** Exact line dispatched when the row is selected. */
  readonly line: string
}

/** Crush chrome commands that the TUI owns (not the agent loop). */
export const CHROME_COMMANDS: readonly PaletteItem[] = [
  { id: 'chrome:help', name: 'help', description: 'Show keyboard shortcuts and commands', group: 'chrome', line: '/help' },
  { id: 'chrome:model', name: 'model', description: 'Switch the conversation model', group: 'chrome', line: '/model' },
  { id: 'chrome:sessions', name: 'sessions', description: 'Resume or switch sessions', group: 'chrome', line: '/sessions' },
  { id: 'chrome:new', name: 'new', description: 'Start a new session', group: 'chrome', line: '/new' },
  { id: 'chrome:interrupt', name: 'interrupt', description: 'Cancel the in-flight turn', group: 'chrome', line: '/interrupt' },
  { id: 'chrome:quit', name: 'quit', description: 'Quit the TUI', group: 'chrome', line: '/quit' },
]

/**
 * Merge Crush chrome commands with DSH-registered descriptors.
 * @param registered - `ctx.commands.list(agent)` descriptors.
 * @returns palette rows, chrome first, then name-sorted system commands.
 */
export function mergePalette(registered: readonly CommandDescriptor[]): PaletteItem[] {
  const chromeNames = new Set(CHROME_COMMANDS.map(item => item.name))
  const system = registered
    .filter(command => !chromeNames.has(command.name))
    .map((command): PaletteItem => ({
      id: `dsh:${command.name}`,
      name: command.name,
      description: command.description,
      group: 'system',
      line: `/${command.name}`,
    }))
    .sort((left, right) => left.name.localeCompare(right.name))
  return [...CHROME_COMMANDS, ...system]
}

/**
 * Filter palette rows by a Crush-style substring query on name or description.
 * @param items - full palette.
 * @param query - raw filter text (leading `/` is stripped).
 * @returns matching rows in original order.
 */
export function filterPalette(items: readonly PaletteItem[], query: string): PaletteItem[] {
  const needle = query.startsWith('/') ? query.slice(1) : query
  const normalized = needle.trim().toLowerCase()
  if (normalized === '') return [...items]
  return items.filter(item =>
    item.name.includes(normalized) || item.description.toLowerCase().includes(normalized))
}

/**
 * Route an editor line: empty, Crush/DSH slash command, or ordinary prompt.
 * @param line - exact editor contents.
 * @returns the routed action.
 */
export function routeLine(line: string):
  { kind: 'empty' }
  | { kind: 'command'; name: string; rawInput: string; line: string }
  | { kind: 'prompt'; text: string } {
  const trimmed = line.trim()
  if (trimmed === '') return { kind: 'empty' }
  const parsed = parseCommand(trimmed)
  if (parsed === undefined) return { kind: 'prompt', text: line }
  return { kind: 'command', name: parsed.name, rawInput: parsed.rawInput, line: trimmed }
}

/**
 * Whether the editor contents should open the Crush command palette.
 * @param line - exact editor contents.
 * @returns true when the line starts with `/` and has no newline.
 */
export function isPaletteOpen(line: string): boolean {
  return line.startsWith('/') && !line.includes('\n')
}
