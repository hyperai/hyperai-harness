# ROUND3 — Legacy Skills Crash Recovery

**Defect:** BUG-R3B-01 (P1 data loss)  
**Code commit:** `60dc943dc1a351f3ebbfb7aeb994a1c68ec1bc86`  
**Test:** `apps/profiles/hyperai/tests/crash.test.mjs`  
**Result:** real child SIGKILL regression PASS; repeated 10/10.

## 1. Fixture

- 12 skills: `qa-kill-01` … `qa-kill-12`.
- Each skill has managed `SKILL.md` and `references/notes.md`.
- v1 repository commit: `ae3319e2930da68a0d94d114e86d06947a9b4347`.
- v2 repository commit: `e93f403875769833435bf24e56c2b2682be43dcd`.
- v1 installed, then each skill received:
  - `NOTES.md` (skill root, not part of the managed digest);
  - `references/my-notes.md` (user file inside a resource dir).

## 2. Real SIGKILL hit

The development harness polled the real child process (not a journal rewrite)
and froze it with SIGSTOP only after observing:

```text
target/<name>                missing
staging/<name>-old-*         present and complete
pending/<name>.json          present
```

It then verified the state again and sent a real SIGKILL. First manual hit was
`qa-kill-02`.

### State at kill

```text
victim: qa-kill-02
target_exists: false
old_exists: true
journal_exists: true
pending: qa-kill-02.json, qa-kill-01.json
staging: qa-kill-01-old-*, qa-kill-02-<new>, qa-kill-02-old-*
```

Old tree hashes captured at the kill:

```text
NOTES.md                 94a106af607c37f58ba453f4fea4f6be789ae4a8864e111a39fe04eb56e4532f
references/my-notes.md   982bc24d0d883adfa869d709df4cdaee3aef26a09e64a03f3a738f8292684ad1
references/notes.md      b5dceb03625dcdefd9ae8b2826d6bb79c8a59ae952bb810845e861117414f5ca
SKILL.md                 051e984da7cb8a39b65e488bef3ab7654b1c564d16c6ed1e7e1e6d55e4b0f42e
```

## 3. Journal / recovery semantics

Journals now carry `phase`:

```text
prepared   journal written; no directory rename yet
old-moved  target renamed to oldPath
new-moved  staging renamed to target
```

Recovery does not trust `phase` alone; it inspects target, oldPath, staging,
manifest and backup:

| State | Action |
|---|---|
| target matches newEntry | write manifest new; preserve missing extras from oldPath/snapshot; clean |
| target matches beforeEntry | keep old target; restore old manifest; preserve extras; clean staging |
| target missing + oldPath complete | **restore oldPath to target**; restore beforeEntry; clean staging/journal |
| target missing + no oldPath + staging complete + no previous entry | finish new install |
| target missing + snapshot available | restore snapshot |
| anything else | throw `SKILL_RECOVERY_FAILED`; keep journal/oldPath/staging/backups; non-zero |

## 4. Recovery result (manual MID hit)

Command:

```text
node apps/profiles/hyperai/scripts/install-skills.mjs \
  --dsh-home <isolated> --profile hyperai \
  --lock <v2-lock> --source <fixture-repo>
```

```text
exit 0
stderr empty
updated 12/12 (qa-kill-01 … qa-kill-12)
```

Post-recovery checks:

- `victim/NOTES.md`:
  `94a106af607c37f58ba453f4fea4f6be789ae4a8864e111a39fe04eb56e4532f`
  — equal to pre-kill.
- `victim/references/my-notes.md`:
  `982bc24d0d883adfa869d709df4cdaee3aef26a09e64a03f3a738f8292684ad1`
  — equal to pre-kill.
- All 24 user extras equal before/after (`extras_equal: true`).
- victim `SKILL.md` = v2.
- manifest `ref` = `e93f403875769833435bf24e56c2b2682be43dcd` for all 12.
- manifest managed-file hashes equal actual files.
- `pending/` empty.
- no `skip-user-modified`; no data loss; exit 0 is now legitimate because
  recovery completed safely.

## 5. Automated regression

`apps/profiles/hyperai/tests/crash.test.mjs`:

- builds 12-skill v1/v2/v3 fixture;
- installs v1 and injects root/reference extras;
- launches real child update;
- tight-polls for target absent + oldPath present + journal;
- SIGSTOP-gated SIGKILL (real kill, no journal fabrication);
- runs recovery and v2/v3, verifying:
  - all 24 extras hashes unchanged;
  - all manifest refs and managed file hashes match disk;
  - no pending journals;
  - repeated update converges;
  - no stale temp journal files.
- Repeated 10/10 PASS after fixing a flaky stale `.json.tmp-*` cleanup race.

## 6. Other kill points

Agent B deep report provides real child SIGKILL evidence for six canonical points
(P1–P6). This developer round did not rerun every canonical point; it adds the
previously uncovered MID state and fail-safe unit coverage. Independent QA
should repeat all six plus MID against the final SHA.

## 7. Residual risks

- Six canonical points still need independent re-run at final SHA.
- SIGKILL may leak temp clone directories (`/tmp/hyperai-skills-*`); low-risk,
  documented, not auto-deleted.
- Multi-process concurrent installers on one DSH_HOME are not serialized.
- Network filesystems / non-APFS rename behavior not tested.

## 8. Release impact

The P1 silent user-data loss path is repaired in code and has a real
mid-swap regression. It is **FIXED pending independent QA re-test**, not a
self-certified release pass.
