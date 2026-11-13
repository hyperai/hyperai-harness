#!/usr/bin/env node
/**
 * Build the internal-beta installation package.
 *
 * One command produces everything a colleague needs:
 *
 *   dist/hyperai-harness-0.2.0-beta.1.tar.gz
 *   dist/hyperai-harness-0.2.0-beta.1.tar.gz.sha256
 *
 * The bundle contains the pre-built, renamed TUI product tarball, the profile
 * installer (bundle-aware), a pinned Skills snapshot and a Chinese README.
 * Nothing in it is committed: `apps/profiles/hyperai/dist/` is git-ignored, and
 * the Skills snapshot comes from the internal repository, which must never
 * appear in the public Harness repository.
 *
 *   node scripts/build-beta.mjs [--out <dir>] [--upstream <tarball>]
 *                               [--skills-repo <url>] [--skills-ref <sha>]
 *                               [--commit <sha>]
 *
 * --upstream skips the registry download by reusing an already verified tarball
 * (see apps/tui/upstream.json). Without it the pinned tarball is fetched with
 * `npm pack` and verified by apps/tui/scripts/build-package.mjs.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { basename, dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { buildPackage, listFiles, writeDeterministicTarball } from '../../../tui/scripts/build-package.mjs'
import { brand } from './distribution.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
/** `apps/profiles/hyperai`. */
const PKG = resolve(HERE, '..')
/** Repository root. */
const REPO = resolve(PKG, '..', '..', '..')
const BRAND = brand()
const TUI_PACKAGE = JSON.parse(readFileSync(join(REPO, 'apps/tui/package.json'), 'utf8'))
const UPSTREAM = JSON.parse(readFileSync(join(REPO, 'apps/tui/upstream.json'), 'utf8'))

/** Runtime versions pinned for the internal beta (validated by RFC-001/002). */
const DSH_VERSION = '0.2.0-rc.2'
const PNPM_VERSION = '10.28.1'
/** Skills source for this beta. */
const SKILLS_REPO = 'https://github.com/hyperai/hyperai-skills.git'
const SKILLS_REF = '34f0a1be0cb3ae9905aecebba13efae6a8657be1'
const SKILLS_BRANCH = 'feat/ppt-generation-upstream'
const SKILL_NAMES = ['ppt-generation', 'example-verified-skill']

/** Profile files copied from the repository template into the bundle. */
const PROFILE_FILES = [
  'LICENSE',
  'cordis.patch.yml',
  'pnpm-workspace.yaml',
  'scripts/install.mjs',
  'scripts/update-lib.mjs',
  'scripts/update.mjs',
  'scripts/install-skills.mjs',
  'scripts/manage.mjs',
  'scripts/preflight.mjs',
  'scripts/skills-lib.mjs',
  'scripts/skills-update.mjs',
  'scripts/distribution.mjs',
]

/** Run a command and return trimmed stdout. */
function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim()
}

/** sha256 of one file. */
function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** Current commit, or an explicit override. */
function resolveCommit(explicit) {
  if (explicit !== undefined) return explicit
  try {
    const full = run('git', ['-C', REPO, 'rev-parse', 'HEAD'])
    const dirty = run('git', ['-C', REPO, 'status', '--porcelain']).length > 0 ? '+dirty' : ''
    return `${full}${dirty}`
  } catch {
    return 'unknown'
  }
}

/** Fetch the pinned upstream tarball when the caller did not provide one. */
function acquireUpstream(explicit, cacheDir) {
  if (explicit !== undefined) return resolve(explicit)
  mkdirSync(cacheDir, { recursive: true })
  const name = run('npm', ['pack', `${UPSTREAM.package}@${UPSTREAM.version}`, '--pack-destination', cacheDir, '--silent'])
  return join(cacheDir, name.split('\n').pop())
}

/**
 * Materialize the pinned Skills snapshot.
 *
 * Only `skills/` is copied: `inbox/` candidates are excluded by decision, and
 * the repository's docs/tests never reach the public bundle.
 */
function fetchSkills(dest) {
  const work = mkdtempSync(join(tmpdir(), 'hyperai-skills-build-'))
  try {
    run('git', ['clone', '--quiet', '--filter=blob:none', '--no-checkout', SKILLS_REPO, work], { stdio: ['ignore', 'pipe', 'pipe'] })
    run('git', ['-C', work, 'checkout', '--quiet', '--detach', SKILLS_REF])
    const head = run('git', ['-C', work, 'rev-parse', 'HEAD'])
    if (head !== SKILLS_REF) throw new Error(`skills checkout is at ${head}, expected ${SKILLS_REF}`)
    const source = join(work, 'skills')
    const names = readdirSync(source, { withFileTypes: true }).filter(entry => entry.isDirectory()).map(entry => entry.name).sort()
    const missing = SKILL_NAMES.filter(name => !names.includes(name))
    if (missing.length > 0) throw new Error(`skills/${missing.join(', ')} missing at ${SKILLS_REF}`)
    mkdirSync(join(dest, 'skills'), { recursive: true })
    for (const name of SKILL_NAMES) cpSync(join(source, name), join(dest, 'skills', name), { recursive: true })
    const files = listFiles(dest)
    const digest = createHash('sha256')
    for (const file of files) digest.update(`${file}\0${sha256(join(dest, file))}\n`)
    writeFileSync(join(dest, 'SNAPSHOT.json'), `${JSON.stringify({
      repository: SKILLS_REPO,
      ref: SKILLS_REF,
      channel: SKILLS_BRANCH,
      prerelease: true,
      area: 'skills',
      excluded: ['inbox'],
      skills: SKILL_NAMES,
      fileCount: files.length,
      contentDigest: `sha256:${digest.digest('hex')}`,
    }, undefined, 2)}\n`)
    return { names: SKILL_NAMES, fileCount: files.length }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/** Write the profile template used inside the bundle. */
function writeBundleProfile(dir, { version, upstreamVersion }) {
  const tarballName = `hyperai-tui-${version}.tgz`
  const manifest = {
    name: 'dsh-profile-hyperai',
    private: true,
    dependencies: { '@hyperai/hyperai-tui': `file:packages/${tarballName}` },
    dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@hyperai/hyperai-tui'] } },
  }
  writeFileSync(join(dir, 'package.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
  writeFileSync(join(dir, 'pnpm-workspace.yaml'), [
    '# hyperai profile pnpm workspace for the internal-beta installation package.',
    '# One package (the profile itself) with hoisted node_modules so the dsh',
    '# loader resolves the TUI bundle from the profile root. The TUI arrives as',
    '# a pre-built `file:` tarball, so there is no patchedDependencies block.',
    'packages:',
    '  - .',
    '',
    'nodeLinker: hoisted',
    'autoInstallPeers: false',
    '',
  ].join('\n'))
  writeFileSync(join(dir, 'tui-meta.json'), `${JSON.stringify({
    name: '@hyperai/hyperai-tui',
    version,
    upstreamVersion,
  }, undefined, 2)}\n`)
  writeFileSync(join(dir, 'brand.json'), `${JSON.stringify(BRAND, undefined, 2)}\n`)
  writeFileSync(join(dir, 'skills.lock.json'), `${JSON.stringify({
    $comment: 'Internal-beta Skills snapshot. The commit is pinned; the source is the bundled skills/ directory, so installation never contacts GitHub.',
    schema: 1,
    repository: SKILLS_REPO,
    ref: SKILLS_REF,
    channel: SKILLS_BRANCH,
    prerelease: true,
    verified: SKILL_NAMES.map(name => ({ name, area: 'skills', validated: true })),
    unverified: [],
  }, undefined, 2)}\n`)
}

/** Per-file manifest for the bundle. */
function writeManifest(bundleRoot, meta) {
  const files = listFiles(bundleRoot).filter(file => file !== 'MANIFEST.json')
  const manifest = {
    schema: 1,
    product: 'HyperAI Harness',
    version: meta.version,
    distribution: 'internal-beta',
    commit: meta.commit,
    components: {
      tui: {
        name: '@hyperai/hyperai-tui',
        version: meta.version,
        upstreamPackage: UPSTREAM.package,
        upstreamVersion: UPSTREAM.version,
        sha256: meta.tui.sha256,
        fileCount: meta.tui.fileCount,
      },
      dsh: { name: '@deepseek-ai/dsh', version: DSH_VERSION },
      pnpm: { version: PNPM_VERSION },
      skills: {
        repository: SKILLS_REPO,
        ref: SKILLS_REF,
        channel: SKILLS_BRANCH,
        prerelease: true,
        names: SKILL_NAMES,
      },
    },
    install: { entry: 'install.sh', node: '^22.19 || >=24', platforms: ['darwin-arm64', 'linux-x64'] },
    files: files.map(file => ({
      path: file,
      size: statSync(join(bundleRoot, file)).size,
      sha256: sha256(join(bundleRoot, file)),
    })),
  }
  writeFileSync(join(bundleRoot, 'MANIFEST.json'), `${JSON.stringify(manifest, undefined, 2)}\n`)
  return manifest
}

/** Parse CLI arguments. */
function parseArgs(argv) {
  const args = {
    out: join(PKG, 'dist'),
    upstream: undefined,
    skillsRepo: undefined,
    skillsRef: undefined,
    commit: undefined,
  }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--out') args.out = resolve(argv[++index])
    else if (arg === '--upstream') args.upstream = resolve(argv[++index])
    else if (arg === '--skills-repo') args.skillsRepo = argv[++index]
    else if (arg === '--skills-ref') args.skillsRef = argv[++index]
    else if (arg === '--commit') args.commit = argv[++index]
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write('usage: node scripts/build-beta.mjs [--out <dir>] [--upstream <tarball>] [--commit <sha>]\n')
      process.exit(0)
    } else throw new Error(`unknown argument ${JSON.stringify(arg)}`)
  }
  return args
}

/** Build the installation package. */
export function buildBeta(args = parseArgs([])) {
  if (args.skillsRepo !== undefined || args.skillsRef !== undefined) {
    throw new Error('this beta pins the skills source in build-beta.mjs; --skills-repo/--skills-ref are intentionally unsupported')
  }
  const version = TUI_PACKAGE.version
  const commit = resolveCommit(args.commit)
  const out = args.out
  mkdirSync(out, { recursive: true })
  const bundleName = `hyperai-harness-${version}`
  const staging = join(out, '.staging')
  rmSync(staging, { recursive: true, force: true })
  const bundleRoot = join(staging, bundleName)
  mkdirSync(bundleRoot, { recursive: true })

  const upstream = acquireUpstream(args.upstream, join(out, '.cache', UPSTREAM.version))
  // Build twice: RFC-002 requires the same commit to produce the same sha256.
  const tui = buildPackage({ upstream, out: join(staging, 'tui-build'), commit })
  const tuiAgain = buildPackage({ upstream, out: join(staging, 'tui-build-again'), commit })
  if (tui.sha256 !== tuiAgain.sha256) throw new Error(`TUI build is not reproducible: ${tui.sha256} != ${tuiAgain.sha256}`)

  mkdirSync(join(bundleRoot, 'tui'), { recursive: true })
  cpSync(tui.tarball, join(bundleRoot, 'tui', basename(tui.tarball)))

  const profileDir = join(bundleRoot, 'profile')
  mkdirSync(profileDir, { recursive: true })
  for (const file of PROFILE_FILES) {
    cpSync(join(PKG, file), join(profileDir, file))
  }
  writeBundleProfile(profileDir, { version, upstreamVersion: UPSTREAM.version })

  const skills = fetchSkills(join(bundleRoot, 'skills'))
  cpSync(join(PKG, 'scripts', 'install.sh'), join(bundleRoot, 'install.sh'))
  execFileSync('chmod', ['755', join(bundleRoot, 'install.sh')])
  cpSync(join(PKG, 'docs', 'beta-install.md'), join(bundleRoot, 'README.md'))

  const manifest = writeManifest(bundleRoot, { version, commit, tui })

  const archive = join(out, `${bundleName}.tar.gz`)
  writeDeterministicTarball(bundleRoot, archive, bundleName)
  writeFileSync(`${archive}.sha256`, `${sha256(archive)}  ${basename(archive)}\n`)

  const report = {
    bundle: archive,
    sha256: sha256(archive),
    sizeBytes: statSync(archive).size,
    version,
    commit,
    tui: { sha256: tui.sha256, sizeBytes: tui.sizeBytes, fileCount: tui.fileCount, renamedFiles: tui.renamedFiles.length },
    skills: { ref: SKILLS_REF, channel: SKILLS_BRANCH, ...skills },
    components: { dsh: DSH_VERSION, pnpm: PNPM_VERSION },
    manifestFileCount: manifest.files.length,
  }
  writeFileSync(join(out, 'build-report.json'), `${JSON.stringify(report, undefined, 2)}\n`)
  rmSync(staging, { recursive: true, force: true })
  return report
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
  const report = buildBeta(parseArgs(process.argv.slice(2)))
  process.stdout.write(`${JSON.stringify(report, undefined, 2)}\n`)
}
