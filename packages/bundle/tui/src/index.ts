/**
 * @deepseek-ai/dsh-tui — Crush-style interactive terminal UI over official
 * DeepSeek Harness services. The bundle patch rides over dsh-base; this
 * runner creates or resumes one Agent through the core registry, mounts the
 * Ink chrome, and stays interactive until the launcher exit hook fires.
 *
 * @module @deepseek-ai/dsh-tui
 */

import { createElement, type ReactElement } from 'react'
import { render as inkRender } from 'ink'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { App } from './app.ts'
import { TuiController } from './controller.ts'

/** Stable Cordis plugin name. */
export const name = 'tui-runner'

/** Core services required before the interactive surface can start. */
export const inject = ['agentDefaultModel', 'agents', 'sessions']

/** Plugin config: resume id and optional opening prompt from the startup service. */
export interface Config {
  /** Persisted session id to resume, when the invocation named one. */
  resume?: string
  /** Optional opening prompt submitted after the TUI attaches a session. */
  prompt?: string
}

export const Config: z<Config> = z.object({
  resume: z.string(),
  prompt: z.string(),
})

/** Process-facing effects of one run; tests substitute a no-op renderer. */
export interface TuiIo {
  /** Ink (or test) renderer. */
  render(element: ReactElement): { unmount(): void }
  stdout: { columns?: number; rows?: number }
  stderr: { write(chunk: string): unknown }
  /** Request process exit with `code` after the tree disposes. */
  exit(code: number): void
}

/** The renderer and streams the runner uses; tests substitute captures. */
export const internals: {
  render: TuiIo['render']
  stdout: TuiIo['stdout']
  stderr: TuiIo['stderr']
} = {
  render: (element: ReactElement) => inkRender(element),
  stdout: process.stdout,
  stderr: process.stderr,
}

/** Report an unexpected TUI failure and request a failing exit. */
function fail(io: TuiIo, error: unknown): void {
  io.stderr.write(`dsh: ${error instanceof Error ? error.message : String(error)}\n`)
  io.exit(1)
}

/**
 * Mount the Crush-style Ink surface over official DSH services.
 * @param ctx - plugin context carrying Agent, default model, Session, and launcher IO.
 * @param config - validated startup config.
 * @param io - process-facing effects.
 */
async function run(ctx: Context, config: Config, io: TuiIo): Promise<void> {
  await ctx.get('loader')?.await()
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  if (agents === undefined || defaultModel === undefined) return

  const selection = defaultModel.currentSelection()
  const guidance = await TuiController.guidance(ctx)
  const controller = new TuiController(ctx, { exit: io.exit }, {
    width: io.stdout.columns ?? 80,
    height: io.stdout.rows ?? 24,
    cwd: process.cwd(),
    provider: selection.provider,
    model: selection.model,
    ...(guidance === undefined ? {} : { guidance }),
  })
  io.render(createElement(App, { controller }))
  await controller.start(config.resume)
  if (config.prompt !== undefined && config.prompt.trim() !== '') {
    await controller.submit(config.prompt)
  }
}

/**
 * Mount the Crush-style TUI runner.
 * @param ctx - plugin context carrying core services and the launcher-provided exit request.
 * @param config - validated startup config.
 */
export function apply(ctx: Context, config: Config): void {
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    throw new Error('tui-runner: the launcher must provide ctx.appExit before the tree mounts')
  }
  const io: TuiIo = { render: internals.render, stdout: internals.stdout, stderr: internals.stderr, exit }
  void run(ctx, config, io).catch((error: unknown) => { fail(io, error) })
}
