#!/usr/bin/env node
/**
 * Install hyperai-skills into a dsh profile as a profile-scoped skill root.
 *
 * Skills land in `<profile>/skills/<name>/` (the directory the profile's
 * cordis.patch.yml feeds to `skill-filesystem.customSkillDirs`), and the
 * installer records exactly what it wrote in
 * `<profile>/.hyperai-skills/manifest.json`.
 *
 * The profile package owns skill installation; the only thing it reads from the
 * TUI package is the profile name in `apps/tui/src/brand.json`.
 *
 * Reproducibility and safety:
 *   - the source is pinned to a commit in `skills/hyperai-skills.lock.json`
 *     (never a branch), and the checkout is verified before anything is copied;
 *   - only the skills listed in the lock are copied, only `SKILL.md` plus the
 *     resource directories the repo format defines — never docs/, tests/,
 *     inbox NOTES.md, or the rest of the repository;
 *   - a skill whose on-disk content no longer matches the manifest (the user
 *     edited it) is skipped, never overwritten;
 *   - replaced skill directories are copied to `.hyperai-skills/backups/<ts>/`
 *     and `--rollback` restores the latest backup;
 *   - the run is idempotent: unchanged skills report `noop`.
 *
 * The default set is every skill in the lock file (repo-verified first, then
 * the inbox candidates that the lock labels `validated: false`); pass
 * `--verified-only` to install only the repo-verified area.
 *
 *   node scripts/install-skills.mjs [--dsh-home <dir>] [--profile <name>]
 *                                   [--ref <sha>] [--verified-only]
 *                                   [--dry-run] [--rollback] [--json]
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createSnapshot, rollback as rollbackShared } from './skills-lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = resolve(HERE, '..')
/** Repository TUI package: brand data only; no TUI code is imported here. */
const TUI = resolve(HERE, '..', '..', '..', 'tui')
const BRAND = JSON.parse(readFileSync(join(TUI, 'src', 'brand.json'), 'utf8'))
const DEFAULT_LOCK = resolve(PKG, 'skills', 'hyperai-skills.lock.json')
/** Resource directories a hyperai skill may reference from its SKILL.md. */
const RESOURCE_DIRS = ['references', 'templates', 'scripts', 'assets', 'examples']
const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
const MANIFEST_SCHEMA = 1

/** Parse CLI arguments. */
export function parseArgs(argv) {
  const options = {
    dshHome: process.env.DSH_HOME ?? '',
    profile: BRAND.profileName,
    lockPath: DEFAULT_LOCK,
    ref: undefined,
    verifiedOnly: true,
    dryRun: false,
    rollback: false,
    json: false,
    source: undefined,
    timeoutMs: 120_000,
  }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--dsh-home') options.dshHome = argv[++index]
    else if (arg === '--profile') options.profile = argv[++index]
    else if (arg === '--lock') options.lockPath = resolve(argv[++index])
    else if (arg === '--ref') options.ref = argv[++index]
    else if (arg === '--source') options.source = resolve(argv[++index])
    else if (arg === '--verified-only') options.verifiedOnly = true
    else if (arg === '--include-unverified') options.verifiedOnly = false
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--rollback') options.rollback = true
    else if (arg === '--json') options.json = true
    else if (arg === '--timeout') options.timeoutMs = Number(argv[++index])
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        'usage: node scripts/install-skills.mjs [--dsh-home <dir>] [--profile <name>] [--ref <sha>] [--source <checkout>] [--verified-only|--include-unverified] [--dry-run] [--rollback] [--timeout <ms>] [--json]\n',
      )
      process.exit(0)
    } else throw new Error(`unknown argument ${JSON.stringify(arg)}`)
  }
  return normalizeSkillOptions(options)
}

/**
 * Resolve the filesystem contract for both the CLI and installer callers.
 * install.mjs calls installSkills with a partial options object; normalizing
 * here keeps the default installation path from producing a TypeError.
 * @param {Record<string, any>} options partial options.
 * @param {{requireDshHome?: boolean}} [requirements]
 */
export function normalizeSkillOptions(options = {}, requirements = {}) {
  const dshHome = options.dshHome ?? process.env.DSH_HOME
  if ((requirements.requireDshHome ?? true) && (dshHome === undefined || dshHome === '')) {
    throw new Error('a Harness home is required: pass --dsh-home or export DSH_HOME')
  }
  const profile = options.profile ?? BRAND.profileName
  const profileDir = options.profileDir ?? (dshHome === undefined || dshHome === '' ? undefined : join(resolve(dshHome), 'profiles', profile))
  if (profileDir === undefined) throw new Error('a Harness home is required: pass --dsh-home or export DSH_HOME')
  const stateDir = options.stateDir ?? join(profileDir, '.hyperai-skills')
  return {
    ...options,
    dshHome: dshHome === undefined || dshHome === '' ? undefined : resolve(dshHome),
    profile,
    profileDir,
    skillsDir: options.skillsDir ?? join(profileDir, 'skills'),
    stateDir,
    manifestPath: options.manifestPath ?? join(stateDir, 'manifest.json'),
    lockPath: options.lockPath ?? DEFAULT_LOCK,
    verifiedOnly: options.verifiedOnly ?? true,
    timeoutMs: Number.isFinite(Number(options.timeoutMs)) ? Math.max(1, Number(options.timeoutMs)) : 120_000,
  }
}

/** Read the lock file. */
export function loadLock(path = DEFAULT_LOCK) {
  const lock = JSON.parse(readFileSync(path, 'utf8'))
  if (lock.schema !== 1) throw new Error(`unsupported skills lock schema ${lock.schema}`)
  if (typeof lock.repository !== 'string' || typeof lock.ref !== 'string') {
    throw new Error('skills lock needs repository and ref')
  }
  return lock
}

/** The skill entries this run installs, in lock order. */
export function selectedSkills(lock, verifiedOnly) {
  const verified = (lock.verified ?? []).map(skill => ({ ...skill, validated: skill.validated !== false }))
  const unverified = (lock.unverified ?? []).map(skill => ({ ...skill, validated: false }))
  return verifiedOnly ? verified : [...verified, ...unverified]
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/** All files contributed by one skill, as sorted workspace-relative paths. */
function skillFiles(dir) {
  const files = []
  const walk = (current, prefix) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) {
        if (prefix === '' && !RESOURCE_DIRS.includes(entry.name)) continue
        walk(join(current, entry.name), relative)
      } else if (entry.isFile()) {
        if (prefix === '' && entry.name !== 'SKILL.md') continue
        files.push(relative)
      }
    }
  }
  walk(dir, '')
  return files.sort()
}

/** Content digest of one installed/source skill directory. */
export function digestSkill(dir) {
  const files = skillFiles(dir)
  const digest = {}
  for (const file of files) digest[file] = sha256(readFileSync(join(dir, file)))
  return digest
}

/** Parse the frontmatter name/description a DSH skill needs, failing loud when absent. */
export function validateSkill(dir, expectedName) {
  const file = join(dir, 'SKILL.md')
  if (!existsSync(file)) throw new Error(`${expectedName}: SKILL.md is missing`)
  const text = readFileSync(file, 'utf8')
  if (!text.startsWith('---\n')) throw new Error(`${expectedName}: SKILL.md must start with YAML frontmatter`)
  const end = text.indexOf('\n---', 4)
  if (end < 0) throw new Error(`${expectedName}: SKILL.md frontmatter is not closed`)
  const frontmatter = text.slice(4, end)
  const name = /^name:\s*(.+)$/mu.exec(frontmatter)?.[1]?.trim()
  const description = /^description:\s*(.+)$/mu.exec(frontmatter)?.[1]?.trim()
  if (name !== expectedName) throw new Error(`${expectedName}: frontmatter name is ${JSON.stringify(name)}`)
  if (!SKILL_NAME.test(name)) throw new Error(`${expectedName}: invalid skill name`)
  if (description === undefined || description.length === 0) throw new Error(`${expectedName}: frontmatter description is missing`)
  return { name, description }
}

/** Read the current manifest, defaulting to an empty one. */
function readManifest(path) {
  try {
    const manifest = JSON.parse(readFileSync(path, 'utf8'))
    if (manifest.schema !== MANIFEST_SCHEMA) return { schema: MANIFEST_SCHEMA, skills: {} }
    return manifest
  } catch {
    return { schema: MANIFEST_SCHEMA, skills: {} }
  }
}

/** Write the manifest atomically. */
function writeManifest(path, manifest) {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}`
  writeFileSync(temporary, `${JSON.stringify(manifest, undefined, 2)}\n`)
  renameSync(temporary, path)
}

/** Run one git command with a hard timeout and one actionable error. */
function runGit(args, options = {}) {
  try {
    const output = execFileSync('git', args, {
      encoding: 'utf8',
      timeout: options.timeoutMs ?? 120_000,
      stdio: options.stdio ?? ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    })
    // execFileSync returns null when stdout is ignored. A successful clone
    // legitimately has no stdout; only a real failure should throw.
    return output === null || output === undefined ? '' : String(output).trim()
  } catch (error) {
    if (error?.code === 'ETIMEDOUT' || error?.signal === 'SIGTERM') {
      throw new Error(`git ${args.slice(0, 2).join(' ')} timed out after ${options.timeoutMs ?? 120_000}ms`)
    }
    const detail = String(error?.stderr ?? '').trim() || String(error?.message ?? error)
    throw new Error(`git ${args.slice(0, 2).join(' ')} failed: ${detail}`)
  }
}

/** Check out the pinned source; returns the directory holding skills/ and inbox/. */
function checkoutSource(lock, ref, source, timeoutMs = 120_000) {
  if (source !== undefined) {
    const head = runGit(['-C', source, 'rev-parse', 'HEAD'], { timeoutMs })
    if (head !== ref) throw new Error(`--source ${source} is at ${head}, expected pinned ref ${ref}`)
    return { root: source, head, owned: false }
  }
  const root = mkdtempSync(join(tmpdir(), 'hyperai-skills-'))
  try {
    runGit(['clone', '--quiet', lock.repository, root], { timeoutMs, stdio: ['ignore', 'ignore', 'pipe'] })
    runGit(['-C', root, 'checkout', '--quiet', '--detach', ref], { timeoutMs, stdio: ['ignore', 'ignore', 'pipe'] })
    const head = runGit(['-C', root, 'rev-parse', 'HEAD'], { timeoutMs })
    if (head !== ref) throw new Error(`checked out ${head}, expected pinned ref ${ref}`)
  } catch (error) {
    rmSync(root, { recursive: true, force: true })
    throw error
  }
  return { root, head: ref, owned: true }
}

/** Every file under a skill dir, relative and sorted; used for user extras. */
function allSkillFiles(dir) {
  if (!existsSync(dir)) return []
  const files = []
  const walk = (current, prefix) => {
    for (const entry of readdirSync(current, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const relative = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      if (entry.isDirectory()) walk(join(current, entry.name), relative)
      else if (entry.isFile()) files.push(relative)
    }
  }
  walk(dir, '')
  return files.sort()
}

/** Files in the installed skill that the manifest does not own (user content). */
function extraFiles(targetDir, owned) {
  return allSkillFiles(targetDir).filter(file => !(file in owned))
}

/** Stable JSON for file→digest maps, independent of insertion order. */
function canonicalFiles(files) {
  return JSON.stringify(Object.fromEntries(Object.entries(files).sort(([a], [b]) => a.localeCompare(b))))
}

/** Decide one skill's action without touching the target. */
export function planSkill(skill, sourceDir, targetDir, manifest) {
  const sourceDigest = digestSkill(sourceDir)
  const recorded = manifest.skills[skill.name]
  const installed = existsSync(join(targetDir, 'SKILL.md'))
  if (!installed) return { action: 'install', sourceDigest, recorded }
  const currentDigest = digestSkill(targetDir)
  if (canonicalFiles(currentDigest) === canonicalFiles(sourceDigest)) return { action: 'noop', sourceDigest, recorded }
  if (recorded === undefined) return { action: 'skip-unmanaged', sourceDigest, recorded }
  const owned = recorded.files ?? {}
  // Only files recorded in the manifest are managed content. A user file in
  // references/ must not look like a user edit of the package.
  const currentManaged = Object.fromEntries(Object.entries(currentDigest).filter(([file]) => file in owned))
  if (canonicalFiles(currentManaged) !== canonicalFiles(owned)) {
    return { action: 'skip-user-modified', sourceDigest, recorded }
  }
  const extras = extraFiles(targetDir, owned)
  const overlap = extras.filter(file => file in sourceDigest)
  if (overlap.length > 0) {
    return { action: 'skip-extra-conflict', sourceDigest, recorded, extras, conflict: overlap }
  }
  return { action: 'update', sourceDigest, recorded, extras }
}

/** Path of a per-skill journal used to recover a SIGKILL between swap and manifest write. */
function journalPath(options, name) {
  return join(options.stateDir, 'pending', `${name}.json`)
}

/** A recovery failure that must keep all evidence and fail the caller loudly. */
export class SkillRecoveryError extends Error {
  constructor(message, details = {}) {
    super(message)
    this.name = 'SkillRecoveryError'
    this.code = 'SKILL_RECOVERY_FAILED'
    this.details = details
  }
}

/** Atomically rewrite a journal after a swap phase. */
function writeJournalFile(path, journal) {
  mkdirSync(dirname(path), { recursive: true })
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(temporary, `${JSON.stringify(journal, undefined, 2)}\n`)
  renameSync(temporary, path)
}

/** Digest a tree without throwing for a missing/partial target. */
function safeSkillDigest(dir) {
  if (dir === undefined || !existsSync(join(dir, 'SKILL.md'))) return undefined
  try { return digestSkill(dir) } catch { return undefined }
}

/** Whether a tree contains exactly the managed files recorded in an entry. */
function managedMatches(digest, entry) {
  if (digest === undefined || entry === undefined || entry === null || typeof entry.files !== 'object') return false
  const current = Object.fromEntries(Object.entries(digest).filter(([file]) => file in entry.files))
  return canonicalFiles(current) === canonicalFiles(entry.files)
}

/** Files under a tree that the given entry does not own (user content). */
function extrasAgainst(dir, owned) {
  if (!existsSync(dir)) return []
  return allSkillFiles(dir).filter(file => !(file in (owned ?? {})))
}

/**
 * Preserve user extras while completing a new tree. A missing extra is copied
 * from the old tree. A hash conflict is never overwritten silently: the old
 * copy is retained under a visible conflict name and recovery fails.
 */
function preserveExtras(source, target, owned) {
  if (!existsSync(source) || !existsSync(target)) return []
  const copied = []
  const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d+Z$/u, 'Z')
  for (const relative of extrasAgainst(source, owned)) {
    const from = join(source, relative)
    const to = join(target, relative)
    if (!existsSync(to)) {
      copyOne(from, to)
      copied.push(relative)
      continue
    }
    const sourceHash = sha256(readFileSync(from))
    const targetHash = sha256(readFileSync(to))
    if (sourceHash !== targetHash) {
      const conflict = `${to}.hyperai-recovered-${stamp}`
      mkdirSync(dirname(conflict), { recursive: true })
      cpSync(from, conflict)
      throw new SkillRecoveryError(
        `user file conflict during recovery at ${relative}; old copy preserved at ${conflict}`,
        { source, target, file: relative, conflict },
      )
    }
  }
  return copied
}

/** Restore a tree from oldPath/snapshot without ever deleting the source first. */
function restoreTree(source, target) {
  if (!existsSync(source)) throw new SkillRecoveryError(`cannot restore missing old tree ${source}`, { source, target })
  if (existsSync(target)) throw new SkillRecoveryError(`refusing to overwrite existing target ${target}`, { source, target })
  mkdirSync(dirname(target), { recursive: true })
  try {
    renameSync(source, target)
  } catch {
    cpSync(source, target, { recursive: true })
    rmSync(source, { recursive: true, force: true })
  }
}

/**
 * Recover journals left by a SIGKILL during the legacy directory swap.
 *
 * Journal states are interpreted from the actual filesystem, never from a
 * mutable "phase" alone:
 *
 * - target matches newEntry: finish the manifest, preserve missing extras from
 *   oldPath/snapshot, then clean staging/oldPath.
 * - target matches beforeEntry: keep the old tree, restore the old manifest,
 *   preserve extras from oldPath, then clean the new staging tree.
 * - target missing + oldPath complete: restore oldPath to target and keep the
 *   old manifest (the P1 mid-swap case).
 * - target missing + no oldPath + staging is a complete new install: finish a
 *   new install only when there was no previous entry.
 * - target missing + snapshot available: restore the snapshot.
 * - anything else: fail safe with SKILL_RECOVERY_FAILED. No journal, oldPath,
 *   staging or backup is deleted on an undecidable state.
 *
 * @param {ReturnType<typeof normalizeSkillOptions>} options normalized options.
 * @returns {string[]} names whose journals were completed.
 */
export function recoverSkillJournals(options) {
  const pendingDir = join(options.stateDir, 'pending')
  if (!existsSync(pendingDir)) return []
  const recovered = []
  // Journal phase writes are atomic temp+rename. A SIGKILL can leave a
  // `.json.tmp-*` beside the last committed journal; it is never a source of
  // truth and must not survive a successful recovery.
  const cleanJournalTemps = () => {
    for (const name of readdirSync(pendingDir)) {
      if (name.endsWith('.json') || !/\.json\.tmp-/u.test(name)) continue
      rmSync(join(pendingDir, name), { force: true })
    }
  }
  const journalFiles = readdirSync(pendingDir).filter(name => name.endsWith('.json'))
  if (journalFiles.length === 0) {
    cleanJournalTemps()
    return []
  }
  for (const file of journalFiles) {
    const path = join(pendingDir, file)
    let journal
    try {
      journal = JSON.parse(readFileSync(path, 'utf8'))
    } catch (error) {
      throw new SkillRecoveryError(
        `cannot parse recovery journal ${path}; it was kept for manual inspection (${error instanceof Error ? error.message : String(error)})`,
        { journalPath: path },
      )
    }
    if (journal === null || typeof journal !== 'object' || typeof journal.name !== 'string') {
      throw new SkillRecoveryError(`invalid recovery journal ${path}; it was kept for manual inspection`, { journalPath: path })
    }
    const name = journal.name
    const target = journal.target ?? join(options.skillsDir, name)
    const expectedTarget = join(options.skillsDir, name)
    if (resolve(target) !== resolve(expectedTarget)) {
      throw new SkillRecoveryError(
        `recovery journal ${path} targets ${target}, outside the profile skill root ${expectedTarget}; refusing to touch it`,
        { journalPath: path, target, expectedTarget },
      )
    }
    const oldPath = typeof journal.oldPath === 'string' ? journal.oldPath : undefined
    const staging = typeof journal.staging === 'string' ? journal.staging : undefined
    const snapshotSkill = typeof journal.snapshot === 'string'
      ? join(options.stateDir, 'backups', journal.snapshot, 'skills', name)
      : undefined
    const targetDigest = safeSkillDigest(target)
    const oldDigest = safeSkillDigest(oldPath)
    const stagingDigest = safeSkillDigest(staging)
    const manifest = readManifest(options.manifestPath)
    const newMatches = targetDigest !== undefined && managedMatches(targetDigest, journal.newEntry)
    const oldMatches = targetDigest !== undefined && managedMatches(targetDigest, journal.beforeEntry)
    const oldTreeMatches = oldDigest !== undefined && managedMatches(oldDigest, journal.beforeEntry)
    const stagingNew = stagingDigest !== undefined && managedMatches(stagingDigest, journal.newEntry)
    const before = journal.beforeEntry ?? null
    const detail = {
      journalPath: path,
      name,
      target,
      oldPath,
      staging,
      snapshot: journal.snapshot,
      targetDigest,
      oldDigest,
      stagingDigest,
    }
    try {
      if (newMatches) {
        // The new tree is already in place. Copy back any extra that was not
        // carried over by the staging copy, then complete the manifest.
        if (oldPath !== undefined && oldTreeMatches) preserveExtras(oldPath, target, before?.files)
        else if (snapshotSkill !== undefined && existsSync(snapshotSkill)) preserveExtras(snapshotSkill, target, before?.files)
        manifest.skills[name] = journal.newEntry
        writeManifest(options.manifestPath, manifest)
      } else if (oldMatches) {
        // The swap never replaced target (or recovery already restored it).
        if (oldPath !== undefined && existsSync(oldPath)) preserveExtras(oldPath, target, before?.files)
        if (before === null) delete manifest.skills[name]
        else manifest.skills[name] = before
        writeManifest(options.manifestPath, manifest)
      } else if (targetDigest === undefined && oldPath !== undefined && existsSync(oldPath) && oldTreeMatches) {
        // P1 MID-SWAP: target was renamed to oldPath but the new tree never
        // reached target. Restore the old tree, including all user extras.
        restoreTree(oldPath, target)
        if (before === null) delete manifest.skills[name]
        else manifest.skills[name] = before
        writeManifest(options.manifestPath, manifest)
      } else if (targetDigest === undefined && before === null && stagingNew) {
        // A new install was killed before its only swap. Complete it.
        restoreTree(staging, target)
        manifest.skills[name] = journal.newEntry
        writeManifest(options.manifestPath, manifest)
      } else if (targetDigest === undefined && before !== null && snapshotSkill !== undefined && existsSync(snapshotSkill)) {
        // Last safe fallback: the pre-run backup still has the old tree.
        copyOneTree(snapshotSkill, target)
        manifest.skills[name] = before
        writeManifest(options.manifestPath, manifest)
      } else {
        throw new SkillRecoveryError(
          `undecidable recovery state for ${name}; journal, old tree, staging and backups were kept for manual recovery`,
          detail,
        )
      }
      // Only after the manifest and extras are safe may evidence be removed.
      if (staging !== undefined) rmSync(staging, { recursive: true, force: true })
      if (oldPath !== undefined) rmSync(oldPath, { recursive: true, force: true })
      rmSync(path, { force: true })
      recovered.push(name)
    } catch (error) {
      if (error instanceof SkillRecoveryError) throw error
      throw new SkillRecoveryError(
        `recovery failed for ${name}: ${error instanceof Error ? error.message : String(error)}. ` +
          'Journal, oldPath, staging and backups were left untouched; run --rollback or inspect the listed paths.',
        { ...detail, cause: error instanceof Error ? error.message : String(error) },
      )
    }
  }
  cleanJournalTemps()
  return recovered
}

/** Copy a directory recursively to a target that must not already exist. */
function copyOneTree(source, target) {
  if (existsSync(target)) throw new SkillRecoveryError(`refusing to overwrite existing target ${target}`, { source, target })
  mkdirSync(dirname(target), { recursive: true })
  cpSync(source, target, { recursive: true })
}

/** Install the pinned skills. */
export function installSkills(options = parseArgs([])) {
  options = normalizeSkillOptions(options)
  const lock = loadLock(options.lockPath)
  const ref = options.ref ?? lock.ref
  const skills = selectedSkills(lock, options.verifiedOnly)
  const result = {
    ref,
    installed: [],
    updated: [],
    unchanged: [],
    skippedSkills: [],
    skillsDir: options.skillsDir,
    dryRun: options.dryRun === true,
  }
  const recovered = options.dryRun ? [] : recoverSkillJournals(options)
  const manifest = readManifest(options.manifestPath)
  let source
  let snapshot
  try {
    source = checkoutSource(lock, ref, options.source, options.timeoutMs)
    // Plan before writing so a dry-run has no side effects and a failure has
    // one consistent pre-change snapshot for manifest-aware rollback.
    const actions = []
    for (const skill of skills) {
      const sourceDir = join(source.root, skill.area, skill.name)
      if (!existsSync(sourceDir)) throw new Error(`${skill.name}: not found at ${skill.area}/${skill.name} in ${ref}`)
      validateSkill(sourceDir, skill.name)
      const targetDir = join(options.skillsDir, skill.name)
      const decision = planSkill(skill, sourceDir, targetDir, manifest)
      if (decision.action === 'install' || decision.action === 'update') actions.push({ skill, sourceDir, targetDir, decision })
      else if (decision.action === 'noop') result.unchanged.push(skill.name)
      else result.skippedSkills.push({ name: skill.name, reason: decision.action, detail: decision.conflict?.join(', ') })
    }
    if (!options.dryRun && actions.length > 0) {
      const existing = [...new Set([...Object.keys(manifest.skills), ...actions.map(item => item.skill.name)])]
        .filter(name => existsSync(join(options.skillsDir, name)))
      snapshot = createSnapshot(options.stateDir, options.skillsDir, manifest, existing)
      result.backup = snapshot.id
    }
    for (const { skill, sourceDir, targetDir, decision } of actions) {
      if (options.dryRun) {
        if (decision.action === 'install') result.installed.push(skill.name)
        else result.updated.push(skill.name)
        continue
      }
      const staging = join(options.stateDir, 'staging', `${skill.name}-${process.pid}-${Date.now()}`)
      try {
        rmSync(staging, { recursive: true, force: true })
        mkdirSync(staging, { recursive: true })
        for (const file of Object.keys(decision.sourceDigest)) copyOne(join(sourceDir, file), join(staging, file))
        // Preserve files the run does not own, including user files inside
        // resource directories, across the directory swap.
        for (const file of decision.extras ?? []) {
          if (existsSync(join(targetDir, file))) copyOne(join(targetDir, file), join(staging, file))
        }
        mkdirSync(dirname(targetDir), { recursive: true })
        const oldPath = join(options.stateDir, 'staging', `${skill.name}-old-${process.pid}-${Date.now()}`)
        const newEntry = {
          ref,
          validated: skill.validated !== false,
          description: validateSkill(sourceDir, skill.name).description,
          files: decision.sourceDigest,
          installedAt: new Date().toISOString(),
        }
        const journal = {
          name: skill.name,
          target: targetDir,
          staging,
          oldPath,
          snapshot: snapshot?.id,
          beforeEntry: manifest.skills[skill.name] ?? null,
          newEntry,
          phase: 'prepared',
          at: new Date().toISOString(),
        }
        const currentJournalPath = journalPath(options, skill.name)
        writeJournalFile(currentJournalPath, journal)
        try {
          if (decision.action === 'update' && existsSync(targetDir)) {
            renameSync(targetDir, oldPath)
            journal.phase = 'old-moved'
            writeJournalFile(currentJournalPath, journal)
          }
          renameSync(staging, targetDir)
          journal.phase = 'new-moved'
          writeJournalFile(currentJournalPath, journal)
        } catch (error) {
          // Preserve a new tree if it already reached target, then put the
          // previous tree back. Never delete the only copy of user extras.
          let failedNew
          try {
            if (existsSync(targetDir) && existsSync(oldPath)) {
              failedNew = join(options.stateDir, 'staging', `${skill.name}-new-failed-${process.pid}-${Date.now()}`)
              mkdirSync(dirname(failedNew), { recursive: true })
              renameSync(targetDir, failedNew)
            }
            if (existsSync(oldPath) && !existsSync(targetDir)) renameSync(oldPath, targetDir)
          } catch { /* keep both paths for manual recovery */ }
          rmSync(currentJournalPath, { force: true })
          rmSync(staging, { recursive: true, force: true })
          const suffix = failedNew === undefined ? '' : `; failed new tree kept at ${failedNew}`
          throw new Error(`${error instanceof Error ? error.message : String(error)}${suffix}`)
        }
        manifest.skills[skill.name] = newEntry
        if (decision.action === 'install') result.installed.push(skill.name)
        else result.updated.push(skill.name)
      } catch (error) {
        // Put the previous tree back before reporting the failed skill.
        try {
          rmSync(staging, { recursive: true, force: true })
          rmSync(journalPath(options, skill.name), { force: true })
          if (snapshot !== undefined) {
            const before = join(snapshot.root, 'skills', skill.name)
            if (existsSync(before)) {
              rmSync(targetDir, { recursive: true, force: true })
              cpSync(before, targetDir, { recursive: true })
            } else if (decision.action === 'install') {
              rmSync(targetDir, { recursive: true, force: true })
            }
          }
        } catch { /* best effort */ }
        throw error
      }
    }
    if (!options.dryRun) {
      writeManifest(options.manifestPath, manifest)
      for (const action of actions) rmSync(journalPath(options, action.skill.name), { force: true })
      rmSync(join(options.stateDir, 'staging'), { recursive: true, force: true })
      appendHistory(options, ref, result)
    }
    result.recovered = recovered
    return result
  } finally {
    if (source !== undefined && source.owned) rmSync(source.root, { recursive: true, force: true })
  }
}
/** Copy one file, creating its parent directory. */
function copyOne(from, to) {
  mkdirSync(dirname(to), { recursive: true })
  cpSync(from, to)
}

/** Append one line to the install history. */
function appendHistory(options, ref, result) {
  const line = {
    at: new Date().toISOString(),
    ref,
    installed: result.installed,
    updated: result.updated,
    skipped: result.skippedSkills,
  }
  mkdirSync(options.stateDir, { recursive: true })
  writeFileSync(join(options.stateDir, 'history.log'), `${JSON.stringify(line)}\n`, { flag: 'a' })
}

/**
 * Restore the newest compatible backup snapshot. Backups now carry the
 * manifest and meta.json just like the updater's snapshots, so one rollback
 * implementation handles both legacy-installer and updater backups.
 */
export function rollbackSkills(options = parseArgs([])) {
  options = normalizeSkillOptions(options)
  const recovered = recoverSkillJournals(options)
  const plan = rollbackShared({ stateDir: options.stateDir, skillsDir: options.skillsDir, to: options.to })
  return { stamp: plan.id, restored: plan.restore, removed: plan.remove, kept: plan.keep, backupBefore: plan.backupBefore, recovered }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const options = parseArgs(process.argv.slice(2))
  try {
    const result = options.rollback ? rollbackSkills(options) : installSkills(options)
    if (options.json) process.stdout.write(`${JSON.stringify(result, undefined, 2)}\n`)
    else if (options.rollback) {
      process.stdout.write(`hyperai-skills: rolled back to ${result.stamp}\n`)
      for (const name of result.restored) process.stdout.write(`  restored ${name}\n`)
    } else {
      process.stdout.write(
        [
          `hyperai-skills: ${result.skillsDir}`,
          `  ref ${result.ref}${result.dryRun ? ' (dry run)' : ''}`,
          `  installed ${result.installed.length}: ${result.installed.join(', ') || '-'}`,
          `  updated   ${result.updated.length}: ${result.updated.join(', ') || '-'}`,
          `  unchanged ${result.unchanged.length}: ${result.unchanged.join(', ') || '-'}`,
          ...result.skippedSkills.map(entry => `  skipped   ${entry.name}: ${entry.reason}`),
          '',
        ].join('\n'),
      )
    }
  } catch (error) {
    process.stderr.write(`hyperai-skills: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(1)
  }
}
