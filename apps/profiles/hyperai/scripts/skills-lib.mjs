/**
 * Shared library for the HyperAI skills updater.
 *
 * The DSH loader only sees installed files; this module owns the independent
 * management layer: remote discovery (`skills/**\/SKILL.md`), content digests,
 * the schema-1/schema-2 manifest, plan classification, transactional installs,
 * backups, history and rollback. It never imports DSH internals and never
 * writes model/provider configuration.
 */
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import {
  copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  renameSync, rmSync, statSync, writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'

/** Default upstream repository; override with --repo or HYPERAI_SKILLS_REPO. */
export const DEFAULT_REPO = 'https://github.com/hyperai/hyperai-skills.git'
/** Stable channel branch. Any other --ref is a prerelease/test source. */
export const STABLE_REF = 'master'
/** Resource directories a hyperai skill may carry (matches the repo format). */
export const RESOURCE_DIRS = ['references', 'templates', 'scripts', 'assets', 'examples']
/** `name:` grammar accepted by DSH and the upstream validator. */
export const SKILL_NAME = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u
// Keep the on-disk manifest schema at 1: the legacy install-skills.mjs reads
// only schema 1, so writing 2 here would make it treat the manifest as empty
// and lose its user-edit protection. The updater adds optional fields to the
// schema-1 entries; schema-2 manifests from development builds are still read
// and are normalized back to 1 on the next write.
export const MANIFEST_SCHEMA = 1
const IGNORED_DIRS = new Set(['.git', 'node_modules', 'inbox'])

/** Error class whose message is meant for the CLI user, not a stack trace. */
export class SkillsError extends Error {
  /** @param {string} message user-facing detail. @param {unknown} [cause] underlying error. */
  constructor(message, cause = undefined) {
    super(message)
    this.name = 'SkillsError'
    this.cause = cause
  }
}

/** @param {string} value @returns {string} sha256 hex. */
export function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

/** @param {Buffer|string} value @returns {string} sha256 hex. */
export function sha256Bytes(value) {
  return createHash('sha256').update(value).digest('hex')
}

/** @param {string} file @returns {string} sha256 hex. */
export function sha256File(file) {
  return sha256Bytes(readFileSync(file))
}

/** @param {Record<string, string>} files sorted file→sha map @returns {string} package digest. */
export function digestFromFiles(files) {
  const entries = Object.entries(files).sort(([a], [b]) => a.localeCompare(b))
  return sha256(JSON.stringify(entries))
}

/** @param {string} dir @returns {string[]} every regular file relative to dir, sorted. */
function walkFiles(dir) {
  const out = []
  const walk = (current, prefix) => {
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch {
      return
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      const rel = prefix === '' ? entry.name : `${prefix}/${entry.name}`
      const full = join(current, entry.name)
      if (entry.isSymbolicLink()) {
        let target
        try {
          target = statSync(full)
        } catch {
          continue
        }
        if (target.isDirectory()) continue
        out.push(rel)
        continue
      }
      if (entry.isDirectory()) walk(full, rel)
      else if (entry.isFile()) out.push(rel)
    }
  }
  walk(dir, '')
  return out.sort()
}

/**
 * The files the updater owns inside one skill directory: SKILL.md plus the
 * allowed resource directories. Top-level dev files (tests/, NOTES.md, …) are
 * not package content.
 * @param {string} dir skill directory.
 * @returns {Record<string, string>} relative file→sha256.
 */
export function scanPackageFiles(dir) {
  const files = {}
  for (const rel of walkFiles(dir)) {
    const [top] = rel.split('/')
    if (rel === 'SKILL.md' || (rel.includes('/') && RESOURCE_DIRS.includes(top))) {
      files[rel] = sha256File(join(dir, rel))
    }
  }
  return files
}

/** @param {string} dir @param {Record<string, string>} owned files already known owned. */
export function scanExtraFiles(dir, owned) {
  // Anything not recorded in the manifest is user content, including files
  // inside a package resource directory (e.g. references/user-notes.md).
  return walkFiles(dir).filter(rel => !(rel in owned))
}

/** Parse YAML frontmatter of a SKILL.md, returning name/description/version when present. */
export function parseSkillFrontmatter(dir, expectedName = undefined) {
  const file = join(dir, 'SKILL.md')
  if (!existsSync(file)) throw new SkillsError(`${basename(dir)}: SKILL.md is missing`)
  let text
  try {
    text = readFileSync(file, 'utf8')
  } catch (error) {
    throw new SkillsError(`${basename(dir)}: cannot read SKILL.md: ${String(error)}`, error)
  }
  if (!text.startsWith('---\n') && !text.startsWith('---\r\n')) {
    throw new SkillsError(`${basename(dir)}: SKILL.md must start with YAML frontmatter`)
  }
  const end = text.startsWith('---\r\n') ? text.indexOf('\r\n---', 4) : text.indexOf('\n---', 4)
  if (end < 0) throw new SkillsError(`${basename(dir)}: SKILL.md frontmatter is not closed`)
  const front = text.slice(text.startsWith('---\r\n') ? 5 : 4, end)
  const field = key => {
    const match = new RegExp(`^${key}:\\s*(.+)$`, 'mu').exec(front)
    if (!match) return undefined
    let value = match[1].trim()
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    return value
  }
  const name = field('name')
  const description = field('description')
  const version = field('version')
  if (name === undefined || name === '') throw new SkillsError(`${basename(dir)}: frontmatter has no name`)
  if (expectedName !== undefined && name !== expectedName) {
    throw new SkillsError(`${basename(dir)}: frontmatter name ${JSON.stringify(name)} does not match the directory name`)
  }
  if (!SKILL_NAME.test(name)) throw new SkillsError(`${basename(dir)}: invalid skill name ${JSON.stringify(name)}`)
  if (description === undefined || description === '') throw new SkillsError(`${basename(dir)}: frontmatter has no description`)
  return { name, description, version }
}

/** Reject symlinks inside a skill package so a copied file cannot escape it. */
function assertNoSymlinks(dir) {
  const walk = (current) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const full = join(current, entry.name)
      if (entry.isSymbolicLink()) throw new SkillsError(`${basename(dir)}: symlink is not allowed in a skill package: ${relative(dir, full)}`)
      if (entry.isDirectory()) walk(full)
    }
  }
  walk(dir)
}

/** Validate relative resource references in SKILL.md against the package files. */
function assertSkillResources(dir, files) {
  const text = readFileSync(join(dir, 'SKILL.md'), 'utf8')
  const refs = new Set()
  for (const match of text.matchAll(/`((?:references|templates|scripts|assets|examples)\/[^`\s]+)`/gu)) refs.add(match[1])
  for (const match of text.matchAll(/\]\(((?:references|templates|scripts|assets|examples)\/[^)\s]+)\)/gu)) refs.add(match[1])
  for (const raw of refs) {
    const ref = decodeURIComponent(raw.split(/[?#]/u)[0])
    if (ref.includes('..')) throw new SkillsError(`${basename(dir)}: suspicious resource reference ${JSON.stringify(raw)}`)
    if (!(ref in files)) throw new SkillsError(`${basename(dir)}: SKILL.md references missing resource ${JSON.stringify(raw)}`)
  }
}

/** Resolve and validate one skill directory; returns its package metadata. */
export function readSkillPackage(dir, expectedName = basename(dir)) {
  const meta = parseSkillFrontmatter(dir, expectedName)
  assertNoSymlinks(dir)
  const files = scanPackageFiles(dir)
  if (files['SKILL.md'] === undefined) throw new SkillsError(`${expectedName}: SKILL.md is not a package file`)
  assertSkillResources(dir, files)
  const bytes = Object.keys(files).reduce((sum, rel) => sum + statSize(join(dir, rel)), 0)
  return { ...meta, files, digest: digestFromFiles(files), bytes }
}

function statSize(file) {
  try {
    return statSync(file).size
  } catch {
    return 0
  }
}

/** Recursively discover skills under a `skills/` root. Nested categories are supported. */
export function discoverSkills(root) {
  const found = []
  const walk = (current) => {
    let entries
    try {
      entries = readdirSync(current, { withFileTypes: true })
    } catch (error) {
      throw new SkillsError(`cannot read skills directory ${current}: ${String(error)}`, error)
    }
    entries.sort((a, b) => a.name.localeCompare(b.name))
    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (entry.name.startsWith('.') || entry.name.startsWith('_') || IGNORED_DIRS.has(entry.name)) continue
      const dir = join(current, entry.name)
      if (existsSync(join(dir, 'SKILL.md'))) {
        const pkg = readSkillPackage(dir, entry.name)
        found.push({ ...pkg, absDir: dir, sourcePath: relative(root, dir).split(sep).join('/') })
        continue // a skill root is not descended into further
      }
      walk(dir)
    }
  }
  walk(root)
  const byName = new Map()
  for (const skill of found) {
    const previous = byName.get(skill.name)
    if (previous !== undefined) {
      throw new SkillsError(
        `duplicate skill name ${JSON.stringify(skill.name)} in skills/: ${previous.sourcePath}/SKILL.md and ${skill.sourcePath}/SKILL.md`,
      )
    }
    byName.set(skill.name, skill)
  }
  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name))
}

/** Run git, converting failures into one user-facing error with stderr attached. */
function git(args, options = {}) {
  try {
    return execFileSync('git', args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: options.timeoutMs ?? 120_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    }).trim()
  } catch (error) {
    const stdout = String(error?.stdout ?? '').trim()
    const stderr = String(error?.stderr ?? '').trim()
    const detail = stderr || stdout || String(error?.message ?? error)
    throw new SkillsError(`git ${args.slice(0, 2).join(' ')} failed: ${detail}`, error)
  }
}

/**
 * Resolve a ref to a commit and materialize that exact commit in a temporary
 * checkout (or use an existing checkout with --source). The caller owns cleanup.
 * @param {{repo?: string, ref?: string, source?: string, timeoutMs?: number}} options
 */
export function prepareSource(options = {}) {
  const repo = options.repo ?? DEFAULT_REPO
  const requestedRef = options.ref ?? STABLE_REF
  const source = options.source
  if (source !== undefined) {
    const sourceRoot = resolve(source)
    if (!existsSync(join(sourceRoot, '.git'))) {
      if (!existsSync(sourceRoot) || !statSync(sourceRoot).isDirectory()) {
        throw new SkillsError(`--source ${sourceRoot} is not a directory`)
      }
      // A plain directory (offline fixture): the caller owns the ref semantics.
      return { repo: sourceRoot, requestedRef, resolvedRef: 'local', refType: 'local', root: sourceRoot, owned: false, cleanup: () => {} }
    }
    let sha
    try {
      sha = git(['-C', sourceRoot, 'rev-parse', '--verify', `${requestedRef}^{commit}`], options)
    } catch (error) {
      throw new SkillsError(`--source ${sourceRoot} cannot resolve ref ${JSON.stringify(requestedRef)} to a commit`, error)
    }
    // Clone the local checkout so the requested commit is materialized without
    // mutating the user's working tree or checking out a ref they may be using.
    const root = mkdtempSync(join(tmpdir(), 'hyperai-skills-source-'))
    try {
      git(['clone', '--quiet', '--no-checkout', sourceRoot, root], options)
      git(['-C', root, 'checkout', '--quiet', '--detach', sha], options)
      const head = git(['-C', root, 'rev-parse', 'HEAD'], options)
      if (head !== sha) throw new SkillsError(`source checkout is at ${head}, expected ${sha}`)
    } catch (error) {
      rmSync(root, { recursive: true, force: true })
      if (error instanceof SkillsError) throw error
      throw new SkillsError(`cannot materialize ${sourceRoot} at ${sha}: ${String(error)}`, error)
    }
    return {
      repo: sourceRoot,
      requestedRef,
      resolvedRef: sha,
      refType: classifyRef(requestedRef, sha),
      root,
      owned: true,
      cleanup: () => rmSync(root, { recursive: true, force: true }),
    }
  }
  let resolvedRef
  if (/^[0-9a-f]{40}$/u.test(requestedRef)) {
    resolvedRef = requestedRef
  } else {
    const refs = refCandidates(requestedRef)
    const output = git(['ls-remote', repo, ...refs], options)
    const map = new Map()
    for (const line of output.split('\n')) {
      const [sha, name] = line.split(/\s+/u)
      if (sha !== undefined && name !== undefined) map.set(name, sha)
    }
    for (const candidate of refs) {
      const sha = map.get(candidate)
      if (sha !== undefined) { resolvedRef = sha; break }
    }
    if (resolvedRef === undefined) {
      throw new SkillsError(
        `cannot resolve ${JSON.stringify(requestedRef)} in ${repo}; check the branch/tag name and GitHub access`,
      )
    }
  }
  const root = mkdtempSync(join(tmpdir(), 'hyperai-skills-update-'))
  try {
    git(['clone', '--quiet', '--depth', '1', '--no-checkout', repo, root], options)
    git(['-C', root, 'fetch', '--quiet', '--depth', '1', 'origin', resolvedRef], options)
    git(['-C', root, 'checkout', '--quiet', '--detach', 'FETCH_HEAD'], options)
    const head = git(['-C', root, 'rev-parse', 'HEAD'], options)
    if (head !== resolvedRef) throw new SkillsError(`checked out ${head}, expected ${resolvedRef}`)
  } catch (error) {
    rmSync(root, { recursive: true, force: true })
    if (error instanceof SkillsError) throw error
    throw new SkillsError(`cannot fetch ${repo}: ${String(error)}`, error)
  }
  return {
    repo,
    requestedRef,
    resolvedRef,
    refType: classifyRef(requestedRef, resolvedRef),
    root,
    owned: true,
    cleanup: () => rmSync(root, { recursive: true, force: true }),
  }
}

function refCandidates(ref) {
  if (ref.startsWith('refs/')) return [ref]
  return [`refs/heads/${ref}`, `refs/tags/${ref}`]
}

function classifyRef(requestedRef, resolvedRef) {
  if (/^[0-9a-f]{40}$/u.test(requestedRef)) return 'commit'
  if (requestedRef.startsWith('refs/heads/') || requestedRef.startsWith('refs/tags/')) {
    return requestedRef.startsWith('refs/tags/') ? 'tag' : 'branch'
  }
  return 'ref'
}

/** Stable only for the default branch; every explicit ref is marked prerelease. */
export function channelOf(requestedRef) {
  const branch = requestedRef.replace(/^refs\/heads\//u, '')
  return branch === STABLE_REF ? 'stable' : 'prerelease'
}

/**
 * Read the manifest, accepting the legacy schema 1 written by
 * install-skills.mjs and the updater's schema 2.
 * @param {string} stateDir `<profile>/.hyperai-skills`.
 */
export function readManifest(stateDir) {
  const path = join(stateDir, 'manifest.json')
  const empty = { schema: MANIFEST_SCHEMA, managedBy: 'hyperai-skills-updater', skills: {} }
  if (!existsSync(path)) return empty
  let parsed
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new SkillsError(`cannot parse ${path}: ${String(error)}`, error)
  }
  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new SkillsError(`${path} is not a JSON object`)
  }
  const skills = parsed.skills !== null && typeof parsed.skills === 'object' && !Array.isArray(parsed.skills)
    ? parsed.skills
    : {}
  return {
    ...parsed,
    schema: MANIFEST_SCHEMA,
    legacySchema: parsed.schema === 1,
    managedBy: parsed.managedBy ?? 'hyperai-skills-updater',
    skills,
  }
}

/** Atomic manifest write; the legacy schema-1 fields of untouched entries are kept. */
export function writeManifest(stateDir, manifest) {
  mkdirSync(stateDir, { recursive: true })
  const path = join(stateDir, 'manifest.json')
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(temp, `${JSON.stringify({ ...manifest, schema: MANIFEST_SCHEMA }, undefined, 2)}\n`, { mode: 0o644 })
  renameSync(temp, path)
}

/** Normalize one manifest entry, supporting legacy entries with only `files`. */
export function normalizeEntry(entry) {
  if (entry === null || typeof entry !== 'object') return undefined
  const files = entry.files !== null && typeof entry.files === 'object' && !Array.isArray(entry.files) ? entry.files : {}
  return {
    ...entry,
    files,
    digest: typeof entry.digest === 'string' ? entry.digest : digestFromFiles(files),
    managedBy: entry.managedBy ?? 'legacy-installer',
    legacyUnverified: entry.legacyUnverified ?? (entry.validated === false && entry.managedBy === undefined),
  }
}

/**
 * Inspect one local managed skill.
 * @param {string} target skill directory.
 * @param {ReturnType<typeof normalizeEntry>} entry manifest entry.
 * @returns {{exists: boolean, modified: string[], files: Record<string,string>, digest: string|undefined, extras: string[], missing: string[]}}
 */
export function inspectLocal(target, entry) {
  const exists = existsSync(join(target, 'SKILL.md'))
  const recorded = entry.files ?? {}
  const files = {}
  const modified = []
  const missing = []
  for (const rel of Object.keys(recorded).sort()) {
    const file = join(target, rel)
    if (!existsSync(file)) { missing.push(rel); continue }
    const hash = sha256File(file)
    files[rel] = hash
    if (hash !== recorded[rel]) modified.push(rel)
  }
  return {
    exists,
    modified,
    missing,
    files,
    digest: digestFromFiles(files),
    extras: exists ? scanExtraFiles(target, recorded) : [],
  }
}

/**
 * Compare remote skills with the local installation.
 * @param {{remote: any[], manifest: any, skillsDir: string, source: any}} input
 * @returns {{adds: any[], updates: any[], unchanged: any[], skipped: any[], kept: any[], localOnly: any[]}}
 */
export function planSkills(input) {
  const { remote, manifest, skillsDir, source } = input
  const adds = []; const updates = []; const unchanged = []; const skipped = []
  const kept = []; const localOnly = []
  const known = new Set()
  for (const skill of remote) {
    known.add(skill.name)
    const entryRaw = manifest.skills[skill.name]
    const entry = entryRaw === undefined ? undefined : normalizeEntry(entryRaw)
    const target = join(skillsDir, skill.name)
    const local = existsSync(join(target, 'SKILL.md'))
    const item = { name: skill.name, remote: skill, source, entry }
    if (entry === undefined) {
      if (local) {
        skipped.push({ ...item, reason: 'local-same-name', detail: 'a locally installed skill with this name already exists; not overwritten' })
      } else {
        adds.push(item)
      }
      continue
    }
    if (entry.legacyUnverified) {
      skipped.push({ ...item, reason: 'legacy-unverified', detail: 'installed from inbox/ by the legacy installer; kept unchanged' })
      continue
    }
    if (!local) {
      adds.push({ ...item, reason: 'local-missing', detail: 'manifest says managed but the directory is missing; reinstalling' })
      continue
    }
    const state = inspectLocal(target, entry)
    if (state.modified.length > 0 || state.missing.length > 0) {
      skipped.push({ ...item, reason: 'local-modified', detail: `user-modified managed files: ${[...state.modified, ...state.missing].join(', ')}` })
      continue
    }
    const extrasOverlap = state.extras.filter(rel => rel in skill.files)
    if (extrasOverlap.length > 0) {
      skipped.push({ ...item, reason: 'extra-file-conflict', detail: `user files collide with new package files: ${extrasOverlap.join(', ')}` })
      continue
    }
    const same = state.digest === skill.digest
    if (same) {
      unchanged.push({ ...item, extras: state.extras })
    } else {
      updates.push({ ...item, extras: state.extras, fromDigest: state.digest, toDigest: skill.digest })
    }
  }
  // Entries/directories the remote no longer provides stay local.
  const allNames = new Set([...Object.keys(manifest.skills), ...listLocalSkillNames(skillsDir)])
  for (const name of [...allNames].sort()) {
    if (known.has(name)) continue
    const entryRaw = manifest.skills[name]
    const entry = entryRaw === undefined ? undefined : normalizeEntry(entryRaw)
    const local = existsSync(join(skillsDir, name, 'SKILL.md'))
    if (entry !== undefined && entry.legacyUnverified) {
      kept.push({ name, reason: 'legacy-unverified', local })
    } else if (entry !== undefined) {
      kept.push({ name, reason: local ? 'remote-missing' : 'local-missing', local })
    } else if (local) {
      localOnly.push({ name, local: true })
    }
  }
  return { adds, updates, unchanged, skipped, kept, localOnly }
}

/** Directory names under a skills root that contain SKILL.md (one level). */
export function listLocalSkillNames(skillsDir) {
  if (!existsSync(skillsDir)) return []
  const names = []
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (entry.isDirectory() && !entry.name.startsWith('.') && existsSync(join(skillsDir, entry.name, 'SKILL.md'))) {
      names.push(entry.name)
    }
  }
  return names.sort()
}

/** Human summary lines for a plan. */
export function formatPlan(plan) {
  const lines = []
  for (const item of plan.adds) lines.push(`+ add     ${item.name}${item.remote.version === undefined ? '' : `  v${item.remote.version}`}  ${Object.keys(item.remote.files).length} files  ${item.remote.bytes} B  (${item.remote.sourcePath})`)
  for (const item of plan.updates) lines.push(`~ update  ${item.name}${item.remote.version === undefined ? '' : `  v${item.remote.version}`}  ${Object.keys(item.remote.files).length} files  ${item.remote.bytes} B  (${item.remote.sourcePath})`)
  for (const item of plan.unchanged) lines.push(`= unchanged ${item.name}${item.extras?.length ? `  (${item.extras.length} local extra files preserved)` : ''}`)
  for (const item of plan.skipped) lines.push(`! skip    ${item.name}  ${item.reason}: ${item.detail}`)
  for (const item of plan.kept) lines.push(`- keep    ${item.name}  ${item.reason}`)
  for (const item of plan.localOnly) lines.push(`· local   ${item.name}  (installed outside the updater)`)
  return lines
}

/** Whether a plan contains writes. */
export function planHasChanges(plan) {
  return plan.adds.length > 0 || plan.updates.length > 0
}

/** Stable timestamp usable as a directory name. */
export function stamp() {
  // Keep milliseconds: two updates can finish in the same second and a
  // second-granularity id would make backup ordering depend on a random suffix.
  return new Date().toISOString().replaceAll(':', '-')
}

/** Create one backup snapshot for a run: manifest + affected existing skill dirs. */
export function createSnapshot(stateDir, skillsDir, manifest, names) {
  const id = `${stamp()}-${Math.random().toString(36).slice(2, 7)}`
  const root = join(stateDir, 'backups', id)
  mkdirSync(join(root, 'skills'), { recursive: true })
  writeFileSync(join(root, 'manifest.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
  const skills = {}
  for (const name of names) {
    const target = join(skillsDir, name)
    if (!existsSync(target)) continue
    const dest = join(root, 'skills', name)
    cpSync(target, dest, { recursive: true })
    skills[name] = true
  }
  const meta = { kind: 'update', at: new Date().toISOString(), names: [...names], present: Object.keys(skills) }
  writeFileSync(join(root, 'meta.json'), `${JSON.stringify(meta, undefined, 2)}\n`)
  return { id, root, meta }
}

/** Copy package files from source into staging, preserving extras for updates. */
function stageSkill(remote, extras, staging) {
  rmSync(staging, { recursive: true, force: true })
  mkdirSync(staging, { recursive: true })
  for (const rel of Object.keys(remote.files).sort()) {
    const from = join(remote.absDir, rel)
    const to = join(staging, rel)
    mkdirSync(dirname(to), { recursive: true })
    copyFileSync(from, to)
  }
  return staging
}

/**
 * Apply install/update actions transactionally.
 * @param {{plan: any, skillsDir: string, stateDir: string, source: any, manifest: any, only?: string[]}} input
 */
export function applyPlan(input) {
  const { plan, skillsDir, stateDir, source, manifest } = input
  const only = input.only
  const result = { installed: [], updated: [], skipped: [], failed: [], backup: undefined }
  const actions = [...plan.adds, ...plan.updates].filter(item => only === undefined || only.includes(item.name))
  if (actions.length === 0) return result
  const existing = actions.map(item => item.name).filter(name => existsSync(join(skillsDir, name)))
  mkdirSync(skillsDir, { recursive: true })
  const snapshot = createSnapshot(stateDir, skillsDir, manifest, existing)
  result.backup = snapshot.id
  mkdirSync(join(stateDir, 'staging'), { recursive: true })
  mkdirSync(join(stateDir, 'pending'), { recursive: true })
  const addedNames = []
  for (const item of actions) {
    const name = item.name
    const remote = item.remote
    const target = join(skillsDir, name)
    const staging = join(stateDir, 'staging', `${name}-${process.pid}-${Date.now()}`)
    const oldPath = join(stateDir, 'staging', `${name}-old-${process.pid}-${Date.now()}`)
    const journalPath = join(stateDir, 'pending', `${name}.json`)
    const extras = item.extras ?? []
    try {
      stageSkill(remote, extras, staging)
      for (const rel of extras) {
        const from = join(target, rel)
        const to = join(staging, rel)
        mkdirSync(dirname(to), { recursive: true })
        copyFileSync(from, to)
      }
      // Verify the staged package content before touching the installed copy.
      // Only the remote package files count here; preserved user extras may live
      // under the same resource directories and are not part of the digest.
      const staged = {}
      for (const rel of Object.keys(remote.files)) {
        const file = join(staging, rel)
        if (!existsSync(file)) throw new SkillsError(`${name}: staged package is missing ${rel}`)
        staged[rel] = sha256File(file)
      }
      if (digestFromFiles(staged) !== remote.digest) throw new SkillsError(`${name}: staged content does not match the remote digest`)
      const journal = {
        name, target, staging, oldPath, snapshot: snapshot.id,
        action: item.reason === undefined && plan.adds.includes(item) ? 'add' : 'update',
        beforeEntry: manifest.skills[name] ?? null,
      }
      writeFileSync(journalPath, `${JSON.stringify(journal, undefined, 2)}\n`)
      if (existsSync(target)) renameSync(target, oldPath)
      try {
        renameSync(staging, target)
      } catch (error) {
        if (existsSync(oldPath) && !existsSync(target)) renameSync(oldPath, target)
        throw error
      }
      const entry = {
        managedBy: 'skills-updater',
        sourcePath: remote.sourcePath,
        version: remote.version,
        description: remote.description,
        files: remote.files,
        digest: remote.digest,
        bytes: remote.bytes,
        source: { repo: source.repo, requestedRef: source.requestedRef, resolvedRef: source.resolvedRef, channel: channelOf(source.requestedRef), fetchedAt: new Date().toISOString() },
        installedAt: new Date().toISOString(),
        validated: true,
      }
      const nextManifest = { ...manifest, schema: MANIFEST_SCHEMA, managedBy: 'hyperai-skills-updater', skills: { ...manifest.skills, [name]: entry } }
      try {
        writeManifest(stateDir, nextManifest)
      } catch (error) {
        // Restore the previous tree; the manifest was not replaced.
        rmSync(target, { recursive: true, force: true })
        if (existsSync(oldPath)) renameSync(oldPath, target)
        throw error
      }
      manifest.skills[name] = entry
      if (plan.adds.includes(item)) { result.installed.push(name); addedNames.push(name) } else result.updated.push(name)
      rmSync(oldPath, { recursive: true, force: true })
      rmSync(staging, { recursive: true, force: true })
      rmSync(journalPath, { force: true })
      appendHistory(stateDir, { at: new Date().toISOString(), action: plan.adds.includes(item) ? 'install' : 'update', name, ref: source.resolvedRef, version: remote.version ?? null })
    } catch (error) {
      try {
        if (existsSync(oldPath) && !existsSync(target)) renameSync(oldPath, target)
        if (existsSync(staging)) rmSync(staging, { recursive: true, force: true })
        if (existsSync(journalPath)) rmSync(journalPath, { force: true })
      } catch { /* best effort */ }
      result.failed.push({ name, error: error instanceof Error ? error.message : String(error) })
    }
  }
  if (addedNames.length > 0) {
    try {
      const metaPath = join(snapshot.root, 'meta.json')
      const meta = JSON.parse(readFileSync(metaPath, 'utf8'))
      meta.added = addedNames
      writeFileSync(metaPath, `${JSON.stringify(meta, undefined, 2)}\n`)
    } catch { /* snapshot metadata is best effort */ }
  }
  return result
}

/**
 * Recover a run interrupted between the directory swap and the manifest write.
 * Safe to call before any command that mutates state.
 * @param {{stateDir: string, skillsDir: string}} input
 */
export function recoverPending({ stateDir, skillsDir }) {
  const pendingDir = join(stateDir, 'pending')
  if (!existsSync(pendingDir)) return []
  const recovered = []
  for (const file of readdirSync(pendingDir).filter(name => name.endsWith('.json'))) {
    const journalPath = join(pendingDir, file)
    let journal
    try {
      journal = JSON.parse(readFileSync(journalPath, 'utf8'))
    } catch {
      rmSync(journalPath, { force: true })
      continue
    }
    const target = journal.target ?? join(skillsDir, journal.name)
    try {
      const manifest = readManifest(stateDir)
      const entry = manifest.skills[journal.name]
      const local = existsSync(join(target, 'SKILL.md'))
      const targetDigest = local ? digestFromFiles(scanPackageFiles(target)) : undefined
      const manifestMatches = entry !== undefined && typeof entry.files === 'object' && digestFromFiles(entry.files) === targetDigest
      if (manifestMatches) {
        rmSync(journal.oldPath, { recursive: true, force: true })
      } else {
        rmSync(target, { recursive: true, force: true })
        if (journal.oldPath !== undefined && existsSync(journal.oldPath)) renameSync(journal.oldPath, target)
        else {
          const snapshotSkill = join(stateDir, 'backups', journal.snapshot, 'skills', journal.name)
          if (existsSync(snapshotSkill)) cpSync(snapshotSkill, target, { recursive: true })
        }
        const manifestBackup = join(stateDir, 'backups', journal.snapshot, 'manifest.json')
        if (existsSync(manifestBackup)) cpSync(manifestBackup, join(stateDir, 'manifest.json'))
      }
      rmSync(journal.staging, { recursive: true, force: true })
      rmSync(journal.oldPath, { recursive: true, force: true })
      rmSync(journalPath, { force: true })
      recovered.push(journal.name)
    } catch {
      // Leave the journal for a later attempt; keep the error out of read-only output.
    }
  }
  return recovered
}

/** Append one JSON line to the updater history. */
export function appendHistory(stateDir, entry) {
  mkdirSync(stateDir, { recursive: true })
  writeFileSync(join(stateDir, 'history.log'), `${JSON.stringify(entry)}\n`, { flag: 'a' })
}

/** List backups newest first. */
export function listBackups(stateDir) {
  const root = join(stateDir, 'backups')
  if (!existsSync(root)) return []
  const out = []
  for (const name of readdirSync(root)) {
    const metaPath = join(root, name, 'meta.json')
    let meta = {}
    try { meta = JSON.parse(readFileSync(metaPath, 'utf8')) } catch { /* tolerate */ }
    if (!existsSync(metaPath)) {
      // Pre-2026-11-02 legacy-installer snapshots only carry skills/<name>/.
      // Mark them so rollback can migrate them instead of refusing to work.
      const legacySkills = join(root, name, 'skills')
      const names = existsSync(legacySkills)
        ? readdirSync(legacySkills).filter(entry => existsSync(join(legacySkills, entry, 'SKILL.md')))
        : []
      meta = { kind: 'legacy-install', at: name, names, legacy: true }
    }
    out.push({ id: name, root: join(root, name), meta })
  }
  // Newest first by recorded time; the random suffix is only a tiebreaker.
  out.sort((a, b) => String(b.meta.at ?? b.id).localeCompare(String(a.meta.at ?? a.id)) || b.id.localeCompare(a.id))
  return out
}

/**
 * Roll back to one snapshot, backing up the current state first.
 * @param {{stateDir: string, skillsDir: string, to?: string, dryRun?: boolean}} input
 */
export function rollback({ stateDir, skillsDir, to, dryRun = false }) {
  const backups = listBackups(stateDir)
  if (backups.length === 0) throw new SkillsError(`no backups under ${join(stateDir, 'backups')}`)
  // Default to the newest update snapshot. A rollback-backup exists only so a
  // rollback can itself be undone via an explicit --to id; it must not become
  // the implicit target of the next rollback.
  const defaultTarget = backups.find(item => item.meta.kind !== 'rollback-backup') ?? backups[0]
  const chosen = to === undefined ? defaultTarget : backups.find(item => item.id === to || item.id.startsWith(to))
  if (chosen === undefined) throw new SkillsError(`no backup matches ${JSON.stringify(to)}; use --list to see them`)
  const snapshotManifestPath = join(chosen.root, 'manifest.json')
  let snapshotManifest
  if (existsSync(snapshotManifestPath)) {
    snapshotManifest = readManifestAt(snapshotManifestPath)
  } else {
    // Compatibility migration for backups written by install-skills.mjs
    // before it recorded manifest.json/meta.json: reconstruct owned files from
    // the snapshot dirs, retaining current metadata for unchanged names.
    const currentManifest = readManifest(stateDir)
    const skills = { ...currentManifest.skills }
    const snapshotSkills = join(chosen.root, 'skills')
    if (existsSync(snapshotSkills)) {
      for (const name of readdirSync(snapshotSkills)) {
        const source = join(snapshotSkills, name)
        if (!existsSync(join(source, 'SKILL.md'))) continue
        const files = scanPackageFiles(source)
        skills[name] = {
          ...(skills[name] ?? {}),
          managedBy: 'legacy-installer-migrated',
          validated: false,
          files,
          digest: digestFromFiles(files),
        }
      }
    }
    snapshotManifest = { schema: MANIFEST_SCHEMA, managedBy: 'hyperai-skills-updater', skills }
  }
  const snapshotNames = Object.keys(snapshotManifest.skills)
  const current = readManifest(stateDir)
  const plan = { id: chosen.id, restore: [], remove: [], keep: [] }
  for (const name of snapshotNames) {
    const source = join(chosen.root, 'skills', name)
    if (existsSync(join(source, 'SKILL.md'))) plan.restore.push(name)
  }
  // Skills added after the snapshot are removed only when still unmodified.
  for (const name of Object.keys(current.skills)) {
    if (name in snapshotManifest.skills) continue
    const entry = normalizeEntry(current.skills[name])
    const target = join(skillsDir, name)
    const state = inspectLocal(target, entry)
    if (state.exists && state.modified.length === 0 && state.missing.length === 0) plan.remove.push(name)
    else plan.keep.push(name)
  }
  if (dryRun) return plan
  mkdirSync(join(stateDir, 'staging'), { recursive: true })
  // Back up the current state so rollback itself is reversible.
  const before = createSnapshot(stateDir, skillsDir, current, Object.keys(current.skills).filter(name => existsSync(join(skillsDir, name))))
  const beforeMetaPath = join(before.root, 'meta.json')
  try {
    const meta = JSON.parse(readFileSync(beforeMetaPath, 'utf8'))
    meta.kind = 'rollback-backup'
    meta.rollbackTo = chosen.id
    writeFileSync(beforeMetaPath, `${JSON.stringify(meta, undefined, 2)}\n`)
  } catch { /* best effort */ }
  for (const name of plan.restore) {
    const source = join(chosen.root, 'skills', name)
    const target = join(skillsDir, name)
    const trash = join(stateDir, 'staging', `rollback-${name}-${process.pid}`)
    rmSync(trash, { recursive: true, force: true })
    if (existsSync(target)) renameSync(target, trash)
    cpSync(source, target, { recursive: true })
    rmSync(trash, { recursive: true, force: true })
  }
  for (const name of plan.remove) rmSync(join(skillsDir, name), { recursive: true, force: true })
  writeManifest(stateDir, snapshotManifest)
  appendHistory(stateDir, { at: new Date().toISOString(), action: 'rollback', to: chosen.id, restored: plan.restore, removed: plan.remove, kept: plan.keep })
  return { ...plan, backupBefore: before.id }
}

/** Read a manifest from an explicit path (used for snapshot manifests). */
function readManifestAt(path) {
  let parsed
  try {
    parsed = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new SkillsError(`cannot parse ${path}: ${String(error)}`, error)
  }
  return {
    ...parsed,
    skills: parsed.skills !== null && typeof parsed.skills === 'object' && !Array.isArray(parsed.skills) ? parsed.skills : {},
  }
}

/** Build an offline catalog (no network): managed, legacy, user-installed, modified flags. */
export function catalog({ manifest, skillsDir }) {
  const local = listLocalSkillNames(skillsDir)
  const managed = []
  for (const [name, raw] of Object.entries(manifest.skills).sort(([a], [b]) => a.localeCompare(b))) {
    const entry = normalizeEntry(raw)
    const target = join(skillsDir, name)
    const state = inspectLocal(target, entry)
    const status = entry.legacyUnverified ? 'legacy-unverified' : state.modified.length > 0 || state.missing.length > 0 ? 'modified' : state.exists ? 'managed' : 'missing'
    managed.push({ name, status, version: entry.version, digest: entry.digest, files: Object.keys(entry.files).length, extras: state.extras })
  }
  const managedNames = new Set(Object.keys(manifest.skills))
  return { managed, localOnly: local.filter(name => !managedNames.has(name)) }
}
