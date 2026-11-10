# ROUND3 — Regression Results

**Code commit:** `60dc943dc1a351f3ebbfb7aeb994a1c68ec1bc86`  
**QA SHA:** `f4d6d0c731f830ece866b6bfd5cdc1a10e176edb`  
**Status:** development self-test — not independent QA acceptance.

## 1. macOS offline quality gates

| Module | Command | Exit | Result |
|---|---|---:|---|
| TUI distribution | `node apps/tui/scripts/verify.mjs` | 0 | **13/13 PASS** |
| TUI tests | `node --test apps/tui/tests/` | 0 | **13/13 PASS** |
| Profile distribution | `node apps/profiles/hyperai/scripts/verify.mjs` | 0 | **12/12 PASS** |
| Profile tests | `node --test apps/profiles/hyperai/tests/` | 0 | **67/67 PASS** |
| Real MID-SWAP SIGKILL test | `node --test apps/profiles/hyperai/tests/crash.test.mjs` | 0 | **PASS**, repeated **10/10** |

Environment: macOS arm64 (Darwin 25.1), Node `v26.9.0`, DSH `0.2.0-rc.2`, pnpm `11.28.5`.

New/updated regression coverage:

- real 12-skill child-process SIGKILL at MID-SWAP, with root and `references/`
  user extras, v2 and v3 convergence;
- malformed/undecidable journal fail-safe;
- non-dry-run `install.mjs --json` success and failure envelopes;
- `skills-update check --json` git-timeout error envelope;
- failed dependency quarantine → successful retry → cleanup;
- uninstall archive README safe-restore assertions;
- TUI Splash font/title markers and 56-column documentation.

## 2. Real installer + private Skills

Command (isolated HOME/DSH_HOME/npm prefix/pnpm home; real authorized GitHub
credential helper; no `--source`, no `--no-skills`):

```text
node apps/profiles/hyperai/scripts/install.mjs --dsh-home <isolated> --json
```

Result:

```text
exit 0
stdout bytes 1576
stderr bytes 2879 (progress/diagnostics only)
JSON parsed successfully
state: completed / done
skills.installed: ["example-verified-skill"]
LICENSE present
```

This verifies the non-dry-run JSON contract end to end, not only a unit test.

## 3. JSON interfaces

| Case | Command | Result |
|---|---|---|
| `install.mjs --json` success | isolated fake-dsh and real-dsh runs | stdout is one valid JSON doc; no `Progress:` on stdout; exit 0 |
| `install.mjs --json` failure | fake dsh exits 7 | stdout `ok:false` envelope + non-zero exit; hint points to repair |
| `skills-update check --json` git timeout | fake git, 100 ms timeout | stdout `ok:false`, code `GIT_TIMEOUT`, hint actionable, exit 1; no raw progress |
| `skills-update check --json` success | local fixture | compact updates array, no full plan |

## 4. Lifecycle / recovery

- Two-stage uninstall: stage 1 exit 0, stage 2 `--purge` exit 0, archive retained.
- Archive README contains safe restore steps, no-overwrite rule, reinstall and
  doctor guidance.
- Bad patch install: old `node_modules` restored, failed tree quarantined,
  state `failed`; successful retry removes the quarantine after verification.
- Interrupted install/doctor/repair tests pass.
- R2-08 MID-SWAP: recovery exit 0, all extras preserved, manifest refs/managed
  hashes consistent, pending cleared; repeated update and v3 update pass.

## 5. TUI / terminal

- Generated patch: `81,048 bytes`, deterministic build.
- TUI verify 13/13 and tests 13/13.
- Real PTY at 56/80/110/120 columns: footer does not overlap; 56 shows compact
  `hyperai v0.2.0`; 80/110/120 show product + upstream version.
- Real PTY `/settings`: visible option is now
  `HyperAI fixed solid (upstream compatibility)`; companion skin is marked
  `HyperAI 不使用`; no daily-rotation claim.
- Extracted terminal OSC title: `HyperAI Harness · ` (product name; no whale glyph).
- `/update` remains disabled with the HyperAI installer/release message.
- Actual TUI model/terminal regression from prior QA evidence remains valid; no
  source-level change to provider logic in this round.

## 6. Linux x86_64 container regression

Command: Docker `node:24-bookworm-slim --platform linux/amd64`, Debian, fake
`dsh` only for preflight, real pnpm installed inside the disposable container.

```text
uname -m -> x86_64
TUI verify -> exit 0
TUI tests -> 13/13 PASS
Profile verify -> 12/12 PASS
Profile tests -> 64 pass, 0 fail, 2 skipped (67 total)
```

This is **not OpenBayes**, but it is real Linux x86_64 Node 24 and covers the
new recovery/JSON code paths. OpenBayes host and Windows remain NOT TESTED in
this development round. Agent B's deep report contains separate OpenBayes
evidence and is not overwritten.

## 7. Environment-blocked / not tested

| Area | Status |
|---|---|
| OpenBayes Linux host | NOT TESTED in this developer round; see Agent B deep report |
| Windows | NOT TESTED; no environment |
| Node 18/20/22/23 full install | NOT TESTED/partial; existing preflight tests cover rejection |
| DSH rc.3/rc.5/alpha.2 real install | NOT TESTED; prior QA evidence; preflight unit tests |
| Anthropic / 403 / 502 / gateway timeout | ENV-BLOCKED/not exercised this round |
| Non-TTY TUI | upstream behavior documented; no product fix |

## 8. Non-TTY check

`dsh --profile hyperai </dev/null` produced no output and did not exit within
10 seconds; it was killed. This is consistent with the documented upstream
TTY requirement. `install.mjs`/`manage.mjs --json` are the supported non-TTY
automation surface.

## 9. Conclusion

All changed code paths are green on macOS and the available Linux x86_64
container. The P1 data-loss boundary now has a real child SIGKILL regression and
passes repeatedly. Independent QA must re-run the exact final SHA, including the
six canonical kill points and the new MID point; this report is not a QA GO.
