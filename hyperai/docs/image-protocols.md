# Terminal image protocols: what dsh-tui does, what we reuse, what we do not

This note records the source-level investigation behind the HyperAI logo's
terminal-image path and its light-terminal fallback. It is written against
`@deepseek-harness-tui/dsh-tui@0.16.1` (patched by `hyperai-tui`), the local
upstream source tree in `~/.dsh/profiles/hyperai/node_modules/`, and the
locally installed `@opentui/core@0.5.17`. External projects that could not be
fetched in this offline environment are marked **unverified offline**.

## 1. dsh-tui 0.16.1 image system (source-verified)

### Capability probe

`lib/types/ink/ink.js` → `maybeProbeKittyGraphics(placements)` starts one probe
when an image consumer requests one:

- **guards** (probe is skipped entirely): no image demand, unmounted/paused,
  terminal queries suspended, stdout not a TTY, `TMUX`/`STY` set (a multiplexer
  cannot be trusted to forward graphics), `DSH_TUI_ACCESSIBILITY`,
  `DSH_TUI_DISABLE_TERMINAL_IMAGES`, `DSH_TUI_IMAGE_PROTOCOL=none`, and images
  only work in the alternate screen.
- **queries** sent in one batch: Kitty Graphics `a=q` (id 31),
  `CSI 16 t` (cell pixels), `CSI 14 t` (window pixels), `CSI > 0 q`
  (XTVERSION), then `flush({attributes:true})` which captures the DA1 reply.
- **selection** (`lib/types/ink/terminal-image-protocol.js`):
  - explicit `DSH_TUI_IMAGE_PROTOCOL` = `none|kitty|sixel` wins;
  - Kitty if the graphics query reply starts with `OK`;
  - Sixel if DA1 attributes `slice(1).includes(4)`;
  - otherwise `none`.
- **geometry**: `resolveTerminalCellSize()` uses the cell-pixel reply, then the
  window/columns/rows ratio, then `DEFAULT_TERMINAL_CELL_SIZE` (8×16). The
  theme provider separately queries **OSC 11** (bounded 400 ms) to resolve the
  light/dark palette; no reply falls back to the dark theme.
- The probe is one-shot (`kittyGraphicsProbeStarted`); there is no re-negotiation
  after a failed probe. Resize does not re-probe, only re-renders.

### Painting

- `components/Image.js` contributes an `ink-image` Yoga leaf; the renderer
  decides after layout whether to attach a terminal placement over exactly that
  cell rectangle (`lib/types/ink/render-node-to-output.js`). Props used by the
  HyperAI mark: `transparent` (no opaque backing; the terminal background shows
  through) and `presentation: 'transcript'` (the placement joins the normal
  image lifecycle, so scrolling/resizing can crop and re-upload it).
- **children are a real fallback**: when a placement is not admitted, the
  `ink-box`/`ink-image` branch paints the component's children; when it is
  admitted, the children are skipped and the renderer paints blank backing cells
  before uploading graphics. This is why the HyperAI component passes the ANSI
  sprite rows as `Image` children — an unsupported/rejected placement still
  shows the sprite.
- Placement lifecycle: `lib/types/ink/output.js` tracks `imagePlacements`,
  `reuseImages`, `hadPreviousImage`, `hasPreviousImageInRegion`; each frame
  re-requests placements when the node/layout changed and the renderer clears
  stale ones. Resize is a normal re-render, so no manual clearing is needed.
- Protocol managers: `kittyGraphicsManager` (PNG upload with cell geometry;
  compression disabled for Ghostty to avoid a 1.3.1 inflate crash) and
  `sixelGraphicsManager` (raster paint; also checks DECRQM 80 so a permanently
  set display mode is not used for previews). `sixel` output is a real Sixel
  raster, not a PNG.
- `loadSharp()` (`dsh-adapter/sharp.js`) decodes sources; sharp is an optional
  dependency of dsh-tui and is present in the HyperAI profile.

### What the terminal does not tell us

Kitty/Sixel uploads are fire-and-forget: the protocol has **no end-to-end
display acknowledgement**. If a terminal falsely advertises Kitty/Sixel, the
renderer will still blank the fallback cells and the slot can stay empty. There
is no re-probe or “image visibly failed” signal in 0.16.1. The HyperAI policy is
therefore: keep the ANSI sprite as the child fallback, never claim images are
verified just because the probe succeeded, and default to ANSI when the terminal
is unknown.

## 2. Comparison with OpenTUI (local source, `@opentui/core@0.5.17`)

OpenTUI is the closest architectural sibling (Zig/native renderer + JS
renderables). Source-verified facts from the installed package:

- `types.d.ts` defines `TerminalCapabilities` with `kitty_graphics`, `sixel`,
  `sgr_pixels`, `multiplexer` (`none|tmux|zellij|screen|unknown`),
  `terminal: {name, version, from_xtversion}`, and `image_protocol`.
- `renderables/Image.d.ts` exposes `ImageRenderable` with
  `ImageRenderProtocol = "auto" | "kitty" | "sixel" | "blocks"`,
  `resolveImageRenderProtocol(requested, capabilities, hasResolution)`,
  `getFittedSize()` with `cellAspectRatio`, `fit` modes, and `onLoad` /
  `onError` load callbacks.
- Capability discovery is delegated to the native library
  (`zig.d.ts`: `getTerminalCapabilities`, `processCapabilityResponse`,
  `queryPixelResolution`, `queryThemeColors`), i.e. OpenTUI also probes the
  terminal instead of trusting `$TERM`.

Takeaways for HyperAI: OpenTUI's explicit **`blocks` fallback protocol** and its
load-error callback are the right robustness primitives. dsh-tui 0.16.1 instead
splits Kitty/Sixel into managers and leaves fallback to the Image children. We
reuse dsh-tui's lifecycle rather than porting OpenTUI (a renderer rewrite, out
of scope) and implement the equivalent guarantees inside the HyperAI component:
sprite children fallback, lazy sharp decode with failure caching, and a
light/dark-safe sprite so a successful-but-invisible image is never the only
thing on screen.

## 3. Yazi / Serie / iTerm2 / VS Code

These could not be source-verified here: the environment has no network access
(GitHub raw and `iterm2.com` requests time out), and neither Yazi nor Serie is
installed locally. The following is documentation-level knowledge and is
**marked unverified offline**; it is included only to position the design.

- **Yazi** (sxyazi/yazi): previews images through multiple protocols — Kitty
  Graphics, iTerm2 inline images, Sixel — and falls back to terminal block
  rendering (`chafa`) when none works. Capability detection combines terminal
  identity/env hints and protocol probes; the image library also supports
  explicit protocol overrides. (Reference: https://github.com/sxyazi/yazi)
- **Serie** (lusingander/serie): a git-graph TUI whose image previews are
  delegated to a terminal-image crate that speaks Kitty/iTerm2/Sixel and keeps a
  block fallback. (Reference: https://github.com/lusingander/serie)
- **iTerm2 inline images**: OSC 1337 `File=inline=1;width=…;height=…;…:<base64>`.
  Placement is cell/percent based and the terminal owns scaling/clearing; unlike
  Kitty there is no placement id or queryable status. Supporting it in dsh-tui
  would mean a third graphics manager plus renderer-side layout/clear plumbing in
  the upstream core — a large patch against files the HyperAI patch deliberately
  does not own. **Not implemented**; recommendation is to land it upstream.
- **VS Code integrated terminal**: `terminal.integrated.enableImages` enables
  the image-capable xterm.js addon (Sixel); with images enabled VS Code can
  advertise Sixel in DA1, which dsh-tui would then use. We did not verify a real
  VS Code terminal in this environment (the installed window was not operable),
  so VS Code is **NOT TESTED**; without the setting, DA1 has no `4` and the
  ANSI sprite is used.

## 4. Recommendation

1. Keep ANSI as the guaranteed baseline; only show HD when the renderer's own
   probe confirms Kitty/Sixel (never from `$TERM`/`$TERM_PROGRAM` names).
2. Keep the sprite rows as `Image` children so a rejected placement always
   falls back.
3. Keep light/dark logo variants, because a white plate on a pure-white
   xterm.js background (Orca light, VS Code light, iTerm2 light) is a real,
   reproducible “logo disappeared” case — see `terminal-compatibility.md`.
4. Do not implement iTerm2 inline images or a new renderer in this patch;
   propose it upstream with the iTerm2 lifecycle model.
5. Provide `scripts/diagnose-terminal.mjs` so a user can report exactly what
   their terminal replied without sharing secrets.
