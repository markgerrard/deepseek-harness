/**
 * Ink presentation for the Crush-style DSH TUI. Renders chrome, transcript,
 * editor, status, and overlays from the controller snapshot.
 * @module @deepseek-ai/dsh-tui/app
 */

import React, { useEffect, useState } from 'react'
import { Box, Text, useApp, useInput, useStdout } from 'ink'
import type { TuiController } from './controller.ts'
import { renderHeader, renderLanding, renderOnboarding, renderOverlay, renderSidebar, helpLines, sessionLines } from './chrome.ts'
import { renderTranscript } from './cards.ts'
import { formatStatusLine, type StatusModel } from './status.ts'
import { layoutAreas } from './layout.ts'
import { CHROME_COMMANDS } from './commands.ts'
import { COLORS, ICONS } from './theme.ts'
import type { TuiState } from './state.ts'

/** Props for the Crush-style Ink app. */
export interface AppProps {
  /** DSH-backed controller. */
  readonly controller: TuiController
}

/**
 * Map Crush UI state onto the status model.
 * @param state - current UI state.
 * @returns status facts.
 */
function statusOf(state: TuiState): StatusModel {
  return {
    provider: state.provider,
    model: state.model,
    cwd: state.cwd,
    usedTokens: state.usedTokens,
    contextWindow: state.contextWindow,
    busy: state.busy,
    compact: false,
  }
}

/**
 * Crush-style Ink application.
 * @param props - controller.
 * @returns the Ink element tree.
 */
export function App(props: AppProps): React.ReactElement {
  const { controller } = props
  const { exit } = useApp()
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
                : input
    void controller.handleKey(name).then((consumed) => {
      if (consumed) return
      if (key.ctrl && input === 'c') {
        exit()
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
      if (input === ' ' && state.focus === 'chat') {
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
  let main: React.ReactNode
  if (state.screen === 'onboarding' && state.guidance !== undefined) {
    main = React.createElement(Text, { color: COLORS.warning }, renderOnboarding(mainWidth, state.guidance))
  } else if (state.screen === 'landing') {
    main = React.createElement(Text, { color: COLORS.muted }, renderLanding(mainWidth, status, home))
  } else {
    main = React.createElement(Text, null, renderTranscript(controller.transcript(), mainWidth))
  }

  let overlay: React.ReactNode = null
  if (state.overlay.kind === 'help') {
    overlay = React.createElement(Text, { color: COLORS.accent }, renderOverlay(state.width, 'Help', helpLines()))
  } else if (state.overlay.kind === 'commands') {
    const items = controller.palette()
    overlay = React.createElement(Text, { color: COLORS.accent }, renderOverlay(
      state.width,
      'Commands',
      items.map(item => `/${item.name}  ${item.description}`),
      state.overlay.selected,
    ))
  } else if (state.overlay.kind === 'models') {
    overlay = React.createElement(Text, { color: COLORS.accent }, renderOverlay(
      state.width,
      'Models',
      state.models.map(model => `${model.provider} / ${model.name}`),
      state.overlay.selected,
    ))
  } else if (state.overlay.kind === 'sessions') {
    overlay = React.createElement(Text, { color: COLORS.accent }, renderOverlay(
      state.width,
      'Sessions',
      sessionLines(state.sessions),
      state.overlay.selected,
    ))
  } else if (state.overlay.kind === 'approval') {
    const reason = state.overlay.reason ?? 'This tool needs approval.'
    overlay = React.createElement(Text, { color: COLORS.warning }, renderOverlay(
      state.width,
      `Approve ${state.overlay.toolName}`,
      [reason, `${ICONS.check} Allow once`, `${ICONS.toolError} Reject`],
      state.overlay.selected + 1,
    ))
  } else if (state.overlay.kind === 'question') {
    overlay = React.createElement(Text, { color: COLORS.accent }, renderOverlay(
      state.width,
      'Question',
      [state.overlay.prompt, ...state.overlay.options],
      state.overlay.selected + 1,
    ))
  }

  const sidebar = layout.sidebar === undefined
    ? null
    : React.createElement(Box, { width: layout.sidebar.width, flexDirection: 'column', paddingRight: 1 },
      React.createElement(Text, { color: COLORS.mark }, renderSidebar(layout.sidebar.width, state.title, status, home)))

  void CHROME_COMMANDS
  return React.createElement(Box, { flexDirection: 'column', width: state.width, height: state.height },
    React.createElement(Box, { height: layout.header.height },
      React.createElement(Text, { color: COLORS.logo, bold: true }, renderHeader(state.width, status, compact))),
    React.createElement(Box, { flexDirection: 'row', height: layout.main.height },
      sidebar,
      React.createElement(Box, { flexDirection: 'column', width: mainWidth, overflow: 'hidden' },
        overlay === null ? main : overlay)),
    React.createElement(Box, { height: layout.editor.height, borderStyle: 'round', borderColor: COLORS.accent },
      React.createElement(Text, { color: COLORS.user }, state.input === '' ? ' ' : state.input)),
    React.createElement(Box, { height: 1 },
      React.createElement(Text, { color: COLORS.muted }, formatStatusLine(status, state.width))),
  )
}
