/**
 * Brand-art checks: the generated terminal mark must keep the splash grid
 * shape and come from the official source image, and the generator must be
 * deterministic for the committed source.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ART_COLUMNS, ART_ROWS, buildLogoArt, renderModule } from '../scripts/generate-logo-art.mjs'

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const stripAnsi = text => text.replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/gu, '')

test('official logo source decodes to a square sprite', () => {
  const art = buildLogoArt(join(PKG, 'brand', 'hyperai-logo.png'))
  assert.ok(art.image.width >= 64)
  assert.equal(art.sprite.length, ART_ROWS * 2)
  const width = art.sprite[0].length
  assert.ok(width > 0 && width <= ART_COLUMNS)
  for (const row of art.sprite) assert.equal(row.length, width)
})

test('both variants render exactly 13 rows of 40 display columns', () => {
  const art = buildLogoArt(join(PKG, 'brand', 'hyperai-logo.png'))
  for (const rows of [art.dark, art.light]) {
    assert.equal(rows.length, ART_ROWS)
    for (const row of rows) {
      assert.equal([...stripAnsi(row)].length, ART_COLUMNS)
      assert.match(row, /\u001b\[K$/u, 'rows must clear the remainder of the line')
    }
  }
})

test('the committed generated module matches a fresh render', () => {
  const art = buildLogoArt(join(PKG, 'brand', 'hyperai-logo.png'))
  const committed = readFileSync(join(PKG, 'brand', 'generated', 'hyperai-logo.js'), 'utf8')
  assert.equal(
    committed,
    renderModule(art),
    'brand/generated/hyperai-logo.js is stale; re-run node scripts/generate-logo-art.mjs',
  )
})

test('light variant keeps the pink accent but darkens the white plate', () => {
  const art = buildLogoArt(join(PKG, 'brand', 'hyperai-logo.png'))
  const dark = art.dark.join('\n')
  const light = art.light.join('\n')
  assert.match(dark, /\u001b\[38;2;255;255;255m/u, 'dark variant paints the official white plate')
  assert.match(dark, /\u001b\[38;2;25[0-9];\d+;\d+m/u, 'dark variant keeps the official pink accent')
  assert.match(light, /\u001b\[38;2;26;26;32m/u, 'light variant maps the white plate to ink')
})
