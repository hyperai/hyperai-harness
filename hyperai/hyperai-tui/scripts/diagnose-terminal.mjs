#!/usr/bin/env node
/**
 * HyperAI TUI terminal diagnostics.
 *
 * Prints what the runtime would decide for the splash logo on this terminal:
 * environment, real protocol probes (Kitty Graphics / Sixel / OSC 11 / cell
 * size), the selected display path (HD PNG vs ANSI sprite), the light/dark
 * variant, and the reason when ANSI fallback is used.
 *
 * The probes are real terminal round-trips on /dev/tty, not `$TERM` guesses:
 * every query is followed by a short bounded wait, so an unresponsive terminal
 * or multiplexer never blocks the command. No sensitive environment variable is
 * read or printed.
 *
 * Usage:
 *   node scripts/diagnose-terminal.mjs            # human-readable
 *   node scripts/diagnose-terminal.mjs --json     # machine-readable
 */
import { readFileSync } from 'node:fs'
import process from 'node:process'

const QUERY_TIMEOUT_MS = 400
const env = process.env
const picked = [
  'TERM',
  'TERM_PROGRAM',
  'TERM_PROGRAM_VERSION',
  'COLORTERM',
  'KITTY_WINDOW_ID',
  'TMUX',
  'STY',
  'SSH_TTY',
  'SSH_CONNECTION',
  'LC_TERMINAL',
  'LC_TERMINAL_VERSION',
  'WEZTERM_EXECUTABLE',
  'VTE_VERSION',
  'WT_SESSION',
  'VSCODE_IPC_HOOK_CLI',
  'DSH_TUI_THEME',
  'DSH_TUI_IMAGE_PROTOCOL',
  'DSH_TUI_DISABLE_TERMINAL_IMAGES',
  'DSH_TUI_ACCESSIBILITY',
  'NO_COLOR',
  'FORCE_COLOR',
]

const wait = ms => new Promise(resolve => setTimeout(resolve, ms))
const truthy = value => value === '1' || value === 'true' || value === 'yes'

/**
 * Send one escape sequence to /dev/tty and collect the terminal's reply for a
 * bounded window. Returns `undefined` when stdin is not a TTY or the terminal
 * stays silent.
 * @param {number} fd - open /dev/tty fd.
 * @param {Buffer} bytes - query bytes.
 * @param {number} timeoutMs - bounded reply window.
 * @returns {Promise<Buffer|undefined>} Raw reply bytes.
 */
async function query(fd, bytes, timeoutMs = QUERY_TIMEOUT_MS) {
  const chunks = []
  const onData = chunk => chunks.push(Buffer.from(chunk))
  process.stdin.on('data', onData)
  try {
    const { writeSync } = await import('node:fs')
    writeSync(fd, bytes)
    const deadline = Date.now() + timeoutMs
    while (Date.now() < deadline && chunks.length === 0) await wait(10)
    return chunks.length === 0 ? undefined : Buffer.concat(chunks)
  } finally {
    process.stdin.off('data', onData)
  }
}

/** Extract DA1 parameters (the sixel flag lives at attributes[1]... protocol order). */
function da1Params(reply) {
  if (reply === undefined) return undefined
  const match = /\x1b\[[?>]?([0-9;]*)c/u.exec(reply.toString('latin1'))
  return match === null ? undefined : match[1].split(';').map(Number).filter(n => Number.isFinite(n))
}

/** Parse an OSC color reply (`rgb:rrrr/gggg/bbbb`) into `[r,g,b]`. */
function parseOscColor(reply, code) {
  if (reply === undefined) return undefined
  const text = reply.toString('latin1')
  const match = new RegExp(`\\x1b\\]${code};rgb:([0-9a-fA-F]{2,4})/([0-9a-fA-F]{2,4})/([0-9a-fA-F]{2,4})`, 'u').exec(text)
  if (match === null) return undefined
  const channel = hex => Math.round((parseInt(hex, 16) / (hex.length === 2 ? 255 : 65535)) * 255)
  return [channel(match[1]), channel(match[2]), channel(match[3])]
}

function luma([r, g, b]) {
  return 0.299 * r + 0.587 * g + 0.114 * b
}

async function main() {
  const json = process.argv.includes('--json')
  const result = {
    tty: {
      stdin: process.stdin.isTTY === true,
      stdout: process.stdout.isTTY === true,
      columns: process.stdout.columns,
      rows: process.stdout.rows,
    },
    env: Object.fromEntries(picked.map(key => [key, env[key]])),
    probes: {},
    decision: {},
  }

  let fd
  try {
    if (process.stdin.isTTY === true) {
      const { openSync } = await import('node:fs')
      fd = openSync('/dev/tty', 'r+')
      process.stdin.setRawMode?.(true)
      process.stdin.resume()
      await wait(30)
      result.probes.da1 = da1Params(await query(fd, Buffer.from('\x1b[c', 'latin1')))
      const kitty = await query(fd, Buffer.from('\x1b_Gi=31,s=1,v=1,a=q,t=d,f=32;AAAAAA==\x1b\\', 'latin1'))
      result.probes.kitty = kitty === undefined ? undefined : kitty.toString('latin1').includes('OK')
      const xtversion = await query(fd, Buffer.from('\x1b[>0q', 'latin1'))
      result.probes.xtversion = xtversion?.toString('latin1').replace(/\x1b[P\\\]|[\x1b]/gu, '').replace(/[^\x20-\x7e]/gu, '') ?? undefined
      const cell = await query(fd, Buffer.from('\x1b[16t', 'latin1'))
      result.probes.cell = cell?.toString('latin1') ?? undefined
      const windowPx = await query(fd, Buffer.from('\x1b[14t', 'latin1'))
      result.probes.window = windowPx?.toString('latin1') ?? undefined
      const background = await query(fd, Buffer.from('\x1b]11;?\x07', 'latin1'))
      result.probes.background = parseOscColor(background, 11) ?? undefined
      const foreground = await query(fd, Buffer.from('\x1b]10;?\x07', 'latin1'))
      result.probes.foreground = parseOscColor(foreground, 10) ?? undefined
    }
  } catch (error) {
    result.probes.error = String(error)
  } finally {
    try {
      process.stdin.setRawMode?.(false)
    } catch {
      /* not a TTY */
    }
    if (fd !== undefined) {
      const { closeSync } = await import('node:fs')
      try {
        closeSync(fd)
      } catch {
        /* best effort */
      }
    }
  }

  // Replicate the renderer's selection: an explicit override wins; otherwise
  // Kitty (reply starts with OK) then Sixel (DA1 advertises parameter 4).
  const override = env.DSH_TUI_IMAGE_PROTOCOL
  const da1 = result.probes.da1
  const protocol =
    override === 'none' || override === 'kitty' || override === 'sixel'
      ? override
      : result.probes.kitty === true
        ? 'kitty'
        : da1 !== undefined && da1.slice(1).includes(4)
          ? 'sixel'
          : 'none'

  const multiplexer = env.TMUX !== undefined ? 'tmux' : env.STY !== undefined ? 'screen' : 'none'
  const background = result.probes.background
  const light = background !== undefined ? luma(background) > 140 : undefined
  const imageBlockedBy = []
  if (!result.tty.stdin) imageBlockedBy.push('stdin is not a TTY')
  if (env.DSH_TUI_DISABLE_TERMINAL_IMAGES !== undefined && truthy(env.DSH_TUI_DISABLE_TERMINAL_IMAGES)) imageBlockedBy.push('DSH_TUI_DISABLE_TERMINAL_IMAGES is set')
  if (env.DSH_TUI_IMAGE_PROTOCOL === 'none') imageBlockedBy.push('DSH_TUI_IMAGE_PROTOCOL=none')
  if (multiplexer !== 'none') imageBlockedBy.push(`${multiplexer} disables the image probe (upstream policy)`)
  if (env.DSH_TUI_ACCESSIBILITY !== undefined && truthy(env.DSH_TUI_ACCESSIBILITY)) imageBlockedBy.push('DSH_TUI_ACCESSIBILITY is set')

  const imagesAvailable = imageBlockedBy.length === 0 && protocol !== 'none'
  result.decision = {
    multiplexer,
    protocol,
    imagesAvailable,
    variant: light === undefined ? 'unknown' : light ? 'light' : 'dark',
    lightBackground: light,
    path: imagesAvailable ? `HD PNG (${protocol}, ${light === false ? 'dark' : 'light'} variant)` : `ANSI sprite (${light === true ? 'light' : 'dark'} variant)`,
    fallbackReasons: imageBlockedBy.length > 0 ? imageBlockedBy : protocol === 'none' ? ['no Kitty Graphics / Sixel response'] : [],
    // Honest limitation: Kitty/Sixel placements have no end-to-end display ack.
    verification: imagesAvailable
      ? 'the renderer has no end-to-end image display acknowledgement; a terminal that falsely advertises graphics could still show a blank slot, so the sprite fallback stays the safest default when images are not needed'
      : 'ANSI fallback is the first frame and requires no capability confirmation',
  }

  if (json) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`)
    return
  }
  const lines = []
  lines.push('HyperAI TUI terminal diagnostics')
  lines.push(`  terminal: TERM=${env.TERM ?? '-'} TERM_PROGRAM=${env.TERM_PROGRAM ?? '-'} ${env.TERM_PROGRAM_VERSION ?? ''}`)
  lines.push(`  TTY: stdin=${result.tty.stdin} stdout=${result.tty.stdout} size=${result.tty.columns ?? '?'}x${result.tty.rows ?? '?'}`)
  lines.push(`  XTVERSION probe: ${result.probes.xtversion ?? 'no reply'}`)
  lines.push(`  DA1 probe: ${da1 === undefined ? 'no reply' : JSON.stringify(da1)}`)
  lines.push(`  Kitty Graphics probe: ${result.probes.kitty === undefined ? 'no reply' : result.probes.kitty ? 'OK' : 'not supported'}`)
  lines.push(`  cell-size probe: ${result.probes.cell ? 'reply' : 'no reply (renderer default cell 8x16)'}`)
  lines.push(`  background: ${background === undefined ? 'no reply (theme falls back to dark)' : `rgb(${background.join(',')}) => ${light ? 'light' : 'dark'}`}`)
  lines.push(`  multiplexer: ${multiplexer}`)
  lines.push(`  selected protocol: ${protocol}`)
  lines.push(`  logo path: ${result.decision.path}`)
  if (result.decision.fallbackReasons.length > 0) lines.push(`  fallback reason: ${result.decision.fallbackReasons.join('; ')}`)
  lines.push(`  image limitation: ${result.decision.verification}`)
  process.stdout.write(`${lines.join('\n')}\n`)
}

main().catch(error => {
  process.stderr.write(`diagnose-terminal failed: ${error?.stack ?? error}\n`)
  process.exitCode = 1
})
