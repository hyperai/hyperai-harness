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
import { Box, Image, Text, useTerminalImageCellSize, useTerminalImages, useTerminalSize, useTheme } from '../ui.js'
import { isLightThemeActive } from '../theme.js'
import { DEFAULT_TERMINAL_CELL_SIZE } from '../ink/terminal-image.js'
import { loadSharp } from '../dsh-adapter/sharp.js'
import { renderSpriteRows } from './Whale.js'
import {
  HYPERAI_LOGO_COLUMNS,
  HYPERAI_LOGO_HD_PNG_BASE64,
  HYPERAI_LOGO_HD_PNG_BASE64_LIGHT,
  HYPERAI_LOGO_HD_SIZE,
  HYPERAI_LOGO_PALETTE,
  HYPERAI_LOGO_PALETTE_LIGHT,
  HYPERAI_LOGO_SPRITE_COMPACT,
  HYPERAI_LOGO_SPRITE_COMPACT_LIGHT,
  HYPERAI_LOGO_SPRITE_ROWS_COMPACT,
  HYPERAI_LOGO_SPRITE_ROWS_WIDE,
  HYPERAI_LOGO_SPRITE_WIDE,
  HYPERAI_LOGO_SPRITE_WIDE_LIGHT,
  HYPERAI_LOGO_WIDE_MIN_ROWS,
} from './hyperaiLogoRows.js'

/**
 * Pre-rendered ANSI rows, one per variant, computed once at module load — the
 * same whale renderer path as the upstream frames.
 *
 * `light` variants add a rim along the circle's existing edge using the SVG's
 * own icon accent: the official white plate (#FFFFFF) has 1:1 contrast on a
 * pure-white terminal background (Orca / VS Code / iTerm2 light themes), where
 * the mark otherwise disappears. Dark terminals keep the exact official art.
 */
const RENDERED = {
  dark: {
    wide: renderSpriteRows(HYPERAI_LOGO_SPRITE_WIDE, HYPERAI_LOGO_PALETTE),
    compact: renderSpriteRows(HYPERAI_LOGO_SPRITE_COMPACT, HYPERAI_LOGO_PALETTE),
  },
  light: {
    wide: renderSpriteRows(HYPERAI_LOGO_SPRITE_WIDE_LIGHT, HYPERAI_LOGO_PALETTE_LIGHT),
    compact: renderSpriteRows(HYPERAI_LOGO_SPRITE_COMPACT_LIGHT, HYPERAI_LOGO_PALETTE_LIGHT),
  },
}

/** HD PNG payload per variant (dark = official render, light = official + rim). */
const HD_PAYLOAD = {
  dark: HYPERAI_LOGO_HD_PNG_BASE64,
  light: HYPERAI_LOGO_HD_PNG_BASE64_LIGHT,
}
/** Decoded high-definition RGBA sources, cached per variant for the process lifetime. */
const hdSourceCache = new Map()
/** In-flight / failed decode markers per variant (a failure is not retried every render). */
const hdDecode = new Map()

/**
 * Decode one embedded 512x512 PNG through the same `sharp` loader upstream
 * portraits use (host copy first, this package's optional copy second).
 * A failed decode is remembered so it never stalls a frame.
 * @param {'dark'|'light'} variant - Which embedded payload to decode.
 * @returns The RGBA source, or `undefined` when decoding is unavailable.
 */
async function decodeHdLogo(variant) {
  if (hdSourceCache.has(variant)) return hdSourceCache.get(variant)
  if (hdDecode.has(variant)) return hdDecode.get(variant)
  const pending = (async () => {
    try {
      const sharp = await loadSharp()
      if (sharp === undefined) return undefined
      const decoded = await sharp(Buffer.from(HD_PAYLOAD[variant], 'base64'), { failOn: 'error' })
        .toColourspace('srgb')
        .ensureAlpha()
        .raw()
        .toBuffer({ resolveWithObject: true })
      const { channels, width, height } = decoded.info
      if (channels !== 4 || width !== HYPERAI_LOGO_HD_SIZE || height !== HYPERAI_LOGO_HD_SIZE) {
        return undefined
      }
      const source = {
        data: new Uint8Array(decoded.data.buffer, decoded.data.byteOffset, decoded.data.byteLength),
        width,
        height,
      }
      hdSourceCache.set(variant, source)
      return source
    } catch {
      return undefined
    }
  })()
  hdDecode.set(variant, pending)
  return pending
}

/**
 * Decode lazily, only after the renderer confirms terminal image capability.
 * @param enabled - `useTerminalImages()` result; decode is skipped when false.
 * @param variant - Theme-selected payload (dark = official, light = rimmed).
 * @returns The RGBA source once decoded, else `undefined` (sprite fallback).
 */
function useHdLogo(enabled, variant) {
  const [source, setSource] = React.useState(undefined)
  React.useEffect(() => {
    if (!enabled) return
    let live = true
    setSource(undefined)
    void decodeHdLogo(variant).then(next => {
      if (live && next !== undefined) setSource(next)
    })
    return () => {
      live = false
    }
  }, [enabled, variant])
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
  // Light terminals (pure-white Orca/VS Code/iTerm2 backgrounds) need the
  // contrast rim, otherwise the white plate vanishes into the background.
  const [themeName] = useTheme()
  const variant = isLightThemeActive(themeName) ? 'light' : 'dark'
  const rendered = RENDERED[variant][wide ? 'wide' : 'compact']
  const imagesAvailable = useTerminalImages(true)
  const source = useHdLogo(imagesAvailable, variant)
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
