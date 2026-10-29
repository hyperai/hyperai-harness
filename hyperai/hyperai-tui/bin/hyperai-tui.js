#!/usr/bin/env node
/**
 * `hyperai-tui` launcher: boots the HyperAI profile through the installed dsh
 * CLI. `dsh --profile hyperai` is the supported entry point; this shim exists so
 * the profile has a stable, discoverable command name of its own.
 */
import { spawn } from 'node:child_process'

const dshBin = process.env.HYPERAI_DSH_BIN ?? 'dsh'
const profile = process.env.HYPERAI_PROFILE ?? 'hyperai'
const child = spawn(dshBin, ['--profile', profile, ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: process.env,
})

child.on('error', error => {
  if (error.code === 'ENOENT') {
    process.stderr.write(
      `hyperai-tui: ${JSON.stringify(dshBin)} was not found on PATH.\n` +
        'Install the harness first (npm install -g @deepseek-ai/dsh) or point HYPERAI_DSH_BIN at it.\n',
    )
    process.exit(127)
  }
  process.stderr.write(`hyperai-tui: failed to launch dsh: ${error.message}\n`)
  process.exit(1)
})

child.on('exit', (code, signal) => {
  if (signal !== null) {
    process.kill(process.pid, signal)
    return
  }
  process.exit(code ?? 1)
})
