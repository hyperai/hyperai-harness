/**
 * HyperAI release check (GitHub Releases, never npm and never the upstream
 * repository). The TUI calls this in the background; a cached answer is used
 * for 24 hours, and every failure is silent. `hyperai update` in the generated
 * launcher owns the actual upgrade.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'

/** Single source of truth for the release repository. */
export const UPDATE_REPO = 'hyperai/hyperai-harness'
const CACHE_MS = 24 * 60 * 60 * 1000

/** Parse a semver string (with prerelease) into comparable parts. */
export function parseSemver(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(String(text).trim())
  if (!match) return undefined
  return {
    major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]),
    prerelease: match[4] === undefined ? [] : match[4].split('.'),
  }
}

/** Semver comparison including prerelease ordering. */
export function compareVersions(a, b) {
  const left = parseSemver(a)
  const right = parseSemver(b)
  if (left === undefined || right === undefined) throw new Error(`invalid version: ${left === undefined ? a : b}`)
  for (const key of ['major', 'minor', 'patch']) {
    if (left[key] !== right[key]) return left[key] < right[key] ? -1 : 1
  }
  if (left.prerelease.length === 0 && right.prerelease.length === 0) return 0
  if (left.prerelease.length === 0) return 1
  if (right.prerelease.length === 0) return -1
  for (let index = 0; index < Math.max(left.prerelease.length, right.prerelease.length); index++) {
    const l = left.prerelease[index]
    const r = right.prerelease[index]
    if (l === undefined) return -1
    if (r === undefined) return 1
    if (l === r) continue
    const ln = /^\d+$/u.test(l)
    const rn = /^\d+$/u.test(r)
    if (ln && rn) return Number(l) < Number(r) ? -1 : 1
    if (ln) return -1
    if (rn) return 1
    return l < r ? -1 : 1
  }
  return 0
}

/** Cache location: all mutable HyperAI state lives under HYPERAI_HOME. */
export function updateCachePath(env = process.env) {
  const home = env.HYPERAI_HOME || join(homedir(), '.hyperai')
  return join(home, 'update-check.json')
}

/** Current installed product version (the TUI package carries it). */
export function currentVersion() {
  try {
    const url = new URL('../../package.json', import.meta.url)
    return JSON.parse(readFileSync(url, 'utf8')).version
  } catch {
    return undefined
  }
}

/** Release API base; HYPERAI_UPDATE_BASE_URL is test-only. */
export function releasesUrl(env = process.env) {
  const base = (env.HYPERAI_UPDATE_BASE_URL || 'https://api.github.com').replace(/\/+$/u, '')
  return `${base}/repos/${UPDATE_REPO}/releases?per_page=100`
}

/** Pick the highest complete Release (draft excluded, both assets required). */
export function pickLatestRelease(releases) {
  let best
  for (const release of Array.isArray(releases) ? releases : []) {
    if (release?.draft === true) continue
    const tag = typeof release.tag_name === 'string' ? release.tag_name : ''
    if (!tag.startsWith('v')) continue
    const version = tag.slice(1)
    const parsed = parseSemver(version)
    if (parsed === undefined) continue
    const assets = Array.isArray(release.assets) ? release.assets : []
    const tarball = assets.find(asset => asset?.name === `hyperai-harness-${version}.tar.gz`)
    const checksum = assets.find(asset => asset?.name === `hyperai-harness-${version}.tar.gz.sha256`)
    if (tarball?.browser_download_url === undefined || checksum?.browser_download_url === undefined) continue
    if (best === undefined || compareVersions(version, best.version) > 0) {
      best = { version, tarball: tarball.browser_download_url, checksum: checksum.browser_download_url, tag }
    }
  }
  return best
}

/**
 * Background check with a 24-hour cache. Returns the latest version only when it
 * is newer than the installed one; all network/shape failures return undefined.
 */
export async function checkForUpdate({ env = process.env, now = Date.now(), fetchImpl = fetch } = {}) {
  if (env.HYPERAI_UPDATE_CHECK === 'off') return undefined
  const current = currentVersion()
  if (current === undefined) return undefined
  const cachePath = updateCachePath(env)
  let cached
  try { cached = JSON.parse(readFileSync(cachePath, 'utf8')) } catch { cached = undefined }
  if (cached?.checkedAt !== undefined && now - cached.checkedAt < CACHE_MS) {
    return typeof cached.latest === 'string' && compareVersions(cached.latest, current) > 0
      ? { current, latest: cached.latest }
      : undefined
  }
  try {
    const response = await fetchImpl(releasesUrl(env), { headers: { accept: 'application/vnd.github+json', 'user-agent': 'hyperai-harness' } })
    if (!response.ok) throw new Error(`release check ${response.status}`)
    const latest = pickLatestRelease(await response.json())
    if (latest === undefined) throw new Error('no complete release')
    const payload = { checkedAt: now, latest: latest.version }
    try { mkdirSync(dirname(cachePath), { recursive: true }); writeFileSync(cachePath, `${JSON.stringify(payload)}\n`) } catch { /* cache is best-effort */ }
    return compareVersions(latest.version, current) > 0 ? { current, latest: latest.version } : undefined
  } catch {
    // Never surface network/rate-limit/shape failures; retry after the TTL.
    try { mkdirSync(dirname(cachePath), { recursive: true }); writeFileSync(cachePath, `${JSON.stringify({ checkedAt: now, latest: undefined })}\n`) } catch { /* best-effort */ }
    return undefined
  }
}

/** One-line, non-blocking notice shown in the TUI. */
export function updateNoticeText(latest, lang = 'zh') {
  return lang === 'zh'
    ? `HyperAI Harness 有新版本 ${latest}，退出后运行 hyperai update 升级`
    : `HyperAI Harness ${latest} is available; run hyperai update after quitting`
}
