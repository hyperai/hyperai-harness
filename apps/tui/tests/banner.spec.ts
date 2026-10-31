import { describe, expect, it } from 'vitest'
import { bannerLines, TUI_VERSION } from '../src/banner.ts'
import { theme } from '../src/theme.ts'

describe('bannerLines', () => {
  it('renders the wordmark with a gradient fill and the session info rows', () => {
    const rows = bannerLines({ session: 'session-1', model: 'hyperai/model-x', cwd: '/work' })
    // Six wordmark rows plus tagline, model, cwd, and session rows.
    expect(rows).toHaveLength(10)
    expect(rows[0]?.[0]?.fg).toBe(theme.primary)
    expect(rows[5]?.[0]?.fg).toBe(theme.secondary)
    const joined = rows.flat().map(run => run.text).join('\n')
    expect(joined).toContain(`v${TUI_VERSION}`)
    expect(joined).toContain('hyperai/model-x')
    expect(joined).toContain('/work')
    expect(joined).toContain('session-1')
  })
})
