/**
 * Brand-art checks: the generated HyperAI mark must use the upstream whale's
 * letter-grid data format (one palette letter per sprite pixel, `.`
 * transparent), keep the official white plate and pink pattern without any
 * dark/ink substitution, and stay reproducible from the committed source image.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ART_COLUMNS, ART_ROWS, PALETTE, buildLogoSprite, renderModule } from '../scripts/generate-logo-art.mjs'

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(PKG, 'brand', 'hyperai-logo.png')

test('official logo source decodes to the whale art grid', () => {
  const art = buildLogoSprite(SOURCE)
  // The canonical local asset is 60x60; the generator accepts >= 48 so a future
  // replacement only has to be a real raster, not this exact size.
  assert.ok(art.image.width >= 48, `logo source is only ${art.image.width}px`)
  assert.equal(art.sprite.length, ART_ROWS * 2, 'one sprite row per half-block pixel row')
  for (const row of art.sprite) assert.equal(row.length, ART_COLUMNS, 'rows span the whale art slot')
  // The square mark is centered in the wider whale slot: transparent padding
  // on both sides, colored pixels in the middle.
  const pad = Math.floor((ART_COLUMNS - 26) / 2)
  for (const row of art.sprite) {
    assert.match(row.slice(0, pad), /^\.+$/u)
    assert.match(row.slice(ART_COLUMNS - pad), /^\.+$/u)
    assert.match(row.slice(pad, ART_COLUMNS - pad), /[^.]/u)
  }
})

test('sprite keeps the white plate, pink pattern and transparency', () => {
  const { sprite } = buildLogoSprite(SOURCE)
  const letters = sprite.join('').split('')
  const counts = Object.fromEntries([...new Set(letters)].map(letter => [letter, letters.filter(l => l === letter).length]))
  for (const letter of Object.keys(counts)) {
    assert.ok(letter === '.' || letter in PALETTE, `unknown sprite letter ${letter}`)
  }
  assert.ok((counts.W ?? 0) > 0, 'white plate missing')
  assert.ok((counts.P ?? 0) > 0, 'official pink pattern missing')
  assert.ok((counts['.'] ?? 0) > 0, 'transparent margin missing')
  // Official colors only: white plate stays white, pink stays #FF6096, and no
  // dark/ink color may appear anywhere in the palette (the old light-theme
  // remap is gone — the mark is never recolored).
  assert.deepEqual(PALETTE.W, [255, 255, 255])
  assert.deepEqual(PALETTE.P, [255, 96, 150])
  for (const [r, g, b] of Object.values(PALETTE)) {
    assert.ok(Math.max(r, g, b) >= 150, `palette entry ${r},${g},${b} is too dark`)
  }
})

test('the committed generated module matches a fresh render', () => {
  const art = buildLogoSprite(SOURCE)
  const committed = readFileSync(join(PKG, 'brand', 'generated', 'hyperai-logo.js'), 'utf8')
  assert.equal(
    committed,
    renderModule(art),
    'brand/generated/hyperai-logo.js is stale; re-run node scripts/generate-logo-art.mjs',
  )
})

test('generated module exports the whale frame data shape', () => {
  const module = readFileSync(join(PKG, 'brand', 'generated', 'hyperai-logo.js'), 'utf8')
  const sprite = /export const HYPERAI_LOGO_SPRITE = \[([\s\S]*?)\n\]/u.exec(module)
  assert.ok(sprite !== null, 'HYPERAI_LOGO_SPRITE missing')
  const rows = [...sprite[1].matchAll(/"(?:[^"\\]|\\.)*"/gu)].map(match => JSON.parse(match[0]))
  assert.equal(rows.length, ART_ROWS * 2)
  for (const row of rows) assert.equal(row.length, ART_COLUMNS)
  assert.match(module, /export const HYPERAI_LOGO_COLUMNS = 40/u)
  assert.match(module, /export const HYPERAI_LOGO_SPRITE_ROWS = 26/u)
  assert.match(module, /export const HYPERAI_LOGO_PALETTE = \{/u)
})
