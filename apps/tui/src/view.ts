/**
 * The OpenTUI terminal surface: HyperAI header, live status bar, scrolling
 * transcript, bordered composer, and the help/tools/model/approval/question
 * overlays. Pure presentation — it renders the view model the driver feeds it
 * and reports user gestures through {@link TuiEvents}; it never reaches a
 * Cordis service.
 * @module @hyperai/hyperai-harness-tui/view
 */

import {
  BoxRenderable,
  InputRenderable,
  InputRenderableEvents,
  ScrollBoxRenderable,
  StyledText,
  TextRenderable,
  createCliRenderer,
  fg as fgRun,
  bold as boldRun,
  setRenderLibPath,
  type CliRenderer,
  type KeyEvent,
  type TextChunk,
} from '@opentui/core'
import { type Chunk, chunk, theme } from './theme.ts'
import { bannerLines, TUI_VERSION } from './banner.ts'
import { t, currentSettings, toggleLang, toggleNotifications } from './locale.ts'
import {
  appendAssistant,
  appendBanner,
  appendNotice,
  appendThinking,
  appendUser,
  beginTool,
  createTranscript,
  endTool,
  renderLine,
  renderToolDetail,
  settleThinking,
  type QuestionAnswerItemView,
  type QuestionItemView,
  type Transcript,
} from './transcript.ts'
import { PromptHistory } from './history.ts'

/** Approval decision the modal can return. */
export type ApprovalChoice = 'allowed-once' | 'rejected' | 'cancelled'

/** User gestures reported to the driver. */
export interface TuiEvents {
  /** Composer Enter: submit a follow-up task. */
  onSend(text: string): void
  /** Ctrl+J: steer the submitted text into the live turn. */
  onSteer(text: string): void
  /** Esc while running: cancel the current turn. */
  onCancel(): void
  /** Ctrl+C while idle: leave the TUI. */
  onQuit(): void
  /** Shift+Tab: cycle the session's permission preset. */
  onCyclePolicy(): void
  /** `/effort`: cycle the reasoning effort. */
  onCycleEffort(): void
  /** Session picker Enter: switch to a persisted session. */
  onResume(sessionId: string): void
  /** `/new`: start a fresh session. */
  onNew(): void
}

/** One row of the session picker. */
export interface SessionRow {
  /** Session identity. */
  id: string
  /** Display title. */
  title: string
  /** Whether a live agent owns the session in this process. */
  live: boolean
  /** Whether this is the session the TUI currently drives. */
  current: boolean
}

/** Session facts the header and banner show. */
export interface TuiInfo {
  /** Session identity. */
  session: string
  /** Routed provider/model label. */
  model: string
  /** The workspace directory. */
  cwd: string
}

/** Modal/overlay kinds the surface can present. */
type OverlayKind = 'approval' | 'questions' | 'question-text' | 'help' | 'tools' | 'model' | 'sessions' | 'settings'

/**
 * Convert one styled run to an OpenTUI text chunk.
 * @param run - the run carrying text, color, and weight.
 * @returns the chunk for a StyledText list.
 */
function toChunk(run: Chunk): TextChunk {
  let input: string | TextChunk = run.text
  if (run.bold === true) input = boldRun(input)
  if (run.fg !== undefined) return fgRun(run.fg)(input)
  return typeof input === 'string' ? { __isChunk: true, text: input } : input
}

/**
 * Paint chunk rows as one multi-line StyledText.
 * @param rows - the chunk rows.
 * @returns the styled text for a TextRenderable.
 */
function toStyled(rows: readonly Chunk[][]): StyledText {
  const chunks: TextChunk[] = []
  for (const row of rows) {
    for (const run of row) chunks.push(toChunk(run))
    chunks.push({ __isChunk: true, text: '\n' })
  }
  return new StyledText(chunks)
}

/** The terminal UI: owns the renderer and every renderable. */
export class TuiSurface {
  #renderer: CliRenderer | undefined
  #scroll: ScrollBoxRenderable | undefined
  #transcriptText: TextRenderable | undefined
  #status: TextRenderable | undefined
  #input: InputRenderable | undefined
  #composer: BoxRenderable | undefined
  #overlay: BoxRenderable | undefined
  #overlayText: TextRenderable | undefined
  #transcript: Transcript = createTranscript()
  #events: TuiEvents | undefined
  #info: TuiInfo = { session: '', model: '', cwd: '' }
  #sessionLabel: TextRenderable | undefined
  #overlayKind: OverlayKind | undefined
  #approvalPick = 0
  #questionIndex = 0
  #questionPicks = new Map<number, Set<number>>()
  #questionDraft = ''
  #pendingQuestions: QuestionItemView[] = []
  #resolveApproval: ((choice: ApprovalChoice) => void) | undefined
  #resolveQuestions: ((answers: QuestionAnswerItemView[]) => void) | undefined
  #running = false
  #policy = 'ask'
  #effort = ''
  #metrics = ''
  #exitArmed = false
  #exitTimer: NodeJS.Timeout | undefined
  #sessions: SessionRow[] = []
  #sessionPick = 0
  #history: PromptHistory | undefined
  #spinTimer: NodeJS.Timeout | undefined
  #turns = 0
  #steps = 0

  /**
   * Bring up the renderer and the composed layout.
   * @param events - user-gesture sink.
   * @param info - session facts for the header and banner.
   * @param home - the Harness home for prompt-history persistence.
   */
  async start(events: TuiEvents, info: TuiInfo, home: string): Promise<void> {
    this.#events = events
    this.#info = info
    this.#history = new PromptHistory(home)
    // The packaged runtime pins the OpenTUI native library beside the
    // executable: node:ffi dlopen cannot see inside the SEA snapshot.
    const pinnedNativeLib = process.env.HYPERAI_TUI_NATIVE_LIB
    if (pinnedNativeLib !== undefined && pinnedNativeLib !== '') setRenderLibPath(pinnedNativeLib)
    const renderer = await createCliRenderer({ exitOnCtrlC: true })
    this.#renderer = renderer

    const root = new BoxRenderable(renderer, {
      id: 'root',
      width: '100%',
      height: '100%',
      flexDirection: 'column',
      backgroundColor: theme.background,
    })
    renderer.root.add(root)

    // ── header ──────────────────────────────────────────────────────────
    const header = new BoxRenderable(renderer, {
      id: 'header',
      width: '100%',
      height: 4,
      border: true,
      borderColor: theme.primary,
      backgroundColor: theme.surface,
      title: ' HyperAI ',
      titleColor: theme.primary,
      flexDirection: 'column',
    } as never)
    const titleRow = new BoxRenderable(renderer, { id: 'title-row', width: '100%', flexDirection: 'row' })
    const title = new TextRenderable(renderer, {
      id: 'title',
      width: 'auto',
      content: toStyled([[chunk(' ▓ HyperAI TUI', theme.primary, true), chunk(` v${TUI_VERSION}`, theme.muted)]]),
    })
    const session = new TextRenderable(renderer, {
      id: 'session-id',
      width: 'auto',
      fg: theme.muted,
      content: `session ${info.session} `,
    })
    this.#sessionLabel = session
    const spacer = new BoxRenderable(renderer, { id: 'title-spacer', width: '100%', flexGrow: 1 })
    titleRow.add(title)
    titleRow.add(spacer)
    titleRow.add(session)
    const subRow = new BoxRenderable(renderer, { id: 'sub-row', width: '100%', flexDirection: 'row' })
    const modelText = new TextRenderable(renderer, {
      id: 'model',
      width: 'auto',
      content: toStyled([[chunk(`  ${info.model}`, theme.accent, true)]]),
    })
    const cwdText = new TextRenderable(renderer, {
      id: 'cwd',
      width: 'auto',
      fg: theme.muted,
      content: `  ${info.cwd} `,
    })
    const subSpacer = new BoxRenderable(renderer, { id: 'sub-spacer', width: '100%', flexGrow: 1 })
    subRow.add(modelText)
    subRow.add(subSpacer)
    subRow.add(cwdText)
    header.add(titleRow)
    header.add(subRow)

    // ── status bar ──────────────────────────────────────────────────────
    this.#status = new TextRenderable(renderer, { id: 'status', width: '100%', height: 1, content: '' })

    // ── transcript ──────────────────────────────────────────────────────
    this.#scroll = new ScrollBoxRenderable(renderer, {
      id: 'session',
      width: '100%',
      height: '100%',
      flexGrow: 1,
      stickyScroll: true,
      border: true,
      borderColor: theme.border,
      title: ' Session ',
      titleColor: theme.muted,
    } as never)
    this.#transcriptText = new TextRenderable(renderer, { id: 'transcript', width: '100%', content: '' })
    this.#scroll.add(this.#transcriptText)

    // ── composer ────────────────────────────────────────────────────────
    const composer = new BoxRenderable(renderer, {
      id: 'composer',
      width: '100%',
      height: 3,
      border: true,
      borderColor: theme.primary,
      backgroundColor: theme.surface,
      title: ' Message ',
      titleColor: theme.secondary,
    })
    this.#input = new InputRenderable(renderer, {
      id: 'composer-input',
      width: '100%',
      placeholder: 'Type a task and press Enter...',
      onKeyDown: (key): void => { this.#onKeyDown(key) },
    })
    composer.add(this.#input)
    this.#composer = composer

    this.#overlay = new BoxRenderable(renderer, {
      id: 'overlay',
      width: '82%',
      height: '70%',
      position: 'absolute',
      left: '9%',
      top: '15%',
      zIndex: 100,
      border: true,
      borderColor: theme.secondary,
      backgroundColor: theme.surface,
      title: '',
      visible: false,
    } as never)
    this.#overlayText = new TextRenderable(renderer, { id: 'overlay-text', width: '100%', height: '100%', content: '' })
    this.#overlay.add(this.#overlayText)

    root.add(header)
    root.add(this.#status)
    root.add(this.#scroll)
    root.add(composer)
    renderer.root.add(this.#overlay)

    this.#input.on(InputRenderableEvents.ENTER, () => { this.#onSubmit() })

    appendBanner(this.#transcript, bannerLines(info))
    this.#repaintTranscript()
    this.#renderStatus()
    renderer.start()
    this.#input.focus()
    this.#spinTimer = setInterval(() => {
      this.#transcript.spinner += 1
      if (this.#running) this.#repaintTranscript()
    }, 140)
  }

  /** Tear down the renderer and restore the terminal. */
  destroy(): void {
    if (this.#spinTimer !== undefined) clearInterval(this.#spinTimer)
    if (this.#exitTimer !== undefined) clearTimeout(this.#exitTimer)
    this.#spinTimer = undefined
    this.#exitTimer = undefined
    this.#renderer?.destroy()
    this.#renderer = undefined
  }

  /**
   * Append a user prompt line.
   * @param text - the prompt text.
   * @param steer - whether the prompt steered a live turn.
   */
  addUser(text: string, steer: boolean): void {
    appendUser(this.#transcript, text, steer)
    this.#repaintTranscript()
  }

  /**
   * Append a streamed model text delta.
   * @param delta - the streamed text.
   */
  appendAssistant(delta: string): void {
    appendAssistant(this.#transcript, delta)
    this.#repaintTranscript()
  }

  /**
   * Append a streamed reasoning delta.
   * @param delta - the streamed reasoning text.
   */
  appendThinking(delta: string): void {
    appendThinking(this.#transcript, delta)
    this.#repaintTranscript()
  }

  /** Settle the open thinking line when its stream ends. */
  settleThinking(): void {
    settleThinking(this.#transcript)
    this.#repaintTranscript()
  }

  /**
   * Open a running tool card.
   * @param name - the tool name.
   * @param args - a short argument preview.
   */
  beginTool(name: string, args: string): void {
    beginTool(this.#transcript, name, args)
    this.#repaintTranscript()
  }

  /**
   * Settle the running tool card.
   * @param name - the tool name.
   * @param ok - whether the call succeeded.
   * @param summary - a short result summary.
   */
  endTool(name: string, ok: boolean, summary: string): void {
    endTool(this.#transcript, name, ok, summary)
    this.#repaintTranscript()
  }

  /**
   * Append a driver notice line.
   * @param text - the notice text.
   */
  notice(text: string): void {
    appendNotice(this.#transcript, text)
    this.#repaintTranscript()
  }

  /**
   * Publish the driver's run state to the status bar.
   * @param running - whether a turn is in flight.
   */
  setRunning(running: boolean): void {
    this.#running = running
    if (running) this.#steps += 1
    this.#renderStatus()
  }

  /** Count a new turn on the status bar. */
  countTurn(): void {
    this.#turns += 1
    this.#steps = 0
    this.#renderStatus()
  }

  /**
   * Publish a session switch to the header identity.
   * @param sessionId - the new session identity.
   */
  setSessionId(sessionId: string): void {
    this.#info = { ...this.#info, session: sessionId }
    if (this.#sessionLabel !== undefined) this.#sessionLabel.content = `session ${sessionId} `
    this.#renderStatus()
  }

  /**
   * Publish the routed model label.
   * @param model - the provider/model label.
   */
  setModelLabel(model: string): void {
    this.#info = { ...this.#info, model }
    this.#renderStatus()
  }

  /**
   * Publish the active approval policy / permission label.
   * @param policy - the label shown in the status bar.
   */
  setPolicy(policy: string): void {
    this.#policy = policy
    this.#renderStatus()
    if (this.#composer !== undefined) {
      this.#composer.borderColor = policy.includes('never') || policy.includes('danger')
        ? theme.warning
        : theme.primary
    }
  }

  /**
   * Publish the active reasoning effort.
   * @param effort - the effort label.
   */
  setEffort(effort: string): void {
    this.#effort = effort
    this.#renderStatus()
  }

  /**
   * Publish live usage metrics for the status bar.
   * @param metrics - a preformatted metrics fragment.
   */
  setMetrics(metrics: string): void {
    this.#metrics = metrics
    this.#renderStatus()
  }

  /**
   * Populate the session picker and open it.
   * @param sessions - the picker rows, newest first.
   */
  showSessions(sessions: SessionRow[]): void {
    this.#sessions = sessions
    this.#sessionPick = sessions.findIndex(row => row.current)
    if (this.#sessionPick < 0) this.#sessionPick = 0
    this.#overlayKind = 'sessions'
    this.#setOverlayTitle(t().sessionsTitle)
    this.#renderOverlay()
  }

  /**
   * Fire a desktop notification (OSC 9) with a BEL fallback.
   * @param body - the notification body.
   */
  notify(body: string): void {
    if (this.#renderer === undefined) return
    if (currentSettings().notifications) {
      process.stdout.write(`\x1b]9;${t().notifyTitle}: ${body}\x07`)
    }
  }

  /**
   * Present the approval modal and resolve with the user's decision.
   * @param toolName - the tool being decided.
   * @param reason - the asker's explanation, when present.
   * @returns the decision the user picked.
   */
  askApproval(toolName: string, reason?: string): Promise<ApprovalChoice> {
    this.#overlayKind = 'approval'
    this.#approvalPick = 0
    this.#pendingQuestions = []
    this.#setOverlayTitle(` Approve · ${toolName} `)
    this.#renderOverlay(reason)
    return new Promise((resolve) => { this.#resolveApproval = resolve })
  }

  /**
   * Present the questions modal and resolve with the batch of answers.
   * @param questions - the questions to answer.
   * @returns one answer item per question id.
   */
  askQuestions(questions: QuestionItemView[]): Promise<QuestionAnswerItemView[]> {
    this.#overlayKind = 'questions'
    this.#questionIndex = 0
    this.#questionPicks = new Map()
    this.#questionDraft = ''
    this.#pendingQuestions = questions
    this.#setOverlayTitle(' Question ')
    this.#renderOverlay()
    return new Promise((resolve) => { this.#resolveQuestions = resolve })
  }

  #setOverlayTitle(title: string): void {
    if (this.#overlay !== undefined) (this.#overlay as unknown as { title: string }).title = title
  }

  #repaintTranscript(): void {
    if (this.#transcriptText === undefined) return
    const rows = this.#transcript.lines.map(line => renderLine(line, this.#transcript.spinner))
    this.#transcriptText.content = toStyled(rows)
    // stickyScroll alone does not follow content that grows past the
    // viewport; pin to the bottom explicitly so late lines stay visible.
    this.#scroll?.scrollTo({ x: 0, y: Infinity })
  }

  #renderStatus(): void {
    if (this.#status === undefined) return
    const m = t()
    const state = this.#running
      ? ['◐', '◓', '◑', '◒'][this.#transcript.spinner % 4] ?? '◌'
      : '●'
    const stateColor = this.#running ? theme.warning : theme.success
    const rows: Chunk[][] = [[
      chunk(` ${state} `, stateColor, true),
      chunk(`${this.#running ? m.running : m.idle} `, stateColor),
      chunk('│ ', theme.border),
      chunk(`turn ${this.#turns} · step ${this.#steps}`, theme.muted),
      chunk(' │ ', theme.border),
      chunk(`${m.policy} ${this.#policy}`, this.#policy.includes('never') || this.#policy.includes('danger')
        ? theme.warning : theme.secondary, true),
    ]]
    if (this.#effort !== '') {
      rows[0]?.push(chunk(' │ ', theme.border), chunk(`${m.effort} ${this.#effort}`, theme.accent, true))
    }
    if (this.#metrics !== '') {
      rows[0]?.push(chunk(' │ ', theme.border), chunk(this.#metrics, theme.muted))
    }
    rows[0]?.push(chunk(' │ ', theme.border), chunk(m.hints, theme.muted))
    this.#status.content = toStyled(rows)
  }

  /** Rebuild the overlay body from its state. */
  #renderOverlay(detail?: string): void {
    if (this.#overlay === undefined || this.#overlayText === undefined) return
    this.#overlay.visible = true
    const rows: Chunk[][] = []
    if (this.#overlayKind === 'approval') {
      if (detail !== undefined && detail !== '') {
        rows.push([chunk(detail, theme.warning)])
        rows.push([])
      }
      const options: [string, string][] = [
        [t().allowOnce, theme.success],
        [t().reject, theme.error],
        [t().cancel, theme.muted],
      ]
      options.forEach(([label, color], index) => {
        rows.push([chunk(index === this.#approvalPick ? ' › ' : '   ', theme.secondary, true),
          chunk(label, color, index === this.#approvalPick)])
      })
    } else if (this.#overlayKind === 'question-text') {
      rows.push([chunk(t().customPrompt, theme.secondary)])
      rows.push([])
      rows.push([chunk(`draft: ${this.#questionDraft}`, theme.accent, true)])
    } else if (this.#overlayKind === 'questions') {
      for (let index = 0; index < this.#pendingQuestions.length; index += 1) {
        const question = this.#pendingQuestions[index]
        if (question === undefined) continue
        const picked = this.#questionPicks.get(index) ?? new Set<number>()
        rows.push([
          chunk(index === this.#questionIndex ? ' › ' : '   ', theme.secondary, true),
          chunk(question.question, theme.accent, true),
        ])
        if (question.detail !== undefined && question.detail !== '') {
          rows.push([chunk(`    ${question.detail}`, theme.muted)])
        }
        const options = question.options ?? []
        for (let option = 0; option < options.length; option += 1) {
          const label = options[option]?.label ?? ''
          rows.push([chunk(`      (${picked.has(option) ? 'x' : ' '}) `, theme.secondary), chunk(label)])
        }
      }
      rows.push([])
      rows.push([chunk(t().questionHints, theme.muted)])
    } else if (this.#overlayKind === 'help') {
      for (const line of t().helpBody) {
        rows.push(line === '' ? [] : [chunk(line, line.startsWith('  ') ? theme.muted : theme.secondary, !line.startsWith('  '))])
      }
    } else if (this.#overlayKind === 'tools') {
      rows.push([chunk(t().toolsTitle.trim(), theme.secondary, true)])
      const tools = this.#transcript.lines.filter(line => line.kind === 'tool')
      if (tools.length === 0) rows.push([chunk('  —', theme.muted)])
      for (const line of tools) {
        rows.push(...renderToolDetail(line))
        rows.push([])
      }
    } else if (this.#overlayKind === 'model') {
      rows.push([chunk('Model route', theme.secondary, true)])
      rows.push([chunk(`  ${this.#info.model}`, theme.accent, true)])
      rows.push([chunk(`  ${t().effort}: ${this.#effort === '' ? 'default' : this.#effort}`, theme.accent)])
      rows.push([chunk(`  session ${this.#info.session}`, theme.muted)])
      rows.push([chunk(`  cwd ${this.#info.cwd}`, theme.muted)])
      rows.push([])
      rows.push([chunk(t().modelFooter, theme.muted)])
    } else if (this.#overlayKind === 'sessions') {
      if (this.#sessions.length === 0) rows.push([chunk('  —', theme.muted)])
      this.#sessions.forEach((row, index) => {
        const marker = row.current ? '●' : row.live ? '○' : ' '
        rows.push([
          chunk(index === this.#sessionPick ? ' › ' : '   ', theme.secondary, true),
          chunk(`${marker} `, row.current ? theme.success : theme.muted),
          chunk(row.title === '' ? row.id.slice(0, 18) : row.title, index === this.#sessionPick ? theme.accent : undefined),
          chunk(`  ${row.id.slice(0, 8)}`, theme.muted),
        ])
      })
      rows.push([])
      rows.push([chunk(t().sessionsFooter, theme.muted)])
    } else if (this.#overlayKind === 'settings') {
      const s = currentSettings()
      rows.push([chunk(t().settingsLang, theme.secondary, true)])
      rows.push([chunk(`  › ${s.lang === 'en' ? 'English' : '中文'}`, theme.accent, true)])
      rows.push([])
      rows.push([chunk(t().settingsNotifications, theme.secondary, true)])
      rows.push([chunk(`  ${s.notifications ? '[x]' : '[ ]'}`, s.notifications ? theme.success : theme.muted)])
      rows.push([])
      rows.push([chunk(t().settingsFooter, theme.muted)])
    }
    this.#overlayText.content = toStyled(rows)
    this.#input?.focus()
  }

  #closeOverlay(): void {
    if (this.#overlay !== undefined) this.#overlay.visible = false
    this.#overlayKind = undefined
    this.#input?.focus()
  }

  #submitQuestions(): void {
    const answers: QuestionAnswerItemView[] = this.#pendingQuestions.map((question, index) => {
      const picked = this.#questionPicks.get(index) ?? new Set<number>()
      const selected = [...picked]
        .map(option => question.options?.[option]?.label ?? '')
        .filter(label => label !== '')
      return { id: question.id, selected }
    })
    const resolve = this.#resolveQuestions
    this.#resolveQuestions = undefined
    this.#closeOverlay()
    resolve?.(answers)
  }

  #resolveApprovalChoice(choice: ApprovalChoice): void {
    const resolve = this.#resolveApproval
    this.#resolveApproval = undefined
    this.#closeOverlay()
    resolve?.(choice)
  }

  #onSubmit(): void {
    const input = this.#input
    if (input === undefined) return
    const text = input.value
    if (text.trim() === '') return
    input.value = ''
    if (this.#overlayKind === 'question-text') {
      this.#questionDraft = text
      this.#overlayKind = 'questions'
      this.#renderOverlay()
      return
    }
    if (this.#overlayKind !== undefined) return
    if (text.startsWith('/')) {
      this.#dispatchCommand(text.trim())
      return
    }
    this.#history?.push(text)
    this.addUser(text, false)
    this.#events?.onSend(text)
  }

  #dispatchCommand(command: string): void {
    const name = command.split(/\s+/, 1)[0] ?? command
    switch (name) {
      case '/help':
        this.#overlayKind = 'help'
        this.#setOverlayTitle(t().helpTitle)
        this.#renderOverlay()
        return
      case '/tools':
        this.#overlayKind = 'tools'
        this.#setOverlayTitle(t().toolsTitle)
        this.#renderOverlay()
        return
      case '/model':
        this.#overlayKind = 'model'
        this.#setOverlayTitle(t().modelTitle)
        this.#renderOverlay()
        return
      case '/settings':
        this.#overlayKind = 'settings'
        this.#setOverlayTitle(t().settingsTitle)
        this.#renderOverlay()
        return
      case '/effort':
        this.#events?.onCycleEffort()
        return
      case '/resume':
        this.#events?.onResume('')
        return
      case '/new':
        this.#events?.onNew()
        return
      case '/clear':
        this.#transcript = createTranscript()
        this.#repaintTranscript()
        return
      case '/exit':
      case '/quit':
        this.#events?.onQuit()
        return
      default:
        this.notice(`${t().unknownCommand} ${name} — /help`)
    }
  }

  /** Key routing: overlays first, then composer chords, then history. */
  #onKeyDown(key: KeyEvent): void {
    const events = this.#events
    if (this.#overlayKind !== undefined) {
      // In question-text mode the composer owns typing; only Esc backs out.
      if (this.#overlayKind === 'question-text') {
        if (key.name === 'escape') {
          key.preventDefault()
          this.#overlayKind = 'questions'
          this.#renderOverlay()
        }
        return
      }
      key.preventDefault()
      if (key.name === 'escape' || key.name === 'q') {
        if (this.#overlayKind === 'approval') this.#resolveApprovalChoice('cancelled')
        else if (this.#overlayKind === 'questions') {
          const resolve = this.#resolveQuestions
          this.#resolveQuestions = undefined
          this.#closeOverlay()
          resolve?.(this.#pendingQuestions.map(question => ({ id: question.id, selected: [] })))
        } else this.#closeOverlay()
        return
      }
      if (this.#overlayKind === 'approval') {
        if (key.name === 'up' || key.name === 'down') {
          this.#approvalPick = (this.#approvalPick + (key.name === 'down' ? 1 : 2)) % 3
          this.#renderOverlay()
        } else if (key.name === 'a') this.#resolveApprovalChoice('allowed-once')
        else if (key.name === 'r') this.#resolveApprovalChoice('rejected')
        else if (key.name === 'return') {
          const picks = ['allowed-once', 'rejected', 'cancelled'] as const
          this.#resolveApprovalChoice(picks[this.#approvalPick] ?? 'cancelled')
        }
        return
      }
      if (this.#overlayKind === 'questions') {
        if (key.name === 'up' || key.name === 'down') {
          this.#questionIndex = Math.max(0, Math.min(this.#pendingQuestions.length - 1,
            this.#questionIndex + (key.name === 'down' ? 1 : -1)))
          this.#renderOverlay()
        } else if (key.name === 'space') {
          const question = this.#pendingQuestions[this.#questionIndex]
          const options = question?.options ?? []
          if (options.length > 0) {
            const picked = this.#questionPicks.get(this.#questionIndex) ?? new Set<number>()
            const next = [...picked]
            const cursor = next.length === 0 ? 0 : Math.min(options.length - 1, (next[next.length - 1] ?? 0) + 1)
            if (question?.multiSelect === true) {
              if (picked.has(cursor)) picked.delete(cursor)
              else picked.add(cursor)
            } else {
              picked.clear()
              picked.add(cursor)
            }
            this.#questionPicks.set(this.#questionIndex, picked)
            this.#renderOverlay()
          }
        } else if (key.name === 'i') {
          this.#overlayKind = 'question-text'
          this.#renderOverlay()
        } else if (key.name === 'return') {
          this.#submitQuestions()
        }
      }
      if (this.#overlayKind === 'sessions') {
        if (key.name === 'up' || key.name === 'down') {
          this.#sessionPick = Math.max(0, Math.min(this.#sessions.length - 1,
            this.#sessionPick + (key.name === 'down' ? 1 : -1)))
          this.#renderOverlay()
        } else if (key.name === 'return') {
          const row = this.#sessions[this.#sessionPick]
          this.#closeOverlay()
          if (row !== undefined && !row.current) this.#events?.onResume(row.id)
        }
      }
      if (this.#overlayKind === 'settings') {
        if (key.name === 'l') {
          toggleLang()
          this.#setOverlayTitle(t().settingsTitle)
          this.#renderOverlay()
          this.#renderStatus()
        } else if (key.name === 'n') {
          toggleNotifications()
          this.#renderOverlay()
        }
      }
      return
    }
    if (key.ctrl && key.name === 'c') {
      key.preventDefault()
      if (this.#running) {
        this.#exitArmed = false
        events?.onCancel()
        return
      }
      // Double-press exit: the first press arms, the second within 2s quits.
      if (this.#exitArmed) {
        events?.onQuit()
        return
      }
      this.#exitArmed = true
      this.notice(t().exitHint)
      if (this.#exitTimer !== undefined) clearTimeout(this.#exitTimer)
      this.#exitTimer = setTimeout(() => { this.#exitArmed = false }, 2000)
      return
    }
    if (key.name === 'escape') {
      key.preventDefault()
      if (this.#running) events?.onCancel()
      else if (this.#input !== undefined) this.#input.value = ''
      return
    }
    if (key.ctrl && key.name === 'return') {
      // Interrupt and send: cancel the live turn, then queue the draft.
      key.preventDefault()
      const input = this.#input
      if (input === undefined || input.value.trim() === '') return
      const text = input.value
      input.value = ''
      this.#history?.push(text)
      this.addUser(text, false)
      if (this.#running) events?.onCancel()
      events?.onSend(text)
      return
    }
    if (key.option && key.name === 'up') {
      key.preventDefault()
      const input = this.#input
      const recalled = this.#history?.older(input?.value ?? '')
      if (input !== undefined && recalled !== undefined) input.value = recalled
      return
    }
    if (key.name === '?' && (this.#input?.value ?? '') === '') {
      key.preventDefault()
      this.#overlayKind = 'help'
      this.#setOverlayTitle(t().helpTitle)
      this.#renderOverlay()
      return
    }
    if (key.ctrl && key.name === 'u') {
      key.preventDefault()
      if (this.#input !== undefined) this.#input.value = ''
      return
    }
    if (key.ctrl && key.name === 'w') {
      key.preventDefault()
      const input = this.#input
      if (input !== undefined) input.value = input.value.replace(/\S+\s*$/, '')
      return
    }
    if (key.ctrl && key.name === 'j') {
      key.preventDefault()
      const input = this.#input
      if (input === undefined || input.value.trim() === '') return
      const text = input.value
      input.value = ''
      this.#history?.push(text)
      this.addUser(text, true)
      events?.onSteer(text)
      return
    }
    if (key.name === 'pageup' || key.name === 'pagedown') {
      key.preventDefault()
      const scroll = this.#scroll
      if (scroll !== undefined) {
        const delta = key.name === 'pageup' ? -12 : 12
        scroll.scrollTop = Math.max(0, scroll.scrollTop + delta)
      }
      return
    }
    if (key.name === 'tab' && key.shift) {
      key.preventDefault()
      events?.onCyclePolicy()
      return
    }
    if (key.name === 'up' || key.name === 'down') {
      key.preventDefault()
      const input = this.#input
      if (input === undefined) return
      const recalled = key.name === 'up'
        ? this.#history?.older(input.value)
        : this.#history?.newer()
      if (recalled !== undefined) input.value = recalled
    }
  }
}
