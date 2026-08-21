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
  /** DeepSeek Blue — official brand, landing whale. */
  deepseek: '#4D6BFE',
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
  deepseek: PALETTE.deepseek,
} as const

/** Per-segment colours for the solid-block landing whale. */
export const WHALE_TONES = {
  /** Body / flukes — DeepSeek Blue. */
  block: COLORS.deepseek,
  /** Blowhole spray — slightly lighter so ▄/▀ reads. */
  spray: '#8AA0FF',
  /** Eye hole; spaces show the terminal background. */
  hole: COLORS.bg,
} as const

/** Product word kept for onboarding copy (no third-party wordmark). */
export const PRODUCT_NAME = 'DSH'

/** Small product mark kept for onboarding copy. */
export const PRODUCT_MARK = 'DeepSeek™'

/** Claude Code-style landing title beside the whale. */
export const PRODUCT_TITLE = 'DeepSeek Harness Code'

/**
 * Landing version next to the title. Always `v0.1.0`, even when
 * package.json is `0.1.0-rc.x`.
 */
export const PRODUCT_VERSION = 'v0.1.0'

/** Unused compact-mode width breakpoint; single-column layout ignores it. */
export const COMPACT_WIDTH = 120

/** Unused compact-mode height breakpoint; single-column layout ignores it. */
export const COMPACT_HEIGHT = 30

/** Unused sidebar content width; the sidebar is never shown. */
export const SIDEBAR_WIDTH = 30

/** Maximum Claude Code-like prompt textarea height. */
export const EDITOR_MAX_HEIGHT = 15

/** Minimum Claude Code-like prompt textarea height (border + one content row). */
export const EDITOR_MIN_HEIGHT = 3

/** Blank rows after the last transcript card and again after the turn clock / Working line. */
export const TRANSCRIPT_PROMPT_GAP = 2
