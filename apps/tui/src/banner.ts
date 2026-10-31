/**
 * The HyperAI startup banner: a compact block-art wordmark with a gradient
 * fill plus the session info rows below it. Pure data — the view renders the
 * chunks; nothing here touches a renderable.
 * @module @hyperai/hyperai-harness-tui/banner
 */

import { type Chunk, chunk, theme } from './theme.ts'

/** Block-art "HYPERAI" wordmark, six rows, ANSI-Shadow style. */
const LOGO_ROWS = [
  ' ██╗  ██╗██╗   ██╗██████╗ ███████╗██████╗  █████╗ ██╗',
  ' ██║  ██║╚██╗ ██╔╝██╔══██╗██╔════╝██╔══██╗██╔══██╗██║',
  ' ███████║ ╚████╔╝ ██████╔╝█████╗  ██████╔╝███████║██║',
  ' ╚════██║  ╚██╔╝  ██╔═══╝ ██╔══╝  ██╔══██╗██╔══██║██║',
  ' ██║  ██║   ██║   ██║     ███████╗██║  ██║██║  ██║██║',
  ' ╚═╝  ╚═╝   ╚═╝   ╚═╝     ╚══════╝╚═╝  ╚═╝╚═╝  ╚═╝╚═╝',
] as const

/** Product version shown beside the wordmark. */
export const TUI_VERSION = '0.1.0'

/**
 * Build the welcome banner lines for the top of the transcript.
 * @param info - session info rows shown under the wordmark.
 * @returns one chunk list per banner row.
 */
export function bannerLines(info: { session: string; model: string; cwd: string }): Chunk[][] {
  const rows: Chunk[][] = LOGO_ROWS.map((row, index) => {
    // Indigo at the top fading to cyan at the bottom of the wordmark.
    const fg = index < 3 ? theme.primary : theme.secondary
    return [chunk(row, fg, true)]
  })
  rows.push([chunk('  HyperAI TUI', theme.accent, true), chunk(` v${TUI_VERSION}`, theme.muted)])
  rows.push([chunk(`  ${info.model}`, theme.muted)])
  rows.push([chunk(`  ${info.cwd}`, theme.muted)])
  rows.push([chunk(`  session ${info.session}`, theme.muted)])
  return rows
}
