/**
 * Brand-art checks: the canonical source is the official SVG, the generator
 * parses its own elements (white circle + embedded icon pattern), the analytic
 * raster is sane, and both whale-format letter-grid sprites stay reproducible
 * with the SVG's own white/rose colors — never a dark substitution.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  ART_COLUMNS,
  GRID_COMPACT,
  GRID_WIDE,
  buildLogoArt,
  decodePng,
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

test('light sprites only repaint the circle edge with the SVG accent rim', () => {
  const art = buildLogoArt(SOURCE)
  assert.deepEqual(art.lightPalette.K, art.accent, 'rim uses the SVG icon accent, no invented colour')
  for (const [darkName, lightName] of [['wide', 'wideLight'], ['compact', 'compactLight']]) {
    const dark = art[darkName].sprite
    const light = art[lightName].sprite
    assert.equal(light.length, dark.length)
    let rimCells = 0
    for (let y = 0; y < dark.length; y++) {
      assert.equal(light[y].length, dark[y].length)
      for (let x = 0; x < dark[y].length; x++) {
        if (light[y][x] === 'K') {
          rimCells++
          assert.notEqual(dark[y][x], '.', 'the rim may only replace opaque plate cells')
            // rim cells must touch transparency (the circle's outer edge)
          const touches =
            y === 0 || x === 0 || y === dark.length - 1 || x === dark[y].length - 1 ||
            dark[y - 1][x] === '.' || dark[y + 1][x] === '.' ||
            dark[y][x - 1] === '.' || dark[y][x + 1] === '.'
          assert.ok(touches, `rim cell ${x},${y} is not on the circle edge`)
        } else {
          assert.equal(light[y][x], dark[y][x], 'only the rim may differ from the official sprite')
        }
      }
    }
    assert.ok(rimCells > 60, `${lightName} rim is too sparse (${rimCells} cells)`)
    assert.equal(dark.join('').includes('K'), false, 'dark sprites must stay official')
  }
})

test('light HD PNG adds the accent rim and keeps transparency/white plate', () => {
  const art = buildLogoArt(SOURCE)
  assert.match(art.lightHdSha256, /^[0-9a-f]{64}$/u)
  const dark = decodePng(art.hdPng)
  const light = decodePng(art.lightHdPng)
  assert.equal(light.width, 512)
  assert.equal(light.height, 512)
  let transparent = 0
  let white = 0
  let rose = 0
  let changed = 0
  for (let i = 0; i < light.width * light.height; i++) {
    const o = i * 4
    const [r, g, b, a] = [light.data[o], light.data[o + 1], light.data[o + 2], light.data[o + 3]]
    if (a < 8) transparent++
    else if (min(r, g, b) > 240) white++
    else if (r > 200 && g < 120 && b < 140) rose++
    if (light.data[o] !== dark.data[o] || light.data[o + 1] !== dark.data[o + 1] || light.data[o + 2] !== dark.data[o + 2]) {
      changed++
    }
  }
  const total = light.width * light.height
  assert.ok(transparent / total > 0.2, 'light HD PNG must keep the transparent background')
  assert.ok(white / total > 0.2, 'light HD PNG must keep the official white plate')
  assert.ok(rose > 0, 'light HD PNG must keep the rose icon')
  assert.ok(changed > 500, 'light HD PNG must add a visible rim')
  assert.ok(changed < total * 0.08, 'the light rim must stay a thin edge treatment')
  // identical outside the circle rim: the icon centre is untouched
  const centre = (256 * 512 + 256) * 4
  assert.deepEqual(
    [light.data[centre], light.data[centre + 1], light.data[centre + 2], light.data[centre + 3]],
    [dark.data[centre], dark.data[centre + 1], dark.data[centre + 2], dark.data[centre + 3]],
  )
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
  assert.match(module, /export const HYPERAI_LOGO_PALETTE_LIGHT = \{/u)
  assert.match(module, /export const HYPERAI_LOGO_SPRITE_WIDE_LIGHT = \[/u)
  assert.match(module, /export const HYPERAI_LOGO_SPRITE_COMPACT_LIGHT = \[/u)
  assert.match(module, /export const HYPERAI_LOGO_HD_PNG_BASE64_LIGHT = "/u)
})

test('embedded HD PNG is a 512x512 RGBA render of the SVG', () => {
  const art = buildLogoArt(SOURCE)
  assert.equal(art.hdPng.length > 0, true)
  assert.match(art.hdSha256, /^[0-9a-f]{64}$/u)
  const image = decodePng(art.hdPng)
  assert.equal(image.width, 512)
  assert.equal(image.height, 512)
  let transparent = 0
  let white = 0
  let rose = 0
  for (let i = 0; i < image.width * image.height; i++) {
    const o = i * 4
    const [r, g, b, a] = [image.data[o], image.data[o + 1], image.data[o + 2], image.data[o + 3]]
    if (a < 8) transparent++
    else if (Math.min(r, g, b) > 240) white++
    else if (r > 200 && g < 120 && b < 140) rose++
  }
  const total = image.width * image.height
  assert.ok(transparent / total > 0.2, 'HD PNG must keep the transparent background')
  assert.ok(white / total > 0.2, 'HD PNG must keep the white circle')
  assert.ok(rose / total > 0.1, 'HD PNG must keep the SVG icon artwork')
  // The committed module embeds exactly this PNG.
  const module = readFileSync(join(PKG, 'brand', 'generated', 'hyperai-logo.js'), 'utf8')
  const match = /export const HYPERAI_LOGO_HD_PNG_BASE64 = "([^"]+)"/u.exec(module)
  assert.ok(match !== null, 'HYPERAI_LOGO_HD_PNG_BASE64 missing')
  assert.equal(createHash('sha256').update(Buffer.from(match[1], 'base64')).digest('hex'), art.hdSha256)
})

const min = (a, b, c) => Math.min(a, b, c)
