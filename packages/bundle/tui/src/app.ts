/**
 * Ink presentation for the Claude Code-like DSH TUI. Single-column transcript,
 * rounded prompt at the bottom, dim footer. No sidebar or diagonal header.
 * @module @deepseek-ai/dsh-tui/app
 */

import React, { useEffect, useLayoutEffect, useState } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import type { TuiController } from './controller.ts'
import { formatAttachChip } from './attach.ts'
import { cardWrapWidth, clipTranscript, insertTurnClocks, renderCard, toneColor } from './cards.ts'
import {
  connectProviderLines,
  formatQueuedLine,
  formatCostLines,
  formatAgentsLine,
  agentLines,
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
import { inkKeyName } from './keys.ts'
import { insertAtCursor, promptPaint, setHardwareCursorVisible } from './prompt.ts'
import { formatDoneLine, formatStatusLine, formatWorkingLine, type StatusModel } from './status.ts'
import { promptPlaceholder } from './suggestion.ts'
import { COLORS, ICONS, TRANSCRIPT_PROMPT_GAP, WHALE_TONES } from './theme.ts'
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
    ...(state.permissionMode === undefined ? {} : { permissionMode: state.permissionMode }),
  }
}

/**
 * Colored overlay body: purple ❯ on the selected row, fg otherwise.
 * Rows are a Box + truncate-safe Text (same as the prompt caret). Ink drops
 * special cells inside wrap/truncate parents, which made ❯ flicker on move.
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
          Box,
          { key: index, flexDirection: 'row', height: 1, flexShrink: 0, flexGrow: 0 },
          React.createElement(Text, { color: COLORS.selector }, ICONS.selector),
          React.createElement(Text, { color: COLORS.fg, wrap: 'truncate' }, line.slice(ICONS.selector.length)),
        )
      }
      return React.createElement(
        Box,
        { key: index, height: 1, flexShrink: 0, flexGrow: 0 },
        React.createElement(Text, { color: COLORS.fg, wrap: 'truncate' }, line === '' ? ' ' : line),
      )
    }),
  )
}

/**
 * Landing / empty-transcript column: per-segment whale colours, muted
 * cwd/model/hint underneath.
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
      Box,
      { key: `whale-${index}`, flexDirection: 'row', height: 1, flexShrink: 0, flexGrow: 0 },
      ...line.segments.map((segment, segIndex) => React.createElement(
        Text,
        { key: segIndex, color: WHALE_TONES[segment.tone] },
        segment.text,
      )),
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
function coloredCard(item: TranscriptItem, width: number, skipLeadingLines = 0, skipTrailingLines = 0): React.ReactElement {
  const wrapWidth = cardWrapWidth(width)
  const rendered = renderCard(item, wrapWidth)
  const start = Math.max(0, skipLeadingLines)
  const end = skipTrailingLines > 0 ? Math.max(start, rendered.lines.length - skipTrailingLines) : rendered.lines.length
  const lines = rendered.lines.slice(start, end)
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
 * Visible block caret: cream cell, dark letter so the glyph stays readable.
 * Empty / newline become a non-breaking space so the cell still occupies a column.
 * Extra paint cell, not a buffer character. No inverse, no █.
 * @param ch - character under the caret, or empty at end-of-input.
 * @returns a single black-on-cream Text cell.
 */
function inverseCursorCell(ch: string): React.ReactElement {
  const glyph = ch === '' || ch === '\n' ? '\u00a0' : ch
  return React.createElement(Text, { color: COLORS.bg, backgroundColor: COLORS.fg }, glyph)
}

/**
 * Paint the prompt buffer as `[before][letter][after]` at `state.cursor`.
 * Box row, not a wrap='truncate' parent — Ink drops inverse cells inside those.
 * @param input - editor contents.
 * @param cursor - caret index.
 * @returns a prompt row.
 */
function promptCursorText(input: string, cursor: number): React.ReactElement {
  const paint = promptPaint(input, cursor)
  return React.createElement(
    Box,
    { flexDirection: 'row', flexGrow: 1, flexShrink: 1 },
    React.createElement(Text, { color: COLORS.fg }, paint.before),
    inverseCursorCell(paint.cursor),
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
  useLayoutEffect(() => {
    setHardwareCursorVisible(stdout, false)
    return () => { setHardwareCursorVisible(stdout, true) }
  }, [stdout])
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
    const name = inkKeyName(input, key)
    // Prompt keys (left/right/backspace/delete) go through handleKey / chromeAction
    // only. Never insert a backspace/DEL byte, and never use a stale React
    // snapshot that still has cursor === input.length.
    void controller.handleKey(name).then((consumed) => {
      if (consumed) return
      if (key.backspace === true || key.delete === true) return
      if (input === '' || input === '\x7f' || input === '\b') return
      if (name === 'backspace' || name === 'delete' || name === 'left' || name === 'right') return
      const live = controller.snapshot()
      if (live.overlay.kind === 'connect-key') {
        if (input !== '' && !key.ctrl && !key.meta) {
          controller.dispatch({ type: 'set-connect-key', value: `${live.overlay.value}${input}` })
        }
        return
      }
      if (live.overlay.kind !== 'none' && live.overlay.kind !== 'commands' && live.overlay.kind !== 'files') return
      if (key.return && key.ctrl) {
        void controller.submitSteer(live.input)
        return
      }
      if (key.ctrl && (input === 't' || input === 'T')) {
        void controller.submitSteer(live.input)
        return
      }
      if (key.return && !key.ctrl) {
        void controller.submit(live.input)
        return
      }
      if (key.ctrl && input === 'j') {
        const edit = insertAtCursor(live.input, live.cursor, '\n')
        controller.dispatch({ type: 'set-input', input: edit.input, cursor: edit.cursor })
        return
      }
      if (input === '?' && live.input === '' && live.overlay.kind === 'none') {
        controller.dispatch({ type: 'open-overlay', overlay: { kind: 'help' } })
        return
      }
      if (input !== '' && !key.ctrl && !key.meta) {
        const edit = insertAtCursor(live.input, live.cursor, input)
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
    const runningPreview = state.agents.filter(agent => agent.status === 'running').length
    const inboxCount = state.steering.length + state.queued.length + state.attachments.length + (runningPreview > 0 ? 1 : 0)
    const transcriptHeight = layout.main.height - inboxCount - (chromeLinePreview === undefined ? 0 : 1 + TRANSCRIPT_PROMPT_GAP)
    const paintWidth = cardWrapWidth(mainWidth)
    const pin = clipTranscript(cardRows, paintWidth, transcriptHeight, {
      pinned: state.transcriptPinned,
      startLine: state.transcriptStart,
    })
    transcriptTaller = pin.taller
    const lastRow = pin.rows.length - 1
    const cards = pin.rows.map((row, index) => {
      const skip = index === 0 ? pin.skipLeadingLines : 0
      const skipTail = index === lastRow ? pin.skipTrailingLines : 0
      if (row.type === 'clock') {
        return React.createElement(
          Box,
          { key: row.clock.id, height: 1, width: paintWidth, flexShrink: 0, flexGrow: 0 },
          React.createElement(Text, { color: COLORS.muted, wrap: 'truncate' }, formatDoneLine(row.clock.ms, row.clock.verb)),
        )
      }
      return coloredCard(row.item, paintWidth, skip, skipTail)
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
  const runningAgents = state.agents.filter(agent => agent.status === 'running').length
  const agentsLine = runningAgents > 0 ? formatAgentsLine(state.agents.length, runningAgents) : undefined
  const steerLines = state.steering.map((item, index) => formatSteerLine(index + 1, item.text, queuedWidth))
  const queuedLines = state.queued.map((item, index) => formatQueuedLine(index + 1, item.text, queuedWidth))
  const attachLines = state.attachments.map(item => formatAttachChip(item.name, queuedWidth))
  const inboxChrome = (agentsLine === undefined ? 0 : 1) + steerLines.length + queuedLines.length + attachLines.length
  const mainHeight = Math.max(0, layout.main.height - inboxChrome - (chromeLine === undefined ? 0 : 1 + TRANSCRIPT_PROMPT_GAP))

  let overlay: React.ReactNode = null
  if (state.overlay.kind === 'help') {
    overlay = coloredLines(renderOverlay(state.width, 'Shortcuts', helpLines()))
  } else if (state.overlay.kind === 'cost') {
    overlay = coloredLines(renderOverlay(state.width, 'Cost', formatCostLines(state.usedTokens, state.contextWindow)))
  } else if (state.overlay.kind === 'agents') {
    overlay = coloredLines(renderOverlay(state.width, 'Agents', agentLines(state.agents), state.overlay.selected))
  } else if (state.overlay.kind === 'files') {
    overlay = coloredLines(renderOverlay(
      state.width,
      'Files',
      state.files.length === 0 ? ['No matching paths.'] : state.files.map(file => file.path),
      state.overlay.selected,
    ))
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
      justifyContent: overlay === null && transcriptTaller && state.transcriptPinned ? 'flex-end' : 'flex-start',
    }, overlay === null ? main : overlay),
    agentsLine === undefined ? null : React.createElement(
      Box,
      { key: 'agents-swarm', height: 1, width: mainWidth, paddingX: 1, flexShrink: 0, flexGrow: 0 },
      React.createElement(Text, { color: COLORS.muted, wrap: 'truncate' }, agentsLine),
    ),
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
    ...attachLines.map((line, index) => React.createElement(
      Box,
      {
        key: state.attachments[index]?.attachmentId ?? `attach-${index}`,
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
          Box,
          { flexDirection: 'row', flexGrow: 1 },
          inverseCursorCell(''),
          React.createElement(Text, { color: COLORS.muted }, promptPlaceholder(state)),
        )
        : promptCursorText(state.input, state.cursor)),
    React.createElement(Box, { height: 1, width: mainWidth, paddingX: 1, flexShrink: 0, flexGrow: 0 },
      React.createElement(Text, { color: COLORS.dim }, formatStatusLine(status, Math.max(1, state.width - 2), home))),
  )
}
