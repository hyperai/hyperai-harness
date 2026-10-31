/**
 * @hyperai/hyperai-harness-tui — the TUI direct driver: it creates one Agent
 * through the core registry (or resumes the exact Session a `--resume` names),
 * runs the interactive terminal loop over it, and streams live deltas into the
 * OpenTUI session view. User input feeds `followup()` / `steer()`, Esc cancels
 * the live turn, and the composed approval and question answerers surface
 * human decisions in modal overlays.
 * @module @hyperai/hyperai-harness-tui
 */

import { randomUUID } from 'node:crypto'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { brandString } from '@deepseek-ai/dsh-brand'
import type { Agent, AgentOptions } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import { installModelSelection } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-fs'
import { createUserMessage, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import type { SessionId } from '@deepseek-ai/dsh-session'
import type {} from '@deepseek-ai/dsh-session-query'
import { setApprovalPolicy } from '@deepseek-ai/dsh-user-approval'
import type {} from '@deepseek-ai/dsh-permission-presets'
import type {} from '@deepseek-ai/dsh-token-meter'
// Empty type imports carry the loader Context merge for the application await,
// the cmdline Context merge for the appExit host value, and the sessionQuery
// Context merge for exact Session resume.
import type {} from '@deepseek-ai/cordis-plugin-loader'
import type {} from '@deepseek-ai/dsh-cmdline'
import { registerAnswerers } from './answerers.ts'
import { TuiSurface, type SessionRow } from './view.ts'
import { loadSettings, t } from './locale.ts'

/** Reasoning efforts cycled by `/effort`, in increasing order. */
const EFFORTS = ['off', 'low', 'high', 'max'] as const

/** Stable Cordis plugin name. */
export const name = 'tui-runtime'

/** Core services required before a session can start. */
export const inject = ['tuiStartup', 'agentDefaultModel', 'agents', 'sessions']

/** Plugin config: the task and Session identity resolved from the injected startup service. */
export interface Config {
  /** The first task text; absent waits for composer input. */
  task?: string
  /** Exact Session identity to resume; absent for a fresh random identity. */
  sessionId?: string
}

export const Config: z<Config> = z.object({
  task: z.string(),
  sessionId: z.string(),
})

/** Process-facing effects: the launcher's bounded exit request. */
interface TuiIo {
  /** Request process exit with `code` after the tree disposes. */
  exit(code: number): void
}

/**
 * Resume the persisted Session with this identity, refusing a composition that
 * cannot keep the log alive after this process exits.
 * @param ctx - plugin context carrying persistence and query services.
 * @param agents - the core Agent registry.
 * @param sessionId - exact Session identity to resume.
 * @param agentOptions - provider/model pair for this run.
 * @param setup - per-Agent scope setup installing the model selection.
 * @returns the resumed Agent.
 */
async function resumeAgent(
  ctx: Context,
  agents: Context['agents'],
  sessionId: SessionId,
  agentOptions: AgentOptions,
  setup: (agentCtx: Context, agent: Agent) => void | Promise<void>,
): Promise<Agent> {
  // Resuming promises the caller a log a later process can continue; without a
  // durable log the whole history dies at exit, so a miscomposed profile fails
  // loud before the resume.
  if (ctx.get('sessionPersistence') === undefined) {
    throw new Error('tui --resume requires the sessionPersistence service; the Session would not survive this process')
  }
  const query = ctx.get('sessionQuery')
  if (query === undefined) {
    throw new Error('tui --resume requires the sessionQuery service; dsh-base provides it')
  }
  const live = agents.get(sessionId)
  if (live !== undefined) {
    throw new Error(`session "${sessionId}" is live in this process; only one surface may drive a session`)
  }
  const { agent } = await agents.resume({ resumeSessionId: sessionId, agentOptions, setup })
  return agent
}

/**
 * Run the interactive TUI loop: create or resume its Agent, wire the terminal
 * surface and answerers, and leave through the user's quit gesture.
 * @param ctx - plugin context carrying core services and the launcher-provided exit request.
 * @param config - validated task and Session identity.
 * @param io - process-facing effects.
 */
async function run(ctx: Context, config: Config, io: TuiIo): Promise<void> {
  // Loader siblings mount concurrently. Await the complete application before
  // creating an Agent so its scoped tools and adapters are not half-composed.
  await ctx.get('loader')?.await()
  const agents = ctx.get('agents')
  const defaultModel = ctx.get('agentDefaultModel')
  const sessions = ctx.get('sessions')
  // Early process shutdown can dispose the tree while the run is pending.
  if (agents === undefined || defaultModel === undefined || sessions === undefined) return

  if (config.sessionId !== undefined && config.sessionId.trim() === '') {
    throw new Error('tui-runtime: sessionId must not be blank')
  }

  const selection = defaultModel.currentSelection()
  const agentOptions: AgentOptions = { ...selection }
  const setup = (agentCtx: Context, agent: Agent): void => {
    if (config.sessionId !== undefined) {
      const previous = agent.model.current()
      const configured = { ...selection }
      if (configured.reasoningEffort === undefined && previous !== undefined
        && previous.provider === configured.provider && previous.model === configured.model
        && previous.reasoningEffort !== undefined) {
        configured.reasoningEffort = previous.reasoningEffort
      }
      agent.model.select(configured)
    }
    installModelSelection(agentCtx)
  }
  const sessionId = brandString<SessionId>(config.sessionId ?? `session-${randomUUID()}`)
  const fs = ctx.get('fs')
  const cwd = fs === undefined ? process.cwd() : fs.processPath(await fs.resolve('.'))
  let agent: Agent = config.sessionId === undefined
    ? (await agents.create({ sessionId, meta: { cwd }, agentOptions, setup })).agent
    : await resumeAgent(ctx, agents, sessionId, agentOptions, setup)
  let currentSessionId = sessionId

  const surface = new TuiSurface()
  let quit: (() => void) | undefined
  const stopped = new Promise<void>((resolve) => { quit = resolve })

  const disposeAnswerers = registerAnswerers(ctx, surface, subject => subject === agent)
  const toolNames = new Map<string, string>()
  const stopStream = ctx.on('agent/assistant-stream', ({ agent: subject, frame }) => {
    if (subject !== agent) return
    if (frame.type === 'start') return
    if (frame.type === 'end') {
      surface.settleThinking()
      return
    }
    const chunk = frame.chunk
    if (chunk.type === 'text-delta') surface.appendAssistant(chunk.text)
    else if (chunk.type === 'reasoning-delta') surface.appendThinking(chunk.text)
  })
  const stopEvents = ctx.on('session/event', (session, event) => {
    if (session !== agent.session) return
    if (event.type === 'turn/start') {
      surface.countTurn()
      surface.setRunning(true)
    } else if (event.type === 'turn/end') {
      surface.setRunning(false)
      const reason = event.data.reason
      if (reason.kind === 'error') {
        surface.notice(`[error] ${reason.error.code}: ${reason.error.message}`)
      } else if (reason.kind === 'aborted') {
        surface.notice(t().aborted)
      }
      // Live usage metrics and a completion notice, both best-effort.
      const meter = ctx.get('tokenMeter')
      const pressure = meter?.contextPressure(agent.session)
      const tokens = pressure?.pressureTokens
      if (pressure !== undefined && typeof tokens === 'number') {
        surface.setMetrics(`ctx ${String(tokens)}/${String(pressure.contextWindow)}`)
      }
      if (reason.kind === 'completed') surface.notify(t().idle)
    } else if (event.type === 'tool/call') {
      toolNames.set(event.data.callId, event.data.name)
      surface.beginTool(event.data.name, summarizeArgs(event.data.arguments))
    } else if (event.type === 'tool/result') {
      const name = toolNames.get(event.data.message.toolCallId) ?? 'tool'
      surface.endTool(name, event.data.error === undefined,
        event.data.error === undefined ? t().toolDone : event.data.error.code)
    }
  })

  const home = process.env.DSH_HOME !== undefined && process.env.DSH_HOME.trim() !== ''
    ? process.env.DSH_HOME
    : join(homedir(), '.dsh')
  loadSettings(home)

  /**
   * Switch the driven session: settle the current Agent, then create or resume
   * the next one and repaint the surface identity.
   * @param target - persisted Session id to resume, or undefined for a fresh one.
   */
  const switchSession = async (target?: string): Promise<void> => {
    agent.cancel({ kind: 'user' })
    await agent.whenIdle()
    await sessions.flush(agent.session)
    const nextId = target === undefined || target === ''
      ? brandString<SessionId>(`session-${randomUUID()}`)
      : brandString<SessionId>(target)
    agent = target === undefined || target === ''
      ? (await agents.create({ sessionId: nextId, meta: { cwd }, agentOptions, setup })).agent
      : await resumeAgent(ctx, agents, nextId, agentOptions, setup)
    currentSessionId = nextId
    surface.setSessionId(nextId)
    surface.notice(`[session ${nextId}]`)
    surface.setRunning(false)
  }

  const approval = ctx.get('approval')
  let policy: string = approval?.overrideOf(agent.session) ?? 'ask'
  const effortOf = (): string => agent.model.current()?.reasoningEffort ?? 'default'
  await surface.start({
    onSend(text) {
      agent.followup(createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
      }))
    },
    onSteer(text) {
      agent.steer(createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'user' },
      }))
    },
    onCancel() {
      agent.cancel({ kind: 'user' })
    },
    onQuit() {
      quit?.()
    },
    onCyclePolicy() {
      const presets = ctx.get('permissionPresets')
      if (presets !== undefined) {
        const options = presets.catalog().options.filter(option => option.value !== 'custom')
        const index = options.findIndex(option => option.value === policy)
        const next = options[(index + 1 + options.length) % Math.max(1, options.length)]
        if (next !== undefined) {
          presets.set(agent.session, next.value)
          policy = next.value
          surface.setPolicy(next.name)
        }
        return
      }
      policy = policy === 'ask' ? 'never' : 'ask'
      setApprovalPolicy(agent.session, policy === 'never' ? 'never' : 'ask')
      surface.setPolicy(policy)
    },
    onCycleEffort() {
      const current = agent.model.current()
      if (current === undefined) return
      const index = EFFORTS.findIndex(effort => effort === current.reasoningEffort)
      const next = EFFORTS[(index + 1 + EFFORTS.length) % EFFORTS.length] ?? 'high'
      agent.model.select({ ...current, reasoningEffort: ReasoningEffortId(next) })
      surface.setEffort(next)
    },
    onResume(sessionId) {
      if (sessionId !== '') {
        void switchSession(sessionId)
        return
      }
      const query = ctx.get('sessionQuery')
      if (query === undefined) {
        surface.notice('sessionQuery unavailable')
        return
      }
      void (async () => {
        const records = await query.listSessions()
        const titles = await query.readTitleSnapshots(records.map(record => record.header.id))
        const titleById = new Map<string, string>()
        for (const result of titles) {
          if (result.status === 'fulfilled' && result.value.title !== undefined) {
            titleById.set(result.sessionId, result.value.title.title)
          }
        }
        const rows: SessionRow[] = records.slice(0, 20).map(record => ({
          id: record.header.id,
          title: titleById.get(record.header.id) ?? '',
          live: record.live,
          current: record.header.id === currentSessionId,
        }))
        surface.showSessions(rows)
      })()
    },
    onNew() {
      void switchSession(undefined)
    },
  }, {
    session: sessionId,
    model: `${selection.provider}/${selection.model}`,
    cwd,
  }, home)
  surface.setPolicy(policy)
  surface.setEffort(effortOf())

  // An optional first task from the command line enters through the same
  // composer path an interactive message would take.
  if (config.task !== undefined && config.task.trim() !== '') {
    surface.addUser(config.task, false)
    agent.followup(createUserMessage({
      content: [{ type: 'text', text: config.task }],
      source: { kind: 'user' },
    }))
  }

  try {
    await stopped
    agent.cancel({ kind: 'user' })
    await agent.whenIdle()
    await sessions.flush(agent.session)
  } finally {
    stopStream()
    stopEvents()
    disposeAnswerers()
    surface.destroy()
  }
  io.exit(0)
}

/**
 * Summarize a tool call's arguments for its one-line card.
 * @param args - the durable call's argument text.
 * @returns a short argument summary.
 */
function summarizeArgs(args: string): string {
  return args.length > 60 ? `${args.slice(0, 57)}...` : args
}

/**
 * Mount the TUI direct driver.
 * @param ctx - plugin context carrying core services and the launcher-provided exit request.
 * @param config - validated task and Session identity.
 */
export function apply(ctx: Context, config: Config): void {
  // Read through the global service store, not the property proxy: appExit is
  // an optional host value, never an injected dependency.
  const exit = ctx.get('appExit')
  if (exit === undefined) {
    throw new Error('tui-runtime: the launcher must provide ctx.appExit before the tree mounts')
  }
  const io: TuiIo = { exit }
  void run(ctx, config, io).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error)
    process.stderr.write(`dsh: ${message}\n`)
    exit(1)
  })
}
