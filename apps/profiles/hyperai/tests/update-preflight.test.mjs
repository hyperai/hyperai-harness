import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { checkNewPackagePreflight } from '../scripts/update.mjs'

test('new package preflight is executed and rejects a future Node requirement', async () => {
  const root = mkdtempSync(join(tmpdir(), 'hyperai-newpkg-'))
  try {
    mkdirSync(join(root, 'profile', 'scripts'), { recursive: true })
    writeFileSync(join(root, 'profile', 'scripts', 'preflight.mjs'), `
      export const SUPPORTED_NODE_RANGE = '>=99'
      export function nodeVersionSupported() { return false }
    `)
    await assert.rejects(() => checkNewPackagePreflight(root), /新版本要求 Node\.js >=99/u)
  } finally { rmSync(root, { recursive: true, force: true }) }
})
