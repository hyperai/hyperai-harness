#!/usr/bin/env node
/**
 * Generate the terminal logo data for hyperai-tui from the OFFICIAL HyperAI
 * logo SVG (`brand/hyperai-logo.svg`, a 120x120 viewBox export: a white circle
 * plus an embedded 271x267 icon painted into a 90x89 rect through an SVG
 * pattern).
 *
 * The SVG is the single canonical source. The build chain is:
 *
 *   brand/hyperai-logo.svg
 *     [1] parse the SVG: circle geometry (white fill), icon rect + pattern
 *         matrix, and the embedded PNG icon (data: URI, 271x267 RGBA)
 *     [2] composite analytically at 512x512 with 4x4 supersampling:
 *         white circle -> icon image stretched into the rect (the SVG's own
 *         `patternContentUnits="objectBoundingBox"` mapping, preserveAspectRatio
 *         none), straight-alpha "icon over circle"
 *     [3] crop the alpha bounding box, square-pad, area-downsample to the two
 *         terminal grids: 40x40 (main, 20 display rows) and 26x26 (compact,
 *         13 display rows)
 *     [4] quantize along the SVG's own white -> rose blend line into the whale's
 *         letter-grid format (one palette letter per sprite pixel, `.` =
 *         transparent)
 *
 * The terminal renders the sprites with the upstream whale's own
 * `renderSpriteRows` (`components/Whale.js`) — true-color half blocks, no image
 * protocol, no theme-specific recoloring. The SVG's own colors are preserved:
 * white circle `#FFFFFF`, icon rose (dominant opaque color of the embedded
 * icon, `#E11D48` in this export), and the white->rose blends used for
 * anti-aliased edges. Transparent pixels stay transparent (terminal background
 * shows through).
 *
 * Output: `brand/generated/hyperai-logo.js` (committed; the runtime never
 * parses SVG or PNG). Re-run after replacing the source:
 *
 *   node scripts/generate-logo-art.mjs
 *
 * Requires only Node built-ins (zlib) — no image library.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { deflateSync, inflateSync } from 'node:zlib'
import { createHash } from 'node:crypto'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = join(HERE, '..')
const SOURCE = join(PKG, 'brand', 'hyperai-logo.svg')
const OUT_JS = join(PKG, 'brand', 'generated', 'hyperai-logo.js')
const OUT_MONO = join(PKG, 'brand', 'generated', 'hyperai-logo.txt')

/** Art slot width (same as the upstream whale box). */
export const ART_COLUMNS = 40
/** Main sprite grid (40x40 -> 20 half-block display rows). */
export const GRID_WIDE = 40
/** Compact sprite grid (26x26 -> 13 half-block display rows). */
export const GRID_COMPACT = 26
/** Terminal rows at or above which the wide (40x40) sprite is used. */
export const WIDE_MIN_ROWS = 44
/** Canonical raster resolution used as the resampling source. */
const CANVAS = 512
/** Supersampling factor per axis for the analytic SVG composite. */
const SUPERSAMPLE = 4
/** Alpha at or above this is treated as opaque; below it the cell is empty. */
const ALPHA_MIN = 128
/** High-definition raster size embedded for the terminal image protocol path. */
export const HD_SIZE = 512
/**
 * Light-theme contrast rim.
 *
 * The official mark is a white circle on transparency; on a pure-white terminal
 * background (Orca light, VS Code light, iTerm2 light, ...) that plate has 1:1
 * contrast and disappears. Light-background variants therefore draw a thin
 * rim along the circle's existing edge using the SVG's own icon accent (no new
 * colours are invented, the SVG itself stays untouched). Dark-background
 * terminals keep the exact official rendering.
 */
export const LIGHT_RIM_LETTER = 'K'
/** Rim thickness in SVG viewBox units; only the outer circle edge is repainted. */
export const LIGHT_RIM_WIDTH = 1.2

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii')
  const body = Buffer.concat([typeBuf, data])
  const out = Buffer.alloc(8 + data.length + 4)
  out.writeUInt32BE(data.length, 0)
  body.copy(out, 4)
  out.writeUInt32BE(crc32(body), 8 + data.length)
  return out
}

/**
 * Encode straight-alpha RGBA pixels as a PNG (8-bit, color type 6, filter 0).
 * Used for the high-definition raster that the terminal image protocol path
 * hands to the renderer; pure Node built-ins (zlib), no image library.
 * @param {{width:number,height:number,data:Uint8Array}} image - RGBA pixels.
 * @returns {Buffer} PNG file bytes.
 */
export function encodePng(image) {
  const { width, height, data } = image
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // RGBA
  const raw = Buffer.alloc(height * (1 + width * 4))
  for (let y = 0; y < height; y++) {
    const rowStart = y * (1 + width * 4)
    raw[rowStart] = 0
    Buffer.from(data.buffer, data.byteOffset + y * width * 4, width * 4).copy(raw, rowStart + 1)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw, { level: 9 })),
    pngChunk('IEND', Buffer.alloc(0)),
  ])
}

/** Decode an 8-bit non-interlaced RGB/RGBA PNG into straight RGBA bytes. */
export function decodePng(buf) {
  const signature = '89504e470d0a1a0a'
  if (buf.subarray(0, 8).toString('hex') !== signature) throw new Error('not a PNG file')
  let off = 8
  let width = 0
  let height = 0
  let bitDepth = 0
  let colorType = 0
  let interlace = 0
  const idat = []
  while (off < buf.length) {
    const length = buf.readUInt32BE(off)
    const type = buf.toString('ascii', off + 4, off + 8)
    const data = buf.subarray(off + 8, off + 8 + length)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      bitDepth = data[8]
      colorType = data[9]
      interlace = data[12]
    } else if (type === 'IDAT') {
      idat.push(data)
    } else if (type === 'IEND') {
      break
    }
    off += 12 + length
  }
  if (bitDepth !== 8) throw new Error(`unsupported bit depth ${bitDepth}`)
  if (colorType !== 6 && colorType !== 2) throw new Error(`unsupported color type ${colorType}`)
  if (interlace !== 0) throw new Error('interlaced PNG is not supported')
  const bpp = colorType === 6 ? 4 : 3
  const raw = inflateSync(Buffer.concat(idat))
  const stride = width * bpp
  const out = new Uint8Array(width * height * 4)
  const previous = new Uint8Array(stride)
  let pos = 0
  for (let y = 0; y < height; y++) {
    const filter = raw[pos++]
    const line = raw.subarray(pos, pos + stride)
    pos += stride
    const current = new Uint8Array(stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? current[x - bpp] : 0
      const b = previous[x]
      const c = x >= bpp ? previous[x - bpp] : 0
      let value = line[x]
      switch (filter) {
        case 0:
          break
        case 1:
          value = (value + a) & 0xff
          break
        case 2:
          value = (value + b) & 0xff
          break
        case 3:
          value = (value + ((a + b) >> 1)) & 0xff
          break
        case 4: {
          const p = a + b - c
          const pa = Math.abs(p - a)
          const pb = Math.abs(p - b)
          const pc = Math.abs(p - c)
          const predictor = pa <= pb && pa <= pc ? a : pb <= pc ? b : c
          value = (value + predictor) & 0xff
          break
        }
        default:
          throw new Error(`unsupported PNG filter ${filter}`)
      }
      current[x] = value
    }
    for (let x = 0; x < width; x++) {
      const o = (y * width + x) * 4
      if (bpp === 4) {
        out[o] = current[x * 4]
        out[o + 1] = current[x * 4 + 1]
        out[o + 2] = current[x * 4 + 2]
        out[o + 3] = current[x * 4 + 3]
      } else {
        out[o] = current[x * 3]
        out[o + 1] = current[x * 3 + 1]
        out[o + 2] = current[x * 3 + 2]
        out[o + 3] = 255
      }
    }
    previous.set(current)
  }
  return { width, height, data: out }
}

const number = '(-?\\d+(?:\\.\\d+)?)'
const attr = (svg, tag, name) => {
  const element = new RegExp(`<${tag}\\b[^>]*>`, 'u').exec(svg)
  if (element === null) throw new Error(`SVG is missing <${tag}>`)
  const matched = new RegExp(`${name}="${number}"`, 'u').exec(element[0])
  if (matched === null) throw new Error(`SVG <${tag}> is missing ${name}`)
  return Number(matched[1])
}

/**
 * Parse the official export. The generator intentionally understands exactly the
 * documented composition (white circle + rect filled from an embedded PNG
 * through an objectBoundingBox pattern) and fails loud if the source changes
 * shape, instead of silently producing a wrong mark.
 * @param {string} svg - SVG document text.
 * @returns Parsed geometry, embedded icon and pattern mapping.
 */
export function parseLogoSvg(svg) {
  const viewBoxMatch = /viewBox="0 0 (\d+(?:\.\d+)?) (\d+(?:\.\d+)?)"/u.exec(svg)
  if (viewBoxMatch === null) throw new Error('SVG is missing a viewBox')
  const viewBox = { width: Number(viewBoxMatch[1]), height: Number(viewBoxMatch[2]) }

  const ovalTag = /<path\b[^>]*id="Oval"[^>]*>/u.exec(svg)
  if (ovalTag === null) throw new Error('SVG is missing the white "Oval" path')
  if (!/fill="white"/u.test(ovalTag[0])) throw new Error('SVG "Oval" path is not white')
  const circleData = /\bd="([^"]+)"/u.exec(ovalTag[0])
  if (circleData === null) throw new Error('SVG "Oval" path has no `d`')
  const coords = [...circleData[1].matchAll(new RegExp(`\\d+(?:\\.\\d+)?`, 'gu'))].map(match => Number(match[0]))
  const xs = coords.filter((_, index) => index % 2 === 0)
  const ys = coords.filter((_, index) => index % 2 === 1)
  const circle = {
    cx: (Math.min(...xs) + Math.max(...xs)) / 2,
    cy: (Math.min(...ys) + Math.max(...ys)) / 2,
    r: (Math.max(...xs) - Math.min(...xs)) / 2,
  }
  if (Math.abs((Math.max(...xs) - Math.min(...xs)) - (Math.max(...ys) - Math.min(...ys))) > 0.5) {
    throw new Error('SVG "Oval" is not a circle')
  }

  const rectTag = /<rect\b[^>]*>/u.exec(svg)
  if (rectTag === null) throw new Error('SVG is missing the icon <rect>')
  const rect = {
    x: attr(svg, 'rect', 'x'),
    y: attr(svg, 'rect', 'y'),
    width: attr(svg, 'rect', 'width'),
    height: attr(svg, 'rect', 'height'),
  }
  if (!/fill="url\(#pattern/u.test(rectTag[0])) throw new Error('SVG icon rect is not pattern-filled')

  const matrixMatch = /transform="matrix\(([^)]+)\)"/u.exec(svg)
  if (matrixMatch === null) throw new Error('SVG is missing the pattern transform matrix')
  const matrix = matrixMatch[1].trim().split(/[\s,]+/u).map(Number)
  if (matrix.length !== 6) throw new Error(`pattern matrix must have 6 numbers, got ${matrix.length}`)

  const anyMatrixMatch = /<image\b[^>]*>/u.exec(svg)
  if (anyMatrixMatch === null) throw new Error('SVG is missing the embedded <image>')
  const dims = { width: attr(svg, 'image', 'width'), height: attr(svg, 'image', 'height') }
  const dataMatch = /xlink:href="data:image\/png;base64,([^"]+)"/u.exec(svg)
  if (dataMatch === null) throw new Error('SVG does not embed a PNG data URI')
  const icon = decodePng(Buffer.from(dataMatch[1], 'base64'))
  if (icon.width !== dims.width || icon.height !== dims.height) {
    throw new Error(`embedded PNG is ${icon.width}x${icon.height}, image tag says ${dims.width}x${dims.height}`)
  }

  return { viewBox, circle, rect, matrix, icon }
}

const clampByte = value => Math.max(0, Math.min(255, value))

/** Bilinear sample of the embedded icon at continuous image coordinates. */
function sampleIcon(icon, u, v) {
  const x = Math.max(0, Math.min(icon.width - 1, u))
  const y = Math.max(0, Math.min(icon.height - 1, v))
  const x0 = Math.floor(x)
  const y0 = Math.floor(y)
  const x1 = Math.min(icon.width - 1, x0 + 1)
  const y1 = Math.min(icon.height - 1, y0 + 1)
  const fx = x - x0
  const fy = y - y0
  const fetch = (xx, yy) => {
    const o = (yy * icon.width + xx) * 4
    return [icon.data[o], icon.data[o + 1], icon.data[o + 2], icon.data[o + 3]]
  }
  const p00 = fetch(x0, y0)
  const p10 = fetch(x1, y0)
  const p01 = fetch(x0, y1)
  const p11 = fetch(x1, y1)
  const mix = (index) =>
    (p00[index] * (1 - fx) + p10[index] * fx) * (1 - fy) + (p01[index] * (1 - fx) + p11[index] * fx) * fy
  return [mix(0), mix(1), mix(2), mix(3)]
}

/**
 * Composite the SVG analytically at `size` x `size`: white circle, then the
 * embedded icon stretched into the icon rect (SVG's objectBoundingBox pattern
 * mapping, preserveAspectRatio="none"), supersampled for anti-aliasing.
 * @param {ReturnType<typeof parseLogoSvg>} parsed - Parsed SVG.
 * @param {number} size - Output raster edge in pixels.
 * @returns {{width:number,height:number,data:Uint8Array}} Straight-alpha RGBA.
 */
export function renderLogoSvg(parsed, size = CANVAS) {
  const { viewBox, circle, rect, matrix, icon } = parsed
  const scaleX = viewBox.width / size
  const scaleY = viewBox.height / size
  const [a, , , d, e, f] = matrix
  if (!(a > 0) || !(d > 0)) throw new Error('pattern matrix has a non-positive scale')
  const out = new Uint8Array(size * size * 4)
  const samples = SUPERSAMPLE * SUPERSAMPLE
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let sumA = 0
      let sumR = 0
      let sumG = 0
      let sumB = 0
      for (let sy = 0; sy < SUPERSAMPLE; sy++) {
        for (let sx = 0; sx < SUPERSAMPLE; sx++) {
          const x = (px + (sx + 0.5) / SUPERSAMPLE) * scaleX
          const y = (py + (sy + 0.5) / SUPERSAMPLE) * scaleY
          // base: the white circle
          const dx = x - circle.cx
          const dy = y - circle.cy
          const baseA = dx * dx + dy * dy <= circle.r * circle.r ? 1 : 0
          // overlay: the icon rect (pattern maps the image onto the rect bbox)
          let iconA = 0
          let iconR = 0
          let iconG = 0
          let iconB = 0
          if (x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height) {
            const bboxX = (x - rect.x) / rect.width
            const bboxY = (y - rect.y) / rect.height
            const u = (bboxX - e) / a
            const v = (bboxY - f) / d
            const sampled = sampleIcon(icon, u, v)
            iconA = sampled[3] / 255
            iconR = sampled[0]
            iconG = sampled[1]
            iconB = sampled[2]
          }
          const outA = iconA + baseA * (1 - iconA)
          const premulR = iconR * iconA + 255 * baseA * (1 - iconA)
          const premulG = iconG * iconA + 255 * baseA * (1 - iconA)
          const premulB = iconB * iconA + 255 * baseA * (1 - iconA)
          sumA += outA
          sumR += premulR
          sumG += premulG
          sumB += premulB
        }
      }
      const o = (py * size + px) * 4
      const alpha = sumA / samples
      if (alpha > 0) {
        out[o] = clampByte(sumR / samples / alpha)
        out[o + 1] = clampByte(sumG / samples / alpha)
        out[o + 2] = clampByte(sumB / samples / alpha)
        out[o + 3] = clampByte(alpha * 255)
      }
    }
  }
  return { width: size, height: size, data: out }
}

/** Alpha bounding box of an RGBA raster. */
export function alphaBox(image) {
  const { width, height, data } = image
  let minX = width
  let minY = height
  let maxX = -1
  let maxY = -1
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3] > 0) {
        if (x < minX) minX = x
        if (y < minY) minY = y
        if (x > maxX) maxX = x
        if (y > maxY) maxY = y
      }
    }
  }
  if (maxX < 0) throw new Error('rendered logo is fully transparent')
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

/** Area-average downsample of the alpha bbox to a square grid (premultiplied). */
function downsampleSquare(image, box, size) {
  const side = Math.max(box.width, box.height)
  const padX = Math.floor((side - box.width) / 2)
  const padY = Math.floor((side - box.height) / 2)
  const rows = []
  for (let y = 0; y < size; y++) {
    const row = []
    const y0 = Math.floor((y * side) / size)
    const y1 = Math.max(y0 + 1, Math.floor(((y + 1) * side) / size))
    for (let x = 0; x < size; x++) {
      const x0 = Math.floor((x * side) / size)
      const x1 = Math.max(x0 + 1, Math.floor(((x + 1) * side) / size))
      let r = 0
      let g = 0
      let b = 0
      let alpha = 0
      let weight = 0
      for (let sy = y0; sy < y1; sy++) {
        const sourceY = box.y + sy - padY
        if (sourceY < 0 || sourceY >= image.height) continue
        for (let sx = x0; sx < x1; sx++) {
          const sourceX = box.x + sx - padX
          if (sourceX < 0 || sourceX >= image.width) continue
          const o = (sourceY * image.width + sourceX) * 4
          const a = image.data[o + 3] / 255
          r += image.data[o] * a
          g += image.data[o + 1] * a
          b += image.data[o + 2] * a
          alpha += a
          weight += 1
        }
      }
      if (alpha === 0 || weight === 0) row.push({ r: 0, g: 0, b: 0, a: 0 })
      else row.push({ r: r / alpha, g: g / alpha, b: b / alpha, a: alpha / weight })
    }
    rows.push(row)
  }
  return rows
}

const clamp = value => Math.max(0, Math.min(255, Math.round(value)))

/** Dominant opaque color of the embedded icon (its own artwork color). */
export function iconColor(icon) {
  const counts = new Map()
  for (let i = 0; i < icon.width * icon.height; i++) {
    const o = i * 4
    if (icon.data[o + 3] < 250) continue
    const key = `${icon.data[o]},${icon.data[o + 1]},${icon.data[o + 2]}`
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  let best = null
  for (const [key, count] of counts) {
    if (best === null || count > best.count) best = { key, count }
  }
  if (best === null) throw new Error('embedded icon has no opaque pixels')
  return best.key.split(',').map(Number)
}

/** Palette letters along the SVG's own white -> icon-color blend line. */
export function buildPalette(white, accent) {
  const letters = ['W', 'a', 'b', 'c', 'R']
  const palette = {}
  letters.forEach((letter, index) => {
    const t = index / (letters.length - 1)
    palette[letter] = [0, 1, 2].map(channel => clamp(white[channel] + (accent[channel] - white[channel]) * t))
  })
  return palette
}

function quantize(pixel, palette) {
  if (pixel.a * 255 < ALPHA_MIN) return '.'
  let best = '.'
  let bestDistance = Infinity
  for (const letter of Object.keys(palette)) {
    const target = palette[letter]
    const dr = pixel.r - target[0]
    const dg = pixel.g - target[1]
    const db = pixel.b - target[2]
    const distance = dr * dr + dg * dg + db * db
    if (distance < bestDistance) {
      bestDistance = distance
      best = letter
    }
  }
  return best
}

/** Light palette: the official blend line plus the rim letter (icon accent). */
export function buildLightPalette(palette, accent) {
  return { ...palette, [LIGHT_RIM_LETTER]: accent }
}

/**
 * Repaint every opaque cell that touches transparency with the rim letter.
 * The only transparent region is outside the circle, so this outlines exactly
 * the plate's edge and never touches the icon (it sits on opaque plate cells).
 * @param {string[]} sprite - letter-grid rows.
 * @returns {string[]} A new sprite with the light-theme rim.
 */
export function withContrastRim(sprite) {
  const rows = sprite.map(row => [...row])
  const height = rows.length
  const width = rows[0]?.length ?? 0
  const out = rows.map(row => row.slice())
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (rows[y][x] === '.') continue
      let edge = false
      for (const [dy, dx] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ny = y + dy
        const nx = x + dx
        if (ny < 0 || nx < 0 || ny >= height || nx >= width || rows[ny][nx] === '.') {
          edge = true
          break
        }
      }
      if (edge) out[y][x] = LIGHT_RIM_LETTER
    }
  }
  return out.map(row => row.join(''))
}

/**
 * Add the same contrast rim to the high-definition RGBA raster: blend the
 * outermost band of the circle toward the icon accent while preserving the
 * source alpha (so the rim keeps the mark's anti-aliased outer edge).
 * @param {{width:number,height:number,data:Uint8Array}} raster - RGBA render.
 * @param {ReturnType<typeof parseLogoSvg>} parsed - SVG composition.
 * @param {number[]} accent - icon RGB.
 * @param {number} [width] - rim thickness in viewBox units.
 * @returns {{width:number,height:number,data:Uint8Array}} A new RGBA raster.
 */
export function addContrastRim(raster, parsed, accent, width = LIGHT_RIM_WIDTH) {
  const { width: pixelsWide, height: pixelsHigh, data } = raster
  const view = parsed.viewBox
  const { cx, cy, r } = parsed.circle
  const scaleX = view.width / pixelsWide
  const scaleY = view.height / pixelsHigh
  const out = new Uint8Array(data)
  for (let y = 0; y < pixelsHigh; y++) {
    for (let x = 0; x < pixelsWide; x++) {
      const o = (y * pixelsWide + x) * 4
      if (data[o + 3] === 0) continue
      const vx = (x + 0.5) * scaleX
      const vy = (y + 0.5) * scaleY
      const distance = Math.hypot(vx - cx, vy - cy)
      if (distance > r || distance < r - width) continue
      const weight = Math.min(1, (r - distance) / width)
      for (let c = 0; c < 3; c++) {
        out[o + c] = Math.round(data[o + c] * (1 - weight) + accent[c] * weight)
      }
    }
  }
  return { width: pixelsWide, height: pixelsHigh, data: out }
}

/**
 * Render the SVG to a square sprite of `size` x `size` palette letters padded
 * into the 40-column whale art slot.
 * @param {ReturnType<typeof parseLogoSvg>} parsed - SVG composition.
 * @param {Record<string, number[]>} palette - letter -> RGB.
 * @param {number} size - sprite grid edge (`GRID_WIDE` / `GRID_COMPACT`).
 * @param {{light?:boolean,raster?:{width:number,height:number,data:Uint8Array}}} [options]
 *   `light` adds the light-theme contrast rim; `raster` reuses one SVG render.
 * @returns {{grid:number,sprite:string[]}} Sprite size and letter rows.
 */
export function buildSprite(parsed, palette, size, options = {}) {
  const { light = false, raster = renderLogoSvg(parsed) } = options
  const box = alphaBox(raster)
  const grid = downsampleSquare(raster, box, size)
  const xOffset = Math.floor((ART_COLUMNS - size) / 2)
  const rows = []
  for (let y = 0; y < size; y++) {
    const row = new Array(ART_COLUMNS).fill('.')
    for (let x = 0; x < size; x++) row[xOffset + x] = quantize(grid[y][x], palette)
    rows.push(row.join(''))
  }
  return { grid: size, sprite: light ? withContrastRim(rows) : rows }
}

const monoSymbols = { '.': ' ', W: '#', a: '+', b: '-', c: '=', R: '*' }
function monoRows(sprite) {
  return sprite.map(row => [...row].map(letter => monoSymbols[letter] ?? '?').join(''))
}

/**
 * Parse the SVG and produce both terminal sprites (wide 40x40 + compact 26x26).
 * @param {string} sourcePath - SVG path (defaults to `brand/hyperai-logo.svg`).
 */
export function buildLogoArt(sourcePath = SOURCE) {
  const svg = readFileSync(sourcePath, 'utf8')
  const parsed = parseLogoSvg(svg)
  const white = [255, 255, 255]
  const accent = iconColor(parsed.icon)
  const palette = buildPalette(white, accent)
  const raster = renderLogoSvg(parsed, HD_SIZE)
  const lightPalette = buildLightPalette(palette, accent)
  const wide = buildSprite(parsed, palette, GRID_WIDE, { raster })
  const compact = buildSprite(parsed, palette, GRID_COMPACT, { raster })
  const wideLight = buildSprite(parsed, palette, GRID_WIDE, { raster, light: true })
  const compactLight = buildSprite(parsed, palette, GRID_COMPACT, { raster, light: true })
  const hdPng = encodePng(raster)
  const hdSha256 = createHash('sha256').update(hdPng).digest('hex')
  const lightRaster = addContrastRim(raster, parsed, accent)
  const lightHdPng = encodePng(lightRaster)
  const lightHdSha256 = createHash('sha256').update(lightHdPng).digest('hex')
  return {
    parsed, palette, lightPalette, white, accent,
    wide, compact, wideLight, compactLight,
    hdPng, hdSha256, lightHdPng, lightHdSha256,
  }
}

/** Render the committed JS module. */
export function renderModule(art) {
  const {
    parsed, palette, lightPalette, white, accent,
    wide, compact, wideLight, compactLight,
    hdPng, hdSha256, lightHdPng, lightHdSha256,
  } = art
  const mono = monoRows(wide.sprite).join('\n')
  return `/**
 * GENERATED FILE — do not edit by hand.
 * Terminal logo data for hyperai-tui, generated from the canonical SVG source
 * \`brand/hyperai-logo.svg\` (${parsed.viewBox.width}x${parsed.viewBox.height} viewBox: white circle
 * + embedded ${parsed.icon.width}x${parsed.icon.height} icon painted into a ${parsed.rect.width}x${parsed.rect.height} rect).
 *
 * The build composites the SVG analytically (white circle + icon, 4x4
 * supersampling), then downsamples to two letter-grid sprites in the upstream
 * whale frame format — one palette letter per sprite pixel, \`.\` transparent —
 * so the runtime renders them through the whale's own \`renderSpriteRows\`
 * (true-color half blocks, no image protocol, no recoloring):
 *
 *   wide      ${GRID_WIDE}x${GRID_WIDE} sprite -> ${GRID_WIDE / 2} display rows (main, terminal rows >= ${WIDE_MIN_ROWS})
 *   compact   ${GRID_COMPACT}x${GRID_COMPACT} sprite -> ${GRID_COMPACT / 2} display rows (small windows)
 *
 * Colors come from the SVG itself: white circle ${JSON.stringify(white)}, icon
 * accent ${JSON.stringify(accent)}, and intermediate blends for anti-aliased
 * edges. Transparent pixels stay transparent (terminal background shows through).
 *
 * The same source also provides a ${HD_SIZE}x${HD_SIZE} RGBA PNG (embedded below)
 * for the terminal image protocol path (Kitty Graphics / Sixel): terminals that
 * report graphics support show that PNG directly through the renderer's Image
 * component; everything else keeps the letter-grid fallback above.
 *
 * Light-theme variants: on light terminal backgrounds the official white plate
 * has no contrast (white on white), so the light sprites/PNG add a thin rim
 * along the circle's existing edge using the SVG's own icon accent. No colour
 * is invented and the dark variants stay byte-identical to the official render.
 *
 * Regenerate with:
 *
 *   node scripts/generate-logo-art.mjs
 */

/** Display columns of the art slot (same as the upstream whale box). */
export const HYPERAI_LOGO_COLUMNS = ${ART_COLUMNS}

/** Terminal rows at or above which the wide 40x40 sprite is used. */
export const HYPERAI_LOGO_WIDE_MIN_ROWS = ${WIDE_MIN_ROWS}

/** Sprite rows of the wide variant (half-block: two sprite pixels per display row). */
export const HYPERAI_LOGO_SPRITE_ROWS_WIDE = ${GRID_WIDE}

/** Sprite rows of the compact variant (half-block: two sprite pixels per display row). */
export const HYPERAI_LOGO_SPRITE_ROWS_COMPACT = ${GRID_COMPACT}

/** Palette map, letter -> [r, g, b], read by \`renderSpriteRows\`. */
export const HYPERAI_LOGO_PALETTE = ${JSON.stringify(palette, null, 2)}

/** Wide letter-grid sprite (${GRID_WIDE}x${GRID_WIDE} mark centered in ${ART_COLUMNS} columns). */
export const HYPERAI_LOGO_SPRITE_WIDE = ${JSON.stringify(wide.sprite, null, 2)}

/** Compact letter-grid sprite (${GRID_COMPACT}x${GRID_COMPACT} mark centered in ${ART_COLUMNS} columns). */
export const HYPERAI_LOGO_SPRITE_COMPACT = ${JSON.stringify(compact.sprite, null, 2)}

/** High-definition raster edge in pixels (terminal image protocol path). */
export const HYPERAI_LOGO_HD_SIZE = ${HD_SIZE}

/** sha256 of the embedded high-definition PNG (reproducibility check). */
export const HYPERAI_LOGO_HD_SHA256 = ${JSON.stringify(hdSha256)}

/** Base64 of the ${HD_SIZE}x${HD_SIZE} RGBA PNG generated from the canonical SVG. */
export const HYPERAI_LOGO_HD_PNG_BASE64 = ${JSON.stringify(hdPng.toString('base64'))}

/** Light-theme palette: the official blend line + \`K\` rim in the icon accent. */
export const HYPERAI_LOGO_PALETTE_LIGHT = ${JSON.stringify(lightPalette)}

/** Light-background sprites (official art + contrast rim on the circle edge). */
export const HYPERAI_LOGO_SPRITE_WIDE_LIGHT = ${JSON.stringify(wideLight.sprite, null, 0)}

export const HYPERAI_LOGO_SPRITE_COMPACT_LIGHT = ${JSON.stringify(compactLight.sprite, null, 0)}

/** sha256 of the embedded light-background HD PNG. */
export const HYPERAI_LOGO_HD_SHA256_LIGHT = ${JSON.stringify(lightHdSha256)}

/** Base64 of the light-background ${HD_SIZE}x${HD_SIZE} RGBA PNG (official art + rim). */
export const HYPERAI_LOGO_HD_PNG_BASE64_LIGHT = ${JSON.stringify(lightHdPng.toString('base64'))}

/** Colorless preview of the wide sprite (docs / no-color logs). */
export const HYPERAI_LOGO_MONO = ${JSON.stringify(mono)}
`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const art = buildLogoArt()
  mkdirSync(dirname(OUT_JS), { recursive: true })
  writeFileSync(OUT_JS, renderModule(art))
  writeFileSync(OUT_MONO, monoRows(art.wide.sprite).join('\n') + '\n')
  process.stdout.write(`hyperai-tui: wrote ${OUT_JS}\nhyperai-tui: wrote ${OUT_MONO}\n`)
}
