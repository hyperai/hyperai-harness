#!/usr/bin/env node
/**
 * Generate the terminal logo art for hyperai-tui from the OFFICIAL HyperAI logo
 * source image (`brand/hyperai-logo.png`), using the SAME rendering mechanism
 * as the upstream DeepSeek whale: a static letter-grid sprite plus a small
 * fixed palette, rendered to true-color half-block rows by the whale's own
 * `renderSpriteRows`.
 *
 * The upstream whale (`components/Whale.js` + `components/whaleFrames.js`) is
 * pre-encoded art, one palette letter per sprite pixel (`. ` = transparent),
 * painted by `renderCellRows`: `▀` with fg = upper pixel / bg = lower pixel,
 * `▄` when only the lower pixel is opaque, and the terminal default background
 * (`\x1b[49m`) for the empty half of a half-covered cell. No image protocol is
 * involved and no color is invented at render time.
 *
 * This script converts the official raster into that data shape:
 *   1. alpha bounding box -> square 26x26 box-downsample (half-block gives
 *      13 display rows, the whale slot's height);
 *   2. per-pixel quantization to the source's own white→pink blend palette
 *      (W white plate, p pale-pink edge, P official pink, `.` transparent);
 *   3. the 26x26 mark centered in the whale's 40-column slot (7 transparent
 *      columns each side), exactly like the whale frames' letter rows.
 *
 * Output: `brand/generated/hyperai-logo.js` (committed; the runtime never
 * parses PNG and never recolors the art). Re-run after replacing the source:
 *
 *   node scripts/generate-logo-art.mjs
 *
 * Requires only Node built-ins (zlib) — no image library.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { inflateSync } from 'node:zlib'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const PKG = join(HERE, '..')
const SOURCE = join(PKG, 'brand', 'hyperai-logo.png')
const OUT_JS = join(PKG, 'brand', 'generated', 'hyperai-logo.js')
const OUT_MONO = join(PKG, 'brand', 'generated', 'hyperai-logo.txt')

/** Splash art slots (must match the TUI's water-whale layout constants). */
export const ART_COLUMNS = 40
export const ART_ROWS = 13
/** Square mark size in sprite pixels (half-block: one display row = 2 pixels). */
const MARK = 26
const X_OFFSET = Math.floor((ART_COLUMNS - MARK) / 2)
/** Alpha at or above this is treated as covered; below it the cell stays empty. */
const ALPHA_MIN = 128
/**
 * Below this spatial size the official mark is downsampled to noise, not a logo.
 * The canonical HyperAI asset (brand/hyperai-logo.png) is 60x60, still ~2.3x the
 * 26x26 sprite; 48 is the floor that keeps the mark recognizable.
 */
const MIN_SOURCE = 48

/**
 * Decode an 8-bit non-interlaced RGB/RGBA PNG into straight RGBA bytes.
 * Supports the subset the brand source uses (and most exported logos): 8-bit
 * true-color with or without alpha, no interlacing, no palette.
 * @param {Buffer} buf - PNG file bytes.
 * @returns {{width: number, height: number, data: Uint8Array}} Decoded pixels.
 */
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

/** Bounding box of pixels with alpha > 0. */
function alphaBox(image) {
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
  if (maxX < 0) throw new Error('logo source is fully transparent')
  return { x: minX, y: minY, width: maxX - minX + 1, height: maxY - minY + 1 }
}

/**
 * Box-downsample the (square-padded) official mark to `size` x `size`.
 * Alpha-weighted so transparent margins do not bleed dark fringes into edges.
 * @returns {{r:number,g:number,b:number,a:number}[][]} Pixel rows.
 */
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
      let a = 0
      let weight = 0
      for (let sy = y0; sy < y1; sy++) {
        const sourceY = box.y + sy - padY
        if (sourceY < 0 || sourceY >= image.height) continue
        for (let sx = x0; sx < x1; sx++) {
          const sourceX = box.x + sx - padX
          if (sourceX < 0 || sourceX >= image.width) continue
          const o = (sourceY * image.width + sourceX) * 4
          const alpha = image.data[o + 3] / 255
          r += image.data[o] * alpha
          g += image.data[o + 1] * alpha
          b += image.data[o + 2] * alpha
          a += alpha
          weight += 1
        }
      }
      if (a === 0 || weight === 0) row.push({ r: 0, g: 0, b: 0, a: 0 })
      else row.push({ r: r / a, g: g / a, b: b / a, a: a / weight })
    }
    rows.push(row)
  }
  return rows
}

/**
 * Palette alphabet, the same letter-grid convention as the upstream whale:
 * `W` white plate · `p` pale-pink edge blend · `P` official pink · `.` transparent.
 * Every entry is derived from the source raster's own white→pink blend line, so
 * no hue is invented and the white plate stays white.
 */
export const PALETTE = {
  W: [255, 255, 255],
  p: [255, 166, 196],
  P: [255, 96, 150],
}
const PALETTE_LETTERS = Object.keys(PALETTE)

/**
 * Quantize one downsampled pixel to the palette: transparent below the alpha
 * threshold, otherwise the nearest entry (nearest along the source's own
 * white→pink blend line).
 * @param {{r:number,g:number,b:number,a:number}} pixel - Downsampled pixel.
 * @returns {string} One palette letter, or `.` for transparent.
 */
function quantize(pixel) {
  if (pixel.a * 255 < ALPHA_MIN) return '.'
  let best = '.'
  let bestDistance = Infinity
  for (const letter of PALETTE_LETTERS) {
    const target = PALETTE[letter]
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

/** Colorless character art for docs and for terminals logged without color. */
function monoRows(sprite) {
  const glyphs = { '.': ' ', W: '#', p: '+', P: '*' }
  return sprite.map(row => [...row].map(letter => glyphs[letter] ?? '?').join(''))
}

/**
 * Convert the official raster to the whale's letter-grid sprite format.
 * @param {string} sourcePath - PNG path (defaults to `brand/hyperai-logo.png`).
 * @returns {{image: object, box: object, sprite: string[]}} Sprite plus source metadata.
 */
export function buildLogoSprite(sourcePath = SOURCE) {
  const image = decodePng(readFileSync(sourcePath))
  if (Math.min(image.width, image.height) < MIN_SOURCE) {
    throw new Error(`logo source is too small (${image.width}x${image.height}); need >= ${MIN_SOURCE}px`)
  }
  const box = alphaBox(image)
  const mark = downsampleSquare(image, box, MARK)
  const sprite = []
  for (let y = 0; y < ART_ROWS * 2; y++) {
    const row = new Array(ART_COLUMNS).fill('.')
    for (let x = 0; x < MARK; x++) row[X_OFFSET + x] = quantize(mark[y][x])
    sprite.push(row.join(''))
  }
  return { image, box, sprite }
}

/** Render the committed JS module for one sprite. */
export function renderModule(art) {
  const mono = monoRows(art.sprite).join('\n')
  return `/**
 * GENERATED FILE — do not edit by hand.
 * Terminal logo data for hyperai-tui in the SAME letter-grid format as the
 * upstream whale frames: one palette letter per sprite pixel, \`.\` transparent.
 * Derived from \`brand/hyperai-logo.png\` (${art.image.width}x${art.image.height} PNG,
 * mark bbox ${art.box.width}x${art.box.height}, ${MARK}x${MARK} sprite centered in the
 * whale's ${ART_COLUMNS}-column slot -> ${ART_ROWS} display rows of half blocks).
 * Rendered at runtime by the whale's own \`renderSpriteRows\` (components/Whale.js).
 * Regenerate with:
 *
 *   node scripts/generate-logo-art.mjs
 *
 * The mark is a downsampled copy of the official artwork, never a redraw: the
 * white plate stays white, the pink pattern keeps its official color, and the
 * transparent margin stays transparent (terminal background shows through).
 */

/** Display columns of the art slot (same as the upstream whale box). */
export const HYPERAI_LOGO_COLUMNS = ${ART_COLUMNS}
/** Sprite rows (half-block: two sprite pixels per display row). */
export const HYPERAI_LOGO_SPRITE_ROWS = ${ART_ROWS * 2}

/** Palette map, letter -> [r, g, b], read by \`renderSpriteRows\`. */
export const HYPERAI_LOGO_PALETTE = ${JSON.stringify(PALETTE, null, 2)}

/** Letter-grid sprite rows (whale frame format). */
export const HYPERAI_LOGO_SPRITE = ${JSON.stringify(art.sprite, null, 2)}

/** Colorless preview of the same sprite (docs / no-color logs). */
export const HYPERAI_LOGO_MONO = ${JSON.stringify(mono)}
`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const art = buildLogoSprite()
  mkdirSync(dirname(OUT_JS), { recursive: true })
  writeFileSync(OUT_JS, renderModule(art))
  writeFileSync(OUT_MONO, monoRows(art.sprite).join('\n') + '\n')
  process.stdout.write(`hyperai-tui: wrote ${OUT_JS}\nhyperai-tui: wrote ${OUT_MONO}\n`)
}
