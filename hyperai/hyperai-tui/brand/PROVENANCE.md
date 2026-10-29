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
followed by a box downsample to a 26×26 sprite, quantizes it to the source's
own white/pink colors and stores it in the upstream whale's letter-grid format
(one palette letter per sprite pixel, `.` transparent). It does not redraw or
annotate the mark, and it never substitutes colors: the white plate stays
`#FFFFFF`, the pattern stays `#FF6096`, and the pale edge `#FFA6C4` is the
source's own white→pink blend. There is no light-theme ink adaptation.

The 60×60 source is still ~2.3× the 26×26 sprite; the generator's minimum
source size is 48 px, chosen so this canonical file is accepted. 26×26 is the
largest distortion-free sprite for the 13-row splash slot (half-block rows).

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
