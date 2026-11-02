#!/usr/bin/env node
/**
 * Lifecycle commands for the installed HyperAI profile.
 *
 *   node scripts/manage.mjs status   [--json]
 *   node scripts/manage.mjs doctor   [--json]
 *   node scripts/manage.mjs repair   [--yes] [--no-skills]
 *   node scripts/manage.mjs uninstall [--yes] [--purge]
 *
 * status and doctor are read-only. repair re-runs the idempotent installer and
 * records its phase in `.hyperai-install.json`. uninstall archives the profile
 * (including user skills/state) before removing installer-owned runtime files;
 * default leaves the archived user data in place, --purge removes the profile.
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { install, parseArgs as parseInstallerArgs, readInstallState } from './install.mjs'
import { inspectEnvironment, nodeVersionSupported, coreVersionSupported, parseNodeVersion } from './preflight.mjs'
import { listBackups, readManifest } from './skills-lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = resolve(HERE, '..')
const TUI = resolve(PKG, '..', '..', 'tui')
const BRAND = JSON.parse(readFileSync(join(TUI, 'src', 'brand.json'), 'utf8'))
const TUI_PACKAGE = JSON.parse(readFileSync(join(TUI, 'package.json'), 'utf8'))

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return undefined }
}

function parseArgs(argv) {
  const options = {
    command: undefined,
    dshHome: process.env.DSH_HOME ?? join(homedir(), '.dsh'),
    profile: BRAND.profileName,
    dshBin: process.env.HYPERAI_DSH_BIN ?? 'dsh',
    pnpmBin: process.env.PNPM_BIN ?? 'pnpm',
    json: false,
    yes: false,
    purge: false,
    skills: true,
    force: false,
  }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (['status', 'doctor', 'repair', 'uninstall'].includes(arg)) options.command = arg
    else if (arg === '--dsh-home') options.dshHome = argv[++i]
    else if (arg === '--profile') options.profile = argv[++i]
    else if (arg === '--dsh-bin') options.dshBin = argv[++i]
    else if (arg === '--pnpm-bin') options.pnpmBin = argv[++i]
    else if (arg === '--json') options.json = true
    else if (arg === '--yes' || arg === '-y') options.yes = true
    else if (arg === '--purge') options.purge = true
    else if (arg === '--no-skills') options.skills = false
    else if (arg === '--force') options.force = true
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`unknown argument ${JSON.stringify(arg)}`)
  }
  options.dshHome = resolve(options.dshHome)
  options.profileDir = join(options.dshHome, 'profiles', options.profile)
  if (options.command === undefined && options.help !== true) options.command = 'status'
  return options
}

function managed(profileDir) {
  return readJson(join(profileDir, 'package.json'))?.hyperaiTuiManaged === true
}

function installedTuiVersion(profileDir) {
  return readJson(join(profileDir, 'node_modules', ...BRAND.upstream.package.split('/'), 'package.json'))?.version
}

/** Read-only status payload. */
export function statusProfile(options) {
  const profileDir = options.profileDir
  const state = readInstallState(profileDir)
  let skills = { skills: {}, error: undefined }
  try { skills = readManifest(join(profileDir, '.hyperai-skills')) } catch (error) { skills = { skills: {}, error: String(error) } }
  return {
    profile: options.profile,
    profileDir,
    managed: managed(profileDir),
    installState: state,
    hyperaiTuiVersion: readJson(join(profileDir, 'package.json'))?.hyperaiTui?.version,
    installedTuiVersion: installedTuiVersion(profileDir),
    upstreamVersion: BRAND.upstream.version,
    copiedPatch: existsSync(join(profileDir, 'patches', 'hyperai-tui.patch')),
    skills: Object.keys(skills.skills ?? {}).length,
    skillsError: skills.error,
    backups: listBackups(join(profileDir, '.hyperai-skills')).length,
  }
}

/** Read-only diagnostics; returns { ok, issues, warnings, status }. */
export function diagnoseProfile(options) {
  const issues = []
  const warnings = []
  const status = statusProfile(options)
  if (!nodeVersionSupported(process.versions.node)) {
    issues.push(`unsupported Node.js ${process.versions.node}; requires ^22.19 || >=24`)
  }
  let environment
  try {
    environment = inspectEnvironment({ dshBin: options.dshBin, pnpmBin: options.pnpmBin })
    if (!coreVersionSupported(environment.dshVersion, BRAND.core.validated)) {
      issues.push(`DSH Core ${environment.dshVersion} is outside the validated set: ${BRAND.core.validated.join(', ')}`)
    }
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error))
  }
  if (!status.managed) issues.push(`profile ${options.profileDir} is not managed by this installer`)
  if (status.installState?.status === 'failed') issues.push(`last install failed: ${status.installState.error ?? 'unknown error'}`)
  if (!status.copiedPatch) warnings.push('copied branding patch is missing; run repair')
  if (status.skillsError !== undefined) issues.push(`skills manifest: ${status.skillsError}`)
  const pending = join(options.profileDir, '.hyperai-skills', 'pending')
  if (existsSync(pending) && readdirSync(pending).length > 0) warnings.push('an interrupted skills transaction has a pending journal; run catalog/update or repair')
  return { ok: issues.length === 0, issues, warnings, environment, status }
}

function requireManaged(options) {
  if (!managed(options.profileDir) && !options.force) {
    throw new Error(`refusing to modify ${options.profileDir}: not a managed HyperAI profile (use --force only after inspection)`)
  }
}

/** Archive one profile without node_modules; returns archive path. */
function archiveProfile(options) {
  const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d+Z$/u, 'Z')
  const archiveRoot = join(options.dshHome, 'profiles', '.hyperai-uninstall-backups', `${options.profile}-${stamp}`)
  cpSync(options.profileDir, archiveRoot, {
    recursive: true,
    filter: source => !source.split(/[\\/]/u).includes('node_modules'),
  })
  writeFileSync(join(archiveRoot, 'README.txt'), 'Archived by manage.mjs uninstall; user skills, settings and install state are preserved here.\n')
  return archiveRoot
}

/** Re-run the idempotent installer; this is the repair path for partial runs. */
export async function repairProfile(options) {
  requireManaged(options)
  return install({
    ...parseInstallerArgs(['--dsh-home', options.dshHome, '--profile', options.profile, '--dsh-bin', options.dshBin, ...(options.skills ? [] : ['--no-skills'])]),
    pnpmBin: options.pnpmBin,
    preflight: true,
  })
}

/** Safe uninstall: archive user data, remove managed runtime files. */
export function uninstallProfile(options) {
  requireManaged(options)
  if (!options.yes) throw new Error('uninstall requires --yes')
  const archive = archiveProfile(options)
  if (options.purge) {
    rmSync(options.profileDir, { recursive: true, force: true })
    return { profileDir: options.profileDir, archive, purge: true, kept: [] }
  }
  const managedPaths = ['package.json', 'cordis.patch.yml', 'pnpm-workspace.yaml', 'patches', 'scripts/skills-lib.mjs', 'scripts/skills-update.mjs', '.plugin-manager', 'node_modules']
  for (const relative of managedPaths) rmSync(join(options.profileDir, relative), { recursive: true, force: true })
  const kept = existsSync(options.profileDir) ? readdirSync(options.profileDir) : []
  return { profileDir: options.profileDir, archive, purge: false, kept }
}

function printStatus(value) {
  process.stdout.write(`profile: ${value.profileDir}\n`)
  process.stdout.write(`managed: ${value.managed ? 'yes' : 'no'}\n`)
  process.stdout.write(`hyperai-tui: ${value.hyperaiTuiVersion ?? '-'}  upstream dsh-tui: ${value.installedTuiVersion ?? '-'} (wanted ${value.upstreamVersion})\n`)
  process.stdout.write(`install state: ${value.installState?.status ?? 'unknown'}\n`)
  process.stdout.write(`skills: ${value.skills} managed${value.skillsError ? ` (manifest error: ${value.skillsError})` : ''}\n`)
}

async function main() {
  let options
  try { options = parseArgs(process.argv.slice(2)) } catch (error) {
    process.stderr.write(`hyperai-manage: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 2
    return
  }
  if (options.help) {
    process.stdout.write('usage: node scripts/manage.mjs <status|doctor|repair|uninstall> [--dsh-home <dir>] [--profile <name>] [--json] [--yes] [--purge]\n')
    return
  }
  try {
    if (options.command === 'status') {
      const value = statusProfile(options)
      if (options.json) process.stdout.write(`${JSON.stringify(value, undefined, 2)}\n`)
      else printStatus(value)
      return
    }
    if (options.command === 'doctor') {
      const value = diagnoseProfile(options)
      if (options.json) process.stdout.write(`${JSON.stringify(value, undefined, 2)}\n`)
      else {
        process.stdout.write(`${value.ok ? 'OK' : 'FAIL'}  ${options.profileDir}\n`)
        for (const issue of value.issues) process.stdout.write(`  issue: ${issue}\n`)
        for (const warning of value.warnings) process.stdout.write(`  warning: ${warning}\n`)
      }
      if (!value.ok) process.exitCode = 1
      return
    }
    if (options.command === 'repair') {
      if (!options.yes) throw new Error('repair requires --yes')
      const result = await repairProfile(options)
      if (options.json) process.stdout.write(`${JSON.stringify(result, undefined, 2)}\n`)
      else process.stdout.write(`repaired ${options.profileDir}\n`)
      return
    }
    const result = uninstallProfile(options)
    if (options.json) process.stdout.write(`${JSON.stringify(result, undefined, 2)}\n`)
    else process.stdout.write(`uninstalled ${options.profileDir}\narchive: ${result.archive}\n${options.purge ? 'profile removed' : `kept: ${result.kept.join(', ') || '-'}`}\n`)
  } catch (error) {
    process.stderr.write(`hyperai-manage: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
