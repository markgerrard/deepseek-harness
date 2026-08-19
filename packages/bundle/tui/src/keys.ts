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
  tab: { key: 'tab', help: 'tab', description: 'change focus' },
  expand: { key: 'space', help: 'space', description: 'expand/collapse' },
  slash: { key: '/', help: '/', description: 'commands' },
  permission: { key: 'shift+tab', help: 'shift+tab', description: 'cycle permission mode' },
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
