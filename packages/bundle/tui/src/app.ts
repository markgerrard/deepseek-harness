/**
 * Ink presentation for the Claude Code-like DSH TUI. Single-column transcript,
 * rounded prompt at the bottom, dim footer. No sidebar or diagonal header.
 * @module @deepseek-ai/dsh-tui/app
 */

import React, { useEffect, useState } from 'react'
import { Box, Text, useInput, useStdout } from 'ink'
import type { TuiController } from './controller.ts'
import { insertTurnClocks, renderCard, toneColor } from './cards.ts'
import {
  connectProviderLines,
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
import { formatDoneLine, formatStatusLine, formatWorkingLine, type StatusModel } from './status.ts'
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
 * @param width - card columns.
 * @returns a colored card.
 */
function coloredCard(item: TranscriptItem, width: number): React.ReactElement {
  const rendered = renderCard(item, width)
  const body = React.createElement(
    Text,
    { wrap: 'wrap', color: COLORS.fg },
    ...rendered.segments.map((segment, index) => React.createElement(
      Text,
      { key: index, color: toneColor(segment.tone) },
      segment.text,
    )),
  )
  if (item.kind === 'user') {
    return React.createElement(
      Box,
      { key: item.id, width, backgroundColor: COLORS.userBar },
      body,
    )
  }
  return React.createElement(Box, { key: item.id, width }, body)
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
    const name = key.ctrl && input ? `ctrl+${input}`
      : key.escape ? 'escape'
        : key.return ? 'return'
          : key.tab ? 'tab'
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
      if (key.return && !key.ctrl) {
        void controller.submit(state.input)
        return
      }
      if (key.ctrl && input === 'j') {
        controller.dispatch({ type: 'set-input', input: `${state.input}\n`, cursor: state.input.length + 1 })
        return
      }
      if (key.backspace || key.delete) {
        const next = state.input.slice(0, Math.max(0, state.input.length - 1))
        controller.dispatch({ type: 'set-input', input: next, cursor: next.length })
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
        const next = `${state.input}${input}`
        controller.dispatch({ type: 'set-input', input: next, cursor: next.length })
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
  const mainHeight = layout.main.height - (workingLine === undefined ? 0 : 1)

  const items = controller.transcript()
  const showLanding = state.screen === 'landing' || (state.screen === 'chat' && items.length === 0 && !state.busy)

  let main: React.ReactNode
  if (state.screen === 'onboarding' && state.guidance !== undefined) {
    main = React.createElement(Text, { color: COLORS.warning, wrap: 'wrap' }, renderOnboarding(mainWidth, state.guidance))
  } else if (showLanding) {
    main = landingView(mainWidth, status, home)
  } else {
    const rows = insertTurnClocks(items, state.turnClocks, state.busy)
    const cards = rows.map((row) => {
      if (row.type === 'clock') {
        return React.createElement(
          Text,
          { key: row.clock.id, color: COLORS.muted, wrap: 'wrap' },
          formatDoneLine(row.clock.ms, row.clock.verb),
        )
      }
      return coloredCard(row.item, mainWidth)
    })
    main = React.createElement(Box, { flexDirection: 'column', width: mainWidth }, ...cards)
  }

  let overlay: React.ReactNode = null
  if (state.overlay.kind === 'help') {
    overlay = coloredLines(renderOverlay(state.width, 'Shortcuts', helpLines()))
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
  const promptBody = state.overlay.kind === 'connect-key'
    ? ' '
    : editorEmpty
      ? undefined
      : state.input
  return React.createElement(Box, { flexDirection: 'column', width: state.width, height: state.height },
    React.createElement(Box, {
      flexDirection: 'column',
      width: mainWidth,
      height: mainHeight,
      overflow: 'hidden',
      marginBottom: TRANSCRIPT_PROMPT_GAP,
    }, overlay === null ? main : overlay),
    workingLine === undefined
      ? null
      : React.createElement(Box, { height: 1, width: mainWidth, paddingX: 1 },
        React.createElement(Text, { color: COLORS.brand, wrap: 'wrap' }, workingLine)),
    React.createElement(Box, {
      height: layout.editor.height,
      width: mainWidth,
      borderStyle: 'round',
      borderColor: COLORS.dim,
      paddingX: 1,
    },
    React.createElement(Text, { color: COLORS.brand }, `${ICONS.prompt} `),
    promptBody === undefined
      ? React.createElement(Text, { color: COLORS.muted, wrap: 'wrap' }, 'Ask DSH…')
      : React.createElement(Text, { color: COLORS.fg, wrap: 'wrap' }, promptBody),
    React.createElement(Text, { color: COLORS.fg, backgroundColor: COLORS.fg }, ' ')),
    React.createElement(Box, { height: 1, width: mainWidth, paddingX: 1 },
      React.createElement(Text, { color: COLORS.dim }, formatStatusLine(status, Math.max(1, state.width - 2), home))),
  )
}
