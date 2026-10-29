#!/usr/bin/env node
/**
 * Generate the terminal logo art for hyperai-tui from the OFFICIAL HyperAI logo
 * source image (`brand/hyperai-logo.png`).
 *
 * The logo is not redrawn: this script only downsamples the official raster to
 * the splash-art pixel grid and encodes it as true-color half-block rows that
 * the TUI renders instead of the upstream DeepSeek whale. Two variants are
 * emitted so the mark stays legible in both terminal backgrounds:
 *
 *   dark  — the official colors on a dark terminal (white mark, pink accents)
 *   light — the official accent colors with the white plate mapped to an ink
 *           tone (a contrast adaptation for light terminals, not a redraw)
 *
 * Output: `brand/generated/hyperai-logo.js` (committed; the runtime never
 * parses PNG). Re-run after replacing the source image:
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

const fg = ([r, g, b]) => `\x1b[38;2;${r};${g};${b}m`
const bg = ([r, g, b]) => `\x1b[48;2;${r};${g};${b}m`
const BG_DEFAULT = '\x1b[49m'
const RESET = '\x1b[0m'
const ERASE_TO_EOL = '\x1b[K'

/**
 * Encode a sprite grid to true-color half-block ANSI rows, mirroring the TUI's
 * own whale encoder so the patched art blends with the existing renderer.
 * @param {(x:number, y:number) => [number,number,number]|undefined} pixel - Sprite pixel lookup.
 */
function encodeHalfBlockRows(pixel) {
  const rows = []
  for (let y = 0; y < ART_ROWS * 2; y += 2) {
    let out = ''
    let current = ''
    for (let x = 0; x < ART_COLUMNS; x++) {
      const top = pixel(x, y)
      const bottom = pixel(x, y + 1)
      let sequence
      let char
      if (top !== undefined && bottom !== undefined) {
        sequence = fg(top) + bg(bottom)
        char = '▀'
      } else if (top !== undefined) {
        sequence = fg(top) + BG_DEFAULT
        char = '▀'
      } else if (bottom !== undefined) {
        sequence = fg(bottom) + BG_DEFAULT
        char = '▄'
      } else {
        sequence = ''
        char = ' '
      }
      if (sequence !== current) {
        out += sequence === '' ? RESET : sequence
        current = sequence
      }
      out += char
    }
    let row = out
    if (!row.endsWith(RESET)) row += RESET
    rows.push(row + ERASE_TO_EOL)
  }
  return rows
}

const clamp = value => Math.max(0, Math.min(255, Math.round(value)))

/** Opaque mark pixels; light terminals get the white plate mapped to ink. */
function visiblePixels(sprite, variant) {
  const rows = []
  for (let y = 0; y < ART_ROWS * 2; y++) {
    const row = []
    for (let x = 0; x < ART_COLUMNS; x++) {
      const sx = x - X_OFFSET
      if (sx < 0 || sx >= MARK) {
        row.push(undefined)
        continue
      }
      const pixel = sprite[y][sx]
      if (pixel.a * 255 < ALPHA_MIN) {
        row.push(undefined)
        continue
      }
      let { r, g, b } = pixel
      if (variant === 'light') {
        const max = Math.max(r, g, b)
        const min = Math.min(r, g, b)
        const saturation = max === 0 ? 0 : (max - min) / max
        // White/near-white plate → ink. Keep the official pink accents.
        if (max > 200 && saturation < 0.2) {
          r = 26
          g = 26
          b = 32
        }
      }
      row.push([clamp(r), clamp(g), clamp(b)])
    }
    rows.push(row)
  }
  return rows
}

/** Monochrome character art for docs and for terminals logged without color. */
function monoRows(grid) {
  const glyphs = ' .:-=+*#%@'
  return grid.map(row =>
    row
      .map(pixel => {
        if (pixel === undefined) return ' '
        const luminance = (0.299 * pixel[0] + 0.587 * pixel[1] + 0.114 * pixel[2]) / 255
        const index = Math.min(glyphs.length - 1, Math.max(0, Math.round(luminance * (glyphs.length - 1))))
        return glyphs[index]
      })
      .join(''),
  )
}

function literal(rows) {
  return `[\n${rows.map(row => `  ${JSON.stringify(row)},`).join('\n')}\n]`
}

export function buildLogoArt(sourcePath = SOURCE) {
  const image = decodePng(readFileSync(sourcePath))
  if (Math.min(image.width, image.height) < MIN_SOURCE) {
    throw new Error(`logo source is too small (${image.width}x${image.height}); need >= ${MIN_SOURCE}px`)
  }
  const box = alphaBox(image)
  const sprite = downsampleSquare(image, box, MARK)
  const dark = encodeHalfBlockRows((x, y) => visiblePixels(sprite, 'dark')[y][x])
  const light = encodeHalfBlockRows((x, y) => visiblePixels(sprite, 'light')[y][x])
  return { image, box, sprite, dark, light }
}

export function renderModule(art) {
  const mono = monoRows(visiblePixels(art.sprite, 'dark')).join('\n')
  return `/**
 * GENERATED FILE — do not edit by hand.
 * Terminal logo art for hyperai-tui, derived from the official HyperAI mark at
 * \`brand/hyperai-logo.png\` (${art.image.width}x${art.image.height} PNG, mark bbox
 * ${art.box.width}x${art.box.height}, ${MARK}x${MARK} sprite, ${ART_COLUMNS}x${ART_ROWS} display cells).
 * Regenerate with:
 *
 *   node scripts/generate-logo-art.mjs
 *
 * The mark is a downsampled copy of the official artwork, never a redraw. The
 * \`light\` variant maps the white plate to an ink tone so the mark stays legible
 * on light terminals; the official pink accents are unchanged in both variants.
 */

/** Display columns of one logo row (matches the splash art box width). */
export const HYPERAI_LOGO_COLUMNS = ${ART_COLUMNS}
/** Display rows of the logo art (half-block: 2 sprite pixels per row). */
export const HYPERAI_LOGO_ROWS_COUNT = ${ART_ROWS}

/** True-color half-block rows for dark terminals (official colors). */
export const HYPERAI_LOGO_ROWS_DARK = ${literal(art.dark)}

/** True-color half-block rows for light terminals (ink plate adaptation). */
export const HYPERAI_LOGO_ROWS_LIGHT = ${literal(art.light)}

/** Colorless character-art preview of the same sprite (docs / no-color logs). */
export const HYPERAI_LOGO_MONO = ${JSON.stringify(mono)}
`
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const art = buildLogoArt()
  mkdirSync(dirname(OUT_JS), { recursive: true })
  writeFileSync(OUT_JS, renderModule(art))
  writeFileSync(OUT_MONO, monoRows(visiblePixels(art.sprite, 'dark')).join('\n') + '\n')
  process.stdout.write(`hyperai-tui: wrote ${OUT_JS}\nhyperai-tui: wrote ${OUT_MONO}\n`)
}
