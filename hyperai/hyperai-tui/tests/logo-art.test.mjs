/**
 * Brand-art checks: the canonical source is the official SVG, the generator
 * parses its own elements (white circle + embedded icon pattern), the analytic
 * raster is sane, and both whale-format letter-grid sprites stay reproducible
 * with the SVG's own white/rose colors — never a dark substitution.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ART_COLUMNS,
  GRID_COMPACT,
  GRID_WIDE,
  buildLogoArt,
  iconColor,
  parseLogoSvg,
  renderLogoSvg,
  renderModule,
} from '../scripts/generate-logo-art.mjs'

const PKG = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const SOURCE = join(PKG, 'brand', 'hyperai-logo.svg')
const svg = readFileSync(SOURCE, 'utf8')

test('canonical SVG parses to the documented composition', () => {
  const parsed = parseLogoSvg(svg)
  assert.equal(parsed.viewBox.width, 120)
  assert.equal(parsed.viewBox.height, 120)
  assert.deepEqual(parsed.circle, { cx: 60, cy: 60, r: 55 })
  assert.deepEqual(parsed.rect, { x: 15, y: 15, width: 90, height: 89 })
  assert.equal(parsed.icon.width, 271)
  assert.equal(parsed.icon.height, 267)
  assert.ok(parsed.matrix[0] > 0 && parsed.matrix[3] > 0, 'pattern matrix must scale the icon')
})

test('embedded icon keeps the SVG color, palette stays on the white→rose line', () => {
  const parsed = parseLogoSvg(svg)
  assert.deepEqual(iconColor(parsed.icon), [225, 29, 72])
  const art = buildLogoArt(SOURCE)
  assert.deepEqual(art.palette.W, [255, 255, 255])
  assert.deepEqual(art.palette.R, [225, 29, 72])
  for (const [letter, [r, g, b]] of Object.entries(art.palette)) {
    assert.ok(letter === 'W' || r >= 225, `palette ${letter} must stay on the white→rose line (${r},${g},${b})`)
    assert.ok(Math.max(r, g, b) >= 150, `palette ${letter} is too dark (${r},${g},${b})`)
  }
})

test('analytic SVG composite has the white circle and the rose icon', () => {
  const parsed = parseLogoSvg(svg)
  const raster = renderLogoSvg(parsed, 128)
  assert.equal(raster.width, 128)
  assert.equal(raster.height, 128)
  let transparent = 0
  let white = 0
  let rose = 0
  for (let i = 0; i < raster.width * raster.height; i++) {
    const o = i * 4
    const [r, g, b, a] = [raster.data[o], raster.data[o + 1], raster.data[o + 2], raster.data[o + 3]]
    if (a < 8) transparent++
    else if (min(r, g, b) > 240) white++
    else if (r > 200 && g < 120 && b < 140) rose++
  }
  const total = raster.width * raster.height
  assert.ok(transparent / total > 0.2, 'transparent corners must stay transparent')
  assert.ok(white / total > 0.2, 'white circle ring missing')
  assert.ok(rose / total > 0.1, 'rose icon missing')
  // centre pixel is inside the icon artwork, the bbox corner is transparent
  const centre = (64 * 128 + 64) * 4
  assert.ok(raster.data[centre + 3] > 200, 'centre must be opaque')
  assert.ok(raster.data[3] < 8, 'top-left corner must be transparent')
})

test('both sprites use the whale letter-grid shape and keep transparency', () => {
  const art = buildLogoArt(SOURCE)
  assert.equal(art.wide.sprite.length, GRID_WIDE)
  assert.equal(art.compact.sprite.length, GRID_COMPACT)
  for (const [name, sprite] of [['wide', art.wide.sprite], ['compact', art.compact.sprite]]) {
    for (const row of sprite) assert.equal(row.length, ART_COLUMNS, `${name} rows span the whale slot`)
    const letters = new Set(sprite.join('').split(''))
    for (const letter of letters) assert.ok(letter === '.' || letter in art.palette, `unknown letter ${letter}`)
    assert.ok(letters.has('W'), `${name} sprite must contain the white circle`)
    assert.ok(letters.has('R'), `${name} sprite must contain the rose icon`)
    assert.ok(letters.has('.'), `${name} sprite must keep transparent pixels`)
    const pad = Math.floor((ART_COLUMNS - (name === 'wide' ? GRID_WIDE : GRID_COMPACT)) / 2)
    if (pad > 0) {
      for (const row of sprite) assert.match(row.slice(0, pad), /^\.+$/u, `${name} sprite must be centred`)
    }
  }
})

test('the committed generated module matches a fresh render', () => {
  const art = buildLogoArt(SOURCE)
  const committed = readFileSync(join(PKG, 'brand', 'generated', 'hyperai-logo.js'), 'utf8')
  assert.equal(committed, renderModule(art), 'brand/generated/hyperai-logo.js is stale; re-run node scripts/generate-logo-art.mjs')
})

test('generated module exports both sprites and the width threshold', () => {
  const module = readFileSync(join(PKG, 'brand', 'generated', 'hyperai-logo.js'), 'utf8')
  assert.match(module, /export const HYPERAI_LOGO_COLUMNS = 40/u)
  assert.match(module, /export const HYPERAI_LOGO_WIDE_MIN_ROWS = \d+/u)
  assert.match(module, /export const HYPERAI_LOGO_SPRITE_ROWS_WIDE = 40/u)
  assert.match(module, /export const HYPERAI_LOGO_SPRITE_ROWS_COMPACT = 26/u)
  assert.match(module, /export const HYPERAI_LOGO_SPRITE_WIDE = \[/u)
  assert.match(module, /export const HYPERAI_LOGO_SPRITE_COMPACT = \[/u)
  assert.match(module, /export const HYPERAI_LOGO_PALETTE = \{/u)
})

const min = (a, b, c) => Math.min(a, b, c)
