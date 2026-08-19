/**
 * Ink presentation for the Claude Code-like DSH TUI. Single-column transcript,
 * rounded prompt at the bottom, dim footer. No sidebar or diagonal header.
 * @module @deepseek-ai/dsh-tui/app
 */

import React, { useEffect, useState } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import type { TuiController } from './controller.ts'
import { cardWrapWidth, insertTurnClocks, pinTranscriptToBottom, renderCard, toneColor } from './cards.ts'
import {
  connectProviderLines,
  formatQueuedLine,
  formatCostLines,
  formatSteerLine,
  helpLines,
  renderApprovalDialog,
  renderChoiceDialog,
  renderConnectKeyDialog,
  renderLandingMeta,
  renderOnboarding,
  renderOverlay,
  renderQuitDialog,
  sessionLines,
  whaleArt,
} from './chrome.ts'
import { connectProviderById, formatModelPickerLines } from './connect.ts'
import { layoutAreas } from './layout.ts'
import { insertAtCursor, promptPaint } from './prompt.ts'
import { formatDoneLine, formatStatusLine, formatWorkingLine, type StatusModel } from './status.ts'
import { promptPlaceholder } from './suggestion.ts'
import { COLORS, ICONS, TRANSCRIPT_PROMPT_GAP } from './theme.ts'
import type { TuiState } from './state.ts'
import type { TranscriptItem } from './transcript.ts'

/** Props for the Claude Code-like Ink app. */
export interface AppProps {
  /** DSH-backed controller. */
  readonly controller: TuiController
}

/**
 * Map UI state onto the status model.
 * @param state - current UI state.
 * @returns status facts.
 */
function statusOf(state: TuiState): StatusModel {
  return {
    provider: state.provider,
    model: state.model,
    cwd: state.cwd,
    busy: state.busy,
    compact: false,
    ...(state.usedTokens === undefined ? {} : { usedTokens: state.usedTokens }),
    ...(state.contextWindow === undefined ? {} : { contextWindow: state.contextWindow }),
    ...(state.notice === undefined ? {} : { notice: state.notice }),
  }
}

/**
 * Colored overlay body: purple ❯ on the selected row, fg otherwise.
 * Every Ink Text carries an explicit color so the frame is not default-white.
 * @param text - overlay lines.
 * @returns a column of colored lines.
 */
function coloredLines(text: string): React.ReactElement {
  const lines = text.split('\n')
  return React.createElement(
    Box,
    { flexDirection: 'column' },
    ...lines.map((line, index) => {
      if (line.startsWith(ICONS.selector)) {
        return React.createElement(
          Text,
          { key: index, wrap: 'wrap', color: COLORS.fg },
          React.createElement(Text, { color: COLORS.selector }, ICONS.selector),
          React.createElement(Text, { color: COLORS.fg }, line.slice(ICONS.selector.length)),
        )
      }
      return React.createElement(Text, { key: index, color: COLORS.fg, wrap: 'wrap' }, line === '' ? ' ' : line)
    }),
  )
}

/**
 * Landing / empty-transcript column: terracotta whale body, lavender accent,
 * muted cwd/model/hint underneath.
 * @param width - main columns.
 * @param status - model/cwd facts.
 * @param home - `$HOME` for path collapsing.
 * @returns the idle splash.
 */
function landingView(width: number, status: StatusModel, home: string | undefined): React.ReactElement {
  const whale = whaleArt(width)
  const meta = renderLandingMeta(width, status, home)
  return React.createElement(
    Box,
    { flexDirection: 'column', width },
    ...whale.map((line, index) => React.createElement(
      Text,
      {
        key: `whale-${index}`,
        color: line.tone === 'body' ? COLORS.brand : COLORS.tool,
      },
      line.text,
    )),
    React.createElement(Text, { key: 'meta', color: COLORS.muted, wrap: 'wrap' }, `\n${meta}`),
  )
}

/**
 * Render one transcript card with per-fragment Ink colors.
 * @param item - projected row.
 * @param width - card Box columns (same value as wrapText).
 * @param skipLeadingLines - top-clipped pre-wrapped rows from pin-to-bottom.
 * @returns a colored card.
 */
function coloredCard(item: TranscriptItem, width: number, skipLeadingLines = 0): React.ReactElement {
  const wrapWidth = cardWrapWidth(width)
  const rendered = renderCard(item, wrapWidth)
  const lines = rendered.lines.slice(Math.max(0, skipLeadingLines))
  const rows = lines.map((line, index) => React.createElement(
    Box,
    { key: index, width: wrapWidth, height: 1, flexShrink: 0, flexGrow: 0 },
    React.createElement(
      Text,
      {
        wrap: 'truncate',
        color: COLORS.fg,
        ...(item.kind === 'user' ? { backgroundColor: COLORS.userBar } : {}),
      },
      ...line.segments.map((segment, segIndex) => React.createElement(
        Text,
        { key: segIndex, color: toneColor(segment.tone) },
        segment.text,
      )),
    ),
  ))
  return React.createElement(
    Box,
    {
      key: item.id,
      width: wrapWidth,
      height: lines.length,
      flexShrink: 0,
      flexGrow: 0,
      flexDirection: 'column',
    },
    ...rows,
  )
}

/**
 * Paint the prompt buffer with the block cursor at `cursor`, not always at the end.
 * @param input - editor contents.
 * @param cursor - caret index.
 * @returns a truncated Ink line.
 */
function promptCursorText(input: string, cursor: number): React.ReactElement {
  const paint = promptPaint(input, cursor)
  return React.createElement(
    Text,
    { wrap: 'truncate' },
    React.createElement(Text, { color: COLORS.fg }, paint.before),
    React.createElement(Text, { color: COLORS.fg }, paint.cursor),
    React.createElement(Text, { color: COLORS.fg }, paint.after),
  )
}

/**
 * Claude Code-like Ink application.
 * @param props - controller.
 * @returns the Ink element tree.
 */
export function App(props: AppProps): React.ReactElement {
  const { controller } = props
  const { stdout } = useStdout()
  const [state, setState] = useState(() => controller.snapshot())

  useEffect(() => controller.subscribe(setState), [controller])
  useEffect(() => {
    const width = stdout.columns ?? 80
    const height = stdout.rows ?? 24
    controller.dispatch({ type: 'resize', width, height })
    const onResize = (): void => {
      controller.dispatch({ type: 'resize', width: stdout.columns ?? 80, height: stdout.rows ?? 24 })
    }
    stdout.on('resize', onResize)
    return () => { stdout.off('resize', onResize) }
  }, [controller, stdout])

  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!state.busy) return
    setNow(Date.now())
    const timer = setInterval(() => { setNow(Date.now()) }, 1000)
    return () => { clearInterval(timer) }
  }, [state.busy])

  const layout = layoutAreas(state.width, state.height, Math.max(1, state.input.split('\n').length + 1))
  const compact = layout.compact
  const status = { ...statusOf(state), compact }
  const home = controller.home()

  useInput((input, key) => {
    const name = key.return && key.ctrl ? 'ctrl+enter'
      : key.upArrow && key.ctrl ? 'ctrl+up'
        : key.tab && key.shift ? 'shift+tab'
          : key.shift && (input === 't' || input === 'T') ? 'shift+t'
            : key.ctrl && input ? `ctrl+${input}`
            : key.escape ? 'escape'
              : key.return ? 'return'
                : key.tab ? 'tab'
                  : key.backspace ? 'backspace'
                    : key.delete ? 'delete'
                      : key.upArrow ? 'up'
                        : key.downArrow ? 'down'
                          : key.leftArrow ? 'left'
                            : key.rightArrow ? 'right'
                              : input
    void controller.handleKey(name).then((consumed) => {
      if (consumed) return
      if (state.overlay.kind === 'connect-key') {
        if (key.backspace || key.delete) {
          controller.dispatch({
            type: 'set-connect-key',
            value: state.overlay.value.slice(0, Math.max(0, state.overlay.value.length - 1)),
          })
          return
        }
        if (input !== '' && !key.ctrl && !key.meta) {
          controller.dispatch({ type: 'set-connect-key', value: `${state.overlay.value}${input}` })
        }
        return
      }
      if (state.overlay.kind !== 'none' && state.overlay.kind !== 'commands') return
      if (key.return && key.ctrl) {
        void controller.submitSteer(state.input)
        return
      }
      if (key.shift && (input === 't' || input === 'T')) {
        void controller.submitSteer(state.input)
        return
      }
      if (key.ctrl && (input === 't' || input === 'T')) {
        void controller.submitSteer(state.input)
        return
      }
      if (key.return && !key.ctrl) {
        void controller.submit(state.input)
        return
      }
      if (key.ctrl && input === 'j') {
        const edit = insertAtCursor(state.input, state.cursor, '\n')
        controller.dispatch({ type: 'set-input', input: edit.input, cursor: edit.cursor })
        return
      }
      if (input === '?' && state.input === '' && state.overlay.kind === 'none') {
        controller.dispatch({ type: 'open-overlay', overlay: { kind: 'help' } })
        return
      }
      if (input === ' ' && state.focus === 'chat' && state.overlay.kind === 'none') {
        const items = controller.transcript()
        const last = [...items].reverse().find(item => item.kind === 'tool' || item.kind === 'reasoning')
        if (last !== undefined && (last.kind === 'tool' || last.kind === 'reasoning')) {
          controller.dispatch({ type: 'toggle-expand', id: last.id, target: last.kind === 'tool' ? 'tools' : 'reasoning' })
        }
        return
      }
      if (input !== '' && !key.ctrl && !key.meta) {
        const edit = insertAtCursor(state.input, state.cursor, input)
        controller.dispatch({ type: 'set-input', input: edit.input, cursor: edit.cursor })
      }
    })
  })

  const mainWidth = layout.main.width
  const workingMs = state.busy && state.turnStartedAt !== undefined
    ? Math.max(0, now - state.turnStartedAt)
    : undefined
  const outputTokens = workingMs !== undefined
    && state.usedTokens !== undefined
    && state.turnTokenBase !== undefined
    && state.usedTokens > state.turnTokenBase
    ? state.usedTokens - state.turnTokenBase
    : undefined
  const workingLine = workingMs === undefined
    ? undefined
    : formatWorkingLine(workingMs, outputTokens)

  const items = controller.transcript()
  const showLanding = state.screen === 'landing' || (state.screen === 'chat' && items.length === 0 && !state.busy)

  let main: React.ReactNode
  let trailingClock: string | undefined
  let transcriptTaller = false
  if (state.screen === 'onboarding' && state.guidance !== undefined) {
    main = React.createElement(Text, { color: COLORS.warning, wrap: 'wrap' }, renderOnboarding(mainWidth, state.guidance))
  } else if (showLanding) {
    main = landingView(mainWidth, status, home)
  } else {
    const rows = insertTurnClocks(items, state.turnClocks, state.busy)
    const last = rows[rows.length - 1]
    const cardRows = last?.type === 'clock' ? rows.slice(0, -1) : rows
    if (last?.type === 'clock') {
      trailingClock = formatDoneLine(last.clock.ms, last.clock.verb)
    }
    const chromeLinePreview = workingLine ?? trailingClock
    const inboxCount = state.steering.length + state.queued.length
    const transcriptHeight = layout.main.height - inboxCount - (chromeLinePreview === undefined ? 0 : 1 + TRANSCRIPT_PROMPT_GAP)
    const paintWidth = cardWrapWidth(mainWidth)
    const pin = pinTranscriptToBottom(cardRows, paintWidth, transcriptHeight)
    transcriptTaller = pin.taller
    const cards = pin.rows.map((row, index) => {
      const skip = index === 0 ? pin.skipLeadingLines : 0
      if (row.type === 'clock') {
        return React.createElement(
          Box,
          { key: row.clock.id, height: 1, width: paintWidth, flexShrink: 0, flexGrow: 0 },
          React.createElement(Text, { color: COLORS.muted, wrap: 'truncate' }, formatDoneLine(row.clock.ms, row.clock.verb)),
        )
      }
      return coloredCard(row.item, paintWidth, skip)
    })
    main = React.createElement(Box, {
      flexDirection: 'column',
      width: paintWidth,
      flexGrow: 0,
      flexShrink: 0,
    }, ...cards)
  }

  const chromeLine = workingLine ?? trailingClock
  const chromeColor = workingLine === undefined ? COLORS.muted : COLORS.brand
  const queuedWidth = Math.max(1, mainWidth - 2)
  const steerLines = state.steering.map((item, index) => formatSteerLine(index + 1, item.text, queuedWidth))
  const queuedLines = state.queued.map((item, index) => formatQueuedLine(index + 1, item.text, queuedWidth))
  const mainHeight = Math.max(0, layout.main.height - steerLines.length - queuedLines.length - (chromeLine === undefined ? 0 : 1 + TRANSCRIPT_PROMPT_GAP))

  let overlay: React.ReactNode = null
  if (state.overlay.kind === 'help') {
    overlay = coloredLines(renderOverlay(state.width, 'Shortcuts', helpLines()))
  } else if (state.overlay.kind === 'cost') {
    overlay = coloredLines(renderOverlay(state.width, 'Cost', formatCostLines(state.usedTokens, state.contextWindow)))
  } else if (state.overlay.kind === 'quit') {
    overlay = coloredLines(renderQuitDialog(state.width, state.overlay.selectedNope))
  } else if (state.overlay.kind === 'commands') {
    const items = controller.palette()
    overlay = coloredLines(renderOverlay(
      state.width,
      '',
      items.map(item => `/${item.name}  ${item.description}`),
      state.overlay.selected,
    ))
  } else if (state.overlay.kind === 'models') {
    overlay = coloredLines(renderOverlay(
      state.width,
      'Models',
      formatModelPickerLines(state.models),
      state.overlay.selected,
    ))
  } else if (state.overlay.kind === 'sessions') {
    overlay = coloredLines(renderOverlay(
      state.width,
      'Sessions',
      sessionLines(state.sessions),
      state.overlay.selected,
    ))
  } else if (state.overlay.kind === 'connect-provider') {
    overlay = coloredLines(renderOverlay(
      state.width,
      'Connect',
      connectProviderLines(state.connectProviders),
      state.overlay.selected,
    ))
  } else if (state.overlay.kind === 'connect-key') {
    const provider = connectProviderById(state.overlay.providerId)
    overlay = coloredLines(renderConnectKeyDialog(
      state.width,
      provider?.displayName ?? state.overlay.providerId,
      state.overlay.value,
      provider?.apiKeyEnv ?? 'API_KEY',
      state.overlay.error,
    ))
  } else if (state.overlay.kind === 'approval') {
    overlay = coloredLines(renderApprovalDialog(
      state.width,
      state.overlay.toolName,
      state.overlay.reason,
      state.overlay.selected,
    ))
  } else if (state.overlay.kind === 'question') {
    overlay = coloredLines(renderChoiceDialog(
      state.width,
      state.overlay.prompt,
      state.overlay.options,
      state.overlay.selected,
    ))
  }

  const editorEmpty = state.input === '' && state.overlay.kind !== 'connect-key'
  const gap = (): React.ReactElement => React.createElement(
    Box,
    { height: TRANSCRIPT_PROMPT_GAP, width: mainWidth, flexShrink: 0, flexGrow: 0, flexDirection: 'column' },
    ...Array.from({ length: TRANSCRIPT_PROMPT_GAP }, (_, index) => React.createElement(Text, { key: index }, ' ')),
  )
  return React.createElement(Box, { flexDirection: 'column', width: state.width, height: state.height },
    React.createElement(Box, {
      flexDirection: 'column',
      width: mainWidth,
      height: mainHeight,
      flexGrow: 0,
      flexShrink: 0,
      justifyContent: overlay === null && transcriptTaller ? 'flex-end' : 'flex-start',
    }, overlay === null ? main : overlay),
    ...steerLines.map((line, index) => React.createElement(
      Box,
      {
        key: state.steering[index]?.id ?? `steer-${index}`,
        height: 1,
        width: mainWidth,
        paddingX: 1,
        flexShrink: 0,
        flexGrow: 0,
      },
      React.createElement(Text, { color: COLORS.muted, wrap: 'truncate' }, line),
    )),
    ...queuedLines.map((line, index) => React.createElement(
      Box,
      {
        key: state.queued[index]?.id ?? `queued-${index}`,
        height: 1,
        width: mainWidth,
        paddingX: 1,
        flexShrink: 0,
        flexGrow: 0,
      },
      React.createElement(Text, { color: COLORS.muted, wrap: 'truncate' }, line),
    )),
    chromeLine === undefined ? null : gap(),
    chromeLine === undefined
      ? null
      : React.createElement(Box, { height: 1, width: mainWidth, paddingX: 1, flexShrink: 0, flexGrow: 0 },
        React.createElement(Text, { color: chromeColor, wrap: 'truncate' }, chromeLine)),
    gap(),
    React.createElement(Box, {
      height: layout.editor.height,
      width: mainWidth,
      borderStyle: 'round',
      borderColor: COLORS.dim,
      paddingX: 1,
      flexShrink: 0,
      flexGrow: 0,
    },
    React.createElement(Text, { color: COLORS.brand, wrap: 'truncate' }, `${ICONS.prompt} `),
    state.overlay.kind === 'connect-key'
      ? React.createElement(Text, { color: COLORS.fg }, ' ')
      : editorEmpty
        ? React.createElement(
          Text,
          { wrap: 'truncate' },
          React.createElement(Text, { color: COLORS.fg }, ICONS.cursor),
          React.createElement(Text, { color: COLORS.muted }, promptPlaceholder(state)),
        )
        : promptCursorText(state.input, state.cursor)),
    React.createElement(Box, { height: 1, width: mainWidth, paddingX: 1, flexShrink: 0, flexGrow: 0 },
      React.createElement(Text, { color: COLORS.dim }, formatStatusLine(status, Math.max(1, state.width - 2), home))),
  )
}
