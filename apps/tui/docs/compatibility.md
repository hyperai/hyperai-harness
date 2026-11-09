# DSH Core / dsh-tui compatibility

HyperAI TUI is a patch over one exact upstream TUI release. Compatibility is a
product decision recorded in [`../src/brand.json`](../src/brand.json), not a
runtime “ignore the warning” switch.

## Pinned matrix

| Layer | Pinned/tested value |
| --- | --- |
| HyperAI TUI product | `apps/tui/package.json` (`0.2.0-beta.5`) |
| Upstream dsh-tui | `@deepseek-harness-tui/dsh-tui@0.16.1`, tag `v0.16.1`, commit `73ff99fbed56563bf154d719effd09f9f9725349` |
| Validated DSH Core lines | `brand.json` → `core.validated` (includes the tested `0.2.0-rc.2`) |
| Unsupported example | `0.2.1-rc.5` is not in the validated set and is refused by the installer |

`UPSTREAM_VALIDATED_VERSIONS` in the upstream package is the source for the
current list. When upstream publishes a new line, a developer must:

1. inspect the upstream contract and release notes;
2. update `core.validated` only after a compatibility run;
3. rebuild the patch (`node scripts/build-patch.mjs`);
4. run TUI/profile tests and a real cold-install smoke;
5. update this matrix and the install evidence before changing the list.

The installer has no `--accept-risk`/version-bypass flag. A DSH Core outside the
list fails before profile writes. The TUI still displays its normal upstream
drift warning for an already-installed mismatched profile, but that does not
count as a successful installation.

## Upgrade policy

- Patch upgrades are intentional releases: rebuild the patch, reinstall the
  profile, and keep the previous verified DSH Core/TUI combination recorded.
- `/update` is intentionally disabled because the upstream updater downloads
  the unbranded package and would silently remove HyperAI branding.
- The profile's `pnpm-lock.yaml` is generated locally. `--frozen-lockfile` is
  opt-in for a reproducible reinstall; normal upgrade runs may refresh the lock
  after review.
- Unsupported combinations should be reported as a blocked install, not worked
  around by editing the Core guard or pinning a different TUI without a new
  compatibility run.
