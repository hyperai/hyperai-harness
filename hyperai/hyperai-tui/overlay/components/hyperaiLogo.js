/**
 * hyperai-tui brand mark.
 *
 * The canonical SVG (`brand/hyperai-logo.svg`) is generated into two forms:
 *
 *  1. a 512x512 RGBA PNG embedded in `hyperaiLogoRows.js` — used only when the
 *     renderer reports terminal graphics support (Kitty Graphics / Sixel). The
 *     PNG is decoded through the same `sharp` loader the upstream portraits use
 *     and painted by the existing upstream `Image` component, so the terminal
 *     shows the original artwork: full-color, anti-aliased edges, transparent
 *     background (the terminal background shows through);
 *  2. two whale-format letter-grid sprites (wide 40x40 / compact 26x26) — the
 *     ANSI fallback for terminals without graphics, rendered through the
 *     upstream whale's `renderSpriteRows` exactly as before.
 *
 * The wide/compact choice is shared with the splash layout budget
 * (`splashArtRows()` in `splashArtRows.js`): both read the terminal height and
 * use `HYPERAI_LOGO_WIDE_MIN_ROWS`, so switching between the high-definition
 * image and the sprite fallback (or shrinking the window) never changes the
 * layout height. The art slot is a fixed-size box; the image is aspect-fitted
 * inside it and never overlaps the title, composer or footer.
 *
 * Detection is the renderer's own capability probe (never the terminal name):
 * it also disables images under tmux/screen, in non-TTY runs and when
 * `DSH_TUI_DISABLE_TERMINAL_IMAGES` is set, falling back to the sprite path.
 */
import React from 'react'
import { jsx as _jsx } from 'react/jsx-runtime'
import { Box, Image, Text, useTerminalImageCellSize, useTerminalImages, useTerminalSize } from '../ui.js'
import { DEFAULT_TERMINAL_CELL_SIZE } from '../ink/terminal-image.js'
import { loadSharp } from '../dsh-adapter/sharp.js'
import { renderSpriteRows } from './Whale.js'
import {
  HYPERAI_LOGO_COLUMNS,
  HYPERAI_LOGO_HD_PNG_BASE64,
  HYPERAI_LOGO_HD_SIZE,
  HYPERAI_LOGO_PALETTE,
  HYPERAI_LOGO_SPRITE_COMPACT,
  HYPERAI_LOGO_SPRITE_ROWS_COMPACT,
  HYPERAI_LOGO_SPRITE_ROWS_WIDE,
  HYPERAI_LOGO_SPRITE_WIDE,
  HYPERAI_LOGO_WIDE_MIN_ROWS,
} from './hyperaiLogoRows.js'

/** Pre-rendered ANSI rows for both variants, computed once at module load — same path as the whale frames. */
const RENDERED_WIDE = renderSpriteRows(HYPERAI_LOGO_SPRITE_WIDE, HYPERAI_LOGO_PALETTE)
const RENDERED_COMPACT = renderSpriteRows(HYPERAI_LOGO_SPRITE_COMPACT, HYPERAI_LOGO_PALETTE)

/** Decoded high-definition RGBA source, cached for the process lifetime. */
let hdSourceCache
/** Whether the HD decode has run (a failed decode is not retried every render). */
let hdSourceResolved = false

/**
 * Decode the embedded 512x512 PNG through the same `sharp` loader upstream
 * portraits use (host copy first, this package's optional copy second).
 * @returns The RGBA source, or `undefined` when decoding is unavailable.
 */
async function decodeHdLogo() {
  if (hdSourceResolved) return hdSourceCache
  hdSourceResolved = true
  try {
    const sharp = await loadSharp()
    if (sharp === undefined) return undefined
    const decoded = await sharp(Buffer.from(HYPERAI_LOGO_HD_PNG_BASE64, 'base64'), { failOn: 'error' })
      .toColourspace('srgb')
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true })
    const { channels, width, height } = decoded.info
    if (channels !== 4 || width !== HYPERAI_LOGO_HD_SIZE || height !== HYPERAI_LOGO_HD_SIZE) {
      return undefined
    }
    hdSourceCache = {
      data: new Uint8Array(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength),
      width,
      height,
    }
    return hdSourceCache
  } catch {
    return undefined
  }
}

/**
 * Decode lazily, only after the renderer confirms terminal image capability.
 * @param enabled - `useTerminalImages()` result; decode is skipped when false.
 * @returns The RGBA source once decoded, else `undefined` (sprite fallback).
 */
function useHdLogo(enabled) {
  const [source, setSource] = React.useState(undefined)
  React.useEffect(() => {
    if (!enabled) return
    let live = true
    void decodeHdLogo().then(next => {
      if (live && next !== undefined) setSource(next)
    })
    return () => {
      live = false
    }
  }, [enabled])
  return enabled ? source : undefined
}

/**
 * The splash brand mark.
 * @param props - `width` pins the art box width (upstream passes its whale-box
 * constant); omitted, the mark uses its own column count.
 */
export function HyperAILogoArt({ width }) {
  const maxColumns = width ?? HYPERAI_LOGO_COLUMNS
  const { rows: terminalRows } = useTerminalSize()
  const wide = terminalRows >= HYPERAI_LOGO_WIDE_MIN_ROWS
  const artRows = (wide ? HYPERAI_LOGO_SPRITE_ROWS_WIDE : HYPERAI_LOGO_SPRITE_ROWS_COMPACT) / 2
  const rendered = wide ? RENDERED_WIDE : RENDERED_COMPACT
  const imagesAvailable = useTerminalImages(true)
  const source = useHdLogo(imagesAvailable)
  const cell = useTerminalImageCellSize() ?? DEFAULT_TERMINAL_CELL_SIZE

  const sprite = _jsx(Box, {
    flexDirection: 'column',
    flexShrink: 0,
    width: maxColumns,
    children: rendered.map((row, index) => _jsx(Text, { wrap: 'truncate-end', children: row }, index)),
  })
  // Fixed-height wrapper shared by the image and the sprite: both occupy exactly
  // `artRows` rows, so the splash layout does not move when graphics come on/off.
  const slot = child =>
    _jsx(Box, {
      width: maxColumns,
      height: artRows,
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      flexShrink: 0,
      children: child,
    })

  if (!imagesAvailable || source === undefined) return slot(sprite)

  // Aspect-fit the square PNG into the art box using the measured cell aspect.
  const cellRatio = cell.height / cell.width
  const ratio = source.width / source.height
  let imageRows = Math.min(artRows, Math.floor(maxColumns / (cellRatio * ratio)))
  imageRows = Math.max(1, imageRows)
  const imageColumns = Math.max(1, Math.min(maxColumns, Math.round(cellRatio * ratio * imageRows)))
  return slot(
    _jsx(Image, {
      transparent: true,
      source,
      width: imageColumns,
      height: imageRows,
      alt: '',
      presentation: 'transcript',
    }),
  )
}
