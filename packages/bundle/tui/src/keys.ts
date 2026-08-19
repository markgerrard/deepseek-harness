/**
 * Keybinding vocabulary for the Claude Code-like DSH terminal UI
 * (`ctrl+p` commands, `ctrl+l` models, `ctrl+s` sessions, `ctrl+g` help,
 * `ctrl+n` new session, `esc` cancel, `?` shortcuts when the editor is empty).
 * @module @deepseek-ai/dsh-tui/keys
 */

/** One keybinding advertised in the help overlay. */
export interface KeyBinding {
  /** Ink / terminal key name. */
  readonly key: string
  /** Alternate keys that trigger the same action. */
  readonly aliases?: readonly string[]
  /** Short help label shown in the status bar. */
  readonly help: string
  /** One-line description shown in the full help overlay. */
  readonly description: string
}

/** Key map used by the TUI controller and help chrome. */
export const KEYS = {
  quit: { key: 'ctrl+c', help: 'ctrl+c', description: 'quit' },
  help: { key: 'ctrl+g', help: 'ctrl+g', description: 'more' },
  commands: { key: 'ctrl+p', help: 'ctrl+p', description: 'commands' },
  models: { key: 'ctrl+l', aliases: ['ctrl+m'], help: 'ctrl+l', description: 'models' },
  sessions: { key: 'ctrl+s', help: 'ctrl+s', description: 'sessions' },
  newSession: { key: 'ctrl+n', help: 'ctrl+n', description: 'new session' },
  send: { key: 'return', aliases: ['enter'], help: 'enter', description: 'send' },
  steer: { key: 'shift+t', aliases: ['ctrl+t', 'ctrl+enter', 'ctrl+T'], help: 'shift+t', description: 'steer this turn (next step)' },
  newline: { key: 'ctrl+j', help: 'ctrl+j', description: 'newline' },
  cancel: { key: 'escape', aliases: ['esc'], help: 'esc', description: 'cancel' },
  rewind: { key: 'escape', aliases: ['esc'], help: 'esc esc', description: 'rewind last prompt' },
  tab: { key: 'tab', help: 'tab', description: 'change focus' },
  expand: { key: 'ctrl+o', help: 'ctrl+o', description: 'expand/collapse' },
  slash: { key: '/', help: '/', description: 'commands' },
  permission: { key: 'shift+tab', help: 'shift+tab', description: 'cycle permission mode' },
  pageUp: { key: 'pageup', aliases: ['pageUp', 'page-up', 'shift+up'], help: 'pgup', description: 'scroll transcript up' },
  pageDown: { key: 'pagedown', aliases: ['pageDown', 'page-down', 'shift+down'], help: 'pgdn', description: 'scroll transcript down' },
} as const satisfies Record<string, KeyBinding>

/**
 * Help fragments shown in the help overlay when the editor is focused.
 * @param compact - whether the terminal is in compact layout.
 * @returns ordered help pairs for the status line.
 */
export function editorHelp(compact: boolean): readonly { key: string; label: string }[] {
  if (compact) {
    return [
      { key: KEYS.commands.help, label: KEYS.commands.description },
      { key: KEYS.help.help, label: KEYS.help.description },
    ]
  }
  return [
    { key: KEYS.commands.help, label: KEYS.commands.description },
    { key: KEYS.models.help, label: KEYS.models.description },
    { key: KEYS.sessions.help, label: KEYS.sessions.description },
    { key: KEYS.help.help, label: KEYS.help.description },
  ]
}

/**
 * Whether `key` is one of a binding's names.
 * @param binding - keybinding.
 * @param key - raw Ink key name.
 * @returns true when the key triggers the binding.
 */
export function matches(binding: KeyBinding, key: string): boolean {
  if (key === binding.key) return true
  return binding.aliases?.includes(key) === true
}

/** Ink `useInput` key flags (Ink 5 uses camelCase `pageUp` / `pageDown`). */
export interface InkKeyFlags {
  readonly return?: boolean
  readonly escape?: boolean
  readonly tab?: boolean
  readonly backspace?: boolean
  readonly delete?: boolean
  readonly upArrow?: boolean
  readonly downArrow?: boolean
  readonly leftArrow?: boolean
  readonly rightArrow?: boolean
  readonly pageUp?: boolean
  readonly pageDown?: boolean
  readonly ctrl?: boolean
  readonly shift?: boolean
  readonly meta?: boolean
  readonly pageup?: boolean
  readonly pagedown?: boolean
}

/**
 * Map an Ink `useInput` event onto the KEYS vocabulary.
 * Shift+Tab is `key.tab && key.shift` (not bare tab). PageUp/PageDown use
 * Ink 5 `key.pageUp` / `key.pageDown`, plus shift+up/down aliases tmux will not steal.
 *
 * Ink 5 parse-keypress names `\x7f` (what xfce4-terminal sends for Backspace)
 * `delete`, and useInput then clears the input because `delete` is
 * non-alphanumeric. Real Forward Delete is CSI `[3~`. Treat the former as
 * backspace and only the CSI as delete so the editor does not swap them.
 * @param input - raw input string from Ink.
 * @param key - Ink key flags.
 * @returns a KEYS name or the raw input.
 */
export function inkKeyName(input: string, key: InkKeyFlags): string {
  if (key.return === true && key.ctrl === true) return 'ctrl+enter'
  if (key.upArrow === true && key.ctrl === true) return 'ctrl+up'
  if (key.downArrow === true && key.ctrl === true) return 'ctrl+down'
  if (key.tab === true && key.shift === true) return 'shift+tab'
  if (key.pageUp === true || key.pageup === true) return 'pageup'
  if (key.pageDown === true || key.pagedown === true) return 'pagedown'
  if (key.upArrow === true && key.shift === true) return 'shift+up'
  if (key.downArrow === true && key.shift === true) return 'shift+down'
  if (key.shift === true && (input === 't' || input === 'T')) return 'shift+t'
  if (key.ctrl === true && input !== '' && input !== undefined) return `ctrl+${input}`
  if (key.escape === true) return 'escape'
  if (key.return === true) return 'return'
  if (key.tab === true) return 'tab'
  if (input === String.fromCharCode(27) + '[3~' || input === String.fromCharCode(27) + '[3;2~') return 'delete'
  if (key.backspace === true) return 'backspace'
  if (input === '\x7f' || input === '\b') return 'backspace'
  if (key.delete === true) return 'backspace'
  if (key.upArrow === true) return 'up'
  if (key.downArrow === true) return 'down'
  if (key.leftArrow === true) return 'left'
  if (key.rightArrow === true) return 'right'
  if (input === String.fromCharCode(27) + '[Z') return 'shift+tab'
  if (input === String.fromCharCode(27) + '[5~' || input === String.fromCharCode(27) + '[5;2~') return 'pageup'
  if (input === String.fromCharCode(27) + '[6~' || input === String.fromCharCode(27) + '[6;2~') return 'pagedown'
  return input
}
