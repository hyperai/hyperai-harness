# Logo source provenance

| Field | Value |
|---|---|
| File | `hyperai-logo.png` |
| Origin | Official HyperAI GitHub organization avatar — organization profile `https://github.com/hyperai` |
| Origin URL | `https://avatars.githubusercontent.com/u/51961168` |
| Fetched | 2026-10-29 (Asia/Shanghai) |
| Format | PNG, 460×460, 8-bit RGBA, non-interlaced |
| sha256 | `a8ad3ebb6f165c9d97818f091e917515e5d363742b78dc79628589feca49a101` |

## Treatment

The file is used verbatim as the brand source. `scripts/generate-logo-art.mjs`
performs a lossless decode followed by a box downsample to a 26×26 sprite and a
true-color half-block encode; it does not redraw, recolor, or annotate the mark.
The only color transform is the light-terminal contrast adaptation documented in
`generated/hyperai-logo.js` (white plate → ink), which is derived from the
official pink accent colors.

## Replacement

When the official logo pack is available, replace this file (keep the filename
`hyperai-logo.png`), update `logo.sha256` / `logo.fetchedAt` / `logo.origin` in
`../brand.json`, and rebuild:

```sh
node scripts/generate-logo-art.mjs
node scripts/build-patch.mjs
node scripts/install.mjs
```

Usage of the mark follows the organization's own brand ownership. This
repository does not claim trademark rights over it; the file is included only to
render the HyperAI-branded interface.
