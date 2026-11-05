#!/usr/bin/env node
/**
 * Build the HyperAI TUI distribution tarball from a pristine upstream package.
 *
 * This is the RFC-002 (P1) product builder: it takes the pinned upstream
 * `@deepseek-harness-tui/dsh-tui` tarball, verifies its bytes, applies the
 * committed branding patch, renames the package to `@hyperai/hyperai-tui`,
 * rewrites every runtime self-reference, and repacks deterministically.
 *
 * Two properties make this safe to publish to colleagues:
 *
 *   - Content is an explicit set, not whatever `npm pack` decides. The product
 *     file set must equal the upstream tarball's file set plus the documented
 *     additions, so an upstream packaging change cannot silently drop files
 *     (RFC-001 lost `vendor/` this way).
 *   - Legal material is exempt from the rename: `LICENSE*`, `licenses/`, the
 *     upstream README/guide and every copyright line stay byte-identical. The
 *     builder asserts that, instead of trusting a global string replace.
 *
 * Usage:
 *   node scripts/build-package.mjs --upstream <tarball> --out <dir> [--commit <sha>]
 *   node scripts/build-package.mjs --upstream <tarball> --out <dir> --verify-reproducible
 *
 * Output: `<out>/hyperai-tui-<version>.tgz` plus `<out>/build-report.json`.
 */
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync, realpathSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { gzipSync } from 'node:zlib'

const HERE = dirname(fileURLToPath(import.meta.url))
/** `apps/tui`. */
const PKG = resolve(HERE, '..')
const BRAND = JSON.parse(readFileSync(join(PKG, 'src', 'brand.json'), 'utf8'))
const TUI_PACKAGE = JSON.parse(readFileSync(join(PKG, 'package.json'), 'utf8'))
const UPSTREAM = JSON.parse(readFileSync(join(PKG, 'upstream.json'), 'utf8'))
const PATCH = join(PKG, 'patches', `dsh-tui@${BRAND.upstream.version}.patch`)
const LICENSE_DIR = join(PKG, 'docs', 'licenses')

/** The product identity published to colleagues. */
export const PRODUCT_NAME = '@hyperai/hyperai-tui'
/** Repository the product metadata points at (not the upstream project). */
const PRODUCT_REPO = 'https://github.com/hyperai/hyperai-harness'

/**
 * Files whose self-references are rewritten. Everything else is either legal /
 * documentation material that must stay byte-identical, bundled dependencies
 * that never reference the host package, or binary assets.
 */
export const RUNTIME_SELF_REFERENCE_FILES = [
  'bin/dsh-tui.js',
  'cordis.yml',
  'cordis.patch.yml',
  'lib/settings.json',
  'lib/types/adapter/standard/descriptor.js',
  'lib/types/dsh-adapter/entry-slot.js',
  'lib/types/dsh-adapter/invariant.js',
  'lib/types/dsh-adapter/oauth/deepseek.js',
  'lib/types/dsh-adapter/packaged-presets.js',
  'lib/types/dsh-adapter/plugin-declaration.js',
  'lib/types/preset-patch.js',
  'lib/types/update.js',
  'lib/types/i18n.js',
  'presets/liangshen/.dsh-tui-managed.json',
  'tui-profile/feed/first-party.json',
]

/** Files added by this build; nothing else may appear in the product. */
const ADDED_FILES = [
  'LICENSE-HYPERAI.txt',
  'HYPERAI.md',
  ...readdirSync(LICENSE_DIR).sort().map(name => `licenses/${name}`),
]

/** Run a command and return trimmed stdout. */
function run(command, args, options = {}) {
  return execFileSync(command, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...options }).trim()
}

/** Hash a file. */
function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** Hash a buffer. */
function sha256Buffer(buffer) {
  return createHash('sha256').update(buffer).digest('hex')
}

/** Every regular file under `root`, as sorted POSIX-style relative paths. */
export function listFiles(root, dir = root) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listFiles(root, path))
    else if (entry.isFile()) out.push(relative(root, path).split(sep).join('/'))
    else throw new Error(`unsupported entry type in package tree: ${path}`)
  }
  return out.sort()
}

/** Refuse an upstream input that is not the pinned tarball. */
export function assertPinnedUpstream(path) {
  const size = statSync(path).size
  if (size !== UPSTREAM.sizeBytes) throw new Error(`upstream size ${size} != pinned ${UPSTREAM.sizeBytes}`)
  const digest = sha256(path)
  if (digest !== UPSTREAM.sha256) throw new Error(`upstream sha256 ${digest} != pinned ${UPSTREAM.sha256}`)
  const integrity = `sha512-${createHash('sha512').update(readFileSync(path)).digest('base64')}`
  if (integrity !== UPSTREAM.integrity) throw new Error(`upstream integrity ${integrity} != pinned ${UPSTREAM.integrity}`)
}

/** Unpack the pinned tarball into a throwaway work directory. */
function acquire(upstream, work) {
  const source = resolve(upstream)
  if (!existsSync(source)) throw new Error(`upstream tarball not found: ${source}`)
  assertPinnedUpstream(source)
  const pristine = join(work, 'pristine')
  mkdirSync(pristine, { recursive: true })
  run('tar', ['-xzf', source, '-C', pristine, '--strip-components', '1'])
  const manifest = JSON.parse(readFileSync(join(pristine, 'package.json'), 'utf8'))
  if (manifest.name !== BRAND.upstream.package || manifest.version !== BRAND.upstream.version) {
    throw new Error(`expected ${BRAND.upstream.package}@${BRAND.upstream.version}, got ${manifest.name}@${manifest.version}`)
  }
  return pristine
}

/** Apply the committed branding patch to a copy of the pristine package. */
function applyBrandPatch(dir) {
  if (!existsSync(PATCH)) throw new Error(`missing branding patch ${PATCH}; run scripts/build-patch.mjs first`)
  run('git', ['apply', '--check', PATCH], { cwd: dir })
  run('git', ['apply', PATCH], { cwd: dir })
}

/**
 * Rewrite the runtime self-references to the HyperAI package name.
 * @returns {{file: string, count: number}[]} rewritten files with hit counts.
 */
function renameSelfReferences(dir) {
  const from = BRAND.upstream.package
  const [scope, shortName] = PRODUCT_NAME.split('/')
  const rules = [
    [from, PRODUCT_NAME],
    ["'@deepseek-harness-tui', 'dsh-tui'", `'${scope}', '${shortName}'`],
    ['"scope": "@deepseek-harness-tui"', `"scope": "${scope}"`],
  ]
  const changed = []
  for (const file of RUNTIME_SELF_REFERENCE_FILES) {
    const path = join(dir, file)
    if (!existsSync(path)) throw new Error(`runtime self-reference file is missing from upstream: ${file}`)
    const original = readFileSync(path, 'utf8')
    let next = original
    let count = 0
    for (const [find, replace] of rules) {
      count += next.split(find).length - 1
      next = next.replaceAll(find, replace)
    }
    if (count === 0) throw new Error(`no self-reference found in ${file}; the rename list is stale`)
    writeFileSync(path, next)
    changed.push({ file, count })
  }
  const leftover = changed.filter(entry => readFileSync(join(dir, entry.file), 'utf8').includes(from))
  if (leftover.length > 0) throw new Error(`self-references remain in: ${leftover.map(entry => entry.file).join(', ')}`)
  return changed
}

/** Copy the legal material and the HyperAI note into the product. */
function addProductFiles(dir, { commit }) {
  cpSync(join(PKG, 'LICENSE'), join(dir, 'LICENSE-HYPERAI.txt'))
  mkdirSync(join(dir, 'licenses'), { recursive: true })
  for (const name of readdirSync(LICENSE_DIR).sort()) cpSync(join(LICENSE_DIR, name), join(dir, 'licenses', name))
  writeFileSync(join(dir, 'HYPERAI.md'), [
    '# HyperAI Harness 终端界面（hyperai-tui）',
    '',
    `这是 HyperAI 构建的终端界面，版本 ${TUI_PACKAGE.version}，基于上游`,
    `[\`${BRAND.upstream.package}@${BRAND.upstream.version}\`](${UPSTREAM.repository}) 修改。`,
    '',
    '本包已经打好 HyperAI 品牌补丁，使用时不经过补丁机制。',
    '',
    `- 产品仓库：${PRODUCT_REPO}`,
    `- 上游版本：${BRAND.upstream.version}（记录在 package.json 的 \`hyperai.upstreamVersion\`）`,
    '- 上游许可证：MIT，见 `LICENSE`；第三方许可证见 `licenses/`；HyperAI 部分见 `LICENSE-HYPERAI.txt`。',
    `- 构建所用提交：${commit ?? 'unknown'}`,
    '',
  ].join('\n'))
}

/**
 * Align version metadata that belongs to the product, not to upstream.
 *
 * Two data files describe the package's own version and are renamed but not
 * versioned by the string rewrite. Both are consumed by update/catalog paths
 * (disabled in this build) and by adapter handshakes, so they must claim the
 * HyperAI release instead of the upstream one.
 * @returns {{file: string, field: string}[]} aligned fields.
 */
function alignVersionMetadata(dir, version) {
  const aligned = []
  const feedPath = join(dir, 'tui-profile', 'feed', 'first-party.json')
  const feed = JSON.parse(readFileSync(feedPath, 'utf8'))
  for (const entry of feed.entries) {
    if (entry.name !== PRODUCT_NAME) continue
    entry.version = version
    aligned.push({ file: 'tui-profile/feed/first-party.json', field: `entries[${entry.name}].version` })
  }
  writeFileSync(feedPath, `${JSON.stringify(feed, undefined, 2)}\n`)

  const settingsPath = join(dir, 'lib', 'settings.json')
  const settings = JSON.parse(readFileSync(settingsPath, 'utf8'))
  if (settings.package === PRODUCT_NAME) {
    settings.packageVersion = version
    aligned.push({ file: 'lib/settings.json', field: 'packageVersion' })
  }
  writeFileSync(settingsPath, `${JSON.stringify(settings, undefined, 2)}\n`)
  const feedAfter = JSON.parse(readFileSync(feedPath, 'utf8'))
  const settingsAfter = JSON.parse(readFileSync(settingsPath, 'utf8'))
  if (feedAfter.entries.some(entry => entry.name === PRODUCT_NAME && entry.version !== version)) {
    throw new Error('plugin feed still advertises a foreign version')
  }
  if (settingsAfter.package === PRODUCT_NAME && settingsAfter.packageVersion !== version) {
    throw new Error('settings manifest still advertises a foreign version')
  }
  return aligned
}

/**
 * Rewrite the product manifest: identity, versions and project metadata.
 * Upstream `repository`/`homepage`/`bugs` point at the upstream project, which
 * would be wrong for a package we publish, so they are replaced explicitly
 * instead of through the self-reference rename.
 */
function rewriteManifest(dir, { commit }) {
  const path = join(dir, 'package.json')
  const manifest = JSON.parse(readFileSync(path, 'utf8'))
  manifest.name = PRODUCT_NAME
  manifest.version = TUI_PACKAGE.version
  manifest.description = `基于 ${BRAND.upstream.package} ${BRAND.upstream.version} 修改的 HyperAI Harness 终端界面（HyperAI 内测版）`
  manifest.repository = { type: 'git', url: `${PRODUCT_REPO}.git` }
  manifest.homepage = `${PRODUCT_REPO}#readme`
  manifest.bugs = { url: `${PRODUCT_REPO}/issues` }
  manifest.files = [...new Set([...(manifest.files ?? []), 'licenses', 'LICENSE-HYPERAI.txt', 'HYPERAI.md'])]
  manifest.hyperai = {
    distribution: 'internal-beta',
    upstreamPackage: BRAND.upstream.package,
    upstreamVersion: BRAND.upstream.version,
    builtFromCommit: commit ?? null,
    builtBy: 'apps/tui/scripts/build-package.mjs',
  }
  writeFileSync(path, `${JSON.stringify(manifest, undefined, 2)}\n`)
  return manifest
}

/** Copyright lines must survive the rename untouched. */
function copyrightLines(text) {
  return text.split('\n').filter(line => /copyright/iu.test(line)).join('\n')
}

/** Emit one ustar header block. */
function tarHeader(name, { size, mode, type = '0', linkname = '' }) {
  const header = Buffer.alloc(512)
  let prefix = ''
  if (Buffer.byteLength(name) > 100) {
    const split = name.lastIndexOf('/')
    if (split === -1) throw new Error(`tar path too long without a directory: ${name}`)
    prefix = name.slice(0, split)
    name = name.slice(split + 1)
    if (Buffer.byteLength(name) > 100 || Buffer.byteLength(prefix) > 155) throw new Error(`tar path too long: ${prefix}/${name}`)
  }
  const octal = (value, length) => `${value.toString(8).padStart(length - 1, '0')}\0`
  header.write(name, 0, 100, 'utf8')
  header.write(octal(mode, 8), 100, 8, 'ascii')
  header.write(octal(0, 8), 108, 8, 'ascii')
  header.write(octal(0, 8), 116, 8, 'ascii')
  header.write(octal(size, 12), 124, 12, 'ascii')
  header.write(octal(0, 12), 136, 12, 'ascii')
  header.fill(' ', 148, 156)
  header.write(type, 156, 1, 'ascii')
  header.write(linkname, 157, 100, 'utf8')
  header.write('ustar\0', 257, 6, 'ascii')
  header.write('00', 263, 2, 'ascii')
  header.write('root', 265, 32, 'ascii')
  header.write('root', 297, 32, 'ascii')
  header.write(octal(0, 8), 329, 8, 'ascii')
  header.write(octal(0, 8), 337, 8, 'ascii')
  header.write(prefix, 345, 155, 'utf8')
  let sum = 0
  for (const byte of header) sum += byte
  header.write(`${sum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii')
  return header
}

/**
 * Write a deterministic npm-style tarball (`package/` prefix).
 *
 * Determinism is a requirement (RFC-002 5.1.6): entries are sorted, mtime is 0,
 * uid/gid are 0 and gzip carries no timestamp or original file name. `npm pack`
 * is not used because it derives the file set from `files`/`.npmignore` rules,
 * which is exactly the implicit behaviour this build must not depend on.
 */
export function writeDeterministicTarball(root, outFile, prefix = 'package') {
  const chunks = []
  for (const file of listFiles(root)) {
    const path = join(root, file)
    const stat = statSync(path)
    const body = readFileSync(path)
    const name = `${prefix}/${file}`
    chunks.push(tarHeader(name, { size: body.length, mode: (stat.mode & 0o111) !== 0 ? 0o755 : 0o644 }))
    chunks.push(body)
    const padding = (512 - (body.length % 512)) % 512
    if (padding > 0) chunks.push(Buffer.alloc(padding))
  }
  chunks.push(Buffer.alloc(1024))
  const gzipped = gzipSync(Buffer.concat(chunks), { level: 9 })
  writeFileSync(outFile, gzipped)
  return outFile
}

/**
 * Build the product.
 * @param {{upstream: string, out: string, commit?: string}} options build inputs.
 * @returns {object} Build report.
 */
export function buildPackage({ upstream, out, commit }) {
  const work = mkdtempSync(join(tmpdir(), 'hyperai-tui-build-'))
  const productRoot = join(work, 'product')
  try {
    const pristine = acquire(upstream, work)
    const pristineFiles = listFiles(pristine)
    cpSync(pristine, productRoot, { recursive: true })
    applyBrandPatch(productRoot)

    // Everything above this point is either upstream bytes or the committed
    // branding patch. The rename must not touch anything else, so the patched
    // tree is the reference for the exemption assertions below.
    const patchedFiles = listFiles(productRoot)
    const patchedBytes = new Map(patchedFiles.map(file => [file, readFileSync(join(productRoot, file))]))
    const renamed = renameSelfReferences(productRoot)
    const versionMetadata = alignVersionMetadata(productRoot, TUI_PACKAGE.version)
    addProductFiles(productRoot, { commit })
    const manifest = rewriteManifest(productRoot, { commit })

    // 1. Legal / documentation material is byte-identical to the patched tree.
    const exempt = patchedFiles.filter(file => !RUNTIME_SELF_REFERENCE_FILES.includes(file) && file !== 'package.json')
    for (const file of exempt) {
      const before = patchedBytes.get(file)
      const after = readFileSync(join(productRoot, file))
      if (!before.equals(after)) throw new Error(`exempt file changed: ${file}`)
    }
    // 2. Copyright lines survive inside rewritten files.
    for (const { file } of renamed) {
      const before = patchedBytes.get(file).toString('utf8')
      const after = readFileSync(join(productRoot, file), 'utf8')
      if (copyrightLines(before) !== copyrightLines(after)) throw new Error(`copyright line changed in ${file}`)
    }
    // 3. Upstream repository/author URLs are untouched anywhere in the tree.
    // package.json metadata (repository/homepage/bugs) is replaced on purpose
    // for the new package identity; attribution stays in `author` and licenses.
    const upstreamUrls = bytes => [...bytes.entries()]
      .filter(([file]) => file !== 'package.json')
      .map(([, buffer]) => buffer)
      .flatMap(buffer => buffer.toString('utf8').match(/https?:\/\/[^\s"'`)]+/gu) ?? [])
      .filter(url => url.includes('ccch1mneyyy'))
      .sort()
    const finalBytes = new Map(listFiles(productRoot).map(file => [file, readFileSync(join(productRoot, file))]))
    const beforeUrls = [...new Set(upstreamUrls(patchedBytes))].sort()
    const afterUrls = [...new Set(upstreamUrls(finalBytes))].sort()
    if (JSON.stringify(beforeUrls) !== JSON.stringify(afterUrls)) {
      const removed = beforeUrls.filter(url => !afterUrls.includes(url))
      const added = afterUrls.filter(url => !beforeUrls.includes(url))
      throw new Error(`an upstream repository/author URL changed during the build (removed: ${removed.join(' ') || 'none'}; added: ${added.join(' ') || 'none'})`)
    }
    if (manifest.repository.url !== `${PRODUCT_REPO}.git`) throw new Error('product repository metadata is wrong')
    if (manifest.author?.url !== 'https://github.com/ccch1mneyyy') throw new Error('upstream author attribution was dropped')
    // 4. Explicit product file set = upstream set + documented additions.
    const productFiles = listFiles(productRoot)
    const expected = [...patchedFiles, ...ADDED_FILES].sort()
    const missing = expected.filter(file => !productFiles.includes(file))
    const unexpected = productFiles.filter(file => !expected.includes(file))
    if (missing.length > 0) throw new Error(`product is missing files: ${missing.join(', ')}`)
    if (unexpected.length > 0) throw new Error(`product has unexpected files: ${unexpected.join(', ')}`)
    // 5. The upstream published tree is preserved as-is, including `vendor/`
    //    (RFC-001 lost it because npm pack decided the file set).
    for (const file of pristineFiles) {
      if (!productFiles.includes(file)) throw new Error(`upstream file dropped from the product: ${file}`)
    }
    if (!productFiles.some(file => file.startsWith('vendor/'))) throw new Error('vendor/ must be preserved explicitly')

    mkdirSync(resolve(out), { recursive: true })
    const tarball = join(resolve(out), `hyperai-tui-${manifest.version}.tgz`)
    writeDeterministicTarball(productRoot, tarball)
    const bytes = readFileSync(tarball)
    return {
      product: manifest.name,
      version: manifest.version,
      upstreamPackage: BRAND.upstream.package,
      upstreamVersion: BRAND.upstream.version,
      tarball,
      sizeBytes: bytes.length,
      sha256: sha256Buffer(bytes),
      integrity: `sha512-${createHash('sha512').update(bytes).digest('base64')}`,
      fileCount: productFiles.length,
      upstreamFileCount: pristineFiles.length,
      addedFiles: ADDED_FILES,
      renamedFiles: renamed,
      versionMetadata,
      preservedTopLevel: ['vendor', 'node_modules', 'guide'],
    }
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

/** Parse CLI arguments. */
function parseArgs(argv) {
  const args = { upstream: undefined, out: undefined, commit: undefined, verifyReproducible: false }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === '--upstream') args.upstream = argv[++index]
    else if (arg === '--out') args.out = argv[++index]
    else if (arg === '--commit') args.commit = argv[++index]
    else if (arg === '--verify-reproducible') args.verifyReproducible = true
    else if (arg === '--help' || arg === '-h') {
      process.stdout.write('usage: node scripts/build-package.mjs --upstream <tarball> --out <dir> [--commit <sha>] [--verify-reproducible]\n')
      process.exit(0)
    } else throw new Error(`unknown argument ${JSON.stringify(arg)}`)
  }
  if (args.upstream === undefined || args.out === undefined) throw new Error('--upstream and --out are required')
  return args
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
  const args = parseArgs(process.argv.slice(2))
  const report = buildPackage(args)
  if (args.verifyReproducible) {
    const second = buildPackage({ ...args, out: `${args.out}-rebuild` })
    if (second.sha256 !== report.sha256) {
      throw new Error(`build is not reproducible: ${report.sha256} != ${second.sha256}`)
    }
    report.reproducible = report.sha256
  }
  writeFileSync(join(resolve(args.out), 'build-report.json'), `${JSON.stringify(report, undefined, 2)}\n`)
  process.stdout.write(`${JSON.stringify(report, undefined, 2)}\n`)
}
