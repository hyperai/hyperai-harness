/**
 * Offline checks for the product packer.
 *
 * The full product build needs the pinned upstream tarball (18 MB, deliberately
 * not committed), so these tests cover the two behaviours that must not depend
 * on it: the deterministic tarball writer and the explicit rename list.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { listFiles, RUNTIME_SELF_REFERENCE_FILES, writeDeterministicTarball } from '../scripts/build-package.mjs'

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const sha256 = path => createHash('sha256').update(readFileSync(path)).digest('hex')

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'hyperai-pack-fixture-'))
  mkdirSync(join(root, 'lib', 'deep'), { recursive: true })
  writeFileSync(join(root, 'package.json'), '{"name":"fixture"}\n')
  writeFileSync(join(root, 'bin.js'), '#!/usr/bin/env node\n')
  execFileSync('chmod', ['755', join(root, 'bin.js')])
  writeFileSync(join(root, 'lib', 'deep', 'a.txt'), 'a\n')
  return root
}

test('the tarball writer is byte-for-byte reproducible', () => {
  const root = fixture()
  const out = mkdtempSync(join(tmpdir(), 'hyperai-pack-out-'))
  try {
    const first = writeDeterministicTarball(root, join(out, 'one.tgz'), 'package')
    const second = writeDeterministicTarball(root, join(out, 'two.tgz'), 'package')
    assert.equal(sha256(first), sha256(second))
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(out, { recursive: true, force: true })
  }
})

test('the tarball is a readable npm-style archive with the requested prefix', () => {
  const root = fixture()
  const out = mkdtempSync(join(tmpdir(), 'hyperai-pack-out-'))
  try {
    const archive = writeDeterministicTarball(root, join(out, 'bundle.tgz'), 'hyperai-harness-0.2.0-beta.1')
    const names = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' }).trim().split('\n').sort()
    assert.deepEqual(names, [
      'hyperai-harness-0.2.0-beta.1/bin.js',
      'hyperai-harness-0.2.0-beta.1/lib/deep/a.txt',
      'hyperai-harness-0.2.0-beta.1/package.json',
    ])
    // Sorted entries: the writer must not depend on directory iteration order.
    assert.deepEqual(listFiles(root), ['bin.js', 'lib/deep/a.txt', 'package.json'])
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(out, { recursive: true, force: true })
  }
})

test('long paths use the ustar prefix field instead of failing', () => {
  const root = mkdtempSync(join(tmpdir(), 'hyperai-pack-long-'))
  const out = mkdtempSync(join(tmpdir(), 'hyperai-pack-out-'))
  try {
    const deep = join(root, 'a'.repeat(60), 'b'.repeat(50))
    mkdirSync(deep, { recursive: true })
    writeFileSync(join(deep, 'file.txt'), 'x\n')
    const archive = writeDeterministicTarball(root, join(out, 'long.tgz'), 'p')
    const names = execFileSync('tar', ['-tzf', archive], { encoding: 'utf8' })
    assert.match(names, /file\.txt/u)
  } finally {
    rmSync(root, { recursive: true, force: true })
    rmSync(out, { recursive: true, force: true })
  }
})

test('the rename list targets runtime files, never licences or docs', () => {
  assert.ok(RUNTIME_SELF_REFERENCE_FILES.includes('cordis.yml'))
  assert.ok(RUNTIME_SELF_REFERENCE_FILES.includes('lib/types/update.js'))
  assert.ok(RUNTIME_SELF_REFERENCE_FILES.includes('tui-profile/feed/first-party.json'))
  for (const forbidden of ['LICENSE', 'README.md', 'licenses/dsh-tui-0.16.1-LICENSE.txt']) {
    assert.equal(RUNTIME_SELF_REFERENCE_FILES.includes(forbidden), false, forbidden)
  }
  assert.ok(RUNTIME_SELF_REFERENCE_FILES.every(file => !file.startsWith('guide/')), 'guide is documentation')
})

test('the pinned upstream record matches the brand pin', () => {
  const brand = JSON.parse(readFileSync(join(PKG, 'src', 'brand.json'), 'utf8'))
  const upstream = JSON.parse(readFileSync(join(PKG, 'upstream.json'), 'utf8'))
  assert.equal(upstream.package, brand.upstream.package)
  assert.equal(upstream.version, brand.upstream.version)
  assert.match(upstream.sha256, /^[0-9a-f]{64}$/u)
  assert.match(upstream.integrity, /^sha512-[A-Za-z0-9+/]+=*$/u)
  assert.ok(upstream.sizeBytes > 1_000_000)
})
