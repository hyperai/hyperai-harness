# Logo source provenance

| Field | Value |
|---|---|
| File | `hyperai-logo.svg` |
| Origin | **Official HyperAI logo SVG provided by the user** |
| Source path | `/Users/zhenhaoli/Downloads/logo-icon-border-1.svg` |
| Provided | 2026-10-29 (Asia/Shanghai) |
| Format | SVG, `120x120` viewBox; white circle path (`fill: white`) + `90x89` icon rect filled from an embedded `271x267` 8-bit RGBA PNG data URI through an `objectBoundingBox` pattern |
| sha256 | `3de898089cbbcc15fd8609f2c46d9e8906ff5119a13baf949cbde1bcf7857bab` |

This SVG is the **single canonical source** for the HyperAI mark. The retired
`51961168.png` (60x60) is no longer used anywhere in the generation chain.

## Treatment (SVG -> terminal art)

`scripts/generate-logo-art.mjs` converts the SVG to the terminal art in four
steps, all with Node built-ins (no image library, no network):

1. **parse** — the generator understands exactly this composition and fails loud
   if the SVG changes shape: it reads the `viewBox`, the white circle `Oval`
   path (center + radius), the icon `<rect>`, the pattern `matrix(...)`, and the
   base64 PNG embedded in the `<image>` data URI (decoded with a small pure-Node
   PNG decoder).
2. **composite** — the SVG is rendered analytically at 512x512 with 4x4
   supersampling: white circle first, then the embedded icon stretched into the
   icon rect exactly as the SVG's `objectBoundingBox` pattern maps it
   (`preserveAspectRatio="none"`), straight-alpha "icon over circle". The
   generator does not redraw the mark.
   The analytic renderer was cross-checked against `rsvg-convert` at 1024x1024:
   alpha mask IoU **0.9996**, composited mean absolute difference **1.18/255**
   (remaining difference is edge anti-aliasing).
3. **downsample** — alpha bounding box, square pad, area average to the two
   terminal grids: **40x40** (main sprite, 20 half-block display rows) and
   **26x26** (compact sprite, 13 display rows, used when the terminal is too
   short for the wide mark).
4. **quantize** — each sprite pixel becomes one palette letter on the SVG's own
   white -> rose blend line: `W` = white circle `#FFFFFF`, `R` = icon rose
   `#E11D48` (dominant opaque color of the embedded icon), with three
   intermediate blends (`a`/`b`/`c`) keeping the anti-aliased edges; `.` =
   transparent. Nothing is darkened or recolored.

The terminal renders the sprites through the upstream whale's own
`renderSpriteRows` (`components/Whale.js`), i.e. true-color half blocks with the
terminal background showing through transparent cells — no image protocol.

## Replacement

When the official logo is updated, replace this file (keep the filename
`hyperai-logo.svg`), update `logo.sha256` / `logo.origin` / `logo.format` in
`../brand.json`, and rebuild:

```sh
node scripts/generate-logo-art.mjs
node scripts/build-patch.mjs
node scripts/install.mjs --no-skills
```

The generator aborts if the new SVG does not have the documented composition
(circle + pattern-filled icon rect + embedded PNG), so a structural change must
be reviewed rather than silently producing a wrong mark.

Usage of the mark follows the organization's own brand ownership. This
repository does not claim trademark rights over it; the file is included only to
render the HyperAI-branded interface.
