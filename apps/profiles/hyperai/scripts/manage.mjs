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
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync, realpathSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { install, parseArgs as parseInstallerArgs, readInstallState } from './install.mjs'
import { inspectEnvironment, nodeVersionSupported, coreVersionSupported, parseNodeVersion } from './preflight.mjs'
import { listBackups, readManifest } from './skills-lib.mjs'
import { brand, tuiPackage } from './distribution.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = resolve(HERE, '..')
const BRAND = brand()
const TUI_PACKAGE = tuiPackage()

function readJson(path) {
  try { return JSON.parse(readFileSync(path, 'utf8')) } catch { return undefined }
}

function parseArgs(argv) {
  const options = {
    command: undefined,
    dshHome: process.env.HYPERAI_DSH_HOME ?? join(process.env.HYPERAI_HOME ?? join(homedir(), '.hyperai'), 'dsh'),
    profile: BRAND.profileName,
    dshBin: process.env.HYPERAI_DSH_BIN ?? 'dsh',
    pnpmBin: process.env.PNPM_BIN ?? 'pnpm',
    // Explicit flags/env win over the runtime recorded by the last install.
    dshBinExplicit: process.env.HYPERAI_DSH_BIN !== undefined,
    pnpmBinExplicit: process.env.PNPM_BIN !== undefined,
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
    else if (arg === '--dsh-bin') { options.dshBin = argv[++i]; options.dshBinExplicit = true }
    else if (arg === '--pnpm-bin') { options.pnpmBin = argv[++i]; options.pnpmBinExplicit = true }
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

const UNINSTALL_MARKER = '.hyperai-uninstall.json'

function managed(profileDir) {
  return readJson(join(profileDir, 'package.json'))?.hyperaiTuiManaged === true
}

function wasUninstalled(profileDir) {
  return readJson(join(profileDir, UNINSTALL_MARKER))?.status === 'uninstalled'
}

function installedTuiManifest(profileDir) {
  for (const relative of [
    ['@hyperai', 'hyperai-tui'],
    BRAND.upstream.package.split('/'),
  ]) {
    const manifest = readJson(join(profileDir, 'node_modules', ...relative, 'package.json'))
    if (manifest !== undefined) return manifest
  }
  return undefined
}

/** The pinned upstream TUI version of the installed product (not the HyperAI release). */
function installedTuiVersion(profileDir) {
  const manifest = installedTuiManifest(profileDir)
  return manifest?.hyperai?.upstreamVersion ?? manifest?.version
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
/** Product package whose `file:` dependency marks an installation-package layout. */
const PRODUCT_PACKAGE = '@hyperai/hyperai-tui'

/**
 * Whether the profile installs the pre-built product tarball.
 *
 * The patch-as-dependency layout only exists for source-checkout installs; the
 * installation package ships a `file:packages/…tgz` dependency instead and has
 * no `patches/hyperai-tui.patch` to check.
 */
export function usesProductTarball(profileDir) {
  const dependency = readJson(join(profileDir, 'package.json'))?.dependencies?.[PRODUCT_PACKAGE]
  return typeof dependency === 'string' && dependency.startsWith('file:')
}

/**
 * Resolve the dsh/pnpm binaries the last install used.
 *
 * A colleague following the README has not put `~/.hyperai/runtime` on PATH, so
 * `doctor` must not depend on that: the install state records the exact
 * binaries. Explicit flags (or their env vars) still override.
 */
export function resolveRuntimeBins(options, status) {
  const recorded = status.installState?.runtime
  const dshBin = options.dshBinExplicit === true || typeof recorded?.dshBin !== 'string' ? options.dshBin : recorded.dshBin
  const pnpmBin = options.pnpmBinExplicit === true || typeof recorded?.pnpmBin !== 'string' ? options.pnpmBin : recorded.pnpmBin
  return { dshBin, pnpmBin }
}

export function diagnoseProfile(options) {
  const issues = []
  const warnings = []
  const status = statusProfile(options)
  if (!nodeVersionSupported(process.versions.node)) {
    issues.push(`unsupported Node.js ${process.versions.node}; requires ^22.19 || >=24`)
  }
  let environment
  const { dshBin, pnpmBin } = resolveRuntimeBins(options, status)
  try {
    environment = inspectEnvironment({ dshBin, pnpmBin })
    if (!coreVersionSupported(environment.dshVersion, BRAND.core.validated)) {
      issues.push(`DSH Core ${environment.dshVersion} is outside the validated set: ${BRAND.core.validated.join(', ')}`)
    }
  } catch (error) {
    issues.push(error instanceof Error ? error.message : String(error))
  }
  if (!status.managed) issues.push(`profile ${options.profileDir} is not managed by this installer`)
  if (status.installState?.status === 'failed') issues.push(`last install failed: ${status.installState.error ?? 'unknown error'}`)
  if (status.installState?.status === 'installing') {
    const pid = Number(status.installState.pid)
    let alive = false
    if (Number.isInteger(pid) && pid > 0) {
      try { process.kill(pid, 0); alive = true } catch { alive = false }
    }
    if (alive) warnings.push(`an installer process (pid ${pid}) is still running; do not run repair concurrently`)
    else issues.push(`interrupted install: state is installing but process ${pid || '?'} is not alive; run repair --yes`)
  }
  const installedDshBin = status.installState?.runtime?.dshBin
  if (installedDshBin !== undefined && installedDshBin !== dshBin) {
    warnings.push(`doctor checked ${dshBin}, while the last install recorded ${installedDshBin}; reinstall or pass the same --dsh-bin`)
  }
  if (!usesProductTarball(options.profileDir) && !status.copiedPatch) {
    warnings.push('copied branding patch is missing; run repair')
  }
  if (status.skillsError !== undefined) issues.push(`skills manifest: ${status.skillsError}`)
  const pending = join(options.profileDir, '.hyperai-skills', 'pending')
  if (existsSync(pending) && readdirSync(pending).length > 0) warnings.push('an interrupted skills transaction has a pending journal; run catalog/update or repair')
  const failedNodeModules = join(options.profileDir, '.hyperai-failed-node_modules')
  if (existsSync(failedNodeModules) && readdirSync(failedNodeModules).length > 0) {
    warnings.push(`failed dependency tree quarantine exists at ${failedNodeModules}; a successful repair will remove it after verification`)
  }
  return { ok: issues.length === 0, issues, warnings, environment, status }
}

function requireManaged(options) {
  if (!managed(options.profileDir) && !wasUninstalled(options.profileDir) && !options.force) {
    throw new Error(`refusing to modify ${options.profileDir}: not a managed HyperAI profile (use --force only after inspection)`)
  }
}

/**
 * Remove the installer-owned runtime files. The marker deliberately survives
 * so a later `uninstall --purge` can finish the two-stage cleanup even though
 * package.json is gone.
 */
function removeManagedRuntime(options) {
  const managedPaths = ['package.json', 'cordis.patch.yml', 'pnpm-workspace.yaml', 'patches', 'packages', 'scripts', 'LICENSE', 'node_modules', '.plugin-manager', '.hyperai-install.json']
  for (const relative of managedPaths) rmSync(join(options.profileDir, relative), { recursive: true, force: true })
  return existsSync(options.profileDir) ? readdirSync(options.profileDir) : []
}

/** Archive one profile without node_modules; returns archive path. */
function archiveProfile(options) {
  const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d+Z$/u, 'Z')
  const archiveRoot = join(options.dshHome, 'profiles', '.hyperai-uninstall-backups', `${options.profile}-${stamp}`)
  cpSync(options.profileDir, archiveRoot, {
    recursive: true,
    filter: source => !source.split(/[\\/]/u).includes('node_modules'),
  })
  writeFileSync(join(archiveRoot, 'README.txt'), [
    'HyperAI Profile uninstall archive',
    '',
    `This directory is a copy of ${options.profileDir} made by manage.mjs uninstall.`,
    'It contains user skills, settings, install state and (when available) backups.',
    '',
    'Safe restore steps:',
    '1. Do not restore over an existing profile directory. Confirm the target path and move it aside first if needed.',
    `2. Check that ${options.profileDir} does not exist or is an empty/unmanaged directory you intend to replace.`,
    `3. Restore with: mkdir -p ${join(options.profileDir, '..')} && cp -R ${JSON.stringify(archiveRoot)} ${JSON.stringify(options.profileDir)}`,
    '4. Remove any .hyperai-uninstall.json marker from the restored profile if present.',
    '5. Re-run the profile installer for this release: node apps/profiles/hyperai/scripts/install.mjs --dsh-home <harness-home>',
    '6. Run: node apps/profiles/hyperai/scripts/manage.mjs doctor --dsh-home <harness-home>',
    '7. Review warnings before starting the TUI. Shared credentials are not inside this archive.',
    '',
    'Keep this archive until the restored profile has passed doctor and a normal TUI launch.',
  ].join('\n') + '\n')
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
  const launcher = removeLauncher()
  if (options.purge) {
    rmSync(options.profileDir, { recursive: true, force: true })
    return { profileDir: options.profileDir, archive, purge: true, kept: [], launcher }
  }
  const kept = removeManagedRuntime(options)
  mkdirSync(options.profileDir, { recursive: true })
  writeFileSync(join(options.profileDir, UNINSTALL_MARKER), `${JSON.stringify({ status: 'uninstalled', profile: options.profile, archive, at: new Date().toISOString() }, undefined, 2)}\n`)
  return { profileDir: options.profileDir, archive, purge: false, kept: [...kept, UNINSTALL_MARKER].sort(), launcher }
}

/**
 * Remove the `hyperai` launcher written by install.sh.
 *
 * Only the file recorded in `~/.hyperai/.hyperai-launcher.json` is touched, and
 * only when it lives inside that HyperAI home; a shared or hand-edited launcher
 * is never guessed at.
 */
function removeLauncher() {
  const home = process.env.HYPERAI_HOME ?? join(homedir(), '.hyperai')
  const marker = join(home, '.hyperai-launcher.json')
  const record = readJson(marker)
  if (record === undefined) return undefined
  const launcher = typeof record.launcher === 'string' ? resolve(record.launcher) : undefined
  if (launcher !== undefined && launcher.startsWith(`${resolve(home)}${sep}`) && existsSync(launcher)) rmSync(launcher, { force: true })
  rmSync(marker, { force: true })
  return launcher
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

/**
 * Whether this module is the process entry point.
 *
 * Comparing `process.argv[1]` with `fileURLToPath(import.meta.url)` as strings
 * fails when the script is reached through a symlinked directory (macOS `/tmp`
 * is `/private/tmp`, for example): Node resolves the module URL to the real
 * path while argv keeps the logical one, so the main flow is skipped and the
 * process still exits 0. Resolve both sides before comparing.
 * @returns {boolean} True when run directly (not imported).
 */
function invokedDirectly() {
  if (process.argv[1] === undefined) return false
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
  } catch {
    return false
  }
}

if (invokedDirectly()) await main()
