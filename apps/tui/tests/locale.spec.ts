import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, describe, expect, it } from 'vitest'
import { currentSettings, loadSettings, saveSettings, setLang, t, toggleLang, toggleNotifications } from '../src/locale.ts'

const root = mkdtempSync(join(tmpdir(), 'hyperai-locale-'))
afterAll(() => { rmSync(root, { recursive: true, force: true }) })

describe('locale settings', () => {
  it('defaults to English with notifications on', () => {
    const home = join(root, 'defaults')
    loadSettings(home)
    expect(currentSettings()).toEqual({ lang: 'en', notifications: true })
    expect(t().composerPlaceholder).toContain('Type a task')
  })

  it('toggles language and notifications and persists both', () => {
    const home = join(root, 'toggles')
    loadSettings(home)
    expect(toggleLang()).toBe('zh')
    expect(t().composerPlaceholder).toContain('输入任务')
    expect(toggleNotifications()).toBe(false)
    const stored = JSON.parse(readFileSync(join(home, 'hyperai-tui', 'settings.json'), 'utf8')) as { lang: string; notifications: boolean }
    expect(stored).toEqual({ lang: 'zh', notifications: false })
    // A fresh load restores the persisted snapshot.
    loadSettings(home)
    expect(currentSettings()).toEqual({ lang: 'zh', notifications: false })
  })

  it('setLang writes through and restores to English', () => {
    const home = join(root, 'setlang')
    loadSettings(home)
    setLang('zh')
    expect(currentSettings().lang).toBe('zh')
    setLang('en')
    expect(t().idle).toBe('idle')
  })

  it('ignores malformed or partial settings files', () => {
    const home = join(root, 'garbage')
    mkdirSync(join(home, 'hyperai-tui'), { recursive: true })
    writeFileSync(join(home, 'hyperai-tui', 'settings.json'), 'not json', { flag: 'w' })
    loadSettings(home)
    expect(currentSettings().lang).toBe('en')
    const partial = join(root, 'partial')
    mkdirSync(join(partial, 'hyperai-tui'), { recursive: true })
    writeFileSync(join(partial, 'hyperai-tui', 'settings.json'), '{"lang":"zh"}', { flag: 'w' })
    loadSettings(partial)
    expect(currentSettings()).toEqual({ lang: 'zh', notifications: true })
  })

  it('saveSettings is best-effort when the target is unwritable', () => {
    loadSettings(join(root, 'blocked'))
    // A file where the settings directory should be makes mkdir/write fail silently.
    writeFileSync(join(root, 'blocked'), 'file-not-dir')
    saveSettings()
    expect(currentSettings().notifications).toBe(true)
  })
})
