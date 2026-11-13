/** Shared release discovery for `hyperai update` (GitHub Releases only). */
export const UPDATE_REPO = 'hyperai/hyperai-harness'

export function parseSemver(text) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/u.exec(String(text).trim())
  if (!match) return undefined
  return { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]), prerelease: match[4] === undefined ? [] : match[4].split('.') }
}

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

export function pickLatestRelease(releases) {
  let best
  for (const release of Array.isArray(releases) ? releases : []) {
    if (release?.draft === true) continue
    const tag = typeof release.tag_name === 'string' ? release.tag_name : ''
    if (!tag.startsWith('v')) continue
    const version = tag.slice(1)
    if (parseSemver(version) === undefined) continue
    const assets = Array.isArray(release.assets) ? release.assets : []
    const tarball = assets.find(asset => asset?.name === `hyperai-harness-${version}.tar.gz`)
    const checksum = assets.find(asset => asset?.name === `hyperai-harness-${version}.tar.gz.sha256`)
    if (tarball?.browser_download_url === undefined || checksum?.browser_download_url === undefined) continue
    if (best === undefined || compareVersions(version, best.version) > 0) {
      best = { version, tag, tarball: tarball.browser_download_url, checksum: checksum.browser_download_url }
    }
  }
  return best
}

export function releasesUrl(env = process.env) {
  const base = (env.HYPERAI_UPDATE_BASE_URL || 'https://api.github.com').replace(/\/+$/u, '')
  return `${base}/repos/${UPDATE_REPO}/releases?per_page=100`
}

export async function fetchLatest(env = process.env, fetchImpl = fetch) {
  const response = await fetchImpl(releasesUrl(env), { headers: { accept: 'application/vnd.github+json', 'user-agent': 'hyperai-harness' } })
  if (!response.ok) throw new Error(`release check failed: HTTP ${response.status}`)
  const latest = pickLatestRelease(await response.json())
  if (latest === undefined) throw new Error('没有找到可用的 Release（需要 tag 和两个附件）')
  return latest
}
