# Logo source provenance

| Field | Value |
|---|---|
| File | `hyperai-logo.png` |
| Origin | **Local canonical brand asset provided by the user** |
| Source path | `/Users/zhenhaoli/Downloads/51961168.png` |
| Provided | 2026-10-29 (Asia/Shanghai) |
| Format | PNG, 60×60, 8-bit RGBA, non-interlaced |
| sha256 | `165ecb79fbad9f2bdc2f2e0aa1e259848529907e7ea7ab32069376629b269741` |

## Treatment

The file is copied byte-for-byte from the local source above (no download, no
remote URL). `scripts/generate-logo-art.mjs` performs a lossless decode
followed by a box downsample to a 26×26 sprite and a true-color half-block
encode; it does not redraw, recolor, or annotate the mark. The only color
transform is the light-terminal contrast adaptation documented in
`generated/hyperai-logo.js` (white plate → ink), which is derived from the
official pink accent colors.

The 60×60 source is still ~2.3× the 26×26 sprite; the generator's minimum
source size is 48 px, chosen so this canonical file is accepted.

## Replacement

When a larger official pack is available, replace this file (keep the filename
`hyperai-logo.png`), update `logo.sha256` / `logo.width` / `logo.height` /
`logo.origin` in `../brand.json`, and rebuild:

```sh
node scripts/generate-logo-art.mjs
node scripts/build-patch.mjs
node scripts/install.mjs --no-skills
```

Usage of the mark follows the organization's own brand ownership. This
repository does not claim trademark rights over it; the file is included only to
render the HyperAI-branded interface.
