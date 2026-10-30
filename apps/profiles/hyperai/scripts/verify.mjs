#!/usr/bin/env node
/**
 * Offline self-check for the `hyperai` profile distribution.
 *
 * Reads the committed profile template, the TUI patch it installs, the skills
 * lock and the installer behaviour. It never launches a terminal, never touches
 * the network and never writes to the real Harness home; the dry-run installer
 * is exercised inside a temporary directory.
 *
 *   node scripts/verify.mjs
 *
 * Exit code 0 = every check passed.
 */
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { install, mergeCordisPatch, parseArgs, profileManifest, workspaceFile } from './install.mjs'
import { loadLock, selectedSkills } from './install-skills.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = resolve(HERE, '..')
const TUI = resolve(HERE, '..', '..', '..', 'tui')
const brand = JSON.parse(readFileSync(join(TUI, 'src', 'brand.json'), 'utf8'))
const manifest = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'))
const cordis = readFileSync(join(PKG, 'cordis.patch.yml'), 'utf8')
const workspace = readFileSync(join(PKG, 'pnpm-workspace.yaml'), 'utf8')
const readme = readFileSync(join(PKG, 'README.md'), 'utf8')
const checks = []

async function check(name, fn) {
  try {
    checks.push({ name, ok: true, detail: (await fn()) ?? '' })
  } catch (error) {
    checks.push({ name, ok: false, detail: error instanceof Error ? error.message : String(error) })
  }
}

await check('profile manifest is a native DSH profile with the pinned TUI bundle', () => {
  if (manifest.name !== 'dsh-profile-hyperai') throw new Error(`manifest name is ${manifest.name}`)
  if (manifest.private !== true) throw new Error('profile manifest must stay private')
  const bundles = manifest.dsh?.profile?.bundles
  if (JSON.stringify(bundles) !== JSON.stringify(['@deepseek-ai/dsh-base', '@deepseek-harness-tui/dsh-tui'])) {
    throw new Error(`bundles are ${JSON.stringify(bundles)}`)
  }
  if (manifest.dependencies?.[brand.upstream.package] !== brand.upstream.version) {
    throw new Error('profile pins a different dsh-tui version than the TUI brand data')
  }
  return `${bundles.join(' + ')} @ ${brand.upstream.version}`
})

await check('the profile patch layer keeps only the profile-scoped skill root', () => {
  for (const marker of [
    '- id: skill-filesystem',
    'disabled: false',
    'customSkillDirs:',
    'DSH_HYPERAI_SKILLS_DIR',
    'watch: true',
  ]) {
    if (!cordis.includes(marker)) throw new Error(`cordis.patch.yml is missing ${JSON.stringify(marker)}`)
  }
  // Model configuration is DSH-native: /provider writes a plain llm-pi-ai row
  // into the *installed* profile. The committed template must not force a
  // provider, endpoint, apiKeyEnv or default model on anyone.
  const cordisConfig = cordis.split('\n').filter(line => !line.trim().startsWith('#')).join('\n')
  for (const marker of ['- id: llm-pi-ai', 'apiKeyEnv', 'HYPERAI_API_KEY', 'HYPERAI_BASE_URL', 'HYPERAI_MODEL', 'HYPERAI_PROVIDER', 'gpt-4o-mini', 'provider:', 'model:']) {
    if (cordisConfig.includes(marker)) throw new Error(`cordis.patch.yml still forces model configuration: ${JSON.stringify(marker)}`)
  }
  if (/api[_-]?key\s*[:=]\s*['"]?[A-Za-z0-9_-]{16,}/iu.test(cordis)) throw new Error('the profile must not contain a credential')
  if (cordis.includes('hyperaiLogo')) throw new Error('profile patch layer still references the removed logo')
  return 'skill root only; providers/models are DSH-native (/provider, /model)'
})

await check('a reinstall drops the legacy model preset but keeps user configuration', () => {
  const legacy = [
    '- id: llm-pi-ai',
    '  config:',
    '    providers:',
    '      hyperai:',
    "        apiKeyEnv: !!js process.env.HYPERAI_API_KEY_ENV ?? 'HYPERAI_API_KEY'",
    '- id: dsh-tui',
    '  config:',
    "    provider: !!js process.env.HYPERAI_PROVIDER ?? 'hyperai'",
    "    model: !!js process.env.HYPERAI_MODEL ?? 'gpt-4o-mini'",
    '    fullscreen: false',
    '    lang: zh',
    '- id: llm-pi-ai',
    '  config:',
    '    providers:',
    '      litellm:',
    '        apiKeyEnv: LITELLM_API_KEY',
    '        baseURL: https://gateway.example/v1',
    '        models:',
    '          - id: gpt-4o-mini',
    '',
  ].join('\n')
  const merged = mergeCordisPatch(legacy, cordis)
  if (merged.includes('HYPERAI_API_KEY_ENV') || merged.includes('HYPERAI_PROVIDER')) {
    throw new Error('the legacy environment-driven preset survived the migration')
  }
  for (const marker of ['litellm', 'LITELLM_API_KEY', 'fullscreen: false', 'lang: zh']) {
    if (!merged.includes(marker)) throw new Error(`user configuration was not preserved: ${JSON.stringify(marker)}`)
  }
  return 'legacy preset removed; user provider and TUI rows kept'
})

await check('the profile installs the TUI through the documented pnpm patch', () => {
  for (const marker of ['packages:', 'nodeLinker: hoisted', 'patchedDependencies:', `'${brand.upstream.package}@${brand.upstream.version}'`, 'patches/hyperai-tui.patch']) {
    if (!workspace.includes(marker)) throw new Error(`pnpm-workspace.yaml is missing ${JSON.stringify(marker)}`)
  }
  const patchFile = join(TUI, 'patches', `dsh-tui@${brand.upstream.version}.patch`)
  if (!existsSync(patchFile)) throw new Error(`the TUI patch is missing: ${patchFile}`)
  const patch = readFileSync(patchFile, 'utf8')
  for (const marker of [brand.splashWords.top, brand.splashWords.bottom, 'r: 255, g: 96, b: 150', 'showWhale: false']) {
    if (marker !== '' && !patch.includes(marker)) throw new Error(`the TUI patch is missing ${JSON.stringify(marker)}`)
  }
  if (patch.includes('hyperaiLogo')) throw new Error('the TUI patch still carries the removed logo module')
  return `${brand.upstream.package}@${brand.upstream.version}`
})

await check('the skills lock is pinned and classified', () => {
  const lock = loadLock(join(PKG, 'skills', 'hyperai-skills.lock.json'))
  if (!/^[0-9a-f]{40}$/u.test(lock.ref)) throw new Error('skills lock ref is not a commit')
  const all = selectedSkills(lock, false)
  const verified = selectedSkills(lock, true)
  if (all.length === 0) throw new Error('skills lock lists no skills')
  if (verified.length === 0 || !verified.every(skill => skill.validated === true)) throw new Error('verified skills are missing')
  if (!all.some(skill => skill.validated === false)) throw new Error('unverified skills are missing')
  if (!existsSync(join(PKG, 'docs', 'skills.md'))) throw new Error('docs/skills.md is missing')
  return `${all.length} skills (${verified.length} verified) @ ${lock.ref.slice(0, 8)}`
})

await check('the dry-run installer plans every managed file and writes nothing', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hyperai-profile-verify-'))
  try {
    const result = await install(parseArgs(['--dsh-home', home, '--no-skills', '--dry-run']))
    const plan = result.plan.map(step => `${step.action} ${step.file}`)
    const expected = [
      'create package.json',
      'create cordis.patch.yml',
      'create pnpm-workspace.yaml',
      'create patches/hyperai-tui.patch',
    ]
    if (JSON.stringify(plan) !== JSON.stringify(expected)) throw new Error(`plan is ${JSON.stringify(plan)}`)
    if (existsSync(join(home, 'profiles', 'hyperai', 'package.json'))) throw new Error('dry run wrote files')
    return plan.join(', ')
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

await check('the installer refuses a foreign profile and the manifest stays manageable', async () => {
  const home = mkdtempSync(join(tmpdir(), 'hyperai-profile-verify-'))
  try {
    const profileDir = join(home, 'profiles', 'hyperai')
    const { mkdirSync, writeFileSync } = await import('node:fs')
    mkdirSync(profileDir, { recursive: true })
    writeFileSync(join(profileDir, 'package.json'), '{"name":"someone-elses-profile"}\n')
    let refused = false
    try {
      await install(parseArgs(['--dsh-home', home, '--no-skills', '--dry-run']))
    } catch (error) {
      refused = /not created by this installer/u.test(String(error))
    }
    if (!refused) throw new Error('a foreign profile was not refused')
    if (profileManifest().hyperaiTui?.upstream !== brand.upstream.version) throw new Error('managed marker records the wrong upstream pin')
    return 'foreign profile refused; managed marker pins the TUI'
  } finally {
    rmSync(home, { recursive: true, force: true })
  }
})

await check('the README documents the native profile, TUI relation and run command', () => {
  for (const marker of ['apps/tui', 'dsh --profile hyperai', '/provider', '/model', 'Skills']) {
    if (!readme.includes(marker)) throw new Error(`README is missing ${JSON.stringify(marker)}`)
  }
  if (readme.includes('HYPERAI_API_KEY')) throw new Error('README still documents a forced provider credential')
  return 'native profile + DSH-native provider/model configuration + skills'
})

const failed = checks.filter(entry => !entry.ok)
for (const entry of checks) {
  process.stdout.write(`${entry.ok ? 'PASS' : 'FAIL'}  ${entry.name}${entry.detail === '' ? '' : `  (${entry.detail})`}\n`)
}
process.stdout.write(`\nhyperai profile verify: ${checks.length - failed.length}/${checks.length} checks passed\n`)
if (failed.length > 0) process.exitCode = 1
