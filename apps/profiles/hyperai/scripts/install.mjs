#!/usr/bin/env node
/**
 * Install (or refresh) the `hyperai` dsh profile from this distribution.
 *
 * This is the profile-side installer; it is intentionally separate from the TUI
 * build. The TUI package (`apps/tui`) owns the branding patch; this installer
 * copies that patch into the managed profile, writes the native DSH profile
 * files, installs the pinned `@deepseek-harness-tui/dsh-tui` dependency through
 * the `dsh plugin` wrapper and then installs the HyperAI skills.
 *
 *   node scripts/install.mjs [options]
 *
 *   --dsh-home <dir>     Harness home to install into (default: $DSH_HOME or ~/.dsh)
 *   --profile <name>     Profile name (default: hyperai)
 *   --dsh-bin <path>     dsh executable (default: $HYPERAI_DSH_BIN or `dsh` on PATH)
 *   --no-skills          Skip the hyperai-skills install step
 *   --verified-only      Install only the repo-verified skills
 *   --skills-ref <sha>   Override the pinned hyperai-skills commit
 *   --dry-run            Print the plan without writing anything
 *   --force              Replace an existing non-managed profile / managed files
 *   --json               Print a machine-readable result
 *
 * Safety rules: a profile that this installer did not create (no managed
 * marker) is never overwritten; every replaced file is copied into
 * `<profile>/.hyperai-backups/<timestamp>/` first; no credentials are read or
 * written; the existing `dsh-tui` profile and `~/.dsh-tui` UI state are never
 * touched.
 *
 * The TUI package location is resolved from this repository checkout
 * (`apps/profiles/hyperai` -> `apps/tui`); the installed profile itself contains
 * no absolute paths or references back to the checkout.
 */
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = resolve(HERE, '..')
/** Repository TUI package: `apps/tui`. */
const TUI = resolve(HERE, '..', '..', '..', 'tui')
const BRAND = JSON.parse(readFileSync(join(TUI, 'src', 'brand.json'), 'utf8'))
const TUI_PACKAGE = JSON.parse(readFileSync(join(TUI, 'package.json'), 'utf8'))
const PROFILE_TEMPLATE = PKG
const PATCH_FILE = join(TUI, 'patches', `dsh-tui@${BRAND.upstream.version}.patch`)
/** Marker written into managed profile manifests; its absence means "not ours". */
const MANAGED_MARKER = 'hyperaiTuiManaged'
const PATCH_MARKER = '# hyperai profile patch layer'
const WORKSPACE_MARKER = '# hyperai profile pnpm workspace:'

/** Parse CLI arguments into an options object. */
export function parseArgs(argv) {
  const options = {
    dshHome: process.env.DSH_HOME ?? join(homedir(), '.dsh'),
    profile: BRAND.profileName,
    dshBin: process.env.HYPERAI_DSH_BIN ?? 'dsh',
    skills: true,
    verifiedOnly: false,
    skillsRef: undefined,
    dryRun: false,
    force: false,
    json: false,
  }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--dsh-home') options.dshHome = argv[++index]
    else if (arg === '--profile') options.profile = argv[++index]
    else if (arg === '--dsh-bin') options.dshBin = argv[++index]
    else if (arg === '--no-skills') options.skills = false
    else if (arg === '--verified-only') options.verifiedOnly = true
    else if (arg === '--skills-ref') options.skillsRef = argv[++index]
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--force') options.force = true
    else if (arg === '--json') options.json = true
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'usage: node scripts/install.mjs [--dsh-home <dir>] [--profile <name>] [--dsh-bin <path>]',
          '                                 [--no-skills] [--verified-only] [--skills-ref <sha>]',
          '                                 [--dry-run] [--force] [--json]',
          '',
        ].join('\n'),
      )
      process.exit(0)
    } else throw new Error(`unknown argument ${JSON.stringify(arg)}`)
  }
  options.dshHome = resolve(options.dshHome)
  options.profileDir = join(options.dshHome, 'profiles', options.profile)
  return options
}

/** Read JSON or return undefined when the file is missing/unreadable. */
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

function isManagedProfile(dir) {
  return readJson(join(dir, 'package.json'))?.[MANAGED_MARKER] === true
}

/** The profile manifest this installer writes. */
export function profileManifest() {
  const template = readJson(join(PROFILE_TEMPLATE, 'package.json'))
  return {
    ...template,
    [MANAGED_MARKER]: true,
    hyperaiTui: { version: TUI_PACKAGE.version, upstream: BRAND.upstream.version },
  }
}

/** The pnpm workspace file this installer writes, fixed to the pinned version. */
export function workspaceFile() {
  return readFileSync(join(PROFILE_TEMPLATE, 'pnpm-workspace.yaml'), 'utf8')
}

/** Copy a generated file into place, backing up a differing previous copy. */
function stageFile(options, relative, content, { marker, plan }) {
  const target = join(options.profileDir, relative)
  const previous = existsSync(target) ? readFileSync(target, 'utf8') : undefined
  if (previous === content) {
    plan.push({ file: relative, action: 'unchanged' })
    return
  }
  if (previous !== undefined && marker !== undefined && !previous.includes(marker) && !options.force) {
    throw new Error(
      `refusing to overwrite ${target}: it was not created by this installer (missing marker "${marker}"). Re-run with --force to back it up and replace it.`,
    )
  }
  plan.push({ file: relative, action: previous === undefined ? 'create' : 'replace' })
  if (options.dryRun) return
  if (previous !== undefined) backupFile(options, relative)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
}

/** Copy a file into the profile, backing up a differing previous copy. */
function stageCopy(options, relative, source, plan) {
  stageFile(options, relative, readFileSync(source, 'utf8'), { plan })
}

/** Preserve one file under the profile's backup directory. */
function backupFile(options, relative) {
  const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d+Z$/u, 'Z')
  const backupDir = join(options.profileDir, '.hyperai-backups', stamp)
  const target = join(backupDir, relative)
  mkdirSync(dirname(target), { recursive: true })
  cpSync(join(options.profileDir, relative), target)
  return join(backupDir, relative)
}

/** Run the pinned-package install through the dsh CLI's own pnpm wrapper. */
function installDependencies(options) {
  const args = ['plugin', '--profile', options.profile, 'install', '--no-frozen-lockfile']
  execFileSync(options.dshBin, args, {
    cwd: options.profileDir,
    env: { ...process.env, DSH_HOME: options.dshHome, CI: 'true' },
    stdio: 'inherit',
  })
}

/** Confirm the branding patch landed and the splash art is actually gone. */
function verifyInstall(options) {
  const tui = join(options.profileDir, 'node_modules', ...BRAND.upstream.package.split('/'))
  const types = join(tui, 'lib', 'types')
  const branding = join(types, 'branding.js')
  const logoV2 = join(types, 'components', 'LogoV2.js')
  if (!existsSync(branding)) throw new Error(`install verification failed: ${branding} is missing`)
  if (!readFileSync(branding, 'utf8').includes(BRAND.splashWords.top)) {
    throw new Error('install verification failed: the branding patch did not apply')
  }
  const logo = readFileSync(logoV2, 'utf8')
  if (!logo.includes('showWhale: false') || !logo.includes('HYPERAI_PALETTE.title')) {
    throw new Error('install verification failed: the no-art splash patch did not apply')
  }
  if (existsSync(join(types, 'components', 'hyperaiLogoRows.js'))) {
    throw new Error('install verification failed: stale logo module present (patch is not the simplified brand)')
  }
}

/**
 * Install the hyperai profile into a Harness home.
 * @param options - Parsed CLI options.
 * @returns A summary object for the CLI and tests.
 */
export async function install(options = parseArgs([])) {
  const plan = []
  const result = { profileDir: options.profileDir, plan, skills: undefined, warnings: [] }
  if (!existsSync(PATCH_FILE)) {
    throw new Error(`missing branding patch ${PATCH_FILE}; build it with "node apps/tui/scripts/build-patch.mjs" first`)
  }
  const exists = existsSync(join(options.profileDir, 'package.json'))
  if (exists && !isManagedProfile(options.profileDir) && !options.force) {
    throw new Error(
      `refusing to touch ${options.profileDir}: it exists but was not created by this installer. ` +
        'Use --force to back it up and replace the managed files.',
    )
  }
  if (!options.dryRun) mkdirSync(options.profileDir, { recursive: true })
  stageFile(options, 'package.json', `${JSON.stringify(profileManifest(), undefined, 2)}\n`, {
    marker: `"${MANAGED_MARKER}": true`,
    plan,
  })
  stageFile(options, 'cordis.patch.yml', readFileSync(join(PROFILE_TEMPLATE, 'cordis.patch.yml'), 'utf8'), {
    marker: PATCH_MARKER,
    plan,
  })
  stageFile(options, 'pnpm-workspace.yaml', workspaceFile(), { marker: WORKSPACE_MARKER, plan })
  stageCopy(options, join('patches', 'hyperai-tui.patch'), PATCH_FILE, plan)
  if (options.dryRun) {
    result.skills = { skipped: options.skills ? 'dry-run' : true }
    return result
  }
  installDependencies(options)
  verifyInstall(options)
  if (options.skills) {
    const { installSkills } = await import('./install-skills.mjs')
    result.skills = installSkills({
      dshHome: options.dshHome,
      profile: options.profile,
      ref: options.skillsRef,
      verifiedOnly: options.verifiedOnly,
      dshBin: options.dshBin,
    })
  }
  return result
}

/** Remove the installer's own state (used by tests and docs); never touches ~/.dsh-tui. */
export function backupDirectory(options) {
  const dir = join(options.profileDir, '.hyperai-backups')
  return existsSync(dir) ? readdirSync(dir).map(name => join(dir, name)).sort().at(-1) : undefined
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2))
  try {
    const result = await install(options)
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, undefined, 2)}\n`)
    } else {
      process.stdout.write(`\nhyperai-tui: profile ${JSON.stringify(options.profile)} at ${options.profileDir}\n`)
      for (const step of result.plan) process.stdout.write(`  ${step.action.padEnd(9)} ${step.file}\n`)
      if (result.skills !== undefined && result.skills.skipped !== true) {
        process.stdout.write(`  skills: ${result.skills.installed.length} installed, ${result.skills.unchanged.length} unchanged, ${result.skills.skippedSkills.length} skipped\n`)
      }
      process.stdout.write(
        [
          '',
          'next steps:',
          '  export HYPERAI_API_KEY=<your key>',
          '  export HYPERAI_BASE_URL=https://your-openai-compatible-gateway/v1   # default: https://api.openai.com/v1',
          '  export HYPERAI_MODEL=<model id>                                      # default: gpt-4o-mini placeholder',
          `  dsh --profile ${options.profile}`,
          '',
        ].join('\n'),
      )
    }
  } catch (error) {
    process.stderr.write(`hyperai-tui: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}
