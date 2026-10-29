#!/usr/bin/env node
/**
 * Install hyperai-skills into a dsh profile as a profile-scoped skill root.
 *
 * Skills land in `<profile>/skills/<name>/` (the directory the profile's
 * cordis.patch.yml feeds to `skill-filesystem.customSkillDirs`), and the
 * installer records exactly what it wrote in
 * `<profile>/.hyperai-skills/manifest.json`.
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

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = resolve(HERE, '..')
const BRAND = JSON.parse(readFileSync(join(PKG, 'brand', 'brand.json'), 'utf8'))
const DEFAULT_LOCK = resolve(PKG, '..', 'skills', 'hyperai-skills.lock.json')
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
    verifiedOnly: false,
    dryRun: false,
    rollback: false,
    json: false,
    source: undefined,
  }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--dsh-home') options.dshHome = argv[++index]
    else if (arg === '--profile') options.profile = argv[++index]
    else if (arg === '--lock') options.lockPath = resolve(argv[++index])
    else if (arg === '--ref') options.ref = argv[++index]
    else if (arg === '--source') options.source = resolve(argv[++index])
    else if (arg === '--source') options.source = resolve(argv[++index])
    else if (arg === '--verified-only') options.verifiedOnly = true
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--rollback') options.rollback = true
    else if (arg === '--json') options.json = true
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write(
        'usage: node scripts/install-skills.mjs [--dsh-home <dir>] [--profile <name>] [--ref <sha>] [--source <checkout>] [--verified-only] [--dry-run] [--rollback] [--json]\n',
      )
      process.exit(0)
    } else throw new Error(`unknown argument ${JSON.stringify(arg)}`)
  }
  if (options.dshHome === '') throw new Error('a Harness home is required: pass --dsh-home or export DSH_HOME')
  options.dshHome = resolve(options.dshHome)
  options.profileDir = join(options.dshHome, 'profiles', options.profile)
  options.skillsDir = join(options.profileDir, 'skills')
  options.stateDir = join(options.profileDir, '.hyperai-skills')
  options.manifestPath = join(options.stateDir, 'manifest.json')
  return options
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

/** Check out the pinned source; returns the directory holding skills/ and inbox/. */
function checkoutSource(lock, ref, source) {
  if (source !== undefined) {
    const head = execFileSync('git', ['-C', source, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
    if (head !== ref) throw new Error(`--source ${source} is at ${head}, expected pinned ref ${ref}`)
    return { root: source, head, owned: false }
  }
  const root = mkdtempSync(join(tmpdir(), 'hyperai-skills-'))
  execFileSync('git', ['clone', '--quiet', lock.repository, root], { stdio: ['ignore', 'ignore', 'pipe'] })
  execFileSync('git', ['-C', root, 'checkout', '--quiet', '--detach', ref], { stdio: ['ignore', 'ignore', 'pipe'] })
  const head = execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  if (head !== ref) throw new Error(`checked out ${head}, expected pinned ref ${ref}`)
  return { root, head, owned: true }
}

/** Decide one skill's action without touching the target. */
export function planSkill(skill, sourceDir, targetDir, manifest) {
  const sourceDigest = digestSkill(sourceDir)
  const recorded = manifest.skills[skill.name]
  const installed = existsSync(join(targetDir, 'SKILL.md'))
  if (!installed) return { action: 'install', sourceDigest, recorded }
  const currentDigest = digestSkill(targetDir)
  const currentSerialized = JSON.stringify(currentDigest)
  if (currentSerialized === JSON.stringify(sourceDigest)) return { action: 'noop', sourceDigest, recorded }
  if (recorded === undefined) return { action: 'skip-unmanaged', sourceDigest, recorded }
  if (JSON.stringify(currentDigest) !== JSON.stringify(recorded.files)) {
    return { action: 'skip-user-modified', sourceDigest, recorded }
  }
  return { action: 'update', sourceDigest, recorded }
}

/** Install the pinned skills. */
export function installSkills(options = parseArgs([])) {
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
  const plan = []
  for (const skill of skills) {
    plan.push({ skill, sourceDir: null })
  }
  const manifest = readManifest(options.manifestPath)
  let source
  try {
    source = checkoutSource(lock, ref, options.source)
    for (const entry of plan) {
      const skill = entry.skill
      const sourceDir = join(source.root, skill.area, skill.name)
      if (!existsSync(sourceDir)) throw new Error(`${skill.name}: not found at ${skill.area}/${skill.name} in ${ref}`)
      validateSkill(sourceDir, skill.name)
      const targetDir = join(options.skillsDir, skill.name)
      const decision = planSkill(skill, sourceDir, targetDir, manifest)
      if (decision.action === 'install' || decision.action === 'update') {
        if (!options.dryRun) {
          const stamp = new Date().toISOString().replaceAll(':', '-').replace(/\.\d+Z$/u, 'Z')
          const backupDir = join(options.stateDir, 'backups', stamp, 'skills', skill.name)
          if (decision.action === 'update') {
            cpSync(targetDir, backupDir, { recursive: true })
            rmSync(targetDir, { recursive: true, force: true })
          }
          mkdirSync(dirname(targetDir), { recursive: true })
          const staging = join(options.stateDir, 'staging', skill.name)
          rmSync(staging, { recursive: true, force: true })
          mkdirSync(dirname(staging), { recursive: true })
          for (const file of Object.keys(decision.sourceDigest)) {
            copyOne(join(sourceDir, file), join(staging, file))
          }
          renameSync(staging, targetDir)
          manifest.skills[skill.name] = {
            ref,
            validated: skill.validated !== false,
            description: validateSkill(targetDir, skill.name).description,
            files: decision.sourceDigest,
            installedAt: new Date().toISOString(),
          }
          if (decision.action === 'install') result.installed.push(skill.name)
          else result.updated.push(skill.name)
        } else {
          if (decision.action === 'install') result.installed.push(skill.name)
          else result.updated.push(skill.name)
        }
      } else if (decision.action === 'noop') {
        result.unchanged.push(skill.name)
      } else {
        result.skippedSkills.push({ name: skill.name, reason: decision.action })
      }
    }
    if (!options.dryRun) {
      writeManifest(options.manifestPath, manifest)
      appendHistory(options, ref, result)
    }
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

/** Restore the newest backup snapshot. */
export function rollbackSkills(options) {
  const backupsRoot = join(options.stateDir, 'backups')
  if (!existsSync(backupsRoot)) throw new Error(`no backups under ${backupsRoot}`)
  const stamp = readdirSync(backupsRoot).sort().at(-1)
  if (stamp === undefined) throw new Error(`no backups under ${backupsRoot}`)
  const snapshot = join(backupsRoot, stamp)
  const skills = join(snapshot, 'skills')
  const restored = []
  if (existsSync(skills)) {
    for (const name of readdirSync(skills)) {
      rmSync(join(options.skillsDir, name), { recursive: true, force: true })
      cpSync(join(skills, name), join(options.skillsDir, name), { recursive: true })
      restored.push(name)
    }
  }
  const manifestBackup = join(snapshot, 'manifest.json')
  if (existsSync(manifestBackup)) cpSync(manifestBackup, options.manifestPath)
  return { stamp, restored }
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
