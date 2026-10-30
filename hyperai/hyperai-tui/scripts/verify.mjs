#!/usr/bin/env node
/**
 * Build and distribution self-check for hyperai-tui. Runs offline: every check
 * reads committed artifacts (brand source, generated art, patch, profile
 * template, skills lock) and exercises the installers in dry-run mode inside a
 * temporary directory. Live TUI launch and model calls are covered by the
 * manual verification procedure in README.md.
 *
 *   node scripts/verify.mjs
 *
 * Exit code 0 = all checks passed.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = resolve(HERE, '..')
const checks = []
const stripAnsi = text => text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/gu, '')
const displayWidth = text => [...stripAnsi(text)].length

function check(name, fn) {
  try {
    const detail = fn()
    checks.push({ name, ok: true, detail: detail ?? '' })
  } catch (error) {
    checks.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) })
  }
}

const brand = JSON.parse(readFileSync(join(PKG, 'brand', 'brand.json'), 'utf8'))

check('brand data names the HyperAI product and pin', () => {
  if (brand.productName !== 'HyperAI Harness') throw new Error('productName')
  if (brand.pluginName !== 'hyperai-tui') throw new Error('pluginName')
  if (brand.splashWords.top !== 'HYPERAI' || brand.splashWords.bottom !== 'HARNESS') {
    throw new Error('splash words')
  }
  if (!/^[0-9a-f]{64}$/u.test(brand.logo.sha256)) throw new Error('logo sha256')
  return `${brand.upstream.package}@${brand.upstream.version}`
})

check('official logo source matches the recorded digest', () => {
  const digest = createHash('sha256').update(readFileSync(join(PKG, brand.logo.file))).digest('hex')
  if (digest !== brand.logo.sha256) throw new Error(`logo sha256 is ${digest}`)
  return brand.logo.file
})

check('logo data uses the whale letter-grid format (wide + compact)', () => {
  const art = readFileSync(join(PKG, 'brand', 'generated', 'hyperai-logo.js'), 'utf8')
  const parseArray = name => {
    const matched = new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\n\\]`, 'u').exec(art)
    if (matched === null) throw new Error(`${name} not found`)
    return [...matched[1].matchAll(/"(?:[^"\\]|\\.)*"/gu)].map(match => JSON.parse(match[0]))
  }
  const paletteMatch = /export const HYPERAI_LOGO_PALETTE = (\{[\s\S]*?\n\})/u.exec(art)
  if (paletteMatch === null) throw new Error('HYPERAI_LOGO_PALETTE not found')
  const palette = JSON.parse(paletteMatch[1])
  const colors = Object.values(palette)
  if (!colors.some(([r, g, b]) => r === 255 && g === 255 && b === 255)) throw new Error('white circle missing from palette')
  if (!colors.some(([r, g, b]) => r === 225 && g === 29 && b === 72)) throw new Error('SVG rose icon color missing from palette')
  for (const [r, g, b] of colors) {
    if (Math.max(r, g, b) < 150) throw new Error(`palette has a dark entry: ${r},${g},${b}`)
  }
  const letters = new Set(Object.keys(palette))
  const summaries = []
  for (const [name, expectedRows, expectedLetters] of [
    ['HYPERAI_LOGO_SPRITE_WIDE', 40, ['W', 'R']],
    ['HYPERAI_LOGO_SPRITE_COMPACT', 26, ['W', 'R']],
  ]) {
    const sprite = parseArray(name)
    if (sprite.length !== expectedRows) throw new Error(`${name} has ${sprite.length} rows (expected ${expectedRows})`)
    for (const row of sprite) if (row.length !== 40) throw new Error(`${name} row is ${row.length} columns`)
    const used = new Set(sprite.join('').split(''))
    for (const letter of used) {
      if (letter !== '.' && !letters.has(letter)) throw new Error(`${name} uses unknown letter ${letter}`)
    }
    for (const letter of expectedLetters) {
      if (!used.has(letter)) throw new Error(`${name} does not use the ${letter} palette letter`)
    }
    if (!used.has('.')) throw new Error(`${name} has no transparent cells`)
    summaries.push(`${expectedRows}x40`)
  }
  // The HD raster for the terminal image protocol path: embedded PNG must be a
  // 512x512 RGBA PNG whose digest matches the generated module's own record.
  const hdMatch = /export const HYPERAI_LOGO_HD_PNG_BASE64 = "([^"]+)"/u.exec(art)
  if (hdMatch === null) throw new Error('HYPERAI_LOGO_HD_PNG_BASE64 missing')
  const png = Buffer.from(hdMatch[1], 'base64')
  if (png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('HD payload is not a PNG')
  if (png.readUInt32BE(16) !== 512 || png.readUInt32BE(20) !== 512) throw new Error('HD PNG is not 512x512')
  const hdDigest = createHash('sha256').update(png).digest('hex')
  const recorded = /export const HYPERAI_LOGO_HD_SHA256 = "([0-9a-f]{64})"/u.exec(art)
  if (recorded === null || recorded[1] !== hdDigest) throw new Error('HD PNG sha256 mismatch')

  // Light-background variants: official art + a rim on the circle edge in the
  // SVG's own icon accent, so the white plate stays visible on white terminals.
  const lightSprite = /export const HYPERAI_LOGO_SPRITE_WIDE_LIGHT = \[([^\]]+)\]/u.exec(art)?.[1] ?? ''
  const lightCompact = /export const HYPERAI_LOGO_SPRITE_COMPACT_LIGHT = \[([^\]]+)\]/u.exec(art)?.[1] ?? ''
  const lightRim = (lightSprite.match(/K/gu) ?? []).length
  const lightCompactRim = (lightCompact.match(/K/gu) ?? []).length
  if (lightRim === 0 || lightCompactRim === 0) throw new Error('light sprites are missing the contrast rim')
  if (lightSprite.includes('R') === false) throw new Error('light sprite lost the icon')
  const darkSprite = /export const HYPERAI_LOGO_SPRITE_WIDE = \[([^\]]+)\]/u.exec(art)?.[1] ?? ''
  if (darkSprite.includes('K')) throw new Error('dark sprite must not carry the light-theme rim')
  const lightPngMatch = /export const HYPERAI_LOGO_HD_PNG_BASE64_LIGHT = "([^"]+)"/u.exec(art)
  if (lightPngMatch === null) throw new Error('light HD PNG missing')
  const lightPng = Buffer.from(lightPngMatch[1], 'base64')
  if (lightPng.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') throw new Error('light HD payload is not a PNG')
  if (lightPng.readUInt32BE(16) !== 512 || lightPng.readUInt32BE(20) !== 512) throw new Error('light HD PNG is not 512x512')
  const lightRecorded = /export const HYPERAI_LOGO_HD_SHA256_LIGHT = "([0-9a-f]{64})"/u.exec(art)
  const lightDigest = createHash('sha256').update(lightPng).digest('hex')
  if (lightRecorded === null || lightRecorded[1] !== lightDigest) throw new Error('light HD PNG sha256 mismatch')
  return `${summaries.join(' + ')} letter grids + 512x512 HD PNG, ${letters.size} palette colors (white + SVG rose)`
})

check('branding patch targets only documented upstream files', () => {
  const patch = readFileSync(join(PKG, 'patches', `dsh-tui@${brand.upstream.version}.patch`), 'utf8')
  const files = [...patch.matchAll(/^diff --git a\/(\S+) b\//gmu)].map(match => match[1])
  const expected = [
    'lib/types/branding.js',
    'lib/types/components/LogoV2.js',
    'lib/types/components/hyperaiLogo.js',
    'lib/types/components/hyperaiLogoRows.js',
    'lib/types/components/splashArtRows.js',
    'lib/types/components/splashEggs.js',
    'lib/types/components/splashFonts.js',
    'lib/types/dsh-adapter/plugin.js',
    'lib/types/i18n.js',
    'lib/types/screens/Launchpad.js',
    'lib/types/update.js',
    'lib/types/utils/paths.js',
  ]
  for (const file of expected) if (!files.includes(file)) throw new Error(`patch is missing ${file}`)
  if (files.length !== expected.length) throw new Error(`patch touches ${files.length} files, expected ${expected.length}`)
  for (const marker of ['HYPERAI', 'hyperaiLogo', 'hyperai-tui', "return { kind: 'unknown' }"]) {
    if (!patch.includes(marker)) throw new Error(`patch is missing marker ${marker}`)
  }
  if (!patch.includes("from './Whale.js'")) throw new Error('hyperaiLogo does not reuse the whale renderer module')
  if (!patch.includes('renderSpriteRows')) throw new Error('hyperaiLogo does not call renderSpriteRows')
  if (!patch.includes('HYPERAI_LOGO_SPRITE_WIDE')) throw new Error('patched logo rows are missing the wide sprite data')
  if (!patch.includes('HYPERAI_LOGO_SPRITE_WIDE_LIGHT')) throw new Error('patched logo rows are missing the light wide sprite')
  if (!patch.includes('HYPERAI_LOGO_HD_PNG_BASE64_LIGHT')) throw new Error('patched logo rows are missing the light HD PNG')
  if (!patch.includes('isLightThemeActive')) throw new Error('hyperaiLogo does not adapt to light terminals')
  if (!patch.includes('HYPERAI_LOGO_SPRITE_COMPACT')) throw new Error('patched logo rows are missing the compact sprite data')
  if (!patch.includes('HYPERAI_LOGO_WIDE_MIN_ROWS')) throw new Error('patched logo rows are missing the wide/compact row threshold')
  if (!patch.includes('hyperaiArtRows')) throw new Error('splash layout does not use the dynamic art height')
  if (!patch.includes('splashArtRows(splashArtForm, mascotBox, rows)')) throw new Error('Launchpad layout budget ignores terminal rows')
  if (!patch.includes('HYPERAI_LOGO_HD_PNG_BASE64')) throw new Error('hyperaiLogo does not embed the HD PNG payload')
  if (!patch.includes('useTerminalImages')) throw new Error('hyperaiLogo does not use the terminal image capability')
  if (!patch.includes('useTerminalImageCellSize')) throw new Error('hyperaiLogo does not measure the terminal cell size')
  if (!patch.includes('presentation: \'transcript\'')) throw new Error('hyperaiLogo does not opt the splash image into the transcript image lifecycle')
  return `${files.length} files, logo rendered by the whale renderSpriteRows (wide/compact)`
})

check('title gradient uses the HyperAI pink palette, not the theme blue', () => {
  const patch = readFileSync(join(PKG, 'patches', `dsh-tui@${brand.upstream.version}.patch`), 'utf8')
  if (!patch.includes('HYPERAI_PALETTE')) throw new Error('HYPERAI_PALETTE is missing from the patch')
  for (const marker of ['titleDark', 'titleLight', 'r: 255, g: 96, b: 150', 'r: 255, g: 247, b: 250']) {
    if (!patch.includes(marker)) throw new Error(`gradient marker missing: ${marker}`)
  }
  if (!patch.includes('brand === \'deepseek\'')) throw new Error('LogoV2 does not special-case the default brand')
  if (!patch.includes('HYPERAI_PALETTE.titleDark')) throw new Error('LogoV2 does not read the dark title ladder')
  if (!patch.includes('HYPERAI_PALETTE.titleLight')) throw new Error('LogoV2 does not read the light title ladder')
  return 'pink -> near-white (dark) / deep pink -> light pink (light)'
})

check('logo source is the local canonical SVG', () => {
  if (!brand.logo.file.endsWith('.svg')) throw new Error(`logo file is not an SVG: ${brand.logo.file}`)
  if (!/logo-icon-border-1\.svg/u.test(brand.logo.origin)) throw new Error('brand.json does not name the official SVG source')
  const svg = readFileSync(join(PKG, brand.logo.file), 'utf8')
  if (!svg.includes('viewBox="0 0 120 120"')) throw new Error('SVG viewBox changed')
  if (!svg.includes('data:image/png;base64,')) throw new Error('SVG is missing the embedded icon')
  const art = readFileSync(join(PKG, 'brand', 'generated', 'hyperai-logo.js'), 'utf8')
  if (!art.includes('generated from the canonical SVG source')) throw new Error('generated art does not record the SVG source')
  if (art.includes('60x60 PNG')) throw new Error('generated art still references the retired PNG source')
  return 'brand/hyperai-logo.svg <- /Users/zhenhaoli/Downloads/logo-icon-border-1.svg'
})

check('profile template is consistent with the brand pin', () => {
  const manifest = JSON.parse(readFileSync(join(PKG, 'profile', 'package.json'), 'utf8'))
  if (manifest.dependencies[brand.upstream.package] !== brand.upstream.version) throw new Error('profile dependency pin')
  if (!manifest.dsh.profile.bundles.includes('@deepseek-ai/dsh-base')) throw new Error('base bundle missing')
  if (!manifest.dsh.profile.bundles.includes(brand.upstream.package)) throw new Error('TUI bundle missing')
  const workspace = readFileSync(join(PKG, 'profile', 'pnpm-workspace.yaml'), 'utf8')
  const patchKey = `'${brand.upstream.package}@${brand.upstream.version}'`
  if (!workspace.includes(patchKey)) throw new Error('patchedDependencies key missing')
  if (!workspace.includes('patches/hyperai-tui.patch')) throw new Error('patchedDependencies path missing')
  const cordis = readFileSync(join(PKG, 'profile', 'cordis.patch.yml'), 'utf8')
  for (const id of ['llm-pi-ai', 'dsh-tui', 'skill-filesystem']) {
    if (!new RegExp(`^- id: ${id}$`, 'mu').test(cordis)) throw new Error(`cordis row ${id} missing`)
  }
  if (cordis.includes('apiKey:') || /sk-[A-Za-z0-9]{10,}/u.test(cordis)) throw new Error('credential material in profile config')
  return 'bundles, patch pin, cordis rows'
})

check('skills lock pins a commit and lists the installable set', () => {
  const lock = JSON.parse(readFileSync(join(PKG, '..', 'skills', 'hyperai-skills.lock.json'), 'utf8'))
  if (!/^[0-9a-f]{40}$/u.test(lock.ref)) throw new Error('unpinned ref')
  if (lock.ref !== '24adeeff371290fab0c15691ab2efb7382e2262e') throw new Error('ref changed without review')
  const names = [...lock.verified, ...lock.unverified].map(skill => skill.name)
  for (const name of ['example-verified-skill', 'mineru-ocr', 'mineru-ocr-to-xlsx', 'playwright-browser']) {
    if (!names.includes(name)) throw new Error(`locked skill ${name} missing`)
  }
  if (lock.verified.some(skill => skill.validated !== true)) throw new Error('verified entry not marked validated')
  if (lock.unverified.some(skill => skill.validated !== false)) throw new Error('unverified entry claims validation')
  return `${lock.ref.slice(0, 8)} · ${names.length} skills`
})

check('logo generator reproduces the committed art', () => {
  const out = execFileSync(process.execPath, [join(PKG, 'scripts', 'generate-logo-art.mjs')], { encoding: 'utf8' })
  if (!out.includes('hyperai-logo.js')) throw new Error('generator reported no output')
  return 'regenerated'
})

check('installer dry-run plans a managed profile', () => {
  const home = mkdtempSync(join(tmpdir(), 'hyperai-tui-verify-'))
  try {
    const output = execFileSync(
      process.execPath,
      [join(PKG, 'scripts', 'install.mjs'), '--dsh-home', home, '--no-skills', '--dry-run', '--json'],
      { encoding: 'utf8' },
    )
    const result = JSON.parse(output)
    const actions = result.plan.map(step => `${step.action} ${step.file}`)
    for (const expected of [
      'create package.json',
      'create cordis.patch.yml',
      'create pnpm-workspace.yaml',
      'create patches/hyperai-tui.patch',
    ]) {
      if (!actions.includes(expected)) throw new Error(`missing plan step: ${expected}`)
    }
    if (existsSync(join(home, 'profiles', 'hyperai', 'package.json'))) throw new Error('dry run wrote files')
    return actions.join(', ')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

check('terminal diagnostics probes the real terminal without reading secrets', () => {
  const script = readFileSync(join(PKG, 'scripts', 'diagnose-terminal.mjs'), 'utf8')
  for (const marker of ['probes.kitty', '/dev/tty', '\\x1b[c', '\\x1b[16t', '\\x1b]11;?', '--json', 'fallbackReasons']) {
    if (!script.includes(marker)) throw new Error(`diagnose-terminal is missing ${JSON.stringify(marker)}`)
  }
  if (/API_KEY|TOKEN|SECRET|PASSWORD/iu.test(script)) throw new Error('diagnose-terminal must not read secrets')
  return 'real Kitty/Sixel/DA1/OSC 11 probes, JSON mode, no secrets'
})

check('installer refuses to overwrite a foreign profile', () => {
  const home = mkdtempSync(join(tmpdir(), 'hyperai-tui-verify-'))
  try {
    execFileSync('mkdir', ['-p', join(home, 'profiles', 'hyperai')])
    execFileSync('sh', ['-c', `printf '{"name":"not-ours"}' > ${JSON.stringify(join(home, 'profiles', 'hyperai', 'package.json'))}`])
    let refused = false
    try {
      execFileSync(process.execPath, [join(PKG, 'scripts', 'install.mjs'), '--dsh-home', home, '--no-skills', '--dry-run'], {
        encoding: 'utf8',
        stdio: 'pipe',
      })
    } catch {
      refused = true
    }
    if (!refused) throw new Error('installer accepted a foreign profile')
    return 'no overwrite without --force'
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

const failed = checks.filter(entry => !entry.ok)
for (const entry of checks) {
  process.stdout.write(`${entry.ok ? 'PASS' : 'FAIL'}  ${entry.name}${entry.detail === '' ? '' : `  (${entry.detail})`}\n`)
}
process.stdout.write(`\nhyperai-tui verify: ${checks.length - failed.length}/${checks.length} checks passed\n`)
process.exit(failed.length === 0 ? 0 : 1)
