/**
 * Distribution source resolution for the HyperAI profile scripts.
 *
 * The same installer runs in two layouts:
 *
 *   - a source checkout (`apps/profiles/hyperai`), where the TUI package, brand
 *     data and skills lock live in the repository;
 *   - an unpacked internal-beta installation package, where everything it needs
 *     is inside `HYPERAI_DIST_ROOT` and the checkout must not be read at all.
 *
 * Every path the profile scripts need goes through this module, so the beta
 * layout is a data-shape question instead of a second installer.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
/** `apps/profiles/hyperai`. */
export const PROFILE_PACKAGE = resolve(HERE, '..')
/** Repository root in a source checkout. */
export const REPO_ROOT = resolve(PROFILE_PACKAGE, '..', '..', '..')
/** Unpacked installation package root, set by install.sh. */
export const BUNDLE_ROOT = process.env.HYPERAI_DIST_ROOT === undefined ? undefined : resolve(process.env.HYPERAI_DIST_ROOT)

/** Read JSON or return undefined. */
export function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'))
  } catch {
    return undefined
  }
}

/** Whether the scripts run from an unpacked installation package. */
export function isBundled() {
  return BUNDLE_ROOT !== undefined
}

/** Fail loudly when a bundle layout is missing a required file. */
export function bundleFile(relative) {
  const path = join(BUNDLE_ROOT, relative)
  if (!existsSync(path)) throw new Error(`installation package is incomplete: ${relative} is missing`)
  return path
}

/** Brand data (splash words, profile name, pinned upstream, validated cores). */
export function brand() {
  const path = isBundled() ? bundleFile('profile/brand.json') : join(REPO_ROOT, 'apps/tui/src/brand.json')
  const data = readJson(path)
  if (data === undefined) throw new Error(`cannot read brand data at ${path}`)
  return data
}

/** The TUI product version and its upstream version. */
export function tuiPackage() {
  if (isBundled()) {
    const meta = readJson(bundleFile('profile/tui-meta.json'))
    if (meta === undefined) throw new Error('installation package is missing profile/tui-meta.json')
    return meta
  }
  const data = readJson(join(REPO_ROOT, 'apps/tui/package.json'))
  if (data === undefined) throw new Error('cannot read apps/tui/package.json')
  return data
}

/** Directory holding the profile template (package.json, workspace, patch layer). */
export function profileTemplateDir() {
  return isBundled() ? bundleFile('profile') : PROFILE_PACKAGE
}

/** Skills lock used by this distribution. */
export function skillsLockPath() {
  return isBundled() ? bundleFile('profile/skills.lock.json') : join(PROFILE_PACKAGE, 'skills', 'hyperai-skills.lock.json')
}

/** Local Skills snapshot bundled for offline installation; undefined in a checkout. */
export function skillsSnapshotDir() {
  return isBundled() ? bundleFile('skills') : undefined
}

/** Bundled TUI product tarball; undefined in a checkout (the patch is used instead). */
export function tuiTarballPath() {
  if (!isBundled()) return undefined
  const dir = bundleFile('tui')
  const candidates = readdirSync(dir).filter(name => name.endsWith('.tgz'))
  if (candidates.length !== 1) throw new Error(`expected exactly one product tarball in ${dir}, found ${candidates.length}`)
  return join(dir, candidates[0])
}
