# ROUND3 — Fix Report

- **Code commit:** `60dc943dc1a351f3ebbfb7aeb994a1c68ec1bc86`
- **Round 3 QA SHA:** `f4d6d0c731f830ece866b6bfd5cdc1a10e176edb`
- **Nature:** development fixes and regression tests; independent QA PENDING.

## 1. BUG-R3B-01 — Legacy Skills MID-SWAP SIGKILL (P1, release blocker)

### Root cause

`apps/profiles/hyperai/scripts/install-skills.mjs` performed the directory swap as:

```text
rename(target -> oldPath)
rename(staging -> target)
```

A SIGKILL between those two calls leaves `target` absent and the only old tree at
`oldPath`. `recoverSkillJournals()` called `digestSkill(target)`, which threw
ENOENT. The broad `catch` swallowed it, keeping the journal. `planSkill()` then
saw no target and classified the skill as `install`; `decision.extras` was
undefined, the snapshot filter excluded the missing skill, and the later
`rmSync(staging)` removed `oldPath`, including user extras. The recovery run
exited 0 with no warning.

### Fix

- Recovery now derives the actual state from the filesystem:
  - target matches `newEntry` → finish manifest, preserve missing extras from
    oldPath/snapshot, then clean.
  - target matches `beforeEntry` → keep old tree, restore old manifest, preserve
    extras, clean staging.
  - **target missing + oldPath complete → restore oldPath to target** (the P1
    MID-SWAP path), restore the old manifest entry, then clean.
  - target missing + no oldPath + staging complete + no previous entry → finish
    the new install.
  - target missing + snapshot available → restore snapshot.
  - undecidable state → throw `SKILL_RECOVERY_FAILED`; preserve journal, oldPath,
    staging and backups; print the paths and non-zero exit.
- Journal records `phase: prepared | old-moved | new-moved`; recovery does not
  rely only on that field.
- Swap error handling now preserves a partially installed new tree as
  `staging/<name>-new-failed-*` and restores `oldPath` before reporting.
- Stale `.json.tmp-*` journal temporaries are removed only after successful
  recovery; no journal/oldPath/staging evidence is deleted on failure.
- User extras at skill root (`NOTES.md`) and inside `references/` are copied
  back with hashes checked. A content conflict creates a visible
  `.hyperai-recovered-*` copy and fails safe instead of overwriting.

### Regression tests

- `apps/profiles/hyperai/tests/crash.test.mjs`:
  - 12 local Git skills (`qa-kill-01..12`);
  - v1 install + `NOTES.md` + `references/my-notes.md` per skill;
  - v2 update as a real child process;
  - polling detects target absent + oldPath present + journal present;
  - `SIGSTOP` freezes the state, then real `SIGKILL`; no journal is modified;
  - recovery, v2, repeated update and v3 update must preserve all 24 extras;
  - manifest refs and managed file hashes must match; no pending journal remains.
- Added fail-safe tests for unreadable journal and undecidable missing-tree state.
- Repeated crash test 10/10 PASS after fixing a stale journal-temp cleanup race.

## 2. BUG-R3-01 / BUG-R3B-02 — `install.mjs --json` stdout pollution (P3)

**Root cause:** JSON mode used `stdio: ['ignore','inherit','inherit']`; the
child's stdout inherited the JSON parent stdout, so pnpm progress preceded the
JSON document.

**Fix:** JSON mode uses `spawnSync` with both child streams piped; stdout and
stderr are forwarded to **stderr**; only the result JSON is written to stdout.
Non-JSON mode keeps inherited live output. Failure also emits one JSON envelope
(`ok:false`, error code/message/hint) and exits non-zero.

**Tests:** non-dry-run `--json` fake-dsh test asserts JSON parses with no
`Progress:` on stdout; failure test asserts stable JSON error envelope.

## 3. BUG-R3-04 — `skills-update check --json` unstructured errors (P3)

**Fix:** `skills-update.mjs` error path emits:

```json
{ "ok": false, "error": { "code": "...", "message": "...", "hint": "..." } }
```

Stable codes include `GIT_TIMEOUT`, `GIT_AUTH`, `ROLLBACK_FAILED`,
`SKILLS_STATE_INVALID`, fallback `SKILLS_UPDATE_FAILED`; tokens in URLs are
redacted; exit code remains non-zero. Non-JSON behavior is unchanged.
Test forces a git timeout with a fake git executable and parses the envelope.

## 4. BUG-R3-03 — Failed dependency tree cleanup (P3)

- `install.mjs` removes `.hyperai-failed-node_modules` **only after** a verified
  success, never before/instead of a good `node_modules`.
- `doctor` warns when a failed-tree quarantine exists and explains repair.
- Tests cover failure → quarantine → successful retry → cleanup.

## 5. BUG-R3-02 — Uninstall archive restore documentation (P3)

- `manage.mjs` archive now writes a detailed `README.txt`: safe restore steps,
  no-overwrite rule, marker removal, reinstall and doctor commands.
- `apps/profiles/hyperai/README.md` documents the same restore flow.
- Lifecycle test asserts the archive README contains the safe steps.

## 6. Updater D3 — recover before planning (low)

- `skills-update.mjs` now calls `recoverPending(options)` before `checkRemote()`
  for non-dry-run updates, so a skill rolled back during recovery is included in
  the same run's plan instead of lagging one run.

## 7. TUI leftovers (P3)

- Splash font label now reads `Splash font (HyperAI fixed solid)` and the visible
  default option reads `HyperAI fixed solid (upstream compatibility)`; hint says
  daily rotation is disabled for HyperAI. Companion skin is marked unused.
- Terminal title now uses `HyperAI Harness · <session>` rather than `✦`.
- 56-column compact label remains intentional; documented in `apps/tui/README.md`.
- Generated patch size: `81,048 bytes`, deterministic build; TUI verify 13/13.

## 8. Non-TTY boundary

- README now explicitly states the TUI requires a real TTY/PTY; headless TUI
  startup is unsupported upstream behavior. CLI `--json` is the automation
  interface. No DSH/TUI architecture change was made for this.

## 9. Residual risks / not claimed fixed

- The six canonical kill points are covered by Agent B's external real tests;
  this repository's new real kill regression focuses on the previously missing
  MID-SWAP state. A full six-phase independent rerun remains QA work.
- Temp clone cleanup after SIGKILL (B2/D2) remains a low-risk disk leak.
- 56-column upstream version is intentionally omitted; non-TTY TUI remains
  upstream-blocked.
- QA-014 Skills repository license and QA-002 private visibility are unchanged
  by product decision.
- All results are development self-test; **independent QA has not accepted this
  commit yet**.
