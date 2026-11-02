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
 *   --include-unverified Install inbox candidates too; default is verified only
 *   --frozen-lockfile    Use the profile's existing pnpm lockfile (reproducible reinstall)
 *   --skills-ref <sha>   Override the pinned hyperai-skills commit
 *   --skills-source <dir> Use an existing HyperAI Skills checkout (offline/test)
 *   --skills-lock <file> Use an alternate pinned skills lock (test/offline)
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
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { preflight as runPreflight } from './preflight.mjs'
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
const INSTALL_STATE = '.hyperai-install.json'

/** Parse CLI arguments into an options object. */
export function parseArgs(argv) {
  const options = {
    dshHome: process.env.DSH_HOME ?? join(homedir(), '.dsh'),
    profile: BRAND.profileName,
    dshBin: process.env.HYPERAI_DSH_BIN ?? 'dsh',
    pnpmBin: process.env.PNPM_BIN ?? 'pnpm',
    preflight: true,
    skills: true,
    verifiedOnly: true,
    frozenLockfile: false,
    skillsRef: undefined,
    skillsSource: undefined,
    skillsLock: undefined,
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
    else if (arg === '--include-unverified') options.verifiedOnly = false
    else if (arg === '--frozen-lockfile') options.frozenLockfile = true
    else if (arg === '--skills-ref') options.skillsRef = argv[++index]
    else if (arg === '--skills-source') options.skillsSource = resolve(argv[++index])
    else if (arg === '--skills-lock') options.skillsLock = resolve(argv[++index])
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--force') options.force = true
    else if (arg === '--json') options.json = true
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        [
          'usage: node scripts/install.mjs [--dsh-home <dir>] [--profile <name>] [--dsh-bin <path>]',
          '                                 [--no-skills] [--verified-only] [--include-unverified]',
          '                                 [--frozen-lockfile] [--skills-ref <sha>]',
          '                                 [--skills-source <dir>] [--skills-lock <file>]',
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

/** Path of the durable install/lifecycle state file. */
export function installStatePath(profileDir) {
  return join(profileDir, INSTALL_STATE)
}

/** Read the previous install state, if any. */
export function readInstallState(profileDir) {
  return readJson(installStatePath(profileDir))
}

/** Atomically record the installer phase so a partial run is diagnosable. */
function writeInstallState(options, state) {
  if (options.dryRun) return
  mkdirSync(options.profileDir, { recursive: true })
  const path = installStatePath(options.profileDir)
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`
  const payload = {
    schema: 1,
    version: TUI_PACKAGE.version,
    upstream: BRAND.upstream.version,
    profile: options.profile,
    ...state,
    updatedAt: new Date().toISOString(),
  }
  writeFileSync(temporary, `${JSON.stringify(payload, undefined, 2)}\n`)
  renameSync(temporary, path)
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

/**
 * Split a profile patch document into a leading header and top-level list
 * blocks. Each block starts at a column-zero `- ` list item and keeps the lines
 * that follow it, so `!!js` tags, comments and `insert:` blocks survive
 * byte-for-byte. Returns undefined when the text is not a top-level YAML list.
 * @param {string} text profile patch text.
 * @returns {{ header: string[], blocks: { lines: string[] }[] } | undefined}
 */
export function splitPatchBlocks(text) {
  const lines = text.split('\n')
  const header = []
  const blocks = []
  let current
  for (const line of lines) {
    if (/^-(?:\s|$)/u.test(line)) {
      if (current !== undefined) blocks.push(current)
      current = { lines: [line] }
    } else if (current === undefined) header.push(line)
    else current.lines.push(line)
  }
  if (current !== undefined) blocks.push(current)
  return blocks.length === 0 ? undefined : { header, blocks }
}

/** The `id:` of a top-level patch block, or undefined for `insert:`/anonymous rows. */
function blockId(block) {
  const match = /^-\s+id:\s*([A-Za-z0-9_.@/-]+)\s*$/u.exec(block.lines[0])
  return match?.[1]
}

/** Whether a block still carries the removed environment-driven model preset. */
function isLegacyModelPreset(block) {
  const text = block.lines.join('\n')
  return /\bHYPERAI_[A-Z_]+\b/u.test(text)
}

/**
 * Sanitize a preserved `dsh-tui` row: strip the legacy environment-driven
 * provider/model defaults and the `!!js` deployment knobs they introduced, but
 * keep any other setting the user changed. Returns undefined when nothing but
 * the old preset defaults remains (the bundle defaults then apply again).
 * @param {{ lines: string[] }} block dsh-tui patch block.
 * @returns {{ lines: string[] } | undefined}
 */
function sanitizeLegacyDshTuiRow(block) {
  const stripped = block.lines.filter(line =>
    !/^\s+(?:provider|model):\s*!!js\b/u.test(line)
    && !/^\s+(?:preset|workspace|sessionId|backend):\s*!!js\s+process\.env\.DSH_TUI_/u.test(line))
  const meaningful = stripped
    .map(line => line.trim())
    .filter(line => line !== '' && !line.startsWith('#') && line !== '- id: dsh-tui' && line !== 'config:')
  // The old preset default also restated these TUI display keys; keep a row
  // only when the user changed at least one of them.
  if (meaningful.every(line => /^(?:fullscreen|terminalImages): true$/u.test(line) || line === 'effort: max')) {
    return undefined
  }
  return { lines: stripped }
}

/**
 * Merge the current template into an installed profile patch while preserving
 * every block the user owns. Managed template ids are replaced; the removed
 * environment-driven `llm-pi-ai` preset is dropped; a user-created provider row
 * (plain values created by `/provider`) and every unknown/`insert:` row is kept.
 * @param {string} existing installed profile patch text.
 * @param {string} template committed profile template text.
 * @returns {string} merged patch text.
 */
export function mergeCordisPatch(existing, template) {
  const parsedTemplate = splitPatchBlocks(template)
  if (parsedTemplate === undefined) throw new Error('profile template is not a top-level YAML list')
  const parsedExisting = splitPatchBlocks(existing)
  if (parsedExisting === undefined) throw new Error('installed cordis.patch.yml is not a top-level YAML list')
  const templateIds = new Set(parsedTemplate.blocks.map(block => blockId(block)).filter(id => id !== undefined))
  const kept = []
  for (const block of parsedExisting.blocks) {
    const id = blockId(block)
    if (id !== undefined && templateIds.has(id)) continue
    if (id === 'llm-pi-ai') {
      // A legacy preset is replaced by nothing. A plain provider row created by
      // DSH's `/provider` is user configuration and must survive every reinstall.
      if (!isLegacyModelPreset(block)) kept.push(block)
      continue
    }
    if (id === 'dsh-tui') {
      const sanitized = sanitizeLegacyDshTuiRow(block)
      if (sanitized !== undefined) kept.push(sanitized)
      continue
    }
    kept.push(block)
  }
  const header = parsedTemplate.header.length === 0 ? '' : `${parsedTemplate.header.join('\n')}\n`
  const body = [...parsedTemplate.blocks, ...kept].map(block => block.lines.join('\n').replace(/\s+$/u, '')).join('\n\n')
  return `${header}${body}\n`
}

/** Write the merged profile patch, backing up a differing previous copy. */
function stageCordisPatch(options, template, plan) {
  const relative = 'cordis.patch.yml'
  const target = join(options.profileDir, relative)
  const previous = existsSync(target) ? readFileSync(target, 'utf8') : undefined
  const content = previous === undefined ? template : mergeCordisPatch(previous, template)
  if (previous === content) {
    plan.push({ file: relative, action: 'unchanged' })
    return
  }
  if (previous !== undefined && !previous.includes(PATCH_MARKER) && !options.force) {
    throw new Error(
      `refusing to overwrite ${target}: it was not created by this installer (missing marker "${PATCH_MARKER}"). Re-run with --force to back it up and replace it.`,
    )
  }
  plan.push({ file: relative, action: previous === undefined ? 'create' : 'replace' })
  if (options.dryRun) return
  if (previous !== undefined) backupFile(options, relative)
  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, content)
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

/** The dsh plugin install arguments; frozen mode is opt-in for reproducible reinstall. */
export function dependencyInstallArgs(options) {
  return ['plugin', '--profile', options.profile, 'install', options.frozenLockfile ? '--frozen-lockfile' : '--no-frozen-lockfile']
}

/** Run the pinned-package install through the dsh CLI's own pnpm wrapper. */
function installDependencies(options) {
  const args = dependencyInstallArgs(options)
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
  if (options.preflight !== false) {
    try {
      result.environment = runPreflight({
        dshBin: options.dshBin,
        pnpmBin: options.pnpmBin,
        coreVersions: BRAND.core?.validated ?? [],
        testedCoreVersions: BRAND.core?.tested ?? [],
      })
    } catch (error) {
      result.warnings.push({ phase: 'preflight', message: error instanceof Error ? error.message : String(error) })
      throw error
    }
  }
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
  const startedAt = new Date().toISOString()
  let phase = 'files'
  if (!options.dryRun) {
    writeInstallState(options, { status: 'installing', phase, startedAt, error: null })
  }
  try {
  stageFile(options, 'package.json', `${JSON.stringify(profileManifest(), undefined, 2)}\n`, {
    marker: `"${MANAGED_MARKER}": true`,
    plan,
  })
  stageCordisPatch(options, readFileSync(join(PROFILE_TEMPLATE, 'cordis.patch.yml'), 'utf8'), plan)
  stageFile(options, 'pnpm-workspace.yaml', workspaceFile(), { marker: WORKSPACE_MARKER, plan })
  stageCopy(options, join('patches', 'hyperai-tui.patch'), PATCH_FILE, plan)
  // Ship the independent skills updater into the installed profile so the user
  // can check/update/rollback skills without keeping this checkout around.
  for (const file of ['skills-lib.mjs', 'skills-update.mjs']) {
    stageCopy(options, join('scripts', file), join(PKG, 'scripts', file), plan)
  }
  if (options.dryRun) {
    result.skills = { skipped: options.skills ? 'dry-run' : true }
    return result
  }
  phase = 'dependencies'
  writeInstallState(options, { status: 'installing', phase, startedAt, error: null })
  installDependencies(options)
  phase = 'verify'
  writeInstallState(options, { status: 'installing', phase, startedAt, error: null })
  verifyInstall(options)
  if (options.skills) {
    phase = 'skills'
    writeInstallState(options, { status: 'installing', phase, startedAt, error: null })
    const { installSkills } = await import('./install-skills.mjs')
    result.skills = installSkills({
      dshHome: options.dshHome,
      profile: options.profile,
      ref: options.skillsRef,
      lockPath: options.skillsLock,
      source: options.skillsSource,
      verifiedOnly: options.verifiedOnly,
      dshBin: options.dshBin,
    })
  }
  writeInstallState(options, { status: 'completed', phase: 'done', error: null, completedAt: new Date().toISOString() })
  return result
  } catch (error) {
    try {
      writeInstallState(options, {
        status: 'failed',
        phase,
        startedAt,
        error: error instanceof Error ? error.message : String(error),
        failedAt: new Date().toISOString(),
      })
    } catch {
      // The original failure is more useful than a state-file failure.
    }
    throw error
  }
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
          `  dsh --profile ${options.profile}`,
          '  then configure a provider with /provider and pick a model with /model',
          '  (DSH-native flow; this profile presets no provider, endpoint or model)',
          '',
        ].join('\n'),
      )
    }
  } catch (error) {
    process.stderr.write(`hyperai-tui: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}
