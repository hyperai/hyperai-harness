# hyperai profile (native DSH profile)

The `hyperai` profile is a **native DeepSeek Harness profile**: the installed
profile is a normal directory under `~/.dsh/profiles/hyperai` with the upstream
manifest fields (`dsh.profile.bundles`, `dependencies`), a
`cordis.patch.yml` patch layer and a profile-local `pnpm` workspace. No custom
profile format or loader is introduced.

This package owns only the profile side:

- the native profile manifest and bundle order (`@deepseek-ai/dsh-base` then the
  branded `@deepseek-harness-tui/dsh-tui`);
- the profile patch layer: the profile-scoped skill root only. Model providers
  and models are **DSH-native user configuration**, not profile defaults;
- profile initialization, validation, TUI patch installation and the HyperAI
  skills install/lock mechanism.

It does **not** contain TUI implementation code. The TUI branding lives in the
independent [`apps/tui`](../../tui) package; this installer copies that package's
generated `pnpm` patch and installs the pinned upstream TUI dependency.

## Prerequisites and compatibility

- Node.js `^22.19 || >=24` (the `apps/tui` engine range); Node 18/20/23 is
  rejected **before** any profile write.
- `pnpm` on `PATH` (the `dsh plugin` wrapper uses it); a missing pnpm is a
  preflight error, not a late failure.
- DSH Core must be in the validated list in
  [`../tui/src/brand.json`](../../tui/src/brand.json). The current tested line
  is `0.2.0-rc.2`; an unsupported line such as `0.2.1-rc.5` is refused with the
  validated list and installation guidance. There is intentionally no
  `--accept-risk`/version-bypass flag.
- The installer records phases in `<profile>/.hyperai-install.json`; a failed
  phase is visible to `status`/`doctor` and can be retried with `repair`.

## Install

```sh
cd apps/profiles/hyperai
node scripts/install.mjs                         # profile + TUI + verified skills
node scripts/install.mjs --include-unverified    # also install inbox candidates (experimental)
node scripts/install.mjs --no-skills
node scripts/install.mjs --dry-run               # print the plan, write nothing
node scripts/install.mjs --frozen-lockfile       # reproducible reinstall from the profile lock
node scripts/verify.mjs                          # offline template/installer checks
node --test tests/                               # installer + skills unit tests
```

`--include-unverified` is the only way to install the three `inbox/` candidates;
the default release path installs only the repo-verified `skills/` set. The
updater still labels legacy/unverified entries and never silently promotes them.

## Lifecycle

```sh
node scripts/manage.mjs status                 # read-only profile/install summary
node scripts/manage.mjs doctor                 # Node/pnpm/DSH Core/patch/skills diagnostics
node scripts/manage.mjs repair --yes           # recover a partial/failed install
node scripts/manage.mjs uninstall --yes        # archive user data, remove managed runtime files
node scripts/manage.mjs uninstall --yes --purge # second stage: archive then remove the profile directory
```

`uninstall` archives the profile (skills, state, user files; excluding
`node_modules`) under `~/.dsh/profiles/.hyperai-uninstall-backups/` before it
removes installer-owned files (including the managed LICENSE). It leaves a
`.hyperai-uninstall.json` marker so a later `uninstall --yes --purge` can finish
the two-stage cleanup without pretending the profile is still managed. Shared
credentials under `~/.dsh/.credentials.yaml` are never rewritten or deleted by
these commands. An interrupted install state (`installing` with a dead pid) is
reported by `doctor` as needing `repair`.

## Environment isolation

The profile's UI state is `~/.dsh-tui-<profile>` (for HyperAI:
`~/.dsh-tui-hyperai`), derived from `--profile`. DSH model/provider/session
state is under `$DSH_HOME/profiles/hyperai`. For a completely isolated test,
set **both** `DSH_HOME` and a temporary `HOME`; setting only `DSH_HOME` still
leaves the TUI preferences/history under the real home directory. The installer
and tests never write the real user's profile when given temporary paths.

The installer writes the native profile under `~/.dsh/profiles/hyperai`,
installs dependencies through `dsh plugin --profile hyperai install`, verifies
the branding patch landed, then installs the pinned skills. A profile that the
installer did not create is refused unless `--force` is given; every replaced
managed file is backed up under `<profile>/.hyperai-backups/<timestamp>/` first.
Existing user data (skills content, `~/.dsh-tui-hyperai` UI state, model
selection and user-created `llm-pi-ai`/`insert` rows in `cordis.patch.yml`) is
preserved; re-running the installer backs the file up and merges only the
managed skill-root row, dropping the removed environment-driven preset rows.
The generated `pnpm-lock.yaml` stays in the profile; use `--frozen-lockfile`
for a reproducible reinstall, or omit it when intentionally refreshing the
patched TUI dependency. The default install path does not write a lockfile into
this repository checkout.

## Configure the model (DSH-native, no preset provider)

The profile does **not** ship a provider, endpoint, API-key variable or default
model. It behaves like the original `dsh-tui` profile:

```sh
dsh --profile hyperai
# inside the TUI:
#   /provider  → add/edit an OpenAI-compatible (or catalog) provider, e.g.
#               route `litellm`, base URL https://your-gateway/v1, key saved in
#               ~/.dsh/.credentials.yaml
#   /model     → pick a model from that provider
```

Provider settings are persisted by DSH in this profile's own
`cordis.patch.yml` (an `llm-pi-ai` row with plain values) and in
`~/.dsh/.credentials.yaml` (mode 0600). The `/model` choice is persisted in
`~/.dsh-tui-hyperai/model.json`. All of these survive restarts and are kept by
`scripts/install.mjs` re-runs (it merges user rows instead of replacing the
patch file). No environment-variable credential, endpoint or model is required
or read by the profile.

## Skills

`scripts/install-skills.mjs` installs the pinned `hyperai-skills` commit listed
in [`skills/hyperai-skills.lock.json`](skills/hyperai-skills.lock.json) into
`<profile>/skills/` as the initial/offline baseline. Day-to-day updates use the
independent updater, which `install.mjs` copies into the installed profile:

```sh
node ~/.dsh/profiles/hyperai/scripts/skills-update.mjs catalog   # offline
node ~/.dsh/profiles/hyperai/scripts/skills-update.mjs check     # read-only
node ~/.dsh/profiles/hyperai/scripts/skills-update.mjs update --yes
node ~/.dsh/profiles/hyperai/scripts/skills-update.mjs rollback --list

# explicit development-branch test (prerelease; never the default):
node ~/.dsh/profiles/hyperai/scripts/skills-update.mjs check \
  --ref feat/ppt-generation-upstream
```

The updater discovers `skills/**/SKILL.md` recursively, flattens categories to
DSH's one-level layout, skips local-modified/user-installed skills, preserves
user extra files, keeps skills removed upstream, and records backups/rollback
snapshots in `<profile>/.hyperai-skills/`. It never touches model/provider
configuration. The TUI checks it asynchronously after the first frame (at most
once per 24h, silent when up to date) and shows a non-blocking hint; typing
`/skills-update` opens the install/details/later dialog. Installation is always
user-confirmed and pinned to the exact SHA shown by the check. See
[`docs/skills.md`](docs/skills.md) for the full mechanism, manifest schema,
TUI bridge and safety rules.

## Layout

```
apps/profiles/hyperai/
├── package.json          native DSH profile manifest (bundles + pinned TUI dep)
├── cordis.patch.yml      profile-scoped skill root only (model config is user-owned)
├── pnpm-workspace.yaml   hoisted profile workspace + TUI patch wiring
├── README.md
├── scripts/install.mjs          profile init + TUI patch + dependency install
├── scripts/install-skills.mjs   legacy/bootstrap skills install
├── scripts/skills-update.mjs    skills check/update/catalog/rollback CLI
├── scripts/skills-lib.mjs       discovery, digests, transactions, rollback
├── scripts/verify.mjs
├── skills/hyperai-skills.lock.json
├── tests/install.test.mjs
├── tests/skills.test.mjs
├── tests/skills-update.test.mjs
└── docs/skills.md
```

## License and third-party material

HyperAI profile code is MIT-licensed (Copyright (c) 2026 DeepSeek); see
[`LICENSE`](LICENSE). The branded TUI is a modified upstream dsh-TUI package,
whose MIT/BSD/MathJax notices are recorded in
[`../tui/docs/third-party-notices.md`](../tui/docs/third-party-notices.md).

The private `hyperai/hyperai-skills` source repository currently has **no
LICENSE file** in the audited checkout. This profile does not relicense or
redistribute the skills source; the installer consumes it from the configured
private repository into the user's local profile, and the Skills repository is
an Internal-only source for now. Before any public distribution of installed
skills, the company must confirm/attach the appropriate license and attribution
for that repository.

## Maintenance

The TUI is installed as a `pnpm` patch over the pinned upstream
`@deepseek-harness-tui/dsh-tui` version in `apps/tui/src/brand.json`. Bumping
upstream means rebuilding the patch in `apps/tui` and re-running this
installer; see `apps/tui/README.md`. The installed profile itself contains no
checkout paths: it only carries the copied `patches/hyperai-tui.patch`.

## Known limitations and upstream boundaries

- The private `hyperai-skills` repository has no LICENSE file; Skills remain
  Internal-only and must not be publicly redistributed until its license and
  attribution are confirmed. QA-002 is intentionally deferred: do not change
  repository visibility, URL, lock ref, authentication or distribution.
- HyperAI does not fix upstream DSH behavior outside the profile/TUI boundary:
  the tool-ralph entry warning and plain-text API-key echo in provider input
  are upstream concerns. They are recorded as known limitations rather than
  forked into the branded patch.
- The branded `/update` command is disabled with an explicit message; upgrades
  go through the profile installer/release flow. `/restart` and normal chat,
  tool, provider and model features remain upstream.
- Very narrow terminal windows use upstream's plain-title fallback. The
  56/80/120-column matrix still needs a dedicated cross-terminal pass.
- Windows/Linux and a fresh public-user install are not yet part of the
  automated acceptance matrix.

## Restoring an uninstall archive

`uninstall --yes` writes an archive under
`<dsh-home>/profiles/.hyperai-uninstall-backups/<profile>-<stamp>/` and a
`README.txt` inside it. The archive is a copy of the profile; it is not a
one-click restore command.

1. Stop every DSH/TUI process using this profile.
2. Choose a target that does not already contain a profile. If
   `<dsh-home>/profiles/<profile>` exists, move it aside; do not merge archives.
3. Copy the archive back to the profile path, preserving user skills, settings
   and install state. Keep the archive until verification finishes.
4. Remove the `.hyperai-uninstall.json` marker from the restored directory.
5. Re-run the profile installer for this release, then
   `node scripts/manage.mjs doctor --dsh-home <dsh-home>`.
6. Review doctor warnings before launching the TUI. Shared credentials live in
   `<dsh-home>/.credentials.yaml`, not in the archive; do not copy credentials
   from an untrusted archive.

## Test-environment boundaries

- The preflight runs `pnpm --version`. If pnpm is provided by Corepack and not
  already installed, that command may bootstrap a package-manager shim into
  `HOME`. This is a host toolchain side effect, not a profile write. QA should
  use a preinstalled pnpm or a disposable HOME and must not assume the check is
  side-effect-free.
- `install.mjs` / `manage.mjs` are the supported non-TTY automation surface;
  use `--json` for one machine-readable document (dependency and pnpm progress
  are kept off stdout; recoverable diagnostics go to stderr).
- **The TUI requires a real TTY/PTY.** Headless/non-TTY TUI startup is not a
  supported automation interface; upstream dsh-tui may wait without output.
  Use a PTY for TUI automation, or use the installer/lifecycle CLI with
  `--json` for CI and scripts.
- Isolated end-to-end tests should set both `DSH_HOME` and `HOME` when checking
  UI state; the installer's `--dsh-home` controls profile files but not every
  upstream TUI preference path.
