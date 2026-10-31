import { describe, expect, it } from 'vitest'
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
  renderMarkdown,
  renderToolDetail,
  settleThinking,
  type ToolLine,
  type Transcript,
} from '../src/transcript.ts'
import { chunk, theme } from '../src/theme.ts'

/** Collect the plain text of a rendered line. */
function textOf(transcript: Transcript, index: number): string {
  const line = transcript.lines[index]
  if (line === undefined) throw new Error(`no line at ${String(index)}`)
  return renderLine(line, 0).map(run => run.text).join('')
}

describe('transcript fold', () => {
  it('starts empty and accepts banner rows as notices', () => {
    const transcript = createTranscript()
    expect(transcript.lines).toHaveLength(0)
    appendBanner(transcript, [[chunk('logo', theme.primary)], [chunk('info')]])
    expect(transcript.lines).toHaveLength(2)
    expect(textOf(transcript, 0)).toBe('logo')
    expect(textOf(transcript, 1)).toBe('info')
  })

  it('records user prompts with the steer flag', () => {
    const transcript = createTranscript()
    appendUser(transcript, 'hello', false)
    appendUser(transcript, 'now', true)
    expect(textOf(transcript, 0)).toContain('hello')
    expect(textOf(transcript, 1)).toContain('now')
    const steer = transcript.lines[1]
    expect(steer?.kind === 'user' && steer.steer).toBe(true)
  })

  it('grows one thinking line across deltas and settles every open line', () => {
    const transcript = createTranscript()
    appendThinking(transcript, 'why ')
    appendThinking(transcript, 'not')
    expect(transcript.lines).toHaveLength(1)
    const open = transcript.lines[0]
    expect(open?.kind === 'thinking' && open.settled).toBe(false)
    settleThinking(transcript)
    expect(open?.kind === 'thinking' && open.settled).toBe(true)
    // A later assistant line does not reopen thinking.
    appendAssistant(transcript, 'answer')
    settleThinking(transcript)
    expect(transcript.lines).toHaveLength(2)
  })

  it('opens a fresh thinking line after a settled one', () => {
    const transcript = createTranscript()
    appendThinking(transcript, 'first')
    settleThinking(transcript)
    appendThinking(transcript, 'second')
    expect(transcript.lines).toHaveLength(2)
  })

  it('merges assistant deltas into one line until another kind lands', () => {
    const transcript = createTranscript()
    appendAssistant(transcript, 'ab')
    appendAssistant(transcript, 'cd')
    expect(transcript.lines).toHaveLength(1)
    expect(textOf(transcript, 0)).toBe('abcd')
    appendNotice(transcript, 'note')
    appendAssistant(transcript, 'later')
    expect(transcript.lines).toHaveLength(3)
  })

  it('settles the matching running tool card and ignores unmatched names', () => {
    const transcript = createTranscript()
    beginTool(transcript, 'bash', '{"c":1}')
    endTool(transcript, 'bash', true, 'done')
    endTool(transcript, 'bash', true, 'late')
    const card = transcript.lines[0]
    expect(card?.kind === 'tool' && card.state).toBe('ok')
    expect(card?.kind === 'tool' && card.summary).toBe('done')
    endTool(transcript, 'missing', false, 'nope')
    expect(transcript.lines).toHaveLength(1)
  })

  it('marks a failed tool card with the error summary', () => {
    const transcript = createTranscript()
    beginTool(transcript, 'bash', '')
    endTool(transcript, 'bash', false, 'DENIED')
    const card = transcript.lines[0]
    expect(card?.kind === 'tool' && card.state).toBe('err')
    expect(textOf(transcript, 0)).toContain('x')
    expect(textOf(transcript, 0)).toContain('DENIED')
  })
})

describe('renderLine', () => {
  it('renders settled thinking as a one-line preview with ellipsis', () => {
    const transcript = createTranscript()
    appendThinking(transcript, `${'x'.repeat(80)}\nsecond`)
    settleThinking(transcript)
    const text = textOf(transcript, 0)
    expect(text).toContain('think')
    expect(text).toContain('…')
    expect(text).not.toContain('second')
  })

  it('renders a running tool card with the argument preview and truncates long args', () => {
    const transcript = createTranscript()
    beginTool(transcript, 'bash', 'y'.repeat(80))
    const text = textOf(transcript, 0)
    expect(text).toContain('bash')
    expect(text).toContain('...')
  })

  it('renders an empty tool tail as a bare card', () => {
    const transcript = createTranscript()
    beginTool(transcript, 'noop', '')
    const text = textOf(transcript, 0)
    expect(text.endsWith('noop')).toBe(true)
  })
})

describe('renderMarkdown', () => {
  it('passes plain prose through untouched', () => {
    const runs = renderMarkdown('hello world')
    expect(runs.map(run => run.text).join('')).toBe('hello world')
  })

  it('prefixes fenced code lines and styles inline code and bold', () => {
    const runs = renderMarkdown('use `x` and **b**\n```\ncode\n```')
    const joined = runs.map(run => run.text).join('')
    expect(joined).toContain('│ code')
    expect(joined).toContain('x')
    expect(joined).toContain('b')
  })

  it('styles headings and keeps their text', () => {
    const runs = renderMarkdown('## Title\nbody')
    expect(runs[0]?.text).toBe('Title')
    expect(runs[0]?.bold).toBe(true)
    expect(runs.map(run => run.text).join('')).toContain('body')
  })

  it('keeps trailing text after an inline token', () => {
    const joined = renderMarkdown('a `c` d').map(run => run.text).join('')
    expect(joined).toBe('a c d')
  })
})

describe('renderToolDetail', () => {
  it('shows args always and the result only once settled', () => {
    const running: ToolLine = { kind: 'tool', name: 'bash', args: '{"a":1}', state: 'running', summary: '' }
    const settled: ToolLine = { kind: 'tool', name: 'bash', args: '{"a":1}', state: 'ok', summary: 'done' }
    const runningRows = renderToolDetail(running)
    expect(runningRows.flat().map(run => run.text).join('')).not.toContain('result')
    const settledRows = renderToolDetail(settled)
    expect(settledRows.flat().map(run => run.text).join('')).toContain('result')
    expect(settledRows.flat().map(run => run.text).join('')).toContain('done')
  })
})
