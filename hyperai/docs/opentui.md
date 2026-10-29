# OpenTUI vs the current dsh-tui stack

This note records why the first HyperAI TUI release reuses `dsh-tui` instead of
moving to [OpenTUI](https://github.com/sst/opentui). It is an engineering
comparison from inspecting the installed packages on this machine and public
project material available at the time of writing; no OpenTUI benchmark was run.

## Current stack (what `dsh-tui` 0.16.1 actually is)

- **Renderer**: React 19 + a bundled Ink-style React renderer
  (`react-reconciler` 0.34, `ink`-compatible host components) over a
  differential ANSI renderer. The package ships its own `lib/types/ink/`
  implementation, terminal-size handling, string-width calculation, and
  alt-screen/fullscreen support.
- **Rendering features**: true-color SGR, half-block pixel sprites (the splash
  art), OSC 52 clipboard, Kitty/Sixel image protocols for portrait/attachment
  previews, mouse selection + wheel scroll in fullscreen, hyperlinks, sixel
  transcripts.
- **Runtime**: Node.js ESM only (engines `^22.19 || >=24`). Not Bun-specific.
- **DSH integration**: a Cordis plugin bundle (`dsh.bundle.patch`), with the
  agent/session/channel wiring in `lib/types/dsh-adapter/`. It also ships a
  plugin-host/extension API (panels, scenes, status lines, dialogs, shortcuts,
  themes) and an agent preset roster.
- **Branding surface**: a data module (`branding.ts`), a generated asset/art
  layer, and theme registration — the mechanism this kit exploits.

## OpenTUI

OpenTUI is a newer terminal-UI toolkit that pairs a native Zig core with
TypeScript bindings; it emphasizes a retained layout engine, native rendering
performance, and its own component model. Exact feature/version details should
be re-checked against the project before a migration decision.

## Comparison for this task

| Dimension | Current `dsh-tui` | OpenTUI | Consequence for HyperAI |
|---|---|---|---|
| DSH integration cost | Already integrated: session/channel/adapter/preset code, battle-tested against `dsh` 0.2.1-rc.2 | Needs a new DSH front-end adapter: agent loop wiring, channel state, approvals, resume, tools | Weeks of work and re-validation, not a UI swap |
| Runtime compatibility | Node ESM (this install: Node 26) | Node/Bun support depends on the binding/native build; must be verified against this Mac and the `dsh` launcher | Unverified; adds a native binary to a pure-ESM profile |
| Performance | Adequate: differential redraws, memoized layers, pre-rendered sprites; no measured bottleneck in normal use | Designed for high-throughput rendering; likely faster on very large transcripts | Not a user-visible problem today |
| Terminal capabilities | True-color, half-block art, Kitty/Sixel images, mouse, OSC 52 | Modern capabilities including images/layout; feature parity needs checking | Current stack already supports the brand mark without images |
| Logo/custom layout/colors | Brand data + generated art + theme layer; a few data-only edits (this kit) | Own layout/theme primitives; a new design system would have to be built | Current approach is far cheaper and already done |
| Migration effort | none | Rewrite splash, chat, composer, overlays, pickers, approvals, settings, tests | Out of scope for a branding release |

## Decision

First release: **stay on the current Ink/React stack**, reuse the upstream
`dsh-tui` implementation unchanged except for the branding patch. This keeps
every harness capability (streaming, tools, approvals, resume, model selection,
shortcuts, settings, agent status) and avoids an unvalidated rewrite.

Revisit OpenTUI only if one of these becomes true:

1. transcript rendering becomes a measured performance bottleneck;
2. a required terminal feature cannot be expressed in the current renderer;
3. the upstream `dsh-tui` project migrates (then follow it rather than
   maintaining a divergent front end);
4. the HyperAI product wants a fundamentally different interaction model than a
   chat transcript.

Even then, the branding kit is portable: the mark generation, the profile, and
the skills installer do not depend on the renderer, so only the patch layer
(`branding`/`splash`/`logo` edits) would be replaced.
