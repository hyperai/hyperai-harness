#!/usr/bin/env node
/**
 * `hyperai update`: check GitHub Releases, confirm, download both assets,
 * verify sha256, extract safely and run the new package's install.sh.
 *
 * No npm, no upstream repository, no automatic upgrade. Every failure leaves
 * the current installation and user data untouched.
 */
import { createHash } from 'node:crypto'
import { createWriteStream, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { get as httpGet } from 'node:http'
import { get as httpsGet } from 'node:https'
import { homedir, tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { createInterface } from 'node:readline'
import { spawnSync } from 'node:child_process'
import { compareVersions, fetchLatest } from './update-lib.mjs'

const HOME_DIR = process.env.HYPERAI_HOME || join(homedir(), '.hyperai')

/** Node range required by the bundled dsh (see install.sh). */
export function nodeSupported(version = process.versions.node) {
  const [major, minor] = version.split('.').map(Number)
  return (major === 22 && minor >= 19) || major >= 24
}

function currentVersion() {
  const launcher = join(HOME_DIR, '.hyperai-launcher.json')
  try { return JSON.parse(readFileSync(launcher, 'utf8')).productVersion } catch { /* fall through */ }
  try {
    const manifest = join(HOME_DIR, 'dsh', 'profiles', 'hyperai', 'package.json')
    return JSON.parse(readFileSync(manifest, 'utf8')).hyperaiTui?.version
  } catch {
    return undefined
  }
}

function download(url, destination, redirects = 0) {
  return new Promise((resolvePromise, reject) => {
    if (redirects > 5) return reject(new Error('下载重定向次数过多'))
    const client = url.startsWith('https:') ? httpsGet : httpGet
    const request = client(url, { headers: { 'user-agent': 'hyperai-harness' } }, response => {
      if ([301, 302, 303, 307, 308].includes(response.statusCode) && response.headers.location) {
        response.resume()
        return resolvePromise(download(new URL(response.headers.location, url).toString(), destination, redirects + 1))
      }
      if (response.statusCode !== 200) {
        response.resume()
        return reject(new Error(`下载失败：HTTP ${response.statusCode}`))
      }
      const expected = Number(response.headers['content-length'])
      let received = 0
      let finished = false
      response.on('data', chunk => { received += chunk.length })
      response.on('aborted', () => { if (!finished) reject(new Error('下载中断')) })
      response.on('error', error => { if (!finished) reject(error) })
      const file = createWriteStream(destination, { mode: 0o600 })
      response.pipe(file)
      file.on('finish', () => {
        finished = true
        file.close(() => {
          if (Number.isFinite(expected) && expected >= 0 && received !== expected) reject(new Error('下载不完整'))
          else resolvePromise()
        })
      })
      file.on('error', error => { if (!finished) reject(error) })
    })
    request.on('error', reject)
    request.setTimeout(60_000, () => request.destroy(new Error('下载超时')))
  })
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/** Reject path traversal and symlinks that escape the extraction root. */
function assertSafeArchive(archive, root) {
  const listing = spawnSync('tar', ['-tzf', archive], { encoding: 'utf8' })
  if (listing.status !== 0) throw new Error('安装包不是有效的 tar.gz')
  for (const entry of listing.stdout.split('\n').filter(Boolean)) {
    if (isAbsolute(entry) || entry.split('/').includes('..')) throw new Error(`安装包包含非法路径：${entry}`)
  }
  const extracted = spawnSync('tar', ['-xzf', archive, '-C', root, '--no-same-owner', '--no-same-permissions'], { encoding: 'utf8' })
  if (extracted.status !== 0) throw new Error('解压安装包失败')
  const realRoot = realpathSync(root)
  const walk = dir => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name)
      const stat = lstatSync(path)
      const real = realpathSync(path)
      if (real !== realRoot && !real.startsWith(realRoot + sep)) throw new Error(`安装包包含指向外部的链接：${relative(realRoot, path)}`)
      if (stat.isDirectory()) walk(path)
    }
  }
  walk(realRoot)
}

async function confirm(question) {
  if (!process.stdin.isTTY) throw new Error('当前不是交互终端；确认升级请加 --yes')
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const answer = await new Promise(resolvePromise => rl.question(question, resolvePromise))
  rl.close()
  return /^y(es)?$/iu.test(answer.trim())
}

/** Run the new package's own Node preflight before touching the install. */
export async function checkNewPackagePreflight(packageRoot) {
  const modulePath = join(packageRoot, 'profile', 'scripts', 'preflight.mjs')
  if (!existsSync(modulePath)) return
  const module = await import(pathToFileURL(modulePath).href)
  if (typeof module.nodeVersionSupported !== 'function') return
  if (!module.nodeVersionSupported(process.versions.node)) {
    throw new Error(`新版本要求 Node.js ${module.SUPPORTED_NODE_RANGE ?? '更高版本'}，当前是 v${process.versions.node}；请先升级 Node，旧版本没有改动`)
  }
}

async function main(argv) {
  const yes = argv.includes('--yes')
  const checkOnly = argv.includes('--check')
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('用法: hyperai update [--check] [--yes]')
    return 0
  }
  const current = currentVersion()
  if (current === undefined) throw new Error('无法确定当前 HyperAI 版本；请重新安装')
  if (!checkOnly && !nodeSupported()) {
    console.error(`升级失败：当前 Node.js v${process.versions.node} 不受支持（需要 ^22.19 或 >=24）。`)
    console.error('请先升级 Node.js，再运行 hyperai update；旧版本和用户数据没有改动。')
    return 1
  }
  const latest = await fetchLatest(process.env)
  if (compareVersions(latest.version, current) <= 0) {
    console.log(`已经是最新版本（${current}）`)
    return 0
  }
  console.log(`当前版本 ${current} → 最新版本 ${latest.version}`)
  if (checkOnly) return 0
  if (!yes && !(await confirm('确认升级？[y/N] '))) {
    console.log('已取消，未做任何修改。')
    return 1
  }
  const work = mkdtempSync(join(HOME_DIR, 'update-'))
  const archive = join(work, `hyperai-harness-${latest.version}.tar.gz`)
  const checksumFile = `${archive}.sha256`
  try {
    console.log('下载安装包…')
    await download(latest.tarball, archive)
    await download(latest.checksum, checksumFile)
    const expected = readFileSync(checksumFile, 'utf8').trim().split(/\s+/u)[0].toLowerCase()
    if (!/^[0-9a-f]{64}$/u.test(expected) || sha256(archive) !== expected) throw new Error('sha256 校验失败，已停止')
    console.log('sha256 校验通过，解压并安装…')
    const root = join(work, 'unpack')
    mkdirSync(root)
    assertSafeArchive(archive, root)
    const packageRoot = join(root, `hyperai-harness-${latest.version}`)
    const installer = join(packageRoot, 'install.sh')
    if (!existsSync(installer)) throw new Error('安装包里没有 install.sh')
    await checkNewPackagePreflight(packageRoot)
    const result = spawnSync('sh', [installer], { stdio: 'inherit', env: { ...process.env, HYPERAI_HOME: HOME_DIR } })
    if (result.status !== 0) throw new Error(`新版本安装失败（退出码 ${result.status}），旧版本仍可继续使用`)
    console.log(`已升级到 ${latest.version}`)
    return 0
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  main(process.argv.slice(2)).then(code => { process.exitCode = code }).catch(error => {
    console.error(`升级失败：${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
