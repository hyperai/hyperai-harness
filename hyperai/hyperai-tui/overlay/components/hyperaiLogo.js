/**
 * hyperai-tui brand mark.
 *
 * Renders the official HyperAI mark — downsampled from `brand/hyperai-logo.png`
 * by `scripts/generate-logo-art.mjs` — in the splash art slot that upstream
 * `@deepseek-harness-tui/dsh-tui` fills with the DeepSeek whale. The mark is a
 * copied, resampled asset, never a redrawn logo.
 *
 * Two color variants keep the mark legible in both terminal backgrounds: the
 * official colors on dark terminals, and the same artwork with the white plate
 * mapped to an ink tone on light terminals. The official pink accents survive
 * unchanged in both.
 *
 * `HyperAILogoArt` keeps the upstream art slot's contract: a fixed-width box of
 * pre-rendered ANSI rows, one row per `Text` child, so the splash layout that
 * upstream measures for the whale keeps working unchanged.
 */
import { jsx as _jsx } from 'react/jsx-runtime'
import { Box, Text } from '../ui.js'
import { isLightThemeActive } from '../theme.js'
import { useTheme } from './design-system/ThemeProvider.js'
import { HYPERAI_LOGO_COLUMNS, HYPERAI_LOGO_ROWS_DARK, HYPERAI_LOGO_ROWS_LIGHT } from './hyperaiLogoRows.js'

/**
 * The splash brand mark.
 * @param props - `width` pins the art box width (upstream passes its whale-box
 * constant); omitted, the mark uses its own column count.
 */
export function HyperAILogoArt({ width }) {
  const [themeName] = useTheme()
  const rows = isLightThemeActive(themeName) ? HYPERAI_LOGO_ROWS_LIGHT : HYPERAI_LOGO_ROWS_DARK
  return _jsx(Box, {
    flexDirection: 'column',
    flexShrink: 0,
    width: width ?? HYPERAI_LOGO_COLUMNS,
    children: rows.map((row, index) => _jsx(Text, { wrap: 'truncate-end', children: row }, index)),
  })
}
