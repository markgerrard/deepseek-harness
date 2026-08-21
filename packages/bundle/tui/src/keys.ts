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
  steer: { key: 'ctrl+t', aliases: ['ctrl+enter', 'ctrl+T'], help: 'ctrl+t', description: 'steer this turn (next step)' },
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
  readonly home?: boolean
  readonly end?: boolean
}

/**
 * Hold a lone Esc this long so a following `b` / `f` can be readline meta
 * (Esc,b / Esc,f). Mac Option+Left often never delivers CSI `1;3D` into this
 * xfce box; Ctrl+Left (`1;5D`) and Esc,b/f are the sequences that arrive.
 */
export const META_PREFIX_MS = 400

/**
 * Strip a leading ESC so CSI matches both raw and Ink-stripped `input`.
 * @param input - raw or ESC-stripped bytes.
 * @returns the body after a single leading ESC, or `input` unchanged.
 */
function csiBody(input: string): string {
  return input.charCodeAt(0) === 27 ? input.slice(1) : input
}

/**
 * xfce4-terminal Option/Ctrl/Meta+Left as CSI (Ink may leave this in `input`
 * when it does not set `leftArrow` + `meta`/`ctrl`).
 * @param input - raw or ESC-stripped CSI.
 * @returns true for Alt/Ctrl/Meta left-arrow sequences.
 */
function isWordJumpLeftSequence(input: string): boolean {
  const body = csiBody(input)
  return body === '[1;3D' || body === '[1;5D' || body === '[1;7D' || body === '[1;9D'
    || body === '[3D' || body === '[5D'
}

/**
 * xfce4-terminal Option/Ctrl/Meta+Right as CSI.
 * @param input - raw or ESC-stripped CSI.
 * @returns true for Alt/Ctrl/Meta right-arrow sequences.
 */
function isWordJumpRightSequence(input: string): boolean {
  const body = csiBody(input)
  return body === '[1;3C' || body === '[1;5C' || body === '[1;7C' || body === '[1;9C'
    || body === '[3C' || body === '[5C'
}

/**
 * Home encodings: Ink name, CSI (`[H` `[1~` `[7~`), SS3 (`OH`).
 * @param input - raw or ESC-stripped bytes.
 * @returns true for Home sequences VTE / xterm / gnome-terminal / iTerm send.
 */
function isHomeSequence(input: string): boolean {
  if (input === 'home') return true
  const body = csiBody(input)
  return body === '[H' || body === '[1~' || body === '[7~' || body === 'OH'
}

/**
 * End encodings: Ink name, CSI (`[F` `[4~` `[8~`), SS3 (`OF`).
 * @param input - raw or ESC-stripped bytes.
 * @returns true for End sequences VTE / xterm / gnome-terminal / iTerm send.
 */
function isEndSequence(input: string): boolean {
  if (input === 'end') return true
  const body = csiBody(input)
  return body === '[F' || body === '[4~' || body === '[8~' || body === 'OF'
}

/**
 * Readline meta-b / meta-f after a held Esc. Ink delivers Alt+b as one
 * `meta`+`b` event when the bytes arrive together; a typed Esc then b is two
 * events, and treating the first as cancel would wipe the prompt.
 * @param name - `inkKeyName` of the key after Esc.
 * @returns the word-jump name, or undefined when Esc should flush as cancel.
 */
export function wordJumpAfterEscape(name: string): 'alt+b' | 'alt+f' | undefined {
  if (name === 'b' || name === 'B' || name === 'alt+b') return 'alt+b'
  if (name === 'f' || name === 'F' || name === 'alt+f') return 'alt+f'
  return undefined
}


/**
 * Map an Ink `useInput` event onto the KEYS vocabulary.
 * Shift+Tab is `key.tab && key.shift` (not bare tab). PageUp/PageDown use
 * Ink 5 `key.pageUp` / `key.pageDown`, plus shift+up/down aliases tmux will not steal.
 * Arrow flags are resolved before `escape`: xfce4-terminal / Ink set `escape` on
 * the CSI prefix of up/down/left/right, and treating that as cancel closed overlays.
 * Home/End are resolved after bare arrows and before `escape`: those CSI names
 * start with ESC, and treating them as cancel wipes the prompt on this VTE box.
 * Ink 5 parse-keypress already names `[H`/`[F`/`[1~`/`[4~`/`[7~`/`[8~`/`OH`/`OF`
 * `home`/`end` but useInput then clears `input` (non-alphanumeric) and has no
 * `home`/`end` flags — so leftover CSI in `input` and optional `key.home` /
 * `key.end` are the paths that still reach us.
 * Option/Alt/Ctrl+Left/Right are mapped before bare arrows: Ink 5 has no `alt`
 * flag (use `meta`), and named arrows clear `input`, so modifier flags are the
 * path when xfce4-terminal sends CSI `1;3D` / `1;5D`. Ink 5 parse-keypress does
 * set `meta` for `1;3D` and `ctrl` for `1;5D` when those bytes arrive as one
 * chunk. Raw CSI is also accepted when Ink leaves the sequence in `input`.
 * This box's xfwm4 does not steal Alt+Left (workspace switch is Ctrl+Alt+Left);
 * Mac Option+Left still often never reaches the pty, so Ctrl+Left and Esc,b/f
 * are the bindings that work here.
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
  if (key.leftArrow === true && (key.meta === true || key.ctrl === true)) return 'alt+left'
  if (key.rightArrow === true && (key.meta === true || key.ctrl === true)) return 'alt+right'
  if (isWordJumpLeftSequence(input)) return 'alt+left'
  if (isWordJumpRightSequence(input)) return 'alt+right'
  if (key.upArrow === true) return 'up'
  if (key.downArrow === true) return 'down'
  if (key.leftArrow === true) return 'left'
  if (key.rightArrow === true) return 'right'
  if (key.home === true || isHomeSequence(input)) return 'home'
  if (key.end === true || isEndSequence(input)) return 'end'
  if (key.meta === true && (input === 'b' || input === 'B')) return 'alt+b'
  if (key.meta === true && (input === 'f' || input === 'F')) return 'alt+f'
  if (input === String.fromCharCode(27) + 'b' || input === String.fromCharCode(27) + 'B') return 'alt+b'
  if (input === String.fromCharCode(27) + 'f' || input === String.fromCharCode(27) + 'F') return 'alt+f'
  if (key.ctrl === true && input !== '' && input !== undefined) return `ctrl+${input}`
  if (key.escape === true) return 'escape'
  if (key.return === true) return 'return'
  if (key.tab === true) return 'tab'
  if (input === String.fromCharCode(27) + '[3~' || input === String.fromCharCode(27) + '[3;2~') return 'delete'
  if (key.backspace === true) return 'backspace'
  if (input === '\x7f' || input === '\b') return 'backspace'
  if (key.delete === true) return 'backspace'
  if (input === String.fromCharCode(27) + '[Z') return 'shift+tab'
  if (input === String.fromCharCode(27) + '[5~' || input === String.fromCharCode(27) + '[5;2~') return 'pageup'
  if (input === String.fromCharCode(27) + '[6~' || input === String.fromCharCode(27) + '[6;2~') return 'pagedown'
  return input
}
