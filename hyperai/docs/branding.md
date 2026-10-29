# Branding: official mark and terminal adaptation

## Source of truth

`brand/hyperai-logo.png` is the **local canonical HyperAI logo asset provided by
the user**: `/Users/zhenhaoli/Downloads/51961168.png`, copied byte-for-byte into
the repository. No remote avatar URL is fetched anywhere in the build or install
path.

- sha256: `165ecb79fbad9f2bdc2f2e0aa1e259848529907e7ea7ab32069376629b269741`
- size: 60×60 RGBA, transparent outside the circular mark
- treatment: alpha bounding box cropped, square-padded, box-downsampled to a
  26×26 sprite (≈2.3× source reduction), encoded as ANSI true-color half-block
  rows (26 sprite rows = 13 terminal rows, 40 columns with padding).

The mark is never redrawn. `scripts/generate-logo-art.mjs` is a pure
decode → crop → downsample → encode pipeline; it requires no image library and
is covered by `tests/logo-art.test.mjs`.

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

## Terminal adaptation

The upstream splash art slot is 40 columns × 13 rows. Two variants are emitted
from the same sprite:

- **dark**: the official colors — white plate, pink accent (`#FF6599`-family).
- **light**: the official pink accents are kept, and the white plate is mapped
  to ink (`#1A1A20`). This is a contrast adaptation for light terminals, not a
  new logo. It is documented in the generated file header.

The component picks a variant from the active theme (`useTheme` +
`isLightThemeActive`), so light and dark themes both show a legible mark.
Half-block rendering is supported by every ANSI terminal; no Kitty/Sixel support
is required. The art is pre-rendered at build time, so the runtime never parses
an image.

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
