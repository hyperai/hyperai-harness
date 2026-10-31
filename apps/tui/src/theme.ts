/**
 * HyperAI brand palette for the TUI. Every color decision is a 24-bit hex
 * token so text renders identically across terminals — no ANSI `dim` or
 * 16-color names whose rendering varies by emulator. Foreground tokens cover
 * interactive, stateful, and brand elements; background tokens fill the
 * full-screen panels the OpenTUI surface paints.
 * @module @hyperai/hyperai-harness-tui/theme
 */

/** One colored text run for {@link StyledText} chunk lists. */
export interface Chunk {
  /** The run's text. */
  text: string
  /** Foreground color hex. */
  fg?: string
  /** Bold weight. */
  bold?: boolean
}

/** HyperAI brand tokens. */
export const theme = {
  /** HyperAI Indigo — brand banner, active input border, headings. */
  primary: '#7C5CFF',
  /** Electric Cyan — section headers, meters, streaming accents. */
  secondary: '#22D3EE',
  /** Orchid — active model badge. */
  accent: '#A78BFA',
  /** Thought Purple — reasoning/thinking content. */
  reasoning: '#C084FC',
  /** Mint Emerald — approve, running-ok, workspace-write. */
  success: '#34D399',
  /** Amber Sun — shell/warning, approval prompts. */
  warning: '#FBBF24',
  /** Coral Red — errors, reject, danger. */
  error: '#F87171',
  /** Slate Gray — hints, footers, secondary lines. */
  muted: '#8B94A7',
  /** Panel background (header, composer). */
  surface: '#10131C',
  /** Screen background. */
  background: '#0A0C12',
  /** Dim border between panels. */
  border: '#2A3142',
} as const

/**
 * Build a colored chunk.
 * @param text - the run's text.
 * @param fg - foreground hex; omitted keeps the default foreground.
 * @param bold - bold weight.
 * @returns the chunk for a StyledText list.
 */
export function chunk(text: string, fg?: string, bold?: boolean): Chunk {
  return { text, ...fg === undefined ? {} : { fg }, ...bold === undefined ? {} : { bold } }
}
