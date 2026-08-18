/**
 * Crush-inspired visual language for the DSH terminal UI: icons, product
 * chrome, and compact-mode breakpoints. Colors are Ink Text color names
 * so the presentation layer can stay a thin mapping over these tokens.
 * @module @deepseek-ai/dsh-tui/theme
 */

/** Crush-style icon tokens reused by header, sidebar, tool cards, and status. */
export const ICONS = {
  check: '✓',
  spinner: '⋯',
  loading: '⟳',
  model: '◇',
  toolPending: '●',
  toolSuccess: '✓',
  toolError: '×',
  radioOn: '◉',
  radioOff: '○',
  borderThin: '│',
  borderThick: '▌',
  diagonal: '╱',
  section: '─',
  todoCompleted: '✓',
  todoPending: '•',
  todoInProgress: '→',
  scrollbarThumb: '┃',
  scrollbarTrack: '│',
} as const

/** Ink Text color names that approximate Crush's warm-gold / muted chrome. */
export const COLORS = {
  logo: 'yellow',
  mark: 'magenta',
  accent: 'cyan',
  muted: 'gray',
  user: 'cyan',
  assistant: 'white',
  thinking: 'gray',
  tool: 'yellow',
  success: 'green',
  error: 'red',
  warning: 'yellow',
  dim: 'gray',
} as const

/** Product word drawn in the Crush-style header logo. */
export const PRODUCT_NAME = 'DSH'

/** Small mark drawn beside the logo, matching Crush's Charm mark treatment. */
export const PRODUCT_MARK = 'DeepSeek™'

/** Crush compact-mode width breakpoint: hide the session sidebar below this. */
export const COMPACT_WIDTH = 120

/** Crush compact-mode height breakpoint: hide the session sidebar below this. */
export const COMPACT_HEIGHT = 30

/** Crush sidebar content width in full layout. */
export const SIDEBAR_WIDTH = 30

/** Maximum Crush-style prompt textarea height. */
export const EDITOR_MAX_HEIGHT = 15

/** Minimum Crush-style prompt textarea height. */
export const EDITOR_MIN_HEIGHT = 3
