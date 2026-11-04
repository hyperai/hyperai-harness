/**
 * Branding contract checks for the no-logo HyperAI TUI.
 *
 * These read the committed brand data and the generated pnpm patch. They are
 * offline by design: the patch build itself is covered by
 * `node scripts/build-patch.mjs` and the real terminal matrix by
 * `docs/verification.md`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const brand = JSON.parse(readFileSync(join(PKG, 'src', 'brand.json'), 'utf8'))
const tuiPackage = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'))
const patch = readFileSync(join(PKG, 'patches', `dsh-tui@${brand.upstream.version}.patch`), 'utf8')
const addedLines = patch
  .split('\n')
  .filter(line => line.startsWith('+') && !line.startsWith('+++'))
  .map(line => line.slice(1))

test('brand data is HyperAI Harness with the one product pink', () => {
  assert.equal(brand.productName, 'HyperAI Harness')
  assert.equal(brand.pluginName, 'hyperai-tui')
  assert.equal(brand.profileName, 'hyperai')
  assert.equal(brand.titleColor, '#FF6096')
  assert.deepEqual(brand.splashWords, { top: 'HYPERAI', bottom: 'HARNESS', plain: 'HyperAI Harness' })
  assert.deepEqual(brand.tagline, { zh: 'HyperAI Harness', en: 'HyperAI Harness' })
  assert.equal(brand.logo, undefined)
  assert.match(brand.upstream.version, /^\d+\.\d+\.\d+$/u)
})

test('the patch palette is solid #FF6096 on every theme', () => {
  const solid = addedLines.filter(line => line.includes('r: 255, g: 96, b: 150'))
  assert.ok(solid.length >= 6, `expected the pink in every palette field, got ${solid.length}`)
  for (const field of ['accent', 'accentShimmer', 'tagline', 'base', 'start', 'mid', 'end', 'flash']) {
    assert.ok(addedLines.some(line => line.trimStart().startsWith(`${field}:`)), `palette field ${field}`)
  }
  for (const stale of ['titleLight', 'titleDark']) assert.equal(patch.includes(stale), false, `stale ${stale}`)
  assert.match(addedLines.join('\n'), /const brandLadder = brand === 'deepseek'\n\s+\? HYPERAI_PALETTE\.title/u)
})

test('the splash carries the pixel words and no art', () => {
  for (const marker of ['HYPERAI', 'HARNESS', 'hyperai-tui']) assert.ok(patch.includes(marker), marker)
  for (const marker of ['whale: false', 'showWhale: false', 'const wantsArt = false;']) {
    assert.ok(patch.includes(marker), `art suppression ${marker}`)
  }
  for (const banned of ['HYPERAI_LOGO', 'hyperaiLogo', 'data:image', 'base64']) {
    assert.equal(patch.includes(banned), false, `logo/image payload ${banned}`)
  }
  const imageAdditions = addedLines.filter(line => /kitty|sixel|useTerminalImages/iu.test(line))
  assert.deepEqual(imageAdditions, [], 'the patch must not add image-protocol code')
})

test('brand-display copy drops DeepSeek/whale-girl wording', () => {
  const added = addedLines.join('\n')
  for (const banned of ['鲸鱼娘', 'whale girl', 'dshTUI', 'dsh-TUI']) assert.equal(added.includes(banned), false, banned)
  for (const marker of ['HyperAI Harness 好像', '正在连接 HyperAI', 'HyperAI 的思考过程']) {
    assert.ok(patch.includes(marker), marker)
  }
})

test('the patch touches only the documented upstream files and stays small', () => {
  const changed = [...patch.matchAll(/^diff --git a\/(\S+) b\//gmu)].map(match => match[1])
  assert.deepEqual(changed.sort(), [
    'lib/types/branding.js',
    'lib/types/components/LogoV2.js',
    'lib/types/components/launchpadLayout.js',
    'lib/types/components/splashEggs.js',
    'lib/types/components/splashFonts.js',
    'lib/types/tips.js',
    'lib/types/commands.js',
    'lib/types/dsh-adapter/plugin.js',
    'lib/types/hyperaiSkills.js',
    'lib/types/hyperaiSkillsCore.js',
    'lib/types/i18n.js',
    'lib/types/screens/Chat.js',
    'lib/types/screens/Launchpad.js',
    'lib/types/settings/definitions.js',
    'lib/types/update.js',
    'lib/types/utils/paths.js',
  ].sort())
  assert.ok(patch.length < 96 * 1024, `patch is ${patch.length} bytes`)
  const longest = patch.split('\n').reduce((max, line) => Math.max(max, line.length), 0)
  assert.ok(longest < 4000, `longest patch line is ${longest} characters`)
})

test('profile isolation, version plate and branded links stay wired', () => {
  for (const marker of [
    `hyperai-tui v${tuiPackage.version}`,
    ' · dsh-tui v${tuiVersion}',
    '.dsh-tui-${profile}',
    'https://github.com/hyperai/hyperai-harness',
    'const onboardingOnBoot = false;',
    'const uniformBrand = true;',
    'sweep(words.plain',
    'hyperaiLook ? HYPERAI_PALETTE.title.base',
    "return { kind: 'unknown' };",
  ]) {
    assert.ok(patch.includes(marker), marker)
  }
})

test('the product version is the HyperAI release and dsh-tui stays upstream', () => {
  assert.ok(patch.includes('const upstream = packageJson.hyperai?.upstreamVersion;'))
  assert.ok(patch.includes(`children: '  v${tuiPackage.version}'`))
  assert.ok(patch.includes(`hyperai-tui v${tuiPackage.version}`))
  const upstream = JSON.parse(readFileSync(join(PKG, 'upstream.json'), 'utf8'))
  assert.equal(upstream.version, brand.upstream.version)
  assert.match(upstream.sha256, /^[0-9a-f]{64}$/u)
})

test('the brand splash is pinned to the upstream solid font', () => {
  const pinned = "brand === 'deepseek' ? splashFontById('bold') : pickSplashFont()"
  assert.ok(patch.includes(pinned), 'patch must pin HYPERAI/HARNESS to the solid base font')
  assert.match(patch, /daily rotation can select stencil\/classic\/dot/u)
  assert.equal((patch.match(new RegExp(pinned.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&'), 'gu')) ?? []).length, 2)
})

test('the patch contains the skills update command and non-blocking hint', () => {
  for (const marker of [
    "name: 'skills-update'",
    'useSkillsUpdate',
    'skillsUpdate.notice',
    'skillsUpdate.open',
    'HyperAI Skills 有',
    '--manual',
    '--ref',
  ]) {
    assert.ok(patch.includes(marker), `patch marker ${marker}`)
  }
  const chat = readFileSync(join(PKG, 'src', 'hyperaiSkills.js'), 'utf8')
  assert.match(chat, /dialogs\.ask/u)
  assert.match(chat, /update.*--yes|--yes.*update/su)
  // No second scanner / installer in the TUI layer.
  for (const banned of ['ls-remote', 'discoverSkills', 'SKILL.md', 'manifest.json']) {
    assert.equal(chat.includes(banned), false, `duplicated profile logic: ${banned}`)
  }
})

test('the TUI tree carries no logo toolchain', () => {
  for (const banned of ['brand', 'overlay', 'bin']) assert.equal(existsSync(join(PKG, banned)), false, banned)
  assert.equal(existsSync(join(PKG, 'scripts', 'generate-logo-art.mjs')), false)
  assert.equal(existsSync(join(PKG, 'scripts', 'diagnose-terminal.mjs')), false)
  const readme = readFileSync(join(PKG, 'README.md'), 'utf8')
  for (const marker of ['#FF6096', 'no logo', 'build-patch.mjs', 'apps/profiles/hyperai']) {
    assert.ok(readme.includes(marker), `README marker ${marker}`)
  }
})


test('upstream self-update checks are disabled before any registry/GitHub fetch', () => {
  const updateSection = patch.slice(patch.indexOf('diff --git a/lib/types/update.js'))
  assert.match(updateSection, /export async function checkForTuiUpdate\(\) \{\n\+\s+.*return undefined;/su, 'checkForTuiUpdate must return before its fetch path')
  assert.match(updateSection, /^\+\s+return undefined;$/mu)
  assert.match(updateSection, /return \{ kind: 'unknown' \};/u)
  // The visible prompt may stay upstream, but both callers must receive undefined.
  const chat = patch.slice(patch.indexOf('diff --git a/lib/types/screens/Chat.js'))
  assert.match(chat, /checkForTuiUpdate\(\)/u)
  assert.ok(patch.length < 96 * 1024)
})
