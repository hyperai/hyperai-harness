import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { compareVersions, pickLatestRelease } from '../scripts/update-lib.mjs'

const asset = (v, name = `hyperai-harness-${v}.tar.gz`) => ({ name, browser_download_url: `https://example.invalid/${name}` })
const release = (v, extra = {}) => ({
  tag_name: `v${v}`,
  draft: false,
  assets: [asset(v), asset(v, `hyperai-harness-${v}.tar.gz.sha256`)],
  ...extra,
})

test('semver ordering includes prerelease segments', () => {
  assert.equal(compareVersions('0.2.0-beta.2.1', '0.2.0-beta.2'), 1)
  assert.equal(compareVersions('0.2.0-beta.2.2', '0.2.0-beta.2.1'), 1)
  assert.equal(compareVersions('0.2.0-beta.10', '0.2.0-beta.9'), 1)
  assert.equal(compareVersions('0.2.0', '0.2.0-beta.2.1'), 1)
})

test('release picking ignores drafts and incomplete assets and picks the highest', () => {
  const picked = pickLatestRelease([
    release('0.2.0-beta.2.3', { draft: true }),
    { tag_name: 'v0.2.0-beta.2.4', draft: false, assets: [asset('0.2.0-beta.2.4')] },
    release('0.2.0-beta.2.1'),
    release('0.2.0-beta.2.2'),
    { tag_name: 'nightly', draft: false, assets: [] },
  ])
  assert.equal(picked.version, '0.2.0-beta.2.2')
  assert.match(picked.tarball, /0\.2\.0-beta\.2\.2\.tar\.gz/u)
})
