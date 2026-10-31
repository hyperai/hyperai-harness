import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { PromptHistory } from '../src/history.ts'

const root = mkdtempSync(join(tmpdir(), 'hyperai-history-'))
afterAll(() => { rmSync(root, { recursive: true, force: true }) })

describe('PromptHistory', () => {
  it('recalls entries newest-last and restores the captured draft on the way back', () => {
    const history = new PromptHistory(join(root, 'a'))
    history.push('one')
    history.push('two')
    expect(history.older('draft')).toBe('two')
    expect(history.older('draft')).toBe('one')
    expect(history.older('draft')).toBeUndefined()
    expect(history.newer()).toBe('two')
    expect(history.newer()).toBe('draft')
    expect(history.newer()).toBeUndefined()
  })

  it('ignores blank pushes and consecutive duplicates', () => {
    const history = new PromptHistory(join(root, 'b'))
    history.push('   ')
    history.push('same')
    history.push('same')
    expect(history.older('')).toBe('same')
    expect(history.older('')).toBeUndefined()
  })

  it('persists pushed entries as JSONL and reloads them', () => {
    const home = join(root, 'c')
    const first = new PromptHistory(home)
    first.push('alpha')
    first.push('beta')
    const file = join(home, 'hyperai-tui', 'history.jsonl')
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file, 'utf8').trim().split('\n')).toHaveLength(2)
    const second = new PromptHistory(home)
    expect(second.older('')).toBe('beta')
    expect(second.older('')).toBe('alpha')
  })

  it('starts empty when the history file is unreadable garbage', () => {
    const home = join(root, 'd')
    const history = new PromptHistory(home)
    history.push('kept')
    const file = join(home, 'hyperai-tui', 'history.jsonl')
    writeFileSync(file, 'not json at all\n')
    const reloaded = new PromptHistory(home)
    expect(reloaded.older('')).toBeUndefined()
  })

  it('caps retained entries at the configured maximum', () => {
    const history = new PromptHistory(join(root, 'e'))
    for (let index = 0; index < 520; index += 1) history.push(`entry-${String(index)}`)
    expect(history.older('')).toBe('entry-519')
    // Walk past the first retained entry without finding the oldest pushes.
    let found = ''
    for (let step = 0; step < 600; step += 1) {
      const recalled = history.older('')
      if (recalled === undefined) break
      found = recalled
    }
    expect(found).toBe('entry-20')
  })
})
