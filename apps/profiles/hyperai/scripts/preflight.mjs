/**
 * Environment and compatibility preflight for the HyperAI profile installer.
 *
 * The checks run before the installer writes a managed profile or invokes
 * pnpm. A failure is actionable and intentionally has no "accept risk" switch:
 * a cold install must not create a half-working profile on an unsupported
 * DSH Core / Node / pnpm combination.
 */
import { spawnSync } from 'node:child_process'

/** Supported Node.js lines from apps/tui/package.json engines. */
export const SUPPORTED_NODE_RANGE = '^22.19 || >=24'

/** A user-facing preflight error. */
export class PreflightError extends Error {
  /** @param {string} message actionable detail. @param {string} [code] stable code. */
  constructor(message, code = 'preflight-failed') {
    super(message)
    this.name = 'PreflightError'
    this.code = code
  }
}

/** @param {string} version Node version string. @returns {{major: number, minor: number, patch: number}|undefined} */
export function parseNodeVersion(version) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)/u.exec(String(version ?? ''))
  return match === null ? undefined : { major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]) }
}

/** Whether a Node version satisfies apps/tui's supported range. */
export function nodeVersionSupported(version) {
  const parsed = parseNodeVersion(version)
  if (parsed === undefined) return false
  if (parsed.major === 22) return parsed.minor >= 19
  return parsed.major >= 24
}

/** Extract a version token from `dsh --version` output. */
export function parseCliVersion(output) {
  const match = /(?:^|\s)(v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?)(?:\s|$)/u.exec(String(output ?? ''))
  return match?.[1]?.replace(/^v/u, '')
}

/** @param {string} version detected core version. @param {string[]} supported validated versions. */
export function coreVersionSupported(version, supported) {
  return supported.includes(version)
}

function runVersion(command, args, options) {
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    timeout: options.timeoutMs ?? 15_000,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  if (result.error !== undefined) {
    const detail = result.error.code === 'ENOENT'
      ? `${command} was not found on PATH`
      : result.error.message
    throw new PreflightError(`cannot run ${command} ${args.join(' ')}: ${detail}`, 'missing-runtime')
  }
  if (result.status !== 0) {
    const detail = String(result.stderr ?? '').trim() || String(result.stdout ?? '').trim() || `exit ${result.status}`
    throw new PreflightError(`${command} ${args.join(' ')} failed: ${detail}`, 'runtime-version-failed')
  }
  return String(result.stdout ?? '').trim()
}

/**
 * Probe the three runtime facts the installer needs.
 * @param {{dshBin: string, pnpmBin?: string, timeoutMs?: number}} options
 * @returns {{nodeVersion: string, dshVersion: string, pnpmVersion: string}}
 */
export function inspectEnvironment(options) {
  const nodeVersion = process.versions.node
  if (!nodeVersionSupported(nodeVersion)) {
    throw new PreflightError(
      `unsupported Node.js ${nodeVersion}; HyperAI TUI requires ${SUPPORTED_NODE_RANGE}. Install Node 24 LTS (or a supported 22.19+), then re-run the installer.`,
      'unsupported-node',
    )
  }
  const dshBin = options.dshBin ?? 'dsh'
  const dshVersion = parseCliVersion(runVersion(dshBin, ['--version'], options))
  if (dshVersion === undefined) {
    throw new PreflightError(`cannot parse DSH Core version from \`${dshBin} --version\``, 'unreadable-dsh-version')
  }
  const pnpmBin = options.pnpmBin ?? 'pnpm'
  const pnpmVersion = runVersion(pnpmBin, ['--version'], options)
  return { nodeVersion, dshVersion, pnpmVersion }
}

/**
 * Validate a fully probed environment against the pinned compatibility list.
 * @param {{nodeVersion?: string, dshVersion: string, pnpmVersion?: string, coreVersions: string[], testedCoreVersions?: string[]}} facts
 */
export function validateEnvironment(facts) {
  if (facts.nodeVersion !== undefined && !nodeVersionSupported(facts.nodeVersion)) {
    throw new PreflightError(`unsupported Node.js ${facts.nodeVersion}; requires ${SUPPORTED_NODE_RANGE}`, 'unsupported-node')
  }
  if (!coreVersionSupported(facts.dshVersion, facts.coreVersions)) {
    const tested = facts.testedCoreVersions?.length ? ` Tested primary line: ${facts.testedCoreVersions.join(', ')}.` : ''
    throw new PreflightError(
      `DSH Core ${facts.dshVersion} is outside the HyperAI TUI validated set.${tested} ` +
        `Validated: ${facts.coreVersions.join(', ')}. ` +
        'Install a matching DSH release or update the HyperAI TUI patch before installing; this installer does not bypass Core version checks.',
      'unsupported-core',
    )
  }
  return facts
}

/**
 * Run all preflight checks.
 * @param {{dshBin: string, pnpmBin?: string, coreVersions: string[], testedCoreVersions?: string[], timeoutMs?: number}} options
 */
export function preflight(options) {
  const facts = inspectEnvironment(options)
  return validateEnvironment({ ...facts, coreVersions: options.coreVersions, testedCoreVersions: options.testedCoreVersions })
}
