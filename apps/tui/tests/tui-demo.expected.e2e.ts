import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { spawn as spawnPty } from 'node-pty'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { startMockLlmServer, type MockLlmServer } from '@deepseek-ai/dsh-llm-mock-server'

/**
 * Owner-local keyless demo: drives the full TUI interaction (streaming reply,
 * tool card, approval modal, clean exit) against the mock provider through a
 * scripted PTY. Patterns must be single words — the differential renderer
 * never emits space bytes between painted words.
 */

const root = resolve(import.meta.dirname, '../../..')
const patch = join(root, 'apps/tui/config/examples/mock-llm.patch.yml')

let mock: MockLlmServer
let home: string

beforeAll(async () => {
  home = mkdtempSync(join(tmpdir(), 'hyperai-e2e-home-'))
  mock = await startMockLlmServer({
    port: 0,
    apiKey: 'mock-key',
    sequence: ['reasoning_success', 'success', 'tool_call_success', 'success'],
    toolName: 'bash',
    toolArguments: '{"description":"demo escalation command","command":"echo tui-demo-ok","sandbox_permissions":"danger-full-access","justification":"demo of the TUI approval flow"}',
  })
})

afterAll(async () => {
  await mock.close()
  rmSync(home, { recursive: true, force: true })
})

/** Driven TUI process under a scripted PTY. */
interface Driver {
  /** Everything the session has painted so far. */
  output(): string
  /** Write keystrokes into the session. */
  send(keys: string): void
  /** Resolve once `marker` appears in the painted output. */
  waitFor(marker: string, timeoutMs: number): Promise<void>
  /** Resolves with the exit code once the process leaves. */
  readonly exited: Promise<number | null>
}

/**
 * Launch the TUI inside a real PTY (node-pty), forwarding writes as keystrokes.
 * @param args - CLI arguments after the node interpreter.
 * @param env - extra environment for the child.
 * @returns the driver handle.
 */
function launch(args: string[], env: Record<string, string>): Driver {
  const inherited = Object.fromEntries(
    Object.entries(process.env).filter((entry): entry is [string, string] => entry[1] !== undefined),
  )
  const pty = spawnPty('node', args, {
    name: 'xterm-256color',
    cols: 100,
    rows: 30,
    cwd: root,
    env: { ...inherited, TERM: 'xterm-256color', ...env },
  })
  let buffer = ''
  pty.onData((data) => { buffer += data })
  const exited = new Promise<number | null>((settle) => {
    pty.onExit(({ exitCode }) => { settle(exitCode) })
  })
  return {
    output: () => buffer,
    send: (keys: string) => { pty.write(keys) },
    async waitFor(marker: string, timeoutMs: number) {
      const deadline = Date.now() + timeoutMs
      while (!buffer.includes(marker)) {
        if (Date.now() > deadline) {
          throw new Error(`marker ${JSON.stringify(marker)} not seen in ${String(timeoutMs)}ms; tail: ${JSON.stringify(buffer.slice(-400))}`)
        }
        await new Promise((r) => { setTimeout(r, 50) })
      }
    },
    exited,
  }
}

describe('TUI keyless demo (mock provider)', () => {
  it('streams a reply, answers an approval, and exits cleanly', async () => {
    const driver = launch(
      ['--import', 'tsx/esm', 'apps/cli/src/bin.ts', '--profile', 'tui', '--patch', patch],
      {
        DSH_HOME: home,
        DEEPSEEK_BASE_URL: `${mock.baseURL}/v1`,
        DEEPSEEK_API_KEY: 'mock-key',
      },
    )
    await driver.waitFor('Type', 60_000)

    // Turn 1: the reasoning stream settles into a think summary line.
    driver.send('hello demo\r')
    await driver.waitFor('think', 60_000)

    // Turn 2: an escalating bash call opens the approval modal.
    driver.send('list the files\r')
    await driver.waitFor('Approve', 60_000)
    driver.send('a')
    await driver.waitFor('done', 60_000)
    await driver.waitFor('description', 10_000)

    // Quit while idle (double Ctrl+C).
    await new Promise((r) => { setTimeout(r, 1000) })
    driver.send('\x03\x03')
    const code = await Promise.race([
      driver.exited,
      new Promise<'timeout'>((r) => { setTimeout(() => { r('timeout') }, 20_000) }),
    ])
    expect(code, `exit did not happen; tail: ${JSON.stringify(driver.output().slice(-400))}`).not.toBe('timeout')
  }, 180_000)
})
