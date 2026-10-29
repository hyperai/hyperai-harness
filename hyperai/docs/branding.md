# Branding: official mark and terminal adaptation

## Source of truth

`brand/hyperai-logo.png` is the **local canonical HyperAI logo asset provided by
the user**: `/Users/zhenhaoli/Downloads/51961168.png`, copied byte-for-byte into
the repository. No remote avatar URL is fetched anywhere in the build or install
path.

- sha256: `165ecb79fbad9f2bdc2f2e0aa1e259848529907e7ea7ab32069376629b269741`
- size: 60×60 RGBA, transparent outside the circular mark
- treatment: alpha bounding box cropped, square-padded, box-downsampled to a
  26×26 sprite, quantized to the source's own white/pink colors and stored in
  the **upstream whale's letter-grid format**: one palette letter per sprite
  pixel, `.` for transparent, 26 sprite rows = 13 terminal rows, centred in the
  40-column art slot.

The mark is never redrawn and never recolored: the white plate stays `#FFFFFF`,
the pattern keeps the official `#FF6096`, the pale edge is `#FFA6C4` (the
source's own white→pink blend) and transparent pixels stay transparent, so the
terminal background shows through. `scripts/generate-logo-art.mjs` is a pure
decode → crop → downsample → quantize pipeline; it requires no image library
and is covered by `tests/logo-art.test.mjs`.

**Resolution limit:** the splash art slot is 13 terminal rows tall and the whale
renderer uses half-block characters, so a square mark can be at most 26×26
pixels (26 of the 40 columns). That is the largest distortion-free rendering the
unchanged layout allows; rendering larger would need a taller slot, i.e. a
layout change this distribution deliberately does not make. The official source
is 60×60, so the committed sprite is a ≈2.3× reduction of the same artwork.

**Production note:** an organization avatar is an official brand resource, but
it is not a design hand-off. If a designer supplies the official logo pack
(SVG or PNG ≥ 256 px, ideally including a light-background variant), replace
`brand/hyperai-logo.png`, update `brand.json` (`logo.origin`, `sha256`,
`fetchedAt`), and re-run:

```sh
node scripts/generate-logo-art.mjs
node scripts/build-patch.mjs
node scripts/install.mjs
```

## Terminal adaptation — the whale's own renderer

The upstream splash art slot is a fixed 40-column × 13-row box, and the upstream
DeepSeek whale fills it with a pre-encoded letter-grid sprite (40×26 letters =
13 half-block rows). The HyperAI mark deliberately reuses that exact mechanism,
data format and renderer instead of inventing an image pipeline:

- **data** — `brand/generated/hyperai-logo.js` exports
  `HYPERAI_LOGO_SPRITE` (26 sprite rows × 40 columns of palette letters) and
  `HYPERAI_LOGO_PALETTE` (`W` white plate, `p` pale-pink edge, `P` official
  pink, `.` transparent) — the same shape as upstream
  `components/whaleFrames.js` (`{ rows: string[] }` letter grids);
- **renderer** — `components/hyperaiLogo.js` calls the whale's own
  `renderSpriteRows(sprite, palette)` (imported from `components/Whale.js`) once
  at module load and renders the resulting rows through `Text`, mirroring
  `WhaleArt` structurally;
- **half-block encoding** — two sprite pixels per cell: `▀` with the upper pixel
  as foreground and the lower pixel as background when both are opaque, `▄` when
  only the lower pixel is opaque, and the empty half of a half-covered cell uses
  `\x1b[49m` (terminal default background); fully transparent cells are plain
  spaces plus an erase-to-EOL. No black is ever painted, so transparent margins
  show the terminal background;
- **no image protocol** — no Kitty/Sixel/inline images are involved, exactly
  like the whale (the splash works in any ANSI true-color terminal);
- **one palette for every theme** — the previous light-theme variant that mapped
  the white plate to ink (`#1A1A20`) is gone: it made the plate read as a black
  disc. The mark is now identical in dark and light themes. On a light terminal
  the white plate is inherently close to the background (white artwork on a
  white background), but it is never darkened or recolored.

The art is pre-rendered at build time, so the runtime never parses a PNG.

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
