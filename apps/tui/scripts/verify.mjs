#!/usr/bin/env node
/**
 * Offline self-check for the HyperAI TUI distribution.
 *
 * Reads committed artifacts only: brand data, the generated pnpm patch, the
 * docs and the test/script layout. It never launches a terminal, never touches
 * the network and never writes to a Harness home. Live terminal verification is
 * the procedure in `docs/verification.md`.
 *
 *   node scripts/verify.mjs
 *
 * Exit code 0 = every check passed.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = resolve(HERE, '..')
const checks = []
const requireStat = file => statSync(file)

function check(name, fn) {
  try {
    checks.push({ name, ok: true, detail: fn() ?? '' })
  } catch (error) {
    checks.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) })
  }
}

const brand = JSON.parse(readFileSync(join(PKG, 'src', 'brand.json'), 'utf8'))
const patch = readFileSync(join(PKG, 'patches', `dsh-tui@${brand.upstream.version}.patch`), 'utf8')
const addedLines = patch
  .split('\n')
  .filter(line => line.startsWith('+') && !line.startsWith('+++'))
  .map(line => line.slice(1))

check('brand data names the HyperAI product and the pinned upstream', () => {
  if (brand.productName !== 'HyperAI Harness') throw new Error('productName')
  if (brand.pluginName !== 'hyperai-tui') throw new Error('pluginName')
  if (brand.profileName !== 'hyperai') throw new Error('profileName')
  if (brand.splashWords.top !== 'HYPERAI' || brand.splashWords.bottom !== 'HARNESS') throw new Error('splash words')
  if (brand.splashWords.plain !== 'HyperAI Harness') throw new Error('plain product name')
  if (brand.tagline.zh !== 'HyperAI Harness' || brand.tagline.en !== 'HyperAI Harness') throw new Error('tagline')
  if (brand.logo !== undefined) throw new Error('brand data must not carry logo fields')
  return `${brand.upstream.package}@${brand.upstream.version}`
})

check('brand title colour is the single product pink #FF6096', () => {
  if (brand.titleColor !== '#FF6096') throw new Error(`titleColor is ${brand.titleColor}`)
  const solid = 'r: 255, g: 96, b: 150'
  const occurrences = addedLines.filter(line => line.includes(solid)).length
  if (occurrences < 6) throw new Error('the patch palette does not use #FF6096 across accent/tagline/title')
  for (const field of ['accent', 'accentShimmer', 'tagline', 'base', 'start', 'mid', 'end', 'flash']) {
    if (!addedLines.some(line => line.includes(`${field}:`))) throw new Error(`palette field ${field} missing`)
  }
  for (const stale of ['titleLight', 'titleDark', 'accentShimmer: Object.freeze({ r: 255, g: 214, b: 230 })']) {
    if (patch.includes(stale)) throw new Error(`stale gradient palette remains: ${stale}`)
  }
  return brand.titleColor
})

check('the splash renders no logo, mascot or image in any arrangement', () => {
  for (const marker of ['whale: false', 'showWhale: false', 'const wantsArt = false;']) {
    if (!patch.includes(marker)) throw new Error(`missing art suppression: ${marker}`)
  }
  for (const banned of ['HYPERAI_LOGO', 'hyperaiLogo', 'data:image', 'base64']) {
    if (patch.includes(banned)) throw new Error(`patch still carries image/logo data: ${banned}`)
  }
  const imageAdditions = addedLines.filter(line => {
    const trimmed = line.trimStart()
    if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) return false
    return /kitty|sixel|useTerminalImages|aria-screenshot|\bImage\b/iu.test(line)
  })
  if (imageAdditions.length > 0) throw new Error(`patch adds image-protocol code: ${imageAdditions[0]}`)
  return 'no art slot, no image protocol additions'
})

check('brand-display copy drops DeepSeek/whale-girl wording', () => {
  const added = addedLines.join('\n')
  for (const banned of ['鲸鱼娘', 'whale girl', 'dshTUI', 'dsh-TUI']) {
    if (added.includes(banned)) throw new Error(`brand-display copy still contains ${JSON.stringify(banned)}`)
  }
  // DeepSeek-platform surfaces (balance/coupon/login) intentionally keep their
  // platform wording; they are not HyperAI branding.
  for (const marker of ['HyperAI Harness 好像', 'HyperAI Harness 捡到', '正在连接 HyperAI', 'HyperAI 的思考过程', '想让 HyperAI 做什么']) {
    if (!patch.includes(marker)) throw new Error(`missing HyperAI copy: ${marker}`)
  }
  return 'star/onboarding/help copy uses the HyperAI name'
})

check('patch touches only the documented upstream files', () => {
  const changed = [...patch.matchAll(/^diff --git a\/(\S+) b\//gmu)].map(match => match[1])
  const expected = [
    'lib/types/branding.js',
    'lib/types/i18n.js',
    'lib/types/components/LogoV2.js',
    'lib/types/components/splashFonts.js',
    'lib/types/components/launchpadLayout.js',
    'lib/types/dsh-adapter/plugin.js',
    'lib/types/utils/paths.js',
    'lib/types/screens/Launchpad.js',
    'lib/types/update.js',
    'lib/types/components/splashEggs.js',
    'lib/types/commands.js',
    'lib/types/screens/Chat.js',
    'lib/types/hyperaiSkills.js',
    'lib/types/hyperaiSkillsCore.js',
  ]
  const unexpected = changed.filter(file => !expected.includes(file))
  const missing = expected.filter(file => !changed.includes(file))
  if (unexpected.length > 0) throw new Error(`unexpected files: ${unexpected.join(', ')}`)
  if (missing.length > 0) throw new Error(`missing files: ${missing.join(', ')}`)
  if (patch.length > 64 * 1024) throw new Error(`patch is unexpectedly large (${patch.length} bytes)`)
  return `${changed.length} files, ${patch.length} bytes`
})

check('brand strings and profile isolation remain wired', () => {
  const expectations = [
    'HYPERAI',
    'HARNESS',
    'hyperai-tui',
    'HyperAI Harness',
    'hyperai-tui v${tuiVersion}',
    '.dsh-tui-${profile}',
    'https://github.com/hyperai/hyperai-harness',
    'const onboardingOnBoot = false;',
    'const uniformBrand = true;',
    'sweep(words.plain',
    'hyperaiLook ? HYPERAI_PALETTE.title.base',
    "return { kind: 'unknown' };",
  ]
  for (const marker of expectations) {
    if (!patch.includes(marker)) throw new Error(`missing brand wiring: ${marker}`)
  }
  return 'words, wordmark, version plate, state isolation, branded links'
})

check('the TUI tree carries no logo toolchain or generated art', () => {
  for (const banned of ['brand', 'overlay', 'bin']) {
    if (existsSync(join(PKG, banned))) throw new Error(`unexpected directory: ${banned}`)
  }
  const scripts = readdirSync(join(PKG, 'scripts'))
  for (const banned of ['generate-logo-art.mjs', 'diagnose-terminal.mjs']) {
    if (scripts.includes(banned)) throw new Error(`unexpected script: ${banned}`)
  }
  const walk = (dir, prefix = '') => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) walk(join(dir, entry.name), relative)
      else if (relative.endsWith('.svg') || relative.endsWith('.png') || relative.endsWith('.base64')) {
        throw new Error(`unexpected image asset: ${relative}`)
      }
    }
  }
  walk(join(PKG, 'src'))
  walk(join(PKG, 'patches'))
  return 'src/ holds brand data only; no svg/png/generated payloads'
})

check('the HyperAI splash is pinned to the upstream solid font', () => {
  const logo = readFileSync(join(PKG, 'src', 'brand.json'), 'utf8')
  if (!logo.includes('HYPERAI')) throw new Error('brand words missing')
  const pinned = "brand === 'deepseek' ? splashFontById('bold') : pickSplashFont()"
  if (!patch.includes(pinned)) throw new Error('patch does not pin the brand splash to splashFontById(\'bold\')')
  if (!patch.includes('daily rotation can select stencil/classic/dot')) throw new Error('patch lacks the hollow-font rationale')
  if (!patch.includes('const [dailyFont] = React.useState(() => brand ===')) throw new Error('LogoV2 pin missing')
  if (!patch.includes('const [dailyFont] = React.useState(() => brand ===')) throw new Error('Launchpad pin missing')
  return 'HYPERAI/HARNESS use the solid base font; daily rotation stays upstream-only'
})

check('the patch carries the HyperAI Skills update bridge without a second scanner', () => {
  const chat = readFileSync(join(PKG, 'src', 'hyperaiSkills.js'), 'utf8')
  const core = readFileSync(join(PKG, 'src', 'hyperaiSkillsCore.js'), 'utf8')
  for (const marker of ['skills-update.mjs', 'check', '--manual', '--auto', '--ref', 'dialogs.ask', 'fingerprint', 'update', '--yes']) {
    if (!chat.includes(marker)) throw new Error(`hyperaiSkills.js is missing ${JSON.stringify(marker)}`)
  }
  for (const marker of ['fingerprint', 'noticeText', 'choices', 'detailOptions', 'resultText']) {
    if (!core.includes(marker)) throw new Error(`hyperaiSkillsCore.js is missing ${marker}`)
  }
  for (const marker of ["name: 'skills-update'", 'useSkillsUpdate', 'skillsUpdate.notice']) {
    if (!patch.includes(marker)) throw new Error(`patch is missing ${JSON.stringify(marker)}`)
  }
  // The TUI must not implement a second remote scanner.
  for (const banned of ['ls-remote', 'discoverSkills', 'SKILL.md', 'manifest.json']) {
    if (chat.includes(banned) || core.includes(banned)) throw new Error(`TUI bridge duplicates profile logic: ${banned}`)
  }
  return 'CLI bridge only; scanning/install stays in apps/profiles/hyperai'
})

check('the skills update screenshots exist', () => {
  for (const file of [
    'skills-update-prompt-dark.png',
    'skills-update-prompt-light.png',
    'skills-update-prompt-small.png',
    'skills-update-dialog-light.png',
    'real/orca-before-hollow.png',
    'real/orca-after-solid.png',
    'real/orca-after-small.png',
    'real/orca-after-narrow.png',
    'real/orca-after-chat.png',
  ]) {
    const path = join(PKG, 'docs', 'screenshots', file)
    if (!existsSync(path)) throw new Error(`missing screenshot ${file}`)
    const { size } = requireStat(path)
    if (size < 10_000) throw new Error(`screenshot ${file} looks empty (${size} bytes)`)
  }
  return 'dark/light/small prompt + dialog captures present'
})

check('upstream license and third-party notices are bundled', () => {
  const license = readFileSync(join(PKG, 'docs', 'licenses', 'dsh-tui-0.16.1-LICENSE.txt'), 'utf8')
  if (!license.includes('Copyright (c) 2026, chimney (ccch1mneyyy)')) throw new Error('upstream MIT copyright missing')
  if (!license.includes('Permission is hereby granted, free of charge')) throw new Error('upstream MIT grant missing')
  const notices = readFileSync(join(PKG, 'docs', 'licenses', 'dsh-tui-0.16.1-THIRD_PARTY_LICENSES.txt'), 'utf8')
  for (const marker of ['dsh-ui-whale', 'BSD 3-Clause License', 'dsh-anchored-standard', 'xiaobright']) {
    if (!notices.includes(marker)) throw new Error(`upstream third-party notice missing ${marker}`)
  }
  const record = readFileSync(join(PKG, 'docs', 'third-party-notices.md'), 'utf8')
  for (const marker of ['MIT', '73ff99fbed56563bf154d719effd09f9f9725349', 'MathJax', 'Apache-2.0']) {
    if (!record.includes(marker)) throw new Error(`third-party notice record missing ${marker}`)
  }
  if (!existsSync(join(PKG, 'LICENSE'))) throw new Error('app-local LICENSE missing')
  for (const file of ['mathjax-tex-svg-LICENSE.txt', 'mathjax-tex-svg-NOTICE.txt']) {
    if (!existsSync(join(PKG, 'docs', 'licenses', file))) throw new Error(`missing ${file}`)
  }
  return 'upstream MIT + BSD/MIT portions + MathJax license/notice recorded'
})

check('documentation describes the no-logo brand and the build chain', () => {
  const readme = readFileSync(join(PKG, 'README.md'), 'utf8')
  for (const marker of ['#FF6096', 'HYPERAI HARNESS', 'no logo', 'build-patch.mjs', 'apps/profiles/hyperai']) {
    if (!readme.includes(marker)) throw new Error(`README is missing ${JSON.stringify(marker)}`)
  }
  for (const doc of ['branding.md', 'verification.md']) {
    if (!existsSync(join(PKG, 'docs', doc))) throw new Error(`missing docs/${doc}`)
  }
  return 'README + branding/verification docs'
})

const failed = checks.filter(entry => !entry.ok)
for (const entry of checks) {
  process.stdout.write(`${entry.ok ? 'PASS' : 'FAIL'}  ${entry.name}${entry.detail === '' ? '' : `  (${entry.detail})`}\n`)
}
process.stdout.write(`\nhyperai-tui verify: ${checks.length - failed.length}/${checks.length} checks passed\n`)
if (failed.length > 0) process.exitCode = 1
