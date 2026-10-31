/**
 * The transcript view model: durable-ish line records the driver folds from
 * session events and stream frames, plus the styled chunks the view paints.
 * Pure data and pure functions — no renderables.
 * @module @hyperai/hyperai-harness-tui/transcript
 */

import { type Chunk, chunk, theme } from './theme.ts'
import { t } from './locale.ts'

/** A user prompt line. */
export interface UserLine {
  kind: 'user'
  /** The prompt text. */
  text: string
  /** Whether the line arrived through steer rather than followup. */
  steer: boolean
}

/** An assistant text line grown by stream deltas. */
export interface AssistantLine {
  kind: 'assistant'
  /** The accumulated text. */
  text: string
}

/** A reasoning line: animated while streaming, one-line summary once settled. */
export interface ThinkingLine {
  kind: 'thinking'
  /** The accumulated reasoning text. */
  text: string
  /** Whether the stream that produced it has ended. */
  settled: boolean
}

/** A tool call card collapsed to one transcript line. */
export interface ToolLine {
  kind: 'tool'
  /** The tool name. */
  name: string
  /** The full argument text; the one-line card previews it. */
  args: string
  /** Card state. */
  state: 'running' | 'ok' | 'err'
  /** Full result summary shown once settled. */
  summary: string
}

/** A driver notice (errors, aborts, system info). */
export interface NoticeLine {
  kind: 'notice'
  /** The notice text. */
  text: string
}

/** Every transcript line shape. */
export type TranscriptLine = UserLine | AssistantLine | ThinkingLine | ToolLine | NoticeLine

/** One question option as the modal renders it. */
export interface QuestionOptionView {
  /** User-facing label. */
  label: string
  /** Optional extra context. */
  description?: string
}

/** One question as the modal renders it. */
export interface QuestionItemView {
  /** Stable id echoed in the answer. */
  id: string
  /** The question to display. */
  question: string
  /** Optional supporting detail. */
  detail?: string
  /** Optional choices. */
  options?: QuestionOptionView[]
  /** Whether more than one option may be selected. */
  multiSelect?: boolean
}

/** One answered question as the caller wants it back. */
export interface QuestionAnswerItemView {
  /** The answered question id. */
  id: string
  /** Selected option labels. */
  selected: string[]
  /** Optional free-text answer. */
  custom?: string
}

/** Transcript state the view renders and the driver mutates through fold helpers. */
export interface Transcript {
  /** The ordered lines. */
  lines: TranscriptLine[]
  /** Spinner phase for running indicators. */
  spinner: number
}

/**
 * Start an empty transcript.
 * @returns the initial transcript state.
 */
export function createTranscript(): Transcript {
  return { lines: [], spinner: 0 }
}

/**
 * Append a banner block as notice-colored logo rows.
 * @param transcript - the transcript to extend.
 * @param rows - chunk rows, typically from `bannerLines`.
 */
export function appendBanner(transcript: Transcript, rows: readonly Chunk[][]): void {
  for (const row of rows) {
    transcript.lines.push({ kind: 'notice', text: row.map(run => run.text).join('') })
  }
}

/**
 * Append a user prompt line.
 * @param transcript - the transcript to extend.
 * @param text - the prompt text.
 * @param steer - whether the prompt steered a live turn.
 */
export function appendUser(transcript: Transcript, text: string, steer: boolean): void {
  transcript.lines.push({ kind: 'user', text, steer })
}

/**
 * Append a reasoning delta, opening a line as needed.
 * @param transcript - the transcript to extend.
 * @param delta - the streamed reasoning text.
 */
export function appendThinking(transcript: Transcript, delta: string): void {
  const last = transcript.lines[transcript.lines.length - 1]
  if (last?.kind === 'thinking' && !last.settled) {
    last.text += delta
    return
  }
  transcript.lines.push({ kind: 'thinking', text: delta, settled: false })
}

/**
 * Settle open thinking lines when their stream ends.
 * @param transcript - the transcript to update.
 */
export function settleThinking(transcript: Transcript): void {
  for (const line of transcript.lines) {
    if (line.kind === 'thinking') line.settled = true
  }
}

/**
 * Append an assistant text delta, opening a line as needed.
 * @param transcript - the transcript to extend.
 * @param delta - the streamed text.
 */
export function appendAssistant(transcript: Transcript, delta: string): void {
  const last = transcript.lines[transcript.lines.length - 1]
  if (last?.kind === 'assistant') {
    last.text += delta
    return
  }
  transcript.lines.push({ kind: 'assistant', text: delta })
}

/**
 * Open a running tool card.
 * @param transcript - the transcript to extend.
 * @param name - the tool name.
 * @param args - a short argument preview.
 */
export function beginTool(transcript: Transcript, name: string, args: string): void {
  transcript.lines.push({ kind: 'tool', name, args, state: 'running', summary: '' })
}

/**
 * Settle the tool card matching this call.
 * @param transcript - the transcript to update.
 * @param name - the tool name recorded when the call opened.
 * @param ok - whether the call succeeded.
 * @param summary - a short result summary.
 */
export function endTool(transcript: Transcript, name: string, ok: boolean, summary: string): void {
  for (let index = transcript.lines.length - 1; index >= 0; index -= 1) {
    const line = transcript.lines[index]
    if (line?.kind === 'tool' && line.name === name && line.state === 'running') {
      line.state = ok ? 'ok' : 'err'
      line.summary = summary
      return
    }
  }
}

/**
 * Append a driver notice line.
 * @param transcript - the transcript to extend.
 * @param text - the notice text.
 */
export function appendNotice(transcript: Transcript, text: string): void {
  transcript.lines.push({ kind: 'notice', text })
}

/** Preview width of a collapsed thinking summary. */
const THINK_PREVIEW = 48

/** Preview width of a tool card's argument tail. */
const TOOL_PREVIEW = 52

/**
 * Render assistant text with lightweight Markdown styling: fenced code blocks,
 * inline code, bold, and headings. Plain prose passes through untouched.
 * @param text - the assistant text.
 * @returns the chunks painting the text.
 */
export function renderMarkdown(text: string): Chunk[] {
  const out: Chunk[] = []
  const segments = text.split(/```/)
  segments.forEach((segment, index) => {
    if (index % 2 === 1) {
      for (const line of segment.split('\n')) {
        out.push(chunk(`  │ ${line}`, theme.secondary))
        out.push(chunk('\n'))
      }
      return
    }
    for (const line of segment.split('\n')) {
      const heading = line.match(/^(#{1,6})\s+(.*)$/)
      if (heading !== null) {
        out.push(chunk(heading[2] ?? '', theme.accent, true))
        out.push(chunk('\n'))
        continue
      }
      // Inline spans: `code` and **bold**.
      const inline = /(`[^`]+`|\*\*[^*]+\*\*)/
      let rest = line
      while (true) {
        const hit = inline.exec(rest)
        if (hit === null) break
        const at = hit.index
        const token = hit[0]
        if (at > 0) out.push(chunk(rest.slice(0, at)))
        if (token.startsWith('`')) out.push(chunk(token.slice(1, -1), theme.secondary))
        else out.push(chunk(token.slice(2, -2), theme.muted, true))
        rest = rest.slice(at + token.length)
      }
      if (rest !== '') out.push(chunk(rest))
      out.push(chunk('\n'))
    }
  })
  if (out.length > 0 && out[out.length - 1]?.text === '\n') out.pop()
  return out
}

/**
 * Render one line to styled chunks.
 * @param line - the line to render.
 * @param spinner - the current spinner phase.
 * @returns the chunks painting the line.
 */
export function renderLine(line: TranscriptLine, spinner: number): Chunk[] {
  switch (line.kind) {
    case 'user':
      return [chunk(line.steer ? t().youSteer : t().you, theme.primary, true), chunk(line.text)]
    case 'assistant':
      return renderMarkdown(line.text)
    case 'thinking': {
      if (!line.settled) {
        const frames = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']
        const frame = frames[spinner % frames.length] ?? '·'
        return [chunk(`${frame} ${t().thinking}`, theme.reasoning, true)]
      }
      const first = line.text.split('\n', 1)[0] ?? ''
      const preview = first.length > THINK_PREVIEW ? `${first.slice(0, THINK_PREVIEW - 1)}…` : first
      return [chunk(`✦ ${t().think}`, theme.reasoning, true), chunk(preview, theme.muted)]
    }
    case 'tool': {
      const mark = line.state === 'running'
        ? ['/', '-', '\\', '|'][spinner % 4] ?? '+'
        : line.state === 'ok' ? 'v' : 'x'
      const color = line.state === 'running' ? theme.warning : line.state === 'ok' ? theme.success : theme.error
      const tail = line.state === 'running' ? line.args : line.summary
      const preview = tail.length > TOOL_PREVIEW ? `${tail.slice(0, TOOL_PREVIEW - 3)}...` : tail
      return [
        chunk(`${mark} ${t().tool} `, color, true),
        chunk(line.name, theme.accent, true),
        preview === '' ? chunk('') : chunk(`  ${preview}`, theme.muted),
      ]
    }
    case 'notice':
      return [chunk(line.text, theme.muted)]
  }
}

/**
 * Render one tool card expanded to its full detail rows.
 * @param line - the tool line to expand.
 * @returns one chunk row per detail line.
 */
export function renderToolDetail(line: ToolLine): Chunk[][] {
  const color = line.state === 'running' ? theme.warning : line.state === 'ok' ? theme.success : theme.error
  const state = line.state === 'running' ? 'running' : line.state === 'ok' ? 'ok' : 'error'
  const rows: Chunk[][] = [
    [chunk(`${line.name} `, theme.accent, true), chunk(`(${state})`, color, true)],
    [chunk('  args: ', theme.muted, true), chunk(line.args)],
  ]
  if (line.summary !== '') rows.push([chunk('  result: ', theme.muted, true), chunk(line.summary, color)])
  return rows
}

/**
 * Render the whole transcript to chunk rows.
 * @param transcript - the transcript to render.
 * @returns one chunk row per line.
 */
export function renderTranscript(transcript: Transcript): Chunk[][] {
  return transcript.lines.map(line => renderLine(line, transcript.spinner))
}
