# Branding: official mark and terminal adaptation

## Source of truth

`brand/hyperai-logo.png` is the **official HyperAI GitHub organization avatar**,
downloaded from the organization profile (`https://github.com/hyperai`, avatar
URL `https://avatars.githubusercontent.com/u/51961168`) on 2026-10-29.

- sha256: `a8ad3ebb6f165c9d97818f091e917515e5d363742b78dc79628589feca49a101`
- size: 460×460 RGBA, transparent outside the circular mark
- treatment: alpha bounding box cropped, square-padded, box-downsampled to a
  26×26 sprite, encoded as ANSI true-color half-block rows (26 sprite rows =
  13 terminal rows, 40 columns with padding).

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
