/**
 * hyperai-tui brand mark.
 *
 * Renders the official HyperAI mark with the SAME mechanism as the upstream
 * DeepSeek whale (`components/Whale.js`): a static letter-grid sprite plus a
 * small fixed palette, painted by the whale's own `renderSpriteRows`. That
 * encoder emits true-color half blocks — `▀` with the upper pixel as foreground
 * and the lower pixel as background, `▄` when only the lower pixel is opaque,
 * `\x1b[49m` (terminal default background) for the empty half of a half-covered
 * cell, and plain spaces with an erase-to-EOL for fully transparent cells — so
 * transparent margins show the terminal background and no black is painted.
 *
 * The sprite is generated from `brand/hyperai-logo.png` by
 * `scripts/generate-logo-art.mjs` in the whale's own data format: one palette
 * letter per sprite pixel (`W` white plate, `p` pale-pink edge, `P` official
 * pink, `.` transparent). No image protocol is used, exactly like the whale.
 *
 * The art slot keeps the upstream contract: a fixed-width box of pre-rendered
 * ANSI rows, one row per `Text` child, so the splash layout measured for the
 * whale works unchanged.
 */
import { jsx as _jsx } from 'react/jsx-runtime'
import { Box, Text } from '../ui.js'
import { renderSpriteRows } from './Whale.js'
import { HYPERAI_LOGO_COLUMNS, HYPERAI_LOGO_PALETTE, HYPERAI_LOGO_SPRITE } from './hyperaiLogoRows.js'

/** Pre-rendered ANSI rows, computed once at module load — same path as the whale frames. */
const RENDERED = renderSpriteRows(HYPERAI_LOGO_SPRITE, HYPERAI_LOGO_PALETTE)

/**
 * The splash brand mark.
 * @param props - `width` pins the art box width (upstream passes its whale-box
 * constant); omitted, the mark uses its own column count.
 */
export function HyperAILogoArt({ width }) {
  return _jsx(Box, {
    flexDirection: 'column',
    flexShrink: 0,
    width: width ?? HYPERAI_LOGO_COLUMNS,
    children: RENDERED.map((row, index) => _jsx(Text, { wrap: 'truncate-end', children: row }, index)),
  })
}
