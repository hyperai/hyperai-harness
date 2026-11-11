#!/usr/bin/env node
/**
 * HyperAI skills updater CLI.
 *
 *   node scripts/skills-update.mjs check [--ref <branch|tag|sha>]
 *   node scripts/skills-update.mjs update [--dry-run] [--yes] [--skill <name>]
 *   node scripts/skills-update.mjs catalog
 *   node scripts/skills-update.mjs rollback [--list] [--to <backup-id>] [--yes]
 *   node scripts/skills-update.mjs dismiss --ref <resolved-sha> [--skill <name>...]
 *
 * The updater never touches model/provider config and keeps the DSH-native
 * loading path unchanged. It reads `skills/` from a pinned commit of the
 * HyperAI skills repository, compares content digests with the local manifest,
 * asks before writing, and only replaces the managed skill directories it owns.
 * `check --auto/--manual/--json` and `dismiss` are the machine-readable bridge
 * used by the HyperAI TUI; `check --auto` records the 24h auto-check slot and
 * suppresses a dismissed batch. See docs/skills.md for the design.
 */
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline/promises'
import {
  DEFAULT_REPO, SKILL_NAME, SkillsError, applyPlan, catalog, channelOf, digestFromFiles,
  discoverSkills, formatPlan, listBackups, planHasChanges, planSkills, prepareSource,
  readManifest, recoverPending, rollback, STABLE_REF,
} from './skills-lib.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Parse CLI arguments. */
export function parseArgs(argv) {
  const options = {
    command: undefined,
    dshHome: process.env.HYPERAI_DSH_HOME ?? join(process.env.HYPERAI_HOME ?? join(homedir(), '.hyperai'), 'dsh'),
    profile: 'hyperai',
    repo: process.env.HYPERAI_SKILLS_REPO ?? DEFAULT_REPO,
    ref: STABLE_REF,
    refExplicit: false,
    source: undefined,
    json: false,
    dryRun: false,
    yes: false,
    list: false,
    to: undefined,
    skills: [],
    timeoutMs: 120_000,
    auto: false,
    manual: false,
    intervalHours: 24,
  }
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index]
    if (arg === 'check' || arg === 'update' || arg === 'catalog' || arg === 'rollback' || arg === 'dismiss') options.command = arg
    else if (arg === '--dsh-home') options.dshHome = argv[++index]
    else if (arg === '--profile') options.profile = argv[++index]
    else if (arg === '--repo') options.repo = argv[++index]
    else if (arg === '--ref') { options.ref = argv[++index]; options.refExplicit = true }
    else if (arg === '--source') options.source = resolve(argv[++index])
    else if (arg === '--json') options.json = true
    else if (arg === '--dry-run') options.dryRun = true
    else if (arg === '--yes' || arg === '-y') options.yes = true
    else if (arg === '--list') options.list = true
    else if (arg === '--to') options.to = argv[++index]
    else if (arg === '--skill') options.skills.push(argv[++index])
    else if (arg === '--timeout') options.timeoutMs = Number(argv[++index])
    else if (arg === '--auto') options.auto = true
    else if (arg === '--manual') options.manual = true
    else if (arg === '--interval-hours') options.intervalHours = Number(argv[++index])
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new SkillsError(`unknown argument ${JSON.stringify(arg)}`)
  }
  options.dshHome = resolve(options.dshHome)
  options.profileDir = join(options.dshHome, 'profiles', options.profile)
  options.skillsDir = join(options.profileDir, 'skills')
  options.stateDir = join(options.profileDir, '.hyperai-skills')
  if (options.command === undefined && options.help !== true) options.command = 'check'
  return options
}

/** Resolve the requested remote and build the check plan. */
function checkRemote(options) {
  const source = prepareSource(options)
  try {
    const nested = join(source.root, 'skills')
    const skillsRoot = existsSync(nested) ? nested : source.root
    let remote
    try {
      remote = discoverSkills(skillsRoot)
    } catch (error) {
      throw error instanceof SkillsError ? error : new SkillsError(String(error), error)
    }
    const manifest = readManifest(options.stateDir)
    const plan = planSkills({ remote, manifest, skillsDir: options.skillsDir, source })
    return { source, manifest, remote, plan }
  } catch (error) {
    source.cleanup()
    throw error
  }
}

/** Print the source/plan header. */
function printHeader(source, options) {
  const channel = channelOf(source.requestedRef)
  process.stdout.write(`source: ${source.repo}\n`)
  process.stdout.write(`ref:    ${source.requestedRef} -> ${source.resolvedRef}  (${channel === 'stable' ? 'stable' : 'prerelease/test'})\n`)
  process.stdout.write(`target: ${options.skillsDir}\n\n`)
}

/** Machine state used by the TUI: auto-check throttle and dismissed batch. */
function tuiStatePath(options) {
  return join(options.stateDir, 'tui-state.json')
}

/** Read the TUI bridge state; corruption is treated as no state. */
function readTuiState(options) {
  const path = tuiStatePath(options)
  if (!existsSync(path)) return { version: 1 }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : { version: 1 }
  } catch {
    return { version: 1 }
  }
}

/** Atomic state write; never blocks the TUI check on a stats-only side file. */
function writeTuiState(options, state) {
  mkdirSync(options.stateDir, { recursive: true })
  const path = tuiStatePath(options)
  const temp = `${path}.tmp-${process.pid}-${Date.now()}`
  writeFileSync(temp, `${JSON.stringify({ version: 1, ...state }, undefined, 2)}\n`)
  renameSync(temp, path)
}

/** Whether the 24h auto-check slot is exhausted. */
function autoCheckDue(state, options) {
  const rawHours = Number(options.intervalHours)
  const hours = Number.isFinite(rawHours) ? Math.max(0, rawHours) : 24
  const interval = hours * 60 * 60 * 1000
  const last = Date.parse(state.lastAutoCheckAt ?? '')
  if (!Number.isFinite(last)) return true
  return Date.now() - last >= interval
}

/** Compact machine-readable check payload for the TUI (full plan kept for CLI). */
function tuiCheckPayload(source, plan, extra = {}) {
  const updates = [
    ...plan.adds.map(item => ({
      name: item.name,
      action: 'add',
      version: item.remote.version,
      description: item.remote.description,
      files: Object.keys(item.remote.files).length,
      bytes: item.remote.bytes,
      sourcePath: item.remote.sourcePath,
      digest: item.remote.digest,
    })),
    ...plan.updates.map(item => ({
      name: item.name,
      action: 'update',
      version: item.remote.version,
      description: item.remote.description,
      files: Object.keys(item.remote.files).length,
      bytes: item.remote.bytes,
      sourcePath: item.remote.sourcePath,
      digest: item.remote.digest,
      fromDigest: item.fromDigest,
    })),
  ]
  return {
    source: {
      repo: source.repo,
      requestedRef: source.requestedRef,
      resolvedRef: source.resolvedRef,
      channel: channelOf(source.requestedRef),
    },
    changes: planHasChanges(plan),
    count: updates.length,
    updates,
    dismissed: extra.dismissed ?? false,
    skippedReason: extra.skippedReason,
    ...extra.extra,
    // Do not ship the full plan (source file maps and skipped details) to the
    // TUI: it is not consumed there and can exceed the child stdout cap on
    // large private repositories. The CLI's human output still uses `plan`.
  }
}

/** Whether a dismissed batch still matches the current plan exactly. */
function isDismissed(state, source, plan) {
  const ignored = state.ignored
  if (ignored === null || typeof ignored !== 'object') return false
  if (ignored.resolvedRef !== source.resolvedRef) return false
  const names = [
    ...plan.adds.map(item => item.name),
    ...plan.updates.map(item => item.name),
  ].sort()
  const dismissedNames = Array.isArray(ignored.names) ? [...ignored.names].sort() : []
  return names.length > 0 && (dismissedNames.length === 0 || JSON.stringify(dismissedNames) === JSON.stringify(names))
}

/** Interactive confirmation; --yes skips it, non-TTY without --yes refuses. */
async function confirm(message) {
  if (!process.stdin.isTTY) throw new SkillsError('refusing to write without confirmation in a non-interactive shell; pass --yes')
  const readline = createInterface({ input: process.stdin, output: process.stdout })
  try {
    const answer = (await readline.question(`${message} [y/N] `)).trim().toLowerCase()
    return answer === 'y' || answer === 'yes'
  } finally {
    readline.close()
  }
}

/** Remove credentials accidentally embedded in URLs before printing an error. */
function redactErrorText(value) {
  return String(value).replace(/https?:\/\/[^\s/@]+@/gu, 'https://<redacted>@')
}

/** Classify an updater failure for the machine-readable contract. */
export function errorEnvelope(error) {
  const raw = error instanceof Error ? error.message : String(error)
  const message = redactErrorText(raw)
  let code = 'SKILLS_UPDATE_FAILED'
  let hint = 'Inspect the message, then retry; use --timeout or --source when appropriate.'
  if (/timed out|ETIMEDOUT/iu.test(raw)) {
    code = 'GIT_TIMEOUT'
    hint = 'Check network/proxy/GitHub access, retry with --timeout <ms>, or use --source <existing-checkout>.'
  } else if (/authentication|permission denied|could not read username|repository not found|access denied/iu.test(raw)) {
    code = 'GIT_AUTH'
    hint = 'Verify GitHub authentication and private-repository permission; never embed a token in the command or config.'
  } else if (/no backups|rollback/iu.test(raw)) {
    code = 'ROLLBACK_FAILED'
    hint = 'List backups with rollback --list and inspect the archive/state paths before deleting anything.'
  } else if (/manifest|invalid JSON|parse/iu.test(raw)) {
    code = 'SKILLS_STATE_INVALID'
    hint = 'Preserve .hyperai-skills and backups; inspect the reported JSON/state error before retrying.'
  }
  return { ok: false, error: { code, message, hint } }
}

/** Print an error in the CLI's consistent form. */
function fail(error) {
  if (process.argv.includes('--json')) {
    process.stdout.write(`${JSON.stringify(errorEnvelope(error), undefined, 2)}\n`)
  } else {
    process.stderr.write(`skills-update: ${error instanceof Error ? error.message : String(error)}\n`)
  }
  process.exitCode = 1
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) {
    process.stdout.write([
      'usage: node skills-update.mjs <command> [options]',
      '',
      'commands:',
      '  check      resolve a remote ref, scan skills/, compare with the local manifest; read-only',
      '  update     check, confirm, then transactionally install/update skills',
      '  catalog    list installed/managed/local-only skills (offline)',
      '  rollback   restore a backup snapshot (--list to see snapshots)',
      '  dismiss    remember a dismissed update batch (resolved SHA + names)',
      '',
      'options:',
      '  --ref <ref>      branch, tag or commit (default: master; non-master = prerelease)',
      '  --repo <url>     skills repository (default: https://github.com/hyperai/hyperai-skills.git)',
      '  --source <dir>   use an existing checkout instead of cloning (offline/tests)',
      '  --dsh-home <dir> Harness home (default: $DSH_HOME or ~/.dsh)',
      '  --profile <name> profile name (default: hyperai)',
      '  --skill <name>   limit update to a skill (repeatable)',
      '  --dry-run        print the plan/result without writing',
      '  --yes            skip interactive confirmation',
      '  --json           machine-readable output (check includes a compact TUI payload)',
      '  --auto           apply the 24h auto-check interval and suppression',
      '  --manual         manual check: ignore the interval and dismissed batch',
      '  --interval-hours auto-check interval (default 24)',
      '  --to <id>        rollback target snapshot',
      '  --list           list rollback snapshots',
      '  --timeout <ms>   git network timeout (default 120000)',
      '',
    ].join('\n'))
    return
  }
  if (options.command === 'dismiss') {
    if (!options.refExplicit || options.ref === '') throw new SkillsError('dismiss requires --ref <resolved-sha>')
    if (!/^[0-9a-f]{40}$/u.test(options.ref)) throw new SkillsError('dismiss --ref must be the 40-char commit SHA shown by check')
    const state = readTuiState(options)
    const names = options.skills.filter(name => SKILL_NAME.test(name)).sort()
    const next = { ...state, ignored: { resolvedRef: options.ref, names, at: new Date().toISOString() } }
    writeTuiState(options, next)
    if (options.json) process.stdout.write(`${JSON.stringify({ dismissed: true, resolvedRef: options.ref, names }, undefined, 2)}\n`)
    else process.stdout.write(`dismissed ${options.ref}${names.length > 0 ? ` (${names.join(', ')})` : ''}\n`)
    return
  }
  if (options.command === 'catalog') {
    const recovered = recoverPending(options)
    const manifest = readManifest(options.stateDir)
    const result = catalog({ manifest, skillsDir: options.skillsDir })
    if (options.json) process.stdout.write(`${JSON.stringify({ ...result, recovered }, undefined, 2)}\n`)
    else {
      process.stdout.write(`catalog: ${options.skillsDir}\n`)
      if (result.managed.length === 0) process.stdout.write('  (no managed skills)\n')
      for (const item of result.managed) {
        process.stdout.write(`  ${item.name}  ${item.status}${item.version ? `  v${item.version}` : ''}  ${item.files} files${item.extras.length ? `  (${item.extras.length} local extra files)` : ''}\n`)
      }
      if (result.localOnly.length > 0) {
        process.stdout.write('\n  local-only (not managed by the updater; never modified):\n')
        for (const name of result.localOnly) process.stdout.write(`    ${name}\n`)
      }
      if (recovered.length > 0) process.stdout.write(`\n  recovered interrupted operation(s): ${recovered.join(', ')}\n`)
    }
    return
  }
  if (options.command === 'rollback') {
    if (options.list) {
      const backups = listBackups(options.stateDir)
      if (backups.length === 0) process.stdout.write('no backups\n')
      for (const backup of backups) {
        process.stdout.write(`${backup.id}  ${backup.meta.kind ?? ''}  ${(backup.meta.names ?? []).length} skill(s)  ${backup.meta.at ?? ''}\n`)
      }
      return
    }
    recoverPending(options)
    const plan = rollback({ stateDir: options.stateDir, skillsDir: options.skillsDir, to: options.to, dryRun: true })
    if (options.json) process.stdout.write(`${JSON.stringify(plan, undefined, 2)}\n`)
    else {
      process.stdout.write(`rollback to ${plan.id}\n`)
      for (const name of plan.restore) process.stdout.write(`  restore ${name}\n`)
      for (const name of plan.remove) process.stdout.write(`  remove  ${name} (added after the snapshot)\n`)
      for (const name of plan.keep) process.stdout.write(`  keep    ${name} (modified after the snapshot)\n`)
    }
    if (options.dryRun) return
    if (!options.yes && !(await confirm('Write this rollback?'))) {
      process.stdout.write('cancelled\n')
      return
    }
    const result = rollback({ stateDir: options.stateDir, skillsDir: options.skillsDir, to: options.to })
    if (options.json) process.stdout.write(`${JSON.stringify(result, undefined, 2)}\n`)
    else process.stdout.write(`rollback done; current state backed up as ${result.backupBefore}\n`)
    return
  }
  // check / update
  if (options.auto && options.manual) throw new SkillsError('--auto and --manual are mutually exclusive')
  // Recover an interrupted prior update before planning this one. Otherwise a
  // skill rolled back by recovery can be missing from this run's plan (D3).
  if (options.command === 'update' && !options.dryRun) recoverPending(options)
  const stateBefore = readTuiState(options)
  if (options.command === 'check' && options.auto && !options.manual && !autoCheckDue(stateBefore, options)) {
    const payload = {
      skipped: true,
      skippedReason: 'auto-interval',
      nextAllowedAt: new Date(Date.parse(stateBefore.lastAutoCheckAt) + (Number.isFinite(Number(options.intervalHours)) ? Math.max(0, Number(options.intervalHours)) : 24) * 3600_000).toISOString(),
      changes: false,
      count: 0,
      updates: [],
      dismissed: false,
    }
    if (options.json) process.stdout.write(`${JSON.stringify(payload, undefined, 2)}\n`)
    else process.stdout.write('auto check skipped: interval not elapsed\n')
    return
  }
  if (options.command === 'check' && options.auto) {
    writeTuiState(options, { ...stateBefore, lastAutoCheckAt: new Date().toISOString(), lastAutoCheckError: null })
  }
  const { source, plan } = checkRemote(options)
  try {
    const dismissed = options.command === 'check' && options.auto && !options.manual && isDismissed(stateBefore, source, plan)
    const payload = tuiCheckPayload(source, plan, { dismissed })
    if (options.command === 'check' && options.auto) {
      writeTuiState(options, {
        ...readTuiState(options),
        lastAutoCheckAt: new Date().toISOString(),
        lastAutoCheckError: null,
        lastResolvedRef: source.resolvedRef,
      })
    }
    if (!options.json) printHeader(source, options)
    const lines = formatPlan(plan)
    if (options.json) {
      process.stdout.write(`${JSON.stringify(payload, undefined, 2)}\n`)
    } else if (lines.length === 0) {
      process.stdout.write('no skills found under skills/\n')
    } else {
      process.stdout.write(`${lines.join('\n')}\n\n`)
    }
    if (options.command === 'check') {
      if (dismissed) {
        process.exitCode = 0
        return
      }
      process.exitCode = planHasChanges(plan) ? 2 : 0
      return
    }
    if (!planHasChanges(plan)) {
      process.stdout.write(plan.skipped.length > 0 ? 'nothing installable: all changed skills were skipped (see above)\n' : 'already up to date\n')
      return
    }
    if (options.dryRun) {
      process.stdout.write('dry run: no files written\n')
      return
    }
    if (options.skills.length > 0) {
      const unknown = options.skills.filter(name => !SKILL_NAME.test(name))
      if (unknown.length > 0) throw new SkillsError(`invalid --skill name(s): ${unknown.join(', ')}`)
    }
    if (!options.yes && !(await confirm(`Install/update ${plan.adds.length + plan.updates.length} skill(s)?`))) {
      process.stdout.write('cancelled\n')
      return
    }
    const result = applyPlan({
      plan,
      skillsDir: options.skillsDir,
      stateDir: options.stateDir,
      source,
      manifest: readManifest(options.stateDir),
      only: options.skills.length > 0 ? options.skills : undefined,
    })
    if (options.json) process.stdout.write(`${JSON.stringify(result, undefined, 2)}\n`)
    else {
      if (result.installed.length > 0) process.stdout.write(`installed: ${result.installed.join(', ')}\n`)
      if (result.updated.length > 0) process.stdout.write(`updated:   ${result.updated.join(', ')}\n`)
      for (const item of result.skipped) process.stdout.write(`skipped:   ${item.name}: ${item.reason}\n`)
      for (const item of result.failed) process.stdout.write(`FAILED:    ${item.name}: ${item.error}\n`)
      if (result.backup !== undefined) process.stdout.write(`backup:    ${result.backup}\n`)
      if (result.failed.length === 0) process.stdout.write('done\n')
    }
    if (result.failed.length === 0) {
      const state = readTuiState(options)
      writeTuiState(options, { ...state, ignored: null, lastInstallAt: new Date().toISOString(), lastInstallRef: source.resolvedRef })
    }
    if (result.failed.length > 0) process.exitCode = 1
  } finally {
    source.cleanup()
  }
}

main().catch(fail)
