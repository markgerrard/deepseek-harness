/**
 * Claude Code-like visual language for the DSH terminal UI: icons, palette,
 * and leftover compact-mode breakpoints (unused by the single-column layout).
 * @module @deepseek-ai/dsh-tui/theme
 */

/** Claude Code-like icon tokens reused by the prompt, tool cards, and dialogs. */
export const ICONS = {
  check: '✓',
  spinner: '✻',
  loading: '●',
  model: '◇',
  toolPending: '●',
  toolSuccess: '✓',
  toolError: '×',
  selector: '❯',
  prompt: '>',
  user: '›',
  assistant: '●',
  clock: '✱',
  cursor: '█',
  radioOn: '❯',
  radioOff: ' ',
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

/**
 * Dark Claude Code-like hex palette. Ink `Text`/`Box` accept these as
 * `color` / `borderColor`.
 */
export const PALETTE = {
  /** Terracotta orange — brand, spinner, user prompt. */
  brand: '#D97757',
  /** Default foreground. */
  fg: '#E8E4DC',
  /** Terminal / inverse-caret background. */
  bg: '#1A1816',
  /** Dim / muted secondary text and borders. */
  muted: '#8A8580',
  /** Pale lavender — tool titles. */
  tool: '#C4B5FD',
  /** Purple — ❯ selector. */
  selector: '#A78BFA',
  /** Muted green — success. */
  success: '#6B8F71',
  /** Red — error. */
  error: '#E85D4C',
  /** Warm warning. */
  warning: '#E8C547',
  /** Extra-dim thinking text. */
  subtle: '#6F6B63',
  /** Full-width user-row bar. */
  userBar: '#3A3632',
} as const

/** Ink color tokens mapped onto the Claude Code-like palette. */
export const COLORS = {
  logo: PALETTE.brand,
  mark: PALETTE.brand,
  accent: PALETTE.brand,
  brand: PALETTE.brand,
  muted: PALETTE.muted,
  user: PALETTE.brand,
  userBar: PALETTE.userBar,
  assistant: PALETTE.fg,
  thinking: PALETTE.muted,
  tool: PALETTE.tool,
  selector: PALETTE.selector,
  success: PALETTE.success,
  error: PALETTE.error,
  warning: PALETTE.warning,
  dim: PALETTE.muted,
  fg: PALETTE.fg,
  bg: PALETTE.bg,
} as const

/** Per-segment colours for the landing whale (not one tint per whole line). */
export const WHALE_TONES = {
  spray: COLORS.tool,
  body: COLORS.brand,
  belly: COLORS.fg,
  eye: COLORS.warning,
  water: COLORS.success,
  accent: COLORS.selector,
} as const

/** Product word kept for onboarding copy (not a Crush wordmark). */
export const PRODUCT_NAME = 'DSH'

/** Small product mark kept for onboarding copy. */
export const PRODUCT_MARK = 'DeepSeek™'

/** Unused Crush compact-mode width breakpoint; single-column layout ignores it. */
export const COMPACT_WIDTH = 120

/** Unused Crush compact-mode height breakpoint; single-column layout ignores it. */
export const COMPACT_HEIGHT = 30

/** Unused Crush sidebar content width; the sidebar is never shown. */
export const SIDEBAR_WIDTH = 30

/** Maximum Claude Code-like prompt textarea height. */
export const EDITOR_MAX_HEIGHT = 15

/** Minimum Claude Code-like prompt textarea height (border + one content row). */
export const EDITOR_MIN_HEIGHT = 3

/** Blank rows after the last transcript card and again after the turn clock / Working line. */
export const TRANSCRIPT_PROMPT_GAP = 2
