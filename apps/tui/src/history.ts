/**
 * Prompt history: in-memory recall bound to the composer's Up/Down keys,
 * persisted as JSONL under the Harness home so drafts survive processes.
 * @module @hyperai/hyperai-harness-tui/history
 */

import { existsSync, mkdirSync, readFileSync, appendFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Cap on retained history entries. */
const MAX_ENTRIES = 500

/** One recalled prompt session's history. */
export class PromptHistory {
  #entries: string[] = []
  #cursor = -1
  #draft = ''
  #file: string

  /**
   * Load history for this workspace.
   * @param home - the Harness home (`$DSH_HOME` or `~/.dsh`).
   */
  constructor(home: string) {
    this.#file = join(home, 'hyperai-tui', 'history.jsonl')
    try {
      if (existsSync(this.#file)) {
        this.#entries = readFileSync(this.#file, 'utf8')
          .split('\n')
          .filter(line => line !== '')
          .map((line) => { try { return JSON.parse(line) as { text?: string } } catch { return {} } })
          .map(record => record.text ?? '')
          .filter(text => text !== '')
          .slice(-MAX_ENTRIES)
      }
    } catch {
      // Unreadable history must never block the TUI; start empty.
    }
    this.#cursor = this.#entries.length
  }

  /**
   * Record a submitted prompt.
   * @param text - the submitted text.
   */
  push(text: string): void {
    if (text.trim() === '') return
    if (this.#entries[this.#entries.length - 1] !== text) {
      this.#entries.push(text)
      if (this.#entries.length > MAX_ENTRIES) this.#entries.shift()
      try {
        mkdirSync(dirname(this.#file), { recursive: true })
        appendFileSync(this.#file, `${JSON.stringify({ text })}\n`)
      } catch {
        // Persistence is best-effort; recall still works in-process.
      }
    }
    this.#cursor = this.#entries.length
    this.#draft = ''
  }

  /**
   * Walk back in history.
   * @param current - the composer's current text, captured as draft on first walk.
   * @returns the recalled entry, or undefined at the start.
   */
  older(current: string): string | undefined {
    if (this.#cursor === this.#entries.length) this.#draft = current
    if (this.#cursor === 0) return undefined
    this.#cursor -= 1
    return this.#entries[this.#cursor]
  }

  /**
   * Walk forward in history.
   * @returns the recalled entry or the captured draft.
   */
  newer(): string | undefined {
    if (this.#cursor >= this.#entries.length) return undefined
    this.#cursor += 1
    return this.#cursor === this.#entries.length ? this.#draft : this.#entries[this.#cursor]
  }
}
