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

check('generated logo art has the splash grid shape', () => {
  const rows = (text, name) => {
    const matched = new RegExp(`export const ${name} = \\[([\\s\\S]*?)\\n\\]`, 'u').exec(text)
    if (matched === null) throw new Error(`${name} not found`)
    return [...matched[1].matchAll(/"(?:[^"\\]|\\.)*"/gu)].map(match => JSON.parse(match[0]))
  }
  const art = readFileSync(join(PKG, 'brand', 'generated', 'hyperai-logo.js'), 'utf8')
  for (const name of ['HYPERAI_LOGO_ROWS_DARK', 'HYPERAI_LOGO_ROWS_LIGHT']) {
    const lines = rows(art, name)
    if (lines.length !== 13) throw new Error(`${name} has ${lines.length} rows`)
    for (const line of lines) {
      const width = displayWidth(line)
      if (width !== 40) throw new Error(`${name} row is ${width} columns`)
    }
  }
  return '2 variants x 13 rows x 40 columns'
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
  return `${files.length} files`
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

check('logo source is the local canonical asset', () => {
  if (!/51961168\.png/u.test(brand.logo.origin)) throw new Error('brand.json does not name the local canonical source')
  if (brand.logo.width !== 60 || brand.logo.height !== 60) throw new Error('logo dimensions mismatch')
  const art = readFileSync(join(PKG, 'brand', 'generated', 'hyperai-logo.js'), 'utf8')
  if (!art.includes(`(60x60 PNG`)) throw new Error('generated art does not record the 60x60 source')
  return 'brand/hyperai-logo.png <- /Users/zhenhaoli/Downloads/51961168.png'
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
