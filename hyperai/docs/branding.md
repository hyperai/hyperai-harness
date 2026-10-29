# Branding: official mark and terminal adaptation

## Source of truth

`brand/hyperai-logo.svg` is the **canonical official HyperAI logo** provided by
the user (`/Users/zhenhaoli/Downloads/logo-icon-border-1.svg`, copied
byte-for-byte into the repository). It is a `120x120` viewBox export: a white
circle plus a `90x89` icon rect painted from an embedded `271x267` RGBA PNG
through an `objectBoundingBox` pattern; the icon's own drawing color is the rose
`#E11D48`. No remote asset is fetched anywhere in the build or install path.

- sha256: `3de898089cbbcc15fd8609f2c46d9e8906ff5119a13baf949cbde1bcf7857bab`
- format: SVG, `120x120` viewBox, embedded `271x267` PNG icon data URI
- treatment: the SVG is parsed (white circle geometry, icon rect, pattern
  matrix, embedded PNG), composited analytically at 512x512 with 4x4
  supersampling (white circle, then the icon stretched into its rect exactly as
  the SVG's pattern maps it), alpha-cropped, downsampled to two square grids,
  and quantized along the SVG's own white → rose blend line. Nothing is redrawn
  or recolored; transparent pixels stay transparent.
- cross-check: the analytic composite matches `rsvg-convert` at 1024x1024 —
  alpha-mask IoU **0.9996**, composited mean absolute difference **1.18/255**
  (the remainder is edge anti-aliasing).

The retired `51961168.png` source (60x60) is no longer referenced by the build,
the profile, the tests or the docs; it only remains in git history.
`scripts/generate-logo-art.mjs` uses Node built-ins only (no image library, no
network) and aborts loudly if the SVG no longer has the documented composition;
it is covered by `tests/logo-art.test.mjs`.

Two terminal sprites are generated from the same SVG:

| sprite | grid | display | when it is used |
|---|---|---|---|
| **wide** (main) | `40x40` | 20 half-block rows | terminal content rows ≥ `HYPERAI_LOGO_WIDE_MIN_ROWS` (44) |
| **compact** | `26x26` | 13 half-block rows | smaller windows — automatic degradation |

**Why 40x40 is the default:** with the measured ~6x12 px cell, the old 13-row
slot capped a square mark at 26x26 logical pixels. The SVG's vector circle plus
`271x267` icon resolve cleanly at 40x40 — 2.4x the pixels of the compact sprite —
so the wide mark is visibly sharper without inventing any new rendering path.
`HYPERAI_LOGO_WIDE_MIN_ROWS = 44` is the smallest content height where the
launchpad layout keeps the 20-row mark instead of dropping the art; below it
`components/hyperaiLogo.js` renders the compact sprite and
`splashArtRows()`/`Launchpad` reserve the matching height, so the logo and the
layout budget always agree.

**Resolution ceiling:** half-block characters render two vertical pixels per
cell, so the 40-column slot can show at most 40x40 logical pixels in a 20-row
slot. A 48x48 grid needs a 24-row slot; the clarity experiment
(`docs/screenshots/logo-clarity-svg.png`) measures that gain but production
keeps 40x40 so the splash layout does not grow further.

## Terminal adaptation — the whale's own renderer

The upstream splash art slot is a fixed 40-column box, and the upstream DeepSeek
whale fills it with pre-encoded letter-grid sprites painted by
`renderCellRows`. The HyperAI mark deliberately reuses that exact mechanism,
data format and renderer instead of inventing an image pipeline:

- **data** — `brand/generated/hyperai-logo.js` exports two letter-grid sprites
  (`HYPERAI_LOGO_SPRITE_WIDE`, `HYPERAI_LOGO_SPRITE_COMPACT`, each 40 columns of
  palette letters) and `HYPERAI_LOGO_PALETTE` (`W` white circle `#FFFFFF`, `R`
  rose icon `#E11D48`, `a`/`b`/`c` intermediate blends for anti-aliased edges,
  `.` transparent) — the same shape as upstream `components/whaleFrames.js`;
- **renderer** — `components/hyperaiLogo.js` calls the whale's own
  `renderSpriteRows(sprite, palette)` (imported from `components/Whale.js`) once
  per sprite at module load and renders the resulting rows through `Text`,
  mirroring `WhaleArt` structurally. It picks wide/compact from
  `useTerminalSize().rows` against the same threshold the layout uses;
- **half-block encoding** — two sprite pixels per cell: `▀` with the upper pixel
  as foreground and the lower pixel as background when both are opaque, `▄` when
  only the lower pixel is opaque, and the empty half of a half-covered cell uses
  `\x1b[49m` (terminal default background); fully transparent cells are plain
  spaces plus an erase-to-EOL. No black is ever painted, so transparent pixels
  show the terminal background;
- **no image protocol** — no Kitty/Sixel/inline images are involved, exactly
  like the whale (the splash works in any ANSI true-color terminal);
- **one palette for every theme** — the mark is identical in dark and light
  themes. On a light terminal the white circle is inherently close to the
  background (white artwork on a white background), but it is never darkened or
  recolored.

The art is pre-rendered at build time, so the runtime never parses SVG or PNG.

## Real-terminal evidence

- `docs/screenshots/real-terminal-dark.png` — Terminal.app, background `#101014`
  (OSC 11), 40x40 main mark, 169x55 window;
- `docs/screenshots/real-terminal-light.png` — Terminal.app, background
  `#FAF7F2`, same main mark;
- `docs/screenshots/real-terminal-small.png` — Terminal.app, 139x40 window:
  the compact 26x26 mark, automatic degradation;
- `docs/screenshots/logo-clarity-svg.png` + `logo-clarity-svg.md` — real-terminal
  comparison of the SVG-derived `26x26` / `40x40` / `48x48` grids in the same
  48x24-cell box on the same background (see the table below).

Clarity experiment (real Terminal.app captures; RMSE against the SVG rendered by
`rsvg-convert` on the same background, lower = closer):

| grid | display cells | mark on screen | colors | edge energy | RMSE vs SVG |
|---|---|---|---|---|---|
| 26x26 | 26x13 | 163x163 px | 1440 | 18.9 | 58.3 |
| 40x40 | 40x20 | 248x248 px | 1533 | 13.6 | 46.4 |
| 48x48 | 48x24 | 291x288 px | 1620 | 11.5 | 31.3 |

Recommendation: **40x40 main + 26x26 compact fallback** (implemented). 48x48 is
measurably sharper but needs a 24-row art slot; the current layout change is
deliberately limited to 20 rows so the splash keeps its proportions. The 26x26
grid is now used only for small windows, where it still shows the official SVG
art at the height the whale slot originally reserved.

## Title gradient

The splash title is no longer the theme's mist-blue gradient. `branding.js`
carries a small `HYPERAI_PALETTE` data block (the same file the splash words and
tagline come from), and `LogoV2.js` feeds it into the existing title ladder that
upstream already uses for the Claude/Codex brands — no title component was
rewritten.

| Theme | Line 1 (`HYPERAI`) | Line 2 (`HARNESS`) | Shimmer |
|---|---|---|---|
| dark | `#FF6096` → `#FFA6C4` (pink → light pink) | `#FFA6C4` → `#FFF7FA` (light pink → near white) | white |
| light | `#D6336C` → `#FF6699` (deep pink → pink) | `#FF6699` → `#FFB3CC` (pink → light pink) | pale pink |

The gradient runs across both lines as one ladder (top-left pinkest, bottom-right
lightest), which is upstream's existing mechanism for brand titles. The light
variant deliberately ends at light pink instead of pure white: white would
disappear on a light terminal. Verified from the captured PTY stream: title
cells use `#FF6096`/`#FFA6C4`/`#FFF4F8` and contain **zero blue-ish** cells
(previously the theme's `#7DA1DE` mist blue). The wordmark/tagline reuse the
same pink family so the header does not mix pink with blue; those two are drawn
through `chalk`, which emitted no color in the PTY capture environment (upstream
behavior, unchanged), so the verified change is the big title.

## What the brand touches

- splash big title (`HYPERAI` / `HARNESS`) in every splash font and on the
  launchpad
- the splash art slot (official mark instead of the DeepSeek whale); upstream
  mascot/portrait slots are disabled so a persisted `companion.skin` cannot
  bring back DeepSeek art in that slot
- the `✦ hyperai-tui v…` wordmark and the launchpad version plate
- the welcome tagline (`HyperAI Harness`), the kernel label
  (`HyperAI Harness`), the task-complete notification, the onboarding copy, and
  the star welcome line (which now links the HyperAI repository)
- the branded package's updater is disabled so `/update` cannot silently
  replace the branded build

## Deliberately unchanged

- Chat, streaming, tool cards, approvals, session handling, pickers, shortcuts,
  settings, and the agent spine — all upstream, unmodified.
- The UI color theme (upstream mist blue). A full HyperAI palette is a data-only
  change in the patch but needs a design decision and visual review.
- Residual DeepSeek references that are not brand marks: the `/deepseek`
  easter-egg command name, some `/tips` entries, and the `/star` copy shown
  after long usage. Listed in the distribution limitations.
