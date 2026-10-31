/**
 * Locale-owned product copy and TUI settings: every visible string lives in
 * the dictionaries below, and the selected language persists with the rest of
 * the TUI settings under the Harness home.
 * @module @hyperai/hyperai-harness-tui/locale
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Supported UI languages. */
export type Lang = 'en' | 'zh'

/** Persisted TUI settings. */
export interface TuiSettings {
  /** UI language. */
  lang: Lang
  /** Whether task-completion notifications fire. */
  notifications: boolean
}

/** The product-copy dictionary, one key per visible string. */
export interface Messages {
  /** Composer placeholder. */
  composerPlaceholder: string
  /** Banner tagline under the logo. */
  bannerInfo: string
  /** Status bar: running state. */
  running: string
  /** Status bar: idle state. */
  idle: string
  /** Status bar: policy label prefix. */
  policy: string
  /** Status bar: effort label prefix. */
  effort: string
  /** Status bar: hints suffix. */
  hints: string
  /** User line prefix. */
  you: string
  /** User line prefix while steering. */
  youSteer: string
  /** Unsettled thinking line. */
  thinking: string
  /** Settled thinking summary prefix. */
  think: string
  /** Tool card label. */
  tool: string
  /** Tool result summary when ok. */
  toolDone: string
  /** Notice: aborted turn. */
  aborted: string
  /** Notice: unknown command prefix. */
  unknownCommand: string
  /** Notice: exit hint on first Ctrl+C. */
  exitHint: string
  /** Overlay title: help. */
  helpTitle: string
  /** Overlay title: tools. */
  toolsTitle: string
  /** Overlay title: model. */
  modelTitle: string
  /** Overlay title: sessions. */
  sessionsTitle: string
  /** Overlay title: settings. */
  settingsTitle: string
  /** Overlay title: approval. */
  approveTitle: string
  /** Overlay title: question. */
  questionTitle: string
  /** Help body lines. */
  helpBody: string[]
  /** Model overlay footer. */
  modelFooter: string
  /** Sessions overlay footer. */
  sessionsFooter: string
  /** Settings overlay body labels. */
  settingsLang: string
  /** Settings label for notifications. */
  settingsNotifications: string
  /** Settings footer. */
  settingsFooter: string
  /** Approval options. */
  allowOnce: string
  /** Approval option: reject. */
  reject: string
  /** Approval option: cancel. */
  cancel: string
  /** Question modal footer hints. */
  questionHints: string
  /** Question custom-text prompt. */
  customPrompt: string
  /** Notification title. */
  notifyTitle: string
}

const en: Messages = {
  composerPlaceholder: 'Type a task and press Enter...',
  bannerInfo: 'HyperAI TUI',
  running: 'running',
  idle: 'idle',
  policy: 'policy',
  effort: 'effort',
  hints: 'Shift+Tab policy · /help commands',
  you: 'You> ',
  youSteer: 'You› ',
  thinking: 'thinking',
  think: 'think · ',
  tool: 'tool',
  toolDone: 'done',
  aborted: '[aborted]',
  unknownCommand: '[unknown command]',
  exitHint: 'press Ctrl+C again to exit',
  helpTitle: ' Help ',
  toolsTitle: ' Tools ',
  modelTitle: ' Model ',
  sessionsTitle: ' Sessions ',
  settingsTitle: ' Settings ',
  approveTitle: 'Approve',
  questionTitle: ' Question ',
  helpBody: [
    'Commands',
    '  /help      this overlay',
    '  /tools     browse tool-call cards',
    '  /model     current model route',
    '  /effort    cycle reasoning effort',
    '  /resume    pick a past session',
    '  /new       start a new session',
    '  /settings  language and notifications',
    '  /clear     clear the transcript view',
    '  /exit      quit the TUI',
    '',
    'Keys',
    '  Enter      send a task',
    '  Ctrl+Enter interrupt and send',
    '  Ctrl+J     steer into the live turn',
    '  Esc        cancel a running turn',
    '  Shift+Tab  cycle permission preset',
    '  PgUp/PgDn  scroll the transcript',
    '  ↑ / ↓      prompt history',
    '  Ctrl+C     quit while idle (twice)',
  ],
  modelFooter: 'Effort: /effort · Esc closes',
  sessionsFooter: '↑/↓ move · Enter resume · Esc closes',
  settingsLang: 'Language',
  settingsNotifications: 'Completion notifications',
  settingsFooter: 'l toggle language · n toggle notifications · Esc closes',
  allowOnce: 'Allow once  (a)',
  reject: 'Reject      (r)',
  cancel: 'Cancel    (Esc)',
  questionHints: '↑/↓ move · Space select · i custom · Enter submit · Esc skip',
  customPrompt: 'Type the custom answer in the composer, then Enter. Esc returns.',
  notifyTitle: 'dsh task complete',
}

const zh: Messages = {
  composerPlaceholder: '输入任务，回车发送...',
  bannerInfo: 'HyperAI TUI',
  running: '运行中',
  idle: '空闲',
  policy: '策略',
  effort: '力度',
  hints: 'Shift+Tab 策略 · /help 命令',
  you: '你> ',
  youSteer: '你› ',
  thinking: '思考中',
  think: '思考 · ',
  tool: '工具',
  toolDone: '完成',
  aborted: '[已中止]',
  unknownCommand: '[未知命令]',
  exitHint: '再按一次 Ctrl+C 退出',
  helpTitle: ' 帮助 ',
  toolsTitle: ' 工具 ',
  modelTitle: ' 模型 ',
  sessionsTitle: ' 会话 ',
  settingsTitle: ' 设置 ',
  approveTitle: '审批',
  questionTitle: ' 提问 ',
  helpBody: [
    '命令',
    '  /help      帮助',
    '  /tools     浏览工具卡',
    '  /model     当前模型路由',
    '  /effort    循环推理力度',
    '  /resume    选择历史会话',
    '  /new       新建会话',
    '  /settings  语言与通知',
    '  /clear     清空视图',
    '  /exit      退出',
    '',
    '按键',
    '  Enter      发送',
    '  Ctrl+Enter 打断并发送',
    '  Ctrl+J     打断进当前回合',
    '  Esc        取消运行中的回合',
    '  Shift+Tab  循环权限预设',
    '  PgUp/PgDn  滚动会话',
    '  ↑ / ↓      输入历史',
    '  Ctrl+C     空闲退出（按两次）',
  ],
  modelFooter: '力度：/effort · Esc 关闭',
  sessionsFooter: '↑/↓ 移动 · Enter 恢复 · Esc 关闭',
  settingsLang: '语言',
  settingsNotifications: '完成通知',
  settingsFooter: 'l 切换语言 · n 切换通知 · Esc 关闭',
  allowOnce: '允许一次  (a)',
  reject: '拒绝      (r)',
  cancel: '取消    (Esc)',
  questionHints: '↑/↓ 移动 · Space 选中 · i 自定义 · Enter 提交 · Esc 跳过',
  customPrompt: '在输入框键入自定义答案后回车；Esc 返回选项。',
  notifyTitle: 'dsh 任务完成',
}

const dictionaries: Record<Lang, Messages> = { en, zh }

/** Mutable settings state, loaded at startup and persisted on change. */
const settings: TuiSettings = { lang: 'en', notifications: true }
let settingsFile = ''

/**
 * Load persisted settings from the Harness home.
 * @param home - the Harness home directory.
 */
export function loadSettings(home: string): void {
  settingsFile = join(home, 'hyperai-tui', 'settings.json')
  // Establish the full snapshot: defaults first, then file overrides.
  settings.lang = 'en'
  settings.notifications = true
  try {
    if (existsSync(settingsFile)) {
      const parsed = JSON.parse(readFileSync(settingsFile, 'utf8')) as Partial<TuiSettings>
      if (parsed.lang === 'en' || parsed.lang === 'zh') settings.lang = parsed.lang
      if (typeof parsed.notifications === 'boolean') settings.notifications = parsed.notifications
    }
  } catch {
    // Unreadable settings never block the TUI; defaults apply.
  }
}

/**
 * Persist the current settings.
 */
export function saveSettings(): void {
  try {
    mkdirSync(dirname(settingsFile), { recursive: true })
    writeFileSync(settingsFile, `${JSON.stringify(settings, null, 2)}\n`)
  } catch {
    // Persistence is best-effort.
  }
}

/** @returns the current settings snapshot. */
export function currentSettings(): TuiSettings {
  return { ...settings }
}

/**
 * Switch the UI language.
 * @param lang - the language to select.
 */
export function setLang(lang: Lang): void {
  settings.lang = lang
  saveSettings()
}

/**
 * Toggle completion notifications.
 * @returns the new state.
 */
export function toggleNotifications(): boolean {
  settings.notifications = !settings.notifications
  saveSettings()
  return settings.notifications
}

/**
 * Flip the UI language.
 * @returns the new language.
 */
export function toggleLang(): Lang {
  settings.lang = settings.lang === 'en' ? 'zh' : 'en'
  saveSettings()
  return settings.lang
}

/**
 * Read the message dictionary for the current language.
 * @returns the active messages.
 */
export function t(): Messages {
  return dictionaries[settings.lang]
}
