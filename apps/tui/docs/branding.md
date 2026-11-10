# Branding: HyperAI Harness pixel wordmark

## Product decision

The HyperAI TUI shows **no logo**. The startup splash is the large pixel wordmark

```text
HYPERAI
HARNESS
```

rendered by the upstream big-font renderer with the product pink `#FF6096`
(255, 96, 150). There is no SVG, PNG, ANSI sprite, whale, mascot or image
placeholder: the splash hero is the wordmark, so removing the logo leaves no
empty block and no reserved art rows.

The pixel font is upstream's, unchanged. The patch only changes which words the
font renders (`BRAND_SPLASH_WORDS`), the colour passed to the existing text
renderer, and the **font selection**: HyperAI starts from upstream's solid base
`bold` face instead of the daily rotation (which can select `stencil`/`classic`
and turn the splash hollow). An explicit `/settings` font choice still wins.
Nothing in the glyph data or image pipeline is redrawn.

## Single brand colour

`#FF6096` is the only HyperAI brand colour. It is declared once in
[`../src/brand.json`](../src/brand.json) (`titleColor`) and the patch generator
derives every palette entry from it:

- `HYPERAI_PALETTE.title` — `base/start/mid/end/flash` are all `#FF6096`, so the
  title is a solid brand pink on dark **and** light terminals. The previous
  theme-dependent ladder (pink → near-white on dark, deep pink → light pink on
  light) was removed; it read as an unintended purple/pink ramp on light themes.
- `accent`, `accentShimmer` and `tagline` — the `✦ hyperai-tui` wordmark and the
  welcome line also use `#FF6096`; the brand never switches to a theme accent.
- No other brand colour is introduced. Theme colours still drive ordinary UI
  text, borders, input and buttons, so contrast there is unchanged.

The colour is not copied into the patch by hand: `scripts/build-patch.mjs`
formats the RGB triple from `titleColor`.

## Brand name

- Product name (user-visible): **HyperAI Harness**
- Terminal splash: **HYPERAI HARNESS**
- TUI plugin name: **hyperai-tui**

Brand-display strings patched: splash words, `logo-tagline` welcome line, brand
setting label, kernel label, task-complete notification, onboarding copy, splash
star line and its repository URL. Technical identifiers stay untouched, and the
patch never renames the upstream `dsh` CLI, packages or the DSH kernel label.
The first-run DeepSeek onboarding wizard is disabled because the profile
configures the provider from environment variables.

## Splash layout without art

The upstream splash reserves rows for a mascot/portrait/whale art slot. The
HyperAI patch removes that slot from the layout math instead of rendering an
empty box:

- `LogoV2` resolves the splash with `whale: false` and the stacked (launchpad)
  branch sets `showWhale: false`, so no art node is rendered in either
  arrangement;
- `launchpadLayout` sets `wantsArt = false`, so the hero budget is the title
  height only — no blank rows where the logo used to be;
- the width-based fallback ladder still applies: the big pixel title is shown
  when it fits, and the upstream plain-text title remains the narrow-terminal
  fallback. Input card, model/status line, tips and footer keep their normal
  positions.

Upstream image features (chat attachments, tool image output, kitty/sixel image
rendering for other views) are untouched: the patch removes only the HyperAI
splash art, not upstream image support.

## Theme behaviour

Dark and light terminals both show the same `#FF6096` title, wordmark and welcome
line. The splash background stays the terminal background; nothing paints a
white plate or a logo background. No image protocol capability detection is
involved in the HyperAI startup path.
