# Terminal compatibility: the logo across real terminals

Every row below was checked against a **real terminal** on this machine
(macOS 26.1, arm64) unless it says otherwise. The HD logo is a 512×512
transparent PNG painted through the renderer's Kitty/Sixel placement; the ANSI
fallback is the 40×40 / 26×26 whale-format sprite, with a light-background
variant that adds a thin rim in the SVG's own icon accent.

## Matrix

| Environment | TERM / identity | Real probe result | Selected path | Logo result |
|---|---|---|---|---|
| **Orca 1.4.244 embedded terminal** (xterm.js 6.0.0, light theme) | `TERM=xterm-256color`, `TERM_PROGRAM=Orca` | DA1 `?1;2c` (no Sixel), Kitty query: no reply, OSC 11 = `#FFFFFF` | none → **ANSI, light variant** | **Fixed**: official white plate invisible on white before the fix (only the rose icon); light variant adds the rim → circle visible. Verified with real Orca capture + `diagnose-terminal`. |
| Ghostty 1.4.0, dark background | `TERM=xterm-ghostty`, `TERM_PROGRAM=ghostty` | Kitty query `OK`, DA1 `?62;22;52c`, cell 8×17, OSC 11 `#101014` | **Kitty → HD PNG, dark variant** | Official HD logo, smooth edges, transparent background, no rim (unchanged regression). |
| Ghostty 1.4.0, white background | same | Kitty `OK`, OSC 11 `#FFFFFF` | **Kitty → HD PNG, light variant** | HD PNG with the accent rim on the white background. |
| macOS Terminal.app, dark (`#101014`) | `TERM=xterm-256color`/`xterm-256color`, Apple Terminal | no Kitty, no Sixel, cell queries unsupported | **ANSI, dark variant** | Official sprite. |
| macOS Terminal.app, light (`#FAF7F2`) | same | same | **ANSI, light variant** | Sprite with the accent rim. |
| Plain PTY, no terminal replies | harness PTY | nothing replies | **ANSI, dark variant**, first frame | Logo sprite visible, startup not blocked, no Kitty/Sixel bytes emitted. |
| tmux / screen | `TMUX`/`STY` set | probe deliberately skipped | **ANSI** | No unconfirmed graphics bytes are sent. |
| `DSH_TUI_DISABLE_TERMINAL_IMAGES=1` | Ghostty, Kitty-capable | probe disabled | **ANSI** | Deliberate override. |
| Image payload corrupted (decode failure) | Ghostty, Kitty-capable | image decode throws | **ANSI** | Real test: corrupted embedded PNG → sharp fails → sprite fallback, identical to images-disabled capture. |
| Window resize | Orca light | n/a | ANSI | Shrink → restore: one placement, radial logo signature identical, no ghost/offset. |
| **Sixel** | — | no Sixel-capable terminal was installable offline (WezTerm/iTerm2 downloads stalled); PTY simulation with a Sixel advertisement | simulated Sixel payload emitted | **NOT TESTED in a real Sixel terminal**; code path smoke-tested only. |
| **iTerm2 inline images** | — | not installed (download blocked) | — | Not implemented: needs a third graphics manager in the upstream renderer; see `image-protocols.md`. **NOT TESTED / not supported.** |
| **VS Code / Cursor integrated terminal** | — | not operable in this environment | — | Not verified. With images disabled (default) DA1 has no `4` → ANSI sprite. **NOT TESTED.** |
| Windows / Linux terminals | — | — | — | **NOT TESTED** (no such machine here). |

## Why the Orca logo disappeared (root cause)

The real terminal replies (recorded by `scripts/diagnose-terminal.mjs` inside
Orca) are:

```json
{"TERM":"xterm-256color","TERM_PROGRAM":"Orca","da1":[1,2],
 "xtversion":">|xterm.js(6.0.0)","background":[255,255,255],
 "decision":{"protocol":"none","imagesAvailable":false,"variant":"light",
             "path":"ANSI sprite (light variant)"}}
```

So the fallback **was working**: the sprite was in the terminal buffer and the
capture contains the sprite's pale blend pixels. The defect was **contrast**, not
a missing fallback: the official mark is a `#FFFFFF` circle with the rose icon on
transparency, and Orca's light theme is exactly `#FFFFFF`, so the white plate and
its near-white anti-aliased blends had 1:1 contrast and vanished; only the rose
icon survived — which reads as “the logo disappeared”.

Evidence (real captures, icon-centred radial rose profile; rim ring is at the
outer radius):

| capture | ring pixels at the circle edge |
|---|---|
| Orca light, before fix (`orca-light-before.png`) | 0 |
| Orca light, after fix (`orca-light-after.png`) | 3811 + 2450 |
| Terminal.app dark (`terminal-ansi-dark.png`) | 0 (official art) |
| Terminal.app light (`terminal-ansi-light.png`) | 4346 |
| Ghostty dark HD (`ghostty-hd-logo-dark.png`) | 0 (official art) |
| Ghostty light HD (`ghostty-hd-logo-light.png`) | 1420 |

The fix keeps the SVG untouched and adds a **light-theme rim** (thickness only
on the circle's existing outer edge, colour = the SVG's own icon accent) to both
the ANSI sprites and the HD PNG. Dark terminals keep the official rendering
byte-for-byte.

## Diagnostics

```sh
cd hyperai/hyperai-tui
node scripts/diagnose-terminal.mjs          # human-readable
node scripts/diagnose-terminal.mjs --json   # machine-readable
```

It reports terminal identity, TTY, real DA1/Kitty/XTVERSION/cell/OSC 11 replies,
multiplexer state, the selected protocol, the theme variant, the logo path, and
the fallback reason — without reading API keys or session data. In a plain PTY
it reports the ANSI fallback and exits immediately (covered by
`tests/diagnose-terminal.test.mjs`).

## Limitations

- Kitty/Sixel have **no end-to-end display acknowledgement**: a terminal that
  falsely advertises graphics could still show a blank slot. The renderer has no
  re-negotiation; the ANSI sprite children remain the safety net, and for
  unknown terminals ANSI is the default.
- Image protocols are disabled by upstream policy under tmux/screen, non-TTY
  runs, and non-alternate-screen modes.
- Light terminals are handled with the accent rim; the official white plate is
  preserved, but a light background is inherently the harder contrast case.
- Real Sixel, iTerm2, VS Code/Cursor and Windows/Linux terminals are unverified
  (see matrix); do not treat this matrix as a claim that every terminal was
  tested.
