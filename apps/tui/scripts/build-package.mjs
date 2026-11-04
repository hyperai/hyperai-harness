#!/usr/bin/env node
/**
 * RFC-001 PoC: build an installable HyperAI TUI product from a pristine upstream
 * package plus the committed branding patch.
 *
 * Unlike `build-patch.mjs` (which produces a pnpm patch that the user's machine
 * applies), this script produces a finished tarball: upstream package, branding
 * patch already applied, upstream licenses kept, HyperAI license added. The
 * three RFC-001 distribution paths differ only in the package name and in
 * whether the package's own self-references are rewritten:
 *
 *   p1  rename      name `@hyperai/hyperai-tui`, every runtime self-reference
 *                   to the upstream package name rewritten to the new name.
 *   p2  rename+alias name `@hyperai/hyperai-tui`, self-references left alone;
 *                   the profile installs it through an npm alias so that
 *                   `node_modules/@deepseek-harness-tui/dsh-tui` still exists.
 *   p3  tarball URL name and self-references unchanged; the profile pins the
 *                   tarball by URL.
 *
 * Usage:
 *   node scripts/build-package.mjs --upstream <tarball|dir> --mode <p1|p2|p3> --out <dir>
 *
 * `--upstream` is verified against `poc/upstream.json` (size, sha256 and the
 * npm integrity) before any build step runs, so an offline copy is provably the
 * pinned tarball. The output tarball is written to `--out` and is never
 * committed: it is ~18 MB, above this repository's binary limit.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** `apps/tui`. */
const PKG = resolve(HERE, '..')
const BRAND = JSON.parse(readFileSync(join(PKG, 'src', 'brand.json'), 'utf8'))
const TUI_PACKAGE = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'))
const UPSTREAM_RECORD = JSON.parse(readFileSync(join(PKG, 'poc', 'upstream.json'), 'utf8'))
const PATCH = join(PKG, 'patches', `dsh-tui@${BRAND.upstream.version}.patch`)
const LICENSES = join(PKG, 'docs', 'licenses')

/** HyperAI's own npm identity for the renamed paths. */
const PRODUCT_NAME = '@hyperai/hyperai-tui'

/**
 * The three RFC-001 products. `rename` runs the self-reference rewrite step and
 * `name` is the published package name.
 */
const MODES = {
  p1: { name: PRODUCT_NAME, rename: true, distribution: 'renamed' },
  p2: { name: PRODUCT_NAME, rename: false, distribution: 'renamed-alias' },
  p3: { name: BRAND.upstream.package, rename: false, distribution: 'tarball-url' },
}

/** Directories that are not part of the upstream source tree we rewrite. */
const SKIP_DIRS = new Set(['node_modules', '.git'])

/**
 * Run a command and return trimmed stdout.
 * @param {string} command - Executable.
 * @param {string[]} args - Arguments.
 * @param {object} [options] - execFileSync options.
 * @returns {string} Trimmed stdout.
 */
function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim()
}

/**
 * Hash a file with the given algorithm.
 * @param {string} path - File to hash.
 * @param {'sha256'|'sha512'} algorithm - Hash algorithm.
 * @param {'hex'|'base64'} encoding - Output encoding.
 * @returns {string} Digest.
 */
function hashFile(path, algorithm, encoding) {
  return createHash(algorithm).update(readFileSync(path)).digest(encoding)
}

/**
 * Refuse an upstream input that is not the pinned tarball.
 * @param {string} path - Tarball path.
 */
function assertPinnedTarball(path) {
  const size = statSync(path).size
  const sha256 = hashFile(path, 'sha256', 'hex')
  const integrity = `sha512-${hashFile(path, 'sha512', 'base64')}`
  if (size !== UPSTREAM_RECORD.sizeBytes) {
    throw new Error(`upstream tarball size ${size} != recorded ${UPSTREAM_RECORD.sizeBytes}`)
  }
  if (sha256 !== UPSTREAM_RECORD.sha256) throw new Error(`upstream tarball sha256 ${sha256} != recorded ${UPSTREAM_RECORD.sha256}`)
  if (integrity !== UPSTREAM_RECORD.integrity) throw new Error(`upstream tarball integrity ${integrity} != recorded ${UPSTREAM_RECORD.integrity}`)
}

/**
 * Unpack the pinned upstream tarball (or copy a pristine directory) into a
 * throwaway work tree.
 * @param {string} upstream - Tarball or pristine package directory.
 * @param {string} work - Work directory that will hold `package/`.
 * @returns {string} Extracted package root.
 */
function acquire(upstream, work) {
  const source = resolve(upstream)
  const target = join(work, 'package')
  if (statSync(source).isDirectory()) {
    const manifest = JSON.parse(readFileSync(join(source, 'package.json'), 'utf8'))
    assertUpstream(manifest)
    cpSync(source, target, { recursive: true, filter: path => !path.split(/[\\/]/u).includes('.git') })
    return target
  }
  assertPinnedTarball(source)
  mkdirSync(target, { recursive: true })
  run('tar', ['-xzf', source, '-C', target, '--strip-components', '1'])
  assertUpstream(JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')))
  return target
}

/**
 * Fail when the source package is not the pinned upstream package/version.
 * @param {{name?: string, version?: string}} manifest - Parsed package manifest.
 */
function assertUpstream(manifest) {
  if (manifest.name !== BRAND.upstream.package || manifest.version !== BRAND.upstream.version) {
    throw new Error(`expected ${BRAND.upstream.package}@${BRAND.upstream.version}, got ${manifest.name}@${manifest.version}`)
  }
}

/**
 * Apply the committed branding patch to the pristine package.
 * @param {string} dir - Package root.
 */
function applyBrandPatch(dir) {
  if (!existsSync(PATCH)) throw new Error(`missing branding patch ${PATCH}; run scripts/build-patch.mjs first`)
  run('git', ['apply', '--check', PATCH], { cwd: dir })
  run('git', ['apply', PATCH], { cwd: dir })
}

/**
 * List every regular file under a directory, as paths relative to it.
 * @param {string} root - Directory to walk.
 * @param {string} [dir] - Current directory (internal recursion).
 * @returns {string[]} Relative file paths.
 */
function listFiles(root, dir = root) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue
      out.push(...listFiles(root, join(dir, entry.name)))
    } else if (entry.isFile()) {
      out.push(relative(root, join(dir, entry.name)).split(sep).join('/'))
    }
  }
  return out
}

/**
 * Rewrite every runtime self-reference to the upstream package name.
 *
 * This is the P1-only step, deliberately separate from the branding patch: the
 * patch stays byte-identical to the committed one, and the rename is a whole
 * package pass so no module specifier, Cordis plugin row, setting manifest,
 * preset owner or user-facing update message keeps the unresolvable old name.
 *
 * The bare `@deepseek-harness-tui` scope also appears without the package name:
 * the plugin feed's `scope` field, and the standalone launcher's
 * `node_modules/@deepseek-harness-tui/dsh-tui` path segments. Rewriting only the
 * package name would leave those behind, so they have their own rules.
 * @param {string} dir - Package root.
 * @param {string} toName - Replacement package name.
 * @returns {{file: string, count: number}[]} Files changed, with hit counts.
 */
function renameSelfReferences(dir, toName) {
  const [toScope, toShortName] = toName.split('/')
  const rules = [
    [BRAND.upstream.package, toName],
    ["'@deepseek-harness-tui', 'dsh-tui'", `'${toScope}', '${toShortName}'`],
    ['"scope": "@deepseek-harness-tui"', `"scope": "@${toScope.slice(1)}"`],
  ]
  const changed = []
  for (const file of listFiles(dir)) {
    const path = join(dir, file)
    const buffer = readFileSync(path)
    if (!buffer.includes('@deepseek-harness-tui')) continue
    const text = buffer.toString('utf8')
    // A non-UTF-8 payload that happens to contain the bytes is binary art, not a
    // specifier; leave it alone rather than corrupting it.
    if (text.includes('\uFFFD')) continue
    let next = text
    let count = 0
    for (const [find, replace] of rules) {
      count += next.split(find).length - 1
      next = next.replaceAll(find, replace)
    }
    writeFileSync(path, next)
    changed.push({ file, count })
  }
  const remaining = listFiles(dir).filter(file => readFileSync(join(dir, file)).includes('@deepseek-harness-tui'))
  if (remaining.length > 0) throw new Error(`rename left the upstream name in: ${remaining.join(', ')}`)
  return changed
}

/** Copy the upstream third-party notices and the HyperAI license into the product. */
function addLicenses(dir) {
  const target = join(dir, 'licenses')
  mkdirSync(target, { recursive: true })
  for (const name of readdirSync(LICENSES).sort()) {
    cpSync(join(LICENSES, name), join(target, name))
  }
  cpSync(join(PKG, 'LICENSE'), join(dir, 'LICENSE-HYPERAI.txt'))
}

/**
 * Rewrite the product manifest: npm identity, HyperAI release metadata and the
 * added license directory.
 * @param {string} dir - Package root.
 * @param {{name: string, distribution: string, renamed: {file: string, count: number}[]}} mode - Build mode.
 * @returns {object} The written manifest.
 */
function rewriteManifest(dir, mode) {
  const path = join(dir, 'package.json')
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  manifest.name = mode.name
  // The package version stays the upstream version: the TUI's own version plate
  // and the peer ranges are keyed on it, and the HyperAI release is recorded
  // separately below.
  manifest.version = BRAND.upstream.version
  manifest.description = `HyperAI Harness branded terminal interface (RFC-001 PoC, ${mode.distribution}) based on ${BRAND.upstream.package}@${BRAND.upstream.version}`
  manifest.files = [...new Set([...(manifest.files ?? []), 'licenses', 'LICENSE-HYPERAI.txt'])]
  manifest.hyperai = {
    distribution: mode.distribution,
    tuiVersion: TUI_PACKAGE.version,
    upstreamPackage: BRAND.upstream.package,
    upstreamVersion: BRAND.upstream.version,
    selfReferencesRenamed: mode.renamed.length > 0,
    builtBy: 'apps/tui/scripts/build-package.mjs',
  }
  writeFileSync(path, `${JSON.stringify(manifest, undefined, 2)}\n`)
  return manifest
}

/**
 * Build one product.
 * @param {{upstream: string, mode: string, out: string}} options - CLI options.
 * @returns {object} Build summary for the CLI and for evidence capture.
 */
export function buildPackage({ upstream, mode, out }) {
  const config = MODES[mode]
  if (config === undefined) throw new Error(`unknown mode ${JSON.stringify(mode)}; expected p1, p2 or p3`)
  const work = mkdtempSync(join(tmpdir(), 'hyperai-tui-product-'))
  try {
    const dir = acquire(upstream, work)
    applyBrandPatch(dir)
    const renamed = config.rename ? renameSelfReferences(dir, config.name) : []
    addLicenses(dir)
    const manifest = rewriteManifest(dir, { ...config, renamed })
    mkdirSync(resolve(out), { recursive: true })
    // `--ignore-scripts`: upstream's `prepare` compiles from a source tree that is
    // not in the published package; the tarball is already built.
    const packed = run('npm', ['pack', '--ignore-scripts', '--pack-destination', resolve(out), '--silent'], { cwd: dir })
    // p1 and p2 share a package name and version but are different artifacts, so
    // every product carries its path in the file name.
    const packedPath = join(resolve(out), packed.split('\n').pop())
    const tarball = packedPath.replace(/\.tgz$/u, `-${mode}.tgz`)
    renameSync(packedPath, tarball)
    assertProductName(tarball, config.name)
    return {
      mode,
      distribution: config.distribution,
      package: manifest.name,
      version: manifest.version,
      tuiVersion: manifest.hyperai.tuiVersion,
      upstreamVersion: manifest.hyperai.upstreamVersion,
      renamedFiles: renamed,
      tarball,
      sizeBytes: statSync(tarball).size,
      sha256: hashFile(tarball, 'sha256', 'hex'),
      integrity: `sha512-${hashFile(tarball, 'sha512', 'base64')}`,
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/**
 * Read the packed tarball back and confirm it carries the expected name.
 * @param {string} tarball - Built product tarball.
 * @param {string} expectedName - Expected package name.
 */
function assertProductName(tarball, expectedName) {
  const listing = run('tar', ['-xzOf', tarball, 'package/package.json'])
  const manifest = JSON.parse(listing)
  if (manifest.name !== expectedName) throw new Error(`product manifest name ${manifest.name} != ${expectedName}`)
  if (!manifest.hyperai || manifest.hyperai.upstreamVersion === undefined) throw new Error('product manifest is missing hyperai metadata')
}

/** Parse CLI arguments. */
function parseArgs(argv) {
  const args = { upstream: undefined, mode: undefined, out: undefined }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--upstream') args.upstream = argv[++index]
    else if (arg === '--mode') args.mode = argv[++index]
    else if (arg === '--out') args.out = argv[++index]
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write('usage: node scripts/build-package.mjs --upstream <tarball|dir> --mode <p1|p2|p3> --out <dir>\n')
      process.exit(0)
    } else throw new Error(`unknown argument ${JSON.stringify(arg)}`)
  }
  if (args.upstream === undefined || args.mode === undefined || args.out === undefined) {
    throw new Error('--upstream, --mode and --out are required')
  }
  return args
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = parseArgs(process.argv.slice(2))
  const result = buildPackage(args)
  process.stdout.write(`${JSON.stringify(result, undefined, 2)}\n`)
}
