/**
 * The TUI app's command-line provider: it parses the task positional, Session
 * identity, and help, then publishes {@link TUI_STARTUP_SERVICE}. The runtime
 * is an ordinary consumer whose lazy config waits for that service.
 * @module @hyperai/hyperai-harness-tui/startup
 */

import { Command } from 'commander'
import type { Context } from '@deepseek-ai/cordis'
import { parseCmdline } from '@deepseek-ai/dsh-cmdline'

/** Stable Cordis plugin name. */
export const name = 'tui-startup'

/** Services required before the invocation can be resolved. */
export const inject = ['cmdlineArgs']

/** Service provided by this plugin and injected by the TUI runtime. */
export const TUI_STARTUP_SERVICE = 'tuiStartup'

/** What the runtime row reads from {@link TUI_STARTUP_SERVICE}. */
export interface TuiStartupValues {
  /** The task text this invocation asked for; absent starts an empty interactive session. */
  task: string | undefined
  /** Exact Session identity to resume; absent starts a fresh session. */
  sessionId: string | undefined
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Parsed arguments of this TUI invocation. */
    tuiStartup: TuiStartupValues
  }
}

/**
 * This app's command: the task positional, its options, and its help text.
 * @returns a fresh program, so one process can parse more than once (tests).
 */
function tuiCommand(): Command {
  return new Command()
    .name('dsh --profile tui')
    .description('Drive the HyperAI terminal UI over one live session.')
    .helpOption('-h, --help', 'show this help')
    .option('--session-id <id>', 'resume the persisted Session with this id; an unknown id is an error')
    .option('--resume <id>', 'alias of --session-id')
    .argument('[task...]', 'the first task text; multiple words are joined by spaces')
    .addHelpText('after', `
Examples:
  dsh --profile tui                       start an interactive session
  dsh --profile tui "run the tests"       start with a first task
  dsh --profile tui --resume session-…    resume a persisted Session
`)
}

/**
 * Parse and provide the TUI invocation as an ordinary Cordis service.
 * @param ctx - plugin context carrying the command line.
 */
export function apply(ctx: Context): void {
  const program = tuiCommand()
  program.action(() => {
    const joined = program.args.join(' ')
    const task = program.args.length === 0 || joined.trim() === '' ? undefined : joined
    const options = program.opts<{ sessionId?: string; resume?: string }>()
    // A SessionId is opaque, so whitespace is part of the identity: validate
    // emptiness on the trimmed value but hand the runtime the exact string.
    const sessionId = options.sessionId ?? options.resume
    if (sessionId !== undefined && sessionId.trim() === '') {
      program.error('error: --resume requires a non-empty session id')
    }
    ctx.provide(TUI_STARTUP_SERVICE, {
      task,
      sessionId,
    } satisfies TuiStartupValues)
  })
  parseCmdline(ctx, program)
}
