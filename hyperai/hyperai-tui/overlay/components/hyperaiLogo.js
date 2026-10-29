/**
 * hyperai-tui brand mark.
 *
 * Renders the canonical SVG's mark with the SAME mechanism as the upstream
 * DeepSeek whale (`components/Whale.js`): static letter-grid sprites plus a
 * small fixed palette, painted by the whale's own `renderSpriteRows`. That
 * encoder emits true-color half blocks — `▀` with the upper pixel as foreground
 * and the lower pixel as background, `▄` when only the lower pixel is opaque,
 * `\x1b[49m` (terminal default background) for the empty half of a half-covered
 * cell, and plain spaces plus erase-to-EOL for fully transparent cells — so
 * transparent pixels show the terminal background and no color is painted there.
 *
 * Two generated sprites share the same 40-column art slot:
 *   - wide    40x40 sprite (20 display rows) — the main mark, used on terminals
 *             tall enough for it (`HYPERAI_LOGO_WIDE_MIN_ROWS`);
 *   - compact 26x26 sprite (13 display rows) — small-window degradation, the
 *             height the whale slot originally reserved.
 * `splashArtRows.js` uses the same threshold for the splash layout budget, so
 * the logo and the space reserved for it always agree.
 *
 * The art is pre-rendered at build time from `brand/hyperai-logo.svg`; the
 * runtime never parses SVG/PNG and never recolors the art.
 */
import { jsx as _jsx } from 'react/jsx-runtime'
import { Box, Text, useTerminalSize } from '../ui.js'
import { renderSpriteRows } from './Whale.js'
import {
  HYPERAI_LOGO_COLUMNS,
  HYPERAI_LOGO_PALETTE,
  HYPERAI_LOGO_SPRITE_COMPACT,
  HYPERAI_LOGO_SPRITE_WIDE,
  HYPERAI_LOGO_WIDE_MIN_ROWS,
} from './hyperaiLogoRows.js'

/** Pre-rendered ANSI rows for both variants, computed once at module load — same path as the whale frames. */
const RENDERED_WIDE = renderSpriteRows(HYPERAI_LOGO_SPRITE_WIDE, HYPERAI_LOGO_PALETTE)
const RENDERED_COMPACT = renderSpriteRows(HYPERAI_LOGO_SPRITE_COMPACT, HYPERAI_LOGO_PALETTE)

/**
 * The splash brand mark.
 * @param props - `width` pins the art box width (upstream passes its whale-box
 * constant); omitted, the mark uses its own column count.
 */
export function HyperAILogoArt({ width }) {
  const { rows } = useTerminalSize()
  const rendered = rows >= HYPERAI_LOGO_WIDE_MIN_ROWS ? RENDERED_WIDE : RENDERED_COMPACT
  return _jsx(Box, {
    flexDirection: 'column',
    flexShrink: 0,
    width: width ?? HYPERAI_LOGO_COLUMNS,
    children: rendered.map((row, index) => _jsx(Text, { wrap: 'truncate-end', children: row }, index)),
  })
}
