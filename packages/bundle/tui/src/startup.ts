/**
 * The TUI app command-line provider. Parses resume, optional opening
 * prompt, and help, then publishes TUI_STARTUP_SERVICE.
 * @module @deepseek-ai/dsh-tui/startup
 */

import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'tui-startup'

/** Services required before the flags can be resolved. */
export const inject = ['cmdlineArgs']

/** Service provided by this plugin and injected by the TUI runner. */
export const TUI_STARTUP_SERVICE = 'tuiStartup'

/** What the runner row reads from TUI_STARTUP_SERVICE. */
export interface TuiStartupValues {
  /** Resume session id, when the invocation named one. */
  resume?: string
  /** Optional opening prompt submitted after the TUI attaches a session. */
  prompt?: string
}
interface TuiOptions { resume?: string }

function tuiCommand(): Command {
  const resumeFlag = '-' + '-resume <session>'
  const profileName = 'dsh -' + '-profile tui'
  return new Command()
    .name(profileName)
    .description('Interactive Crush-style terminal UI over DeepSeek Harness.')
    .helpOption('-h, -' + '-help', 'show this help')
    .option(resumeFlag, 'resume a persisted session id')
    .argument('[prompt...]', 'optional opening prompt; stay in the interactive TUI after it')
}

/**
 * Parse and provide the TUI invocation as an ordinary Cordis service.
 * @param ctx - plugin context carrying the command line.
 */
export function apply(ctx: Context): void {
  const program = tuiCommand()
  program.action(() => {
    const options = program.opts<TuiOptions>()
    const prompt = program.args.join(' ')
    ctx.provide(TUI_STARTUP_SERVICE, {
      ...(options.resume !== undefined && options.resume !== '' ? { resume: options.resume } : {}),
      ...(prompt.trim() === '' ? {} : { prompt }),
    } satisfies TuiStartupValues)
  })
  parseCmdline(ctx, program)
}
