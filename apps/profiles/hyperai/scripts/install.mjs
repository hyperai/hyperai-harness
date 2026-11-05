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
 *   --no-openbayes       Skip installing the openbayes-user skill
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
import { execFileSync, spawnSync } from 'node:child_process'
import { createWriteStream, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync, realpathSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { get as httpGet } from 'node:http'
import { get as httpsGet } from 'node:https'
import { preflight as runPreflight } from './preflight.mjs'
import { brand, isBundled, profileTemplateDir, skillsLockPath, skillsSnapshotDir, tuiPackage, tuiTarballPath } from './distribution.mjs'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = resolve(HERE, '..')
const BRAND = brand()
const TUI_PACKAGE = tuiPackage()
const PROFILE_TEMPLATE = profileTemplateDir()
/** Repository branding patch; unused when installing from an installation package. */
const PATCH_FILE = join(HERE, '..', '..', '..', 'tui', 'patches', `dsh-tui@${BRAND.upstream.version}.patch`)
/** Marker written into managed profile manifests; its absence means "not ours". */
const MANAGED_MARKER = 'hyperaiTuiManaged'
const PATCH_MARKER = '# hyperai profile patch layer'
const WORKSPACE_MARKER = '# hyperai profile pnpm workspace:'
const INSTALL_STATE = '.hyperai-install.json'

/**
 * OpenBayes user skill: downloaded at install time into the official discovery
 * directory (`~/.agents/skills/`), never bundled into the installer and never
 * modified. An existing copy always wins; a failed download never fails the
 * HyperAI install.
 */
const OPENBAYES_DEFAULT_URL = 'https://openbayes.com/skills/openbayes-user/latest.tar.gz'
const OPENBAYES_MANUAL = 'npx skills add https://openbayes.com/skills/openbayes-user'
const OPENBAYES_MAX_BYTES = 20 * 1024 * 1024

/** Official location used by `npx skills add` and by DSH's default skill roots. */
export function openbayesSkillDir(home = process.env.HOME ?? homedir()) {
  return join(home, '.agents', 'skills', 'openbayes-user')
}

/** Read `<dir>/VERSION` when present. */
export function openbayesVersion(dir) {
  try {
    return readFileSync(join(dir, 'VERSION'), 'utf8').trim() || undefined
  } catch {
    return undefined
  }
}

/**
 * Reject an archive that could escape the target directory or smuggle links.
 * `modes` holds the first character of each `tar -tvzf` line, aligned with names.
 */
export function validateOpenbayesArchive(names, modes = []) {
  if (!Array.isArray(names) || names.length === 0) throw new Error('压缩包为空')
  for (const name of names) {
    const clean = String(name).replace(/\/+$/u, '')
    if (clean === '') throw new Error('压缩包包含空路径')
    if (clean.startsWith('/') || clean.includes('\\')) throw new Error(`压缩包包含非法路径：${name}`)
    if (clean.split('/').includes('..')) throw new Error(`压缩包包含上级目录：${name}`)
    if (clean !== 'openbayes-user' && !clean.startsWith('openbayes-user/')) {
      throw new Error(`压缩包根目录必须只有 openbayes-user/：${name}`)
    }
  }
  if (!names.some(name => String(name).replace(/\/+$/u, '') === 'openbayes-user/SKILL.md')) {
    throw new Error('压缩包缺少 openbayes-user/SKILL.md')
  }
  if (modes.some(mode => mode === 'l' || mode === 'h')) throw new Error('压缩包包含符号链接或硬链接')
  return true
}

/** Download with redirects, a timeout and a size cap. */
function downloadOpenbayes(url, target, redirects = 5) {
  return new Promise((resolvePromise, reject) => {
    const client = url.startsWith('https:') ? httpsGet : httpGet
    const request = client(url, { headers: { 'user-agent': `hyperai-harness/${TUI_PACKAGE.version}` } }, response => {
      const status = response.statusCode ?? 0
      if ([301, 302, 303, 307, 308].includes(status) && typeof response.headers.location === 'string') {
        response.resume()
        if (redirects <= 0) reject(new Error('重定向次数过多'))
        else resolvePromise(downloadOpenbayes(new URL(response.headers.location, url).toString(), target, redirects - 1))
        return
      }
      if (status !== 200) {
        response.resume()
        reject(new Error(`下载失败（HTTP ${status}）`))
        return
      }
      let bytes = 0
      const output = createWriteStream(target)
      response.on('data', chunk => {
        bytes += chunk.length
        if (bytes > OPENBAYES_MAX_BYTES) {
          request.destroy(new Error('下载内容超过大小上限'))
          output.destroy()
        }
      })
      response.pipe(output)
      output.on('finish', () => output.close(() => resolvePromise(bytes)))
      output.on('error', reject)
    })
    request.setTimeout(60_000, () => request.destroy(new Error('下载超时')))
    request.on('error', reject)
  })
}

/** List archive names and mode characters; throws when tar cannot read it. */
function inspectOpenbayesArchive(file) {
  const names = spawnSync('tar', ['-tzf', file], { encoding: 'utf8' })
  if (names.status !== 0) throw new Error('压缩包无法读取')
  const verbose = spawnSync('tar', ['-tvzf', file], { encoding: 'utf8' })
  if (verbose.status !== 0) throw new Error('压缩包无法读取')
  return {
    names: names.stdout.split('\n').filter(line => line !== ''),
    modes: verbose.stdout.split('\n').filter(line => line !== '').map(line => line.trimStart()[0]),
  }
}

/**
 * Install `openbayes-user` into `~/.agents/skills/` unless it already exists.
 * Returns a status object; failures are reported, never thrown.
 */
export async function installOpenbayesSkill(options = {}) {
  const home = options.home ?? process.env.HOME ?? homedir()
  const target = openbayesSkillDir(home)
  const url = options.url ?? OPENBAYES_DEFAULT_URL
  const log = options.log ?? (line => process.stdout.write(`${line}\n`))
  if (existsSync(target)) {
    const version = openbayesVersion(target)
    log(`openbayes-user: 已有${version === undefined ? '' : ` ${version}`}，保留不动（${target}）`)
    return { status: 'kept', version, dir: target }
  }
  if (options.dryRun === true) {
    log(`openbayes-user: 将安装到 ${target}（dry-run，未下载）`)
    return { status: 'planned', dir: target }
  }
  const work = mkdtempSync(join(tmpdir(), 'hyperai-openbayes-'))
  try {
    const archive = join(work, 'latest.tar.gz')
    await downloadOpenbayes(url, archive)
    const { names, modes } = inspectOpenbayesArchive(archive)
    validateOpenbayesArchive(names, modes)
    const unpacked = join(work, 'unpacked')
    mkdirSync(unpacked)
    const extracted = spawnSync('tar', ['-xzf', archive, '-C', unpacked], { encoding: 'utf8' })
    if (extracted.status !== 0) throw new Error('压缩包解压失败')
    const source = join(unpacked, 'openbayes-user')
    if (!existsSync(join(source, 'SKILL.md'))) throw new Error('解压后没有 openbayes-user/SKILL.md')
    mkdirSync(dirname(target), { recursive: true })
    cpSync(source, target, { recursive: true })
    const version = openbayesVersion(target)
    log(`openbayes-user: 已安装${version === undefined ? '' : ` ${version}`} → ${target}`)
    return { status: 'installed', version, dir: target }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    log(`警告：openbayes-user 安装失败（${reason}）。HyperAI 其余部分已安装完成。`)
    log(`  手动安装：${OPENBAYES_MANUAL}`)
    return { status: 'failed', reason, dir: target, manual: OPENBAYES_MANUAL }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

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
    else if (arg === '--pnpm-bin') options.pnpmBin = argv[++index]
    else if (arg === '--no-skills') options.skills = false
    else if (arg === '--no-openbayes') options.openbayes = false
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
          'usage: node scripts/install.mjs [--dsh-home <dir>] [--profile <name>] [--dsh-bin <path>] [--pnpm-bin <path>]',
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
    pid: process.pid,
    runtime: { dshBin: options.dshBin, pnpmBin: options.pnpmBin, node: process.version },
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
 * @returns {{ header: string[], blocks: { lines: string[], prefix?: string[] }[] } | undefined}
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
  // Comments/blank lines immediately above a block belong to that block. Without
  // this reassignment they would stay in the previous managed block and be
  // dropped when that block is replaced.
  for (let index = 0; index < blocks.length - 1; index++) {
    const block = blocks[index]
    const moved = []
    while (block.lines.length > 1) {
      const last = block.lines[block.lines.length - 1]
      if (!/^\s*(?:#|$)/u.test(last)) break
      block.lines.pop()
      // Keep comments with the following block; drop separator blanks so the
      // merge stays byte-stable across repeated installs.
      if (/^\s*#/u.test(last)) moved.unshift(last)
    }
    if (moved.length > 0) blocks[index + 1].prefix = [...moved, ...(blocks[index + 1].prefix ?? [])]
  }
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
  return { ...block, lines: stripped }
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
  const body = [...parsedTemplate.blocks, ...kept]
    .map(block => [...(block.prefix ?? []), ...block.lines].join('\n').replace(/\s+$/u, ''))
    .join('\n\n')
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

/** Copy a binary file into the profile verbatim (never through a UTF-8 string). */
export function stageBinary(options, relative, source, plan) {
  const target = join(options.profileDir, relative)
  const content = readFileSync(source)
  const previous = existsSync(target) ? readFileSync(target) : undefined
  if (previous !== undefined && previous.equals(content)) {
    plan.push({ file: relative, action: 'unchanged' })
    return
  }
  plan.push({ file: relative, action: previous === undefined ? 'create' : 'replace' })
  if (options.dryRun) return
  if (previous !== undefined) backupFile(options, relative)
  mkdirSync(dirname(target), { recursive: true })
  cpSync(source, target)
}

/** Copy a text file into the profile, backing up a differing previous copy. */
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

/** Root holding node_modules snapshots for dependency-install rollback. */
function nodeModulesBackupRoot(options) {
  return join(options.profileDir, '.hyperai-node_modules-backup')
}

/** Restore a snapshot left by an interrupted dependency install. */
function recoverDependencyBackup(options) {
  const root = nodeModulesBackupRoot(options)
  if (!existsSync(root)) return undefined
  const stamps = readdirSync(root).sort()
  const latest = stamps.at(-1)
  if (latest === undefined) {
    rmSync(root, { recursive: true, force: true })
    return undefined
  }
  const snapshot = join(root, latest)
  const target = join(options.profileDir, 'node_modules')
  if (existsSync(snapshot)) {
    rmSync(target, { recursive: true, force: true })
    renameSync(snapshot, target)
  }
  rmSync(root, { recursive: true, force: true })
  return latest
}

/** Move node_modules aside before a dependency install; caller restores on failure. */
function stageNodeModulesTransaction(options) {
  const target = join(options.profileDir, 'node_modules')
  if (!existsSync(target)) return undefined
  const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d+Z$/u, 'Z')
  const root = nodeModulesBackupRoot(options)
  const snapshot = join(root, stamp)
  mkdirSync(root, { recursive: true })
  renameSync(target, snapshot)
  return { stamp, root, snapshot }
}

/** Keep a failed tree under a clearly named quarantine instead of leaving it active. */
function quarantineFailedNodeModules(options) {
  const target = join(options.profileDir, 'node_modules')
  if (!existsSync(target)) return undefined
  const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d+Z$/u, 'Z')
  const quarantine = join(options.profileDir, '.hyperai-failed-node_modules', stamp)
  mkdirSync(dirname(quarantine), { recursive: true })
  renameSync(target, quarantine)
  return quarantine
}

/** The dsh plugin install arguments; frozen mode is opt-in for reproducible reinstall. */
export function dependencyInstallArgs(options) {
  return ['plugin', '--profile', options.profile, 'install', options.frozenLockfile ? '--frozen-lockfile' : '--no-frozen-lockfile']
}

/** Run the pinned-package install through the dsh CLI's own pnpm wrapper. */
function installDependencies(options) {
  const args = dependencyInstallArgs(options)
  const env = { ...process.env, DSH_HOME: options.dshHome, CI: 'true' }
  if (!options.json) {
    execFileSync(options.dshBin, args, { cwd: options.profileDir, env, stdio: 'inherit' })
    return
  }
  // --json promises exactly one machine-readable document on stdout. The
  // dsh/pnpm child must therefore never inherit fd 1: capture both streams and
  // forward them to stderr, preserving diagnostics for humans.
  const child = spawnSync(options.dshBin, args, {
    cwd: options.profileDir,
    env,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (child.error) throw child.error
  if (child.stdout) process.stderr.write(child.stdout)
  if (child.stderr) process.stderr.write(child.stderr)
  if (child.status !== 0) {
    throw new Error(`dsh plugin install exited ${child.status ?? 'without a status'}; dependency output was written to stderr`)
  }
}

/** Remove failed dependency trees only after a verified success. */
function cleanupFailedNodeModules(options) {
  const root = join(options.profileDir, '.hyperai-failed-node_modules')
  if (!existsSync(root)) return 0
  const removed = readdirSync(root)
  rmSync(root, { recursive: true, force: true })
  return removed.length
}

/** Confirm the branding patch landed and the splash art is actually gone. */
function verifyInstall(options) {
  const tui = isBundled()
    ? join(options.profileDir, 'node_modules', '@hyperai', 'hyperai-tui')
    : join(options.profileDir, 'node_modules', ...BRAND.upstream.package.split('/'))
  const types = join(tui, 'lib', 'types')
  const branding = join(types, 'branding.js')
  const logoV2 = join(types, 'components', 'LogoV2.js')
  const license = join(options.profileDir, 'LICENSE')
  if (!existsSync(license)) throw new Error(`install verification failed: ${license} is missing (R2-10)`)
  if (!readFileSync(license, 'utf8').includes('Copyright (c) 2026 DeepSeek')) throw new Error('install verification failed: install-state LICENSE is empty or wrong')
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
  if (options.frozenLockfile && !existsSync(join(options.profileDir, 'pnpm-lock.yaml'))) {
    throw new Error(
      '--frozen-lockfile requires an existing profile pnpm-lock.yaml. Run the installer once without --frozen-lockfile ' +
        'to create the lock, review it, then rerun with --frozen-lockfile; the installer will not silently fall back to a mutable install.',
    )
  }
  if (!isBundled() && !existsSync(PATCH_FILE)) {
    throw new Error(`missing branding patch ${PATCH_FILE}; build it with "node apps/tui/scripts/build-patch.mjs" first`)
  }
  if (isBundled()) {
    const tarball = tuiTarballPath()
    if (!existsSync(tarball)) throw new Error(`installation package product tarball is missing: ${tarball}`)
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
  stageCopy(options, 'LICENSE', join(PROFILE_TEMPLATE, 'LICENSE'), plan)
  stageCordisPatch(options, readFileSync(join(PROFILE_TEMPLATE, 'cordis.patch.yml'), 'utf8'), plan)
  stageFile(options, 'pnpm-workspace.yaml', workspaceFile(), { marker: WORKSPACE_MARKER, plan })
  if (isBundled()) {
    // The product tarball becomes a profile-local `file:` dependency, so the
    // installed profile keeps working after the installation package is moved.
    const tarball = tuiTarballPath()
    stageBinary(options, join('packages', basename(tarball)), tarball, plan)
    // A profile created by the old patch flow still carries an unused
    // patchedDependencies patch. Removing it leaves exactly one TUI source.
    const stalePatch = join(options.profileDir, 'patches', 'hyperai-tui.patch')
    if (existsSync(stalePatch)) {
      plan.push({ file: join('patches', 'hyperai-tui.patch'), action: 'remove' })
      if (!options.dryRun) {
        rmSync(stalePatch, { force: true })
        const patchDir = join(options.profileDir, 'patches')
        if (existsSync(patchDir) && readdirSync(patchDir).length === 0) rmSync(patchDir, { recursive: true, force: true })
      }
    }
  } else {
    stageCopy(options, join('patches', 'hyperai-tui.patch'), PATCH_FILE, plan)
  }
  // Ship the independent skills updater into the installed profile so the user
  // can check/update/rollback skills without keeping this checkout around.
  for (const file of ['skills-lib.mjs', 'skills-update.mjs']) {
    stageCopy(options, join('scripts', file), join(PKG, 'scripts', file), plan)
  }
  if (options.dryRun) {
    result.skills = { skipped: options.skills ? 'dry-run' : true }
    result.openbayes = options.openbayes ? { status: 'planned', dir: openbayesSkillDir() } : { status: 'skipped' }
    return result
  }
  phase = 'dependencies'
  const recoveredDependency = recoverDependencyBackup(options)
  if (recoveredDependency !== undefined) result.warnings.push({ phase: 'dependencies', message: `restored an interrupted node_modules snapshot (${recoveredDependency})` })
  const dependencyTransaction = stageNodeModulesTransaction(options)
  writeInstallState(options, { status: 'installing', phase, startedAt, error: null })
  try {
    installDependencies(options)
    phase = 'verify'
    writeInstallState(options, { status: 'installing', phase, startedAt, error: null })
    verifyInstall(options)
  } catch (error) {
    const quarantined = quarantineFailedNodeModules(options)
    if (dependencyTransaction !== undefined && existsSync(dependencyTransaction.snapshot)) {
      renameSync(dependencyTransaction.snapshot, join(options.profileDir, 'node_modules'))
      rmSync(dependencyTransaction.root, { recursive: true, force: true })
    }
    if (quarantined !== undefined) result.warnings.push({ phase: 'verify', message: `failed node_modules quarantined at ${quarantined}` })
    throw error
  }
  if (dependencyTransaction !== undefined) rmSync(dependencyTransaction.root, { recursive: true, force: true })
  const cleanedFailedTrees = cleanupFailedNodeModules(options)
  if (cleanedFailedTrees > 0) result.warnings.push({ phase: 'verify', message: `removed ${cleanedFailedTrees} quarantined failed dependency tree(s) after successful verification` })
  if (options.skills) {
    phase = 'skills'
    writeInstallState(options, { status: 'installing', phase, startedAt, error: null })
    const { installSkills } = await import('./install-skills.mjs')
    result.skills = installSkills({
      dshHome: options.dshHome,
      profile: options.profile,
      ref: options.skillsRef,
      lockPath: options.skillsLock ?? skillsLockPath(),
      source: options.skillsSource ?? skillsSnapshotDir(),
      localSnapshot: isBundled(),
      verifiedOnly: options.verifiedOnly,
      dshBin: options.dshBin,
    })
  }
  if (options.openbayes) {
    // Never fatal: the skill is an optional add-on and the profile is already usable.
    phase = 'openbayes'
    writeInstallState(options, { status: 'installing', phase, startedAt, error: null })
    result.openbayes = await installOpenbayesSkill({
      url: options.openbayesUrl,
      log: options.json === true ? () => {} : line => process.stdout.write(`${line}\n`),
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

if (invokedDirectly()) {
  const options = parseArgs(process.argv.slice(2))
  try {
    const result = await install(options)
    if (options.json) {
      process.stdout.write(`${JSON.stringify(result, undefined, 2)}\n`)
    } else {
      process.stdout.write(`\nhyperai-tui: profile ${JSON.stringify(options.profile)} at ${options.profileDir}\n`)
      for (const step of result.plan) process.stdout.write(`  ${step.action.padEnd(9)} ${step.file}\n`)
      if (result.skills !== undefined && Array.isArray(result.skills.installed)) {
        process.stdout.write(`  skills: ${result.skills.installed.length} installed, ${result.skills.unchanged.length} unchanged, ${result.skills.skippedSkills.length} skipped\n`)
      } else if (result.skills?.skipped === 'dry-run') {
        process.stdout.write('  skills: dry-run (not run)\n')
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
    const message = error instanceof Error ? error.message : String(error)
    if (options.json) {
      process.stdout.write(`${JSON.stringify({
        ok: false,
        error: {
          code: error?.code ?? 'INSTALL_FAILED',
          message,
          hint: 'Inspect .hyperai-install.json and stderr; fix the reported phase, then run manage.mjs repair --yes.',
        },
      }, undefined, 2)}\n`)
    } else {
      process.stderr.write(`hyperai-tui: ${message}\n`)
    }
    process.exit(1)
  }
}
