# RFC-002 结果报告

> 关联 RFC：[RFC-002：HyperAI Harness 内测安装包 v0.2.0-beta.1](https://github.com/lizhenhhh/jihua/blob/main/RFC-002-internal-beta.md)
> 工作分支：`feat/hyperai-internal-beta`（基线 `feat/hyperai-tui-profile` @ `529589f396`）

## 结论

**可以交给同事使用。** 一条命令构建出安装包，同事解压后运行 `./install.sh`，再用 `~/.hyperai/bin/hyperai` 启动；macOS（arm64）与 Ubuntu 20.04（x86_64）上 E1～E10 全部通过，安装过程不读取源码仓库、不访问 GitHub，TUI 成品包已完成改名与品牌化。

验收（RFC-002 验收报告）在 macOS 与 Ubuntu 上补测了 E11：两个平台都用真实模型完成了对话，并用 `ppt-generation` 生成了 3 页中文 `.pptx`，`python-pptx` 可读。开发侧当时没有 API key，这一项由验收覆盖。
E1 在 macOS 上用 shim 模拟 Node 18，真实 Node 18 的 E1 在 Ubuntu 上通过；Windows 不在范围内。

已知限制集中在“内测版”本身：默认关闭 Skills 自动更新、`/update` 禁用、固定 dsh `0.2.0-rc.2` 与上游 TUI `0.16.1`、`ppt-generation` 需要用户自行安装 `python-pptx`。

## 交付物

| 项 | 值 |
|---|---|
| 安装包 | `hyperai-harness-0.2.0-beta.1.tar.gz` |
| 大小 | 18 461 159 字节（修复轮 fix-1 重建；见文末） |
| sha256 | `a75065818a285e00c469ae7b9988854ca0a9c11a7bb3dd2ccc04fd41215394ae` |
| 构建命令 | `cd apps/profiles/hyperai && node scripts/build-beta.mjs` |
| 构建 commit | `aae051d8e1901e5608db37dd6b96d262e04dde53`（修复轮 fix-1） |
| TUI 成品包 | `@hyperai/hyperai-tui@0.2.0-beta.1`，sha256 `d93aac7ca19e9e4710b52b1c113bf593c2ebebbf060d91221a801e624213422ea9`，3296 个文件 |
| Skills 快照 | `hyperai-skills@34f0a1be0cb3ae9905aecebba13efae6a8657be1`（`feat/ppt-generation-upstream`，2 个 Skill，27 个文件） |
| 同事使用说明 | 安装包内 `README.md`，源文件 `apps/profiles/hyperai/docs/beta-install.md` |
| Draft PR | <https://github.com/hyperai/hyperai-harness/pull/2>（`feat/hyperai-internal-beta` → `master`，Draft，不合并） |

安装包与 `dist/` 构建产物**不入库**（`apps/profiles/hyperai/.gitignore`），Skills 内容、成品 tarball、上游原包都不在公开仓库里。

## 环境

| 项 | macOS | Ubuntu |
|---|---|---|
| OS | macOS 26.1（25B78），arm64 | Ubuntu 20.04.6 LTS，x86_64 |
| 系统 Node | v26.9.0 | v18.20.4（E1 用） |
| 测试用户 Node | 同系统 Node | v22.23.4（`$HOME/node`，E2 起） |
| npm | 11.19.1 | 随 Node 22.23.4 的 npm 10 |
| pnpm | 10.28.1（安装包运行时） | 10.28.1（安装包运行时） |
| dsh | `@deepseek-ai/dsh@0.2.0-rc.2`（安装包运行时） | 同左 |
| 隔离方式 | 全新临时 `HOME` + `DSH_HOME` | 普通用户 `<测试用户>`，独立 HOME |

## 设计说明

**安装位置**

| 内容 | 路径 | 理由 |
|---|---|---|
| 启动命令 | `~/.hyperai/bin/hyperai` | 一个稳定的入口；不写 shell rc，不改变用户环境 |
| dsh + pnpm | `~/.hyperai/runtime/` | 与同事已有的 dsh 完全隔离；版本固定为验证过的 `0.2.0-rc.2` / `10.28.1` |
| profile | `~/.dsh/profiles/hyperai/` | DSH 原生 profile 位置，`dsh --profile hyperai` 可识别 |
| 界面偏好 | `~/.dsh-tui-hyperai/` | 上游按 profile 名派生，已有机制，不改 |

**为什么隔离运行时**：RFC 要求“不能覆盖或升级同事已经安装的其他版本的 dsh”。`install.sh` 用 `npm install --prefix ~/.hyperai/runtime` 把 dsh/pnpm 装进私有目录，再把该目录的 `node_modules/.bin` 放到调用 `dsh plugin` 的 `PATH` 前面。E10 用假的“用户自己的 dsh”验证过：安装前后文件哈希不变，`PATH` 上的 dsh 仍是用户那份。

**为什么 pnpm 也一起装**：`dsh plugin` 依赖 `PATH` 上的 pnpm。同事机器上未必有，且版本会影响 lockfile 行为，所以和 dsh 一样固定在 `~/.hyperai/runtime`，不碰系统全局。

**为什么成品包用 `file:` 依赖**：安装器把 TUI tarball 复制到 `<profile>/packages/`，profile 的 `dependencies` 写 `file:packages/hyperai-tui-0.2.0-beta.1.tgz`。这样 profile 是自包含的：安装包目录之后可以删掉/移动，重装和 `doctor` 都不依赖它。TUI tarball 用二进制方式复制（`stageBinary`），不会经过 UTF-8 字符串。

**启动器**：`~/.hyperai/bin/hyperai` 是三个动作的组合——定位 `~/.hyperai`、设置 `DSH_HOME`（安装时用的是同一个值）、设置 `HYPERAI_SKILLS_TUI_AUTO=0`，然后 `exec dsh --profile hyperai`。默认关闭 Skills 自动检查是因为同事一般没有内部 Skills 仓库权限，自动检查只会产生无意义失败。

**复用而不是重写**：`install.sh` 只做 Node 检查、运行时安装和启动器生成，真正的 profile 安装仍然走 `install.mjs`，因此预检、阶段状态、受管文件备份、`cordis.patch.yml` 合并、`node_modules` 事务、拒绝覆盖外来 profile 这些行为全部保留。新增的只是 `scripts/distribution.mjs`：它让同一套脚本在“源码 checkout”和“安装包目录”（`HYPERAI_DIST_ROOT`）两种布局下解析 brand / TUI 版本 / Skills lock。

**卸载**：`manage.mjs uninstall --yes` 归档后清理受管文件，并按 `~/.hyperai/.hyperai-launcher.json` 记录删除启动命令；`--purge` 进入第二阶段。`~/.dsh/.credentials.yaml` 不会被任何卸载命令删除。

## 版本号处理清单

成品包 `version` 是 HyperAI 版本 `0.2.0-beta.1`，上游版本记在 `hyperai.upstreamVersion`（`0.16.1`）。上游每一处读取自身版本或比较包名的地方：

| 位置 | 用途 | 现在取哪个版本 | 理由 |
|---|---|---|---|
| `lib/types/update.js` → `installedTuiVersion()` | 版本铭牌的 `dsh-tui` 段、版本漂移警告、`/update` 目标、`plugin-install` 的 `ownVersion` | **上游**（`hyperai.upstreamVersion`，回退 `version`） | 函数语义是“已安装的 dsh-tui 包版本”，所有调用方都把它当上游 TUI 版本。RFC-001 验收里 P2 就是因为这个函数拿不到版本而丢铭牌；这里改成从 `hyperai.upstreamVersion` 读，铭牌显示 `dsh-tui v0.16.1` |
| `lib/types/components/LogoV2.js` 头部徽标 | 聊天页标题 `✦ hyperai-tui v…` | **HyperAI**（构建期把 `apps/tui/package.json` 的版本烘进补丁） | 产品身份，不随上游 |
| `lib/types/screens/Launchpad.js` 铭牌 | `hyperai-tui v… · dsh-tui v…` | 左 **HyperAI**（烘入），右 **上游**（`installedTuiVersion()`） | E4 的检查项；左右来源分离 |
| `lib/settings.json` → `packageVersion` | 设置清单声明的包版本 | **HyperAI**（`build-package.mjs` 结构化对齐） | 清单和包版本必须一致；在 dsh 安装里没找到读取它的运行时消费者，改动风险低，且有断言 |
| `tui-profile/feed/first-party.json` → `entries[].version` | 第一方插件 feed 声明的版本 | **HyperAI**（结构化对齐） | feed 描述的是我们的包；更新路径已禁用 |
| `bin/dsh-tui.js` → `ownVersion` / `PACKAGE` | 独立启动器把自己钉到某个版本（add / rescue profile） | 包自身 `version` = **HyperAI** | 启动器安装的就是这个包 |
| `lib/types/adapter/standard/descriptor.js` → `readOwnPackageVersion()` | 标准适配器握手的 `hostVersion` | 包自身 `version` = **HyperAI** | 这是“宿主 TUI 版本”，不是上游包版本 |
| `lib/types/update.js` 其余（全局启动器对齐、更新目标解析） | `/update` 流程 | 经 `installedTuiVersion()` 取 **上游** | `/update` 已被品牌补丁禁用，保持语义一致 |
| `presets/liangshen/.dsh-tui-managed.json` | preset 归属标记 | 只有 `owner` 改名，无版本字段 | 归属必须指向新包名 |
| `/update` 命令 | 用户可见入口 | 不读版本 | 已替换为 HyperAI 禁用提示（E6） |

`installedTuiVersion()` 的补丁是精确替换：

```js
const upstream = packageJson.hyperai?.upstreamVersion;
if (packageJson.name === PACKAGE_NAME && typeof upstream === 'string' && valid(upstream) !== null) return upstream;
if (packageJson.name === PACKAGE_NAME && typeof version === 'string' && valid(version) !== null) return version;
```

保留 `version` 回退，避免有人在没有 `hyperai` 字段的旧安装上启动时铭牌直接消失。

## 测试结果

| 检查 | macOS | Ubuntu | 证据 |
|---|---|---|---|
| E1 系统 Node 18 被拒绝、不写文件 | 通过（shim 模拟 Node 18；exit 1，`$HOME` 未创建） | 通过（真实系统 Node v18.20.4；exit 1，未创建目录） | `*/e1-node18.log` |
| E2 全新环境安装成功、不读源码仓库、不访问 GitHub | 通过 | 通过 | `*/install.log`；E8 的 `install-e8.log` 是在 checkout 被 `mv` 隐藏、`HTTPS_PROXY` 指向不可达地址（`NO_PROXY` 只放行 registry）时重装的 |
| E3 粉色像素字、无鲸鱼/logo | 通过 | 通过 | `*/pty/startup.screen.txt`、`brand-pixel-check.json`（整帧 `#FF6096` **40 176** 像素；顶部 36% 的 splash 区域 21 699 像素，且该区域除背景色外只有粉色） |
| E4 铭牌 `hyperai-tui v0.2.0-beta.1 · dsh-tui v0.16.1` | 通过 | 通过 | `*/pty/startup.screen.txt` |
| E5 `--dump-config` 有 `@hyperai/hyperai-tui` 与 `skill-filesystem`，无跳过 | 通过（611 行，stderr 0） | 通过（611 行，stderr 0） | `*/dump-config.txt`、`*.err` |
| E6 `/update` 禁用提示；`/provider`、`/model` 可打开 | 通过 | 通过 | `*/pty/update.screen.txt`、`provider`、`model` |
| E7 Skills 已安装、Agent 能发现、启动不自动检查 | 通过（`/skills` 列出 `ppt-generation`、`example-verified-skill`；启动画面无 Skills 提示） | 通过 | `*/pty/skills.screen.txt`、`ubuntu/session-files.txt` |
| E8 第二次安装成功且用户数据保留 | 通过（假 provider 行、`lang=en` 偏好、会话索引前后一致） | 通过（假 provider 行、`lang=en` 偏好、会话文件仍存在） | `*/install-e8.log`、`*/cordis.after.yml`、`*/settings.after.json`、`macos/session-index.*.json`、`ubuntu/session-files.txt` |
| E9 卸载清理受管文件、归档用户数据 | 通过（按说明直接执行，未设 `HYPERAI_DIST_ROOT`） | 通过（同左） | `*/uninstall.json` |
| E10 不影响已安装的其它 dsh | 通过（哈希不变） | 通过（哈希不变） | `*/install-e10.log` |
| E11 真实模型轮次 + 用 `ppt-generation` 生成 pptx | 通过（验收 agent 实测：3 页中文 PPT，44 751 B） | 通过（验收 agent 实测：3 页中文 PPT，42 700 B） | 验收报告第 98 行；开发侧无 key，未独立复测 |

补充说明：

- Ubuntu 的 E2 使用 `HYPERAI_NPM_REGISTRY=https://registry.npmmirror.com`：执行时官方源在该测试服务器上极慢（单个 tarball 90–150 秒，`npm install` 45 分钟无进展），换镜像后 2 分钟内完成。这是安装器支持的镜像路径（RFC 5.3.7），也是本次环境事实；macOS 仍用官方源。
- E2 的“不访问 GitHub”不是断网测试：dsh/pnpm 需要访问 npm registry，所以用 `HTTPS_PROXY`/`HTTP_PROXY` 指向 `127.0.0.1:9`，只把 `registry.npmjs.org` 放进 `NO_PROXY`。安装成功说明 GitHub 没有被访问。
- E8 的“会话数据保留”在 macOS 上是 `session-index.json` 前后条目一致（1 → 1，同一 session id）；Ubuntu 上证据是 `dsh-home/storages/session_projcache/sessions/` 里的会话文件仍在（`session-files.txt`）。
- E7 的“启动不自动检查”由启动器导出的 `HYPERAI_SKILLS_TUI_AUTO=0` 保证（该变量由 TUI 的 `hyperaiSkills.js` 读取），并实测启动画面没有 Skills 更新提示。
- 修复轮在 macOS 上复跑了“从旧版（补丁方式）覆盖升级”：旧 profile 用基线安装器创建，再加假 provider，用新安装包覆盖后 `patches/hyperai-tui.patch` 被删除、provider 保留、`bundles` 变成 `@deepseek-ai/dsh-base,@hyperai/hyperai-tui`（证据 `macos/upgrade-*.log`、`macos/upgrade-cordis.after.yml`）。
- 验收 agent 额外验证了“从旧版（补丁方式）覆盖升级”与“手动 `/skills-update` 的失败提示”（Ubuntu 上弹一次 `HyperAI skill check failed` 对话框，不刷屏）；本报告后续的修复轮也覆盖了升级清理。

## 可复现构建

| 项 | 结果 |
|---|---|
| 同一 commit 构建两次，安装包 sha256 相同 | 通过：两次都是 `a7506581…94ae`（修复轮 fix-1） |
| TUI 成品包两次构建 sha256 相同 | 通过：`d93aac7c…2ea9`（`build-beta.mjs` 内部构建两次并比对，不一致直接失败） |
| 输入按 size、sha256、integrity 校验 | 通过：`apps/tui/upstream.json` 固定 `18 473 587` 字节 / `2144b317…336e` / `sha512-xk8Nvi…hbg==`，不符即退出 |
| 豁免文件逐字节不变 | 通过：`LICENSE`、`README.md`、`guide/**`、所有非运行时代码文件与“打完补丁的树”逐字节相同；每个被改名文件里的 `Copyright` 行逐字节相同。`licenses/` 的 5 份是**本仓库 `apps/tui/docs/licenses/` 的副本**（上游原包里没有这个目录），与仓库副本逐字节相同 |
| 上游仓库/作者 URL 未被改写 | 通过：构建前后收集所有含 `ccch1mneyyy` 的 URL 集合，完全一致；`package.json` 的 `author` 字段保留上游署名 |
| 产物清单断言 | 通过：3296 个文件 = 上游 3287 个 + 9 个新增（`LICENSE-HYPERAI.txt`、`HYPERAI.md`、`licenses/` 5 份）。`vendor/` 的 114 个文件明确保留（RFC-001 曾因依赖 `npm pack` 而静默丢失） |

构建报告（`dist/build-report.json`）记录了上述所有哈希与断言结果。

安装包是在 commit `aae051d8e1`（修复轮 fix-1）上构建的。该 commit 之后的提交只增加证据和本报告（以及 PR 链接），不改变任何构建输入（`apps/tui/`、`apps/profiles/hyperai/scripts/`、`docs/beta-install.md`）；manifest 里的 `commit` 字段是构建时记录的，所以在本分支最新 tip 上重新构建会得到不同的哈希，这是预期行为。

## 验收反馈修复（RFC-002 验收报告）

验收结论是“修复后可以发”，列了 4 项必须修复。本分支已处理：

| 验收问题 | 处理 | 位置 |
|---|---|---|
| 公开仓库里有内部 Skills 的 description 原文 | 把 `skills.screen.txt` 第 30/32 行的描述替换成 `<描述已移除：内部仓库内容>`，只保留技能名；证据 README 记录了这一处理，并 `grep` 复查过 | `docs/evidence/rfc-002/{macos,ubuntu}/pty/skills.screen.txt` |
| 说明里的卸载命令跑不通（缺 `HYPERAI_DIST_ROOT`） | 让 `distribution.mjs` 从脚本自身位置推导安装包根目录（`<bundle>/profile/scripts/` → 上两级），文档不再需要环境变量；新增单元测试 | `scripts/distribution.mjs`、`tests/beta.test.mjs`、`docs/beta-install.md` §7 |
| 像素统计 21 699 与实测 40 176 不符 | 确实是口径问题：21 699 只统计了顶部 splash 区域。证据改成同时记录整帧 40 176 与 splash 区域 21 699，并写明区域与方法 | `docs/evidence/rfc-002/brand-pixel-check.json`、本报告 E3 行 |
| 说明缺排障 / `doctor` / 磁盘说明 | 第 8 节增加“排障”小节：`status`/`doctor --dsh-bin` 用法、常见报错对照表、磁盘占用；第 5 节补 `--user`/venv 装 `python-pptx`；第 6 节补“从旧版覆盖升级” | `docs/beta-install.md` |
| 升级后旧补丁残留 | 安装器在安装包模式下删除不再使用的 `<profile>/patches/hyperai-tui.patch`（空目录一并清理），并在计划里记录 `remove`；macOS 上用旧补丁方式装一遍再覆盖升级，实测 `patch=removed`、`legacy-provider=1`、bundle 变成新名 | `scripts/install.mjs`、`docs/evidence/rfc-002/macos/upgrade-*.log` |

## 已知问题与限制

1. **E11 的开发侧复测**：开发机没有 API key，这一项由验收 agent 在两平台实测通过（见测试结果表）；如果后续要 CI 化，需要单独的测试 key。
2. **macOS 的 E1 是模拟的**：用 PATH 上的 node shim 返回 `18.20.4`。真实 Node 18 的拒绝路径在 Ubuntu 上验证过；macOS 上只验证了“拒绝且不写入”的逻辑分支。
3. **首次安装要下载 dsh/pnpm**：约 541 个包，开发机上约 2 分钟。默认官方 npm 源，可用 `HYPERAI_NPM_REGISTRY` 切换镜像。
4. **profile 自带 18 MB tarball**：`<profile>/packages/hyperai-tui-0.2.0-beta.1.tgz` 会让 profile 目录变大；换来的是安装包目录可以删除、重装不依赖它。
5. **`manage.mjs repair` 在安装包模式下需要 `HYPERAI_DIST_ROOT`**：说明文档里让用户直接重跑 `install.sh`，而不是手动 repair。
6. **手动 `/skills-update` 的成功路径未测**：验收 agent 在 Ubuntu 上验证了失败提示（一次对话框，不刷屏），macOS 未单独跑；成功更新需要内部仓库权限，仍不在本次范围。
7. **版本对齐的范围**：`lib/settings.json` 的 `packageVersion` 与插件 feed 的 `version` 已改成 HyperAI 版本；`lib/settings.json` 的 `namespace: "dsh-tui"` 按 RFC/验收要求保持不变。
8. **平台**：只验证了 macOS arm64 与 Ubuntu 20.04 x86_64；其它 Linux 发行版、Windows、Node 22 之外的 22.x 小版本未测。
9. **没有代码签名**：安装包是 `.tar.gz`，macOS Gatekeeper 不会拦；但 `install.sh` 与启动器依赖可执行位，解压工具若丢掉权限需要 `chmod +x`。
10. **卸载会保留少量文件**：`skills/`、`.hyperai-skills`、`cordis.yml`、`pnpm-lock.yaml` 会留在 profile 目录（同时已归档），方便误卸载后手工恢复；`--purge` 才会删掉整个目录。说明文档第 7 节已写清。
11. **升级时 `cordis.patch.yml` 可能只差空行**：`install.mjs` 的合并逻辑会重新排版顶层块，语义不变。验收时观测到 Ubuntu 前后哈希不同、diff 仅空行，属于可接受行为。
12. **完成时间**：本报告完成于 2026-11-04 晚，早于 RFC 的周四 12:00 交付线；不需要触发进度风险汇报。

## 偏离 RFC 的地方

1. **构建产物目录**：使用 RFC 第 7 节允许的示例 `apps/profiles/hyperai/dist/`，而不是仓库根 `dist/`——根目录配置不允许改，`.gitignore` 放在子目录。
2. **安装包结构**比 RFC 第 3.1 节的最低要求多了 `profile/brand.json`、`profile/tui-meta.json`、`profile/skills.lock.json`：安装器需要在没有源码仓库的情况下知道 profile 名、版本和 Skills 锁定信息。少了这三份就无法做到“不读源码仓库”。
3. **启动器额外写 `~/.hyperai/.hyperai-launcher.json`**：RFC 只要求“新建的启动文件要能清理”，用这个记录文件精确定位，避免误删用户自己的同名脚本。
4. **没有修改仓库里的 `skills/hyperai-skills.lock.json`**（RFC 5.4.3 允许）：内测包的锁定信息写在安装包的 `profile/skills.lock.json` 里，仓库默认行为不变。
5. **E2 的“不访问 GitHub”用代理黑名单而不是断网**：dsh/pnpm 安装需要 npm registry，完全断网会误伤；用 `NO_PROXY` 只放行 registry 更精确。
6. **证据不提交 PNG**：截图里有本机绝对路径，无法逐像素脱敏；改为提交同等内容的屏幕文本，并单独记录品牌像素统计。
7. **P2 / P3 未实现**：RFC 只要求 P1，按 RFC 执行。
8. **PR 的 base 分支**：RFC 写的是 `feat/hyperai-internal-beta` → `main`，但这个仓库没有 `main` 分支，默认分支是 `master`。Draft PR #2 因此开到 `master`；分支内容与 RFC 要求一致。
9. **证据里的 Skills 描述已打码**：`/skills` 屏幕文本原本带内部仓库的 description 原文，提交前替换成 `<描述已移除：内部仓库内容>`；技能名保留。

## 修复轮 fix-1（RFC-002-fix-1 第二部分）

本轮只改文档，没有改代码（`install.sh` 的默认 registry 仍是官方源）。

### 改了什么

- **安装步骤**（`beta-install.md` §2）：拆成「获取安装包 → 校验并解压 → 安装」，安装给出两种方式：
  - 方式 A（默认）：`./install.sh`，用 npm 官方源；
  - 方式 B（国内/官方源慢）：`HYPERAI_NPM_REGISTRY=https://registry.npmmirror.com ./install.sh`。
  写明怎么选、`install.sh` 默认**不会**自动切换、首次要下载约 500 MB / 500 多个包、正常几分钟、慢时十几分钟甚至更久，卡住可换镜像重跑（脚本幂等）。排障表里的镜像写法与安装步骤保持一致。
- **待定项**（`beta-install.md` §2.1、§9）：下载步骤改为「从分发人处获取安装包和 `.sha256` 文件」；反馈改为「内测期间请直接联系分发安装包给你的同事。」；文档里不再有 `<待负责人填写>` 之类的占位符。

### 新安装包

| 项 | 值 |
|---|---|
| 文件 | `hyperai-harness-0.2.0-beta.1.tar.gz` |
| 大小 | 18 461 159 字节 |
| sha256 | `a75065818a285e00c469ae7b9988854ca0a9c11a7bb3dd2ccc04fd41215394ae` |
| 构建 commit | `aae051d8e1901e5608db37dd6b96d262e04dde53` |
| TUI 成品包 | sha256 `d93aac7ca19e9e4710b52b1c113bf593c2ebebbf060d91221a801e624213422ea9`，3296 个文件 |
| 构建 | `cd apps/profiles/hyperai && node scripts/build-beta.mjs`，同 commit 构建两次 sha256 一致 |

包内 `README.md` 与仓库 `apps/profiles/hyperai/docs/beta-install.md` 的 sha256 相同（`4699f3c64bfcda3e0282857315b20c592b88988d2b451792ba7cad7a5bfaa73f`）。

### 自检结果（本轮）

| 检查 | 结果 |
|---|---|
| 两次构建 sha256 一致 | 通过：两次都是 `a7506581…94ae` |
| 包内 README 与仓库说明一致 | 通过：两边都是 `4699f3c6…73f` |
| `apps/tui` verify / tests | 14/14、20/20 |
| `apps/profiles/hyperai` verify / tests | 12/12、72/72 |
| macOS 全新临时 HOME 安装并启动 | 通过：安装 exit 0、profile 与 Skills 生成、启动画面铭牌 `hyperai-tui v0.2.0-beta.1 · dsh-tui v0.16.1`、`--dump-config` 611 行 / stderr 0 字节 |
| 服务器上安装包 | 已覆盖 `/home/<测试用户>/hyperai-harness-0.2.0-beta.1.tar.gz`，大小 18 461 159 字节，`sha256sum -c` 通过 |

两个平台的完整回归按 RFC 由验收 agent 执行，本轮没有重跑。

### 本轮发现、但按约束没有改代码的问题

**在符号链接路径下解压时，`install.sh` 会「假安装成功」。**

- 复现：把安装包解压到 `/tmp/...`（macOS 的 `/tmp` 是符号链接），运行 `./install.sh` → exit 0、打印「安装完成」、生成启动器，但 `<DSH_HOME>/profiles/hyperai` 没有生成；启动器指向不存在的 profile。换成 `/private/tmp/...`（真实路径）后安装正常。
- 根因：`install.mjs` 等脚本用 `process.argv[1] === fileURLToPath(import.meta.url)` 判断「是不是被直接执行」。Node 会把入口的 `import.meta.url` 解析成真实路径（`/private/tmp/...`），而 `process.argv[1]` 保留传入的逻辑路径（`/tmp/...`），两者不相等，`main()` 不执行、进程以 0 退出。
- 影响：解压到 `/tmp`、`/var`（macOS 上也是符号链接）或任何符号链接目录的用户会遇到「安装完成但没有 profile」。解压到普通目录（如 `~/Downloads`、`/private/tmp/...`）不受影响；本轮快速验证因此改用真实路径完成。
- 建议修法（需要单独修复轮，本轮按 RFC「不要改代码」未实施）：`install.sh` 用 `cd -P` 解析 `HERE`，或把入口判断改成比较 `realpath`；同样的 guard 也存在于 `manage.mjs` / `build-package.mjs`，一并处理更稳妥。
