# RFC-013 结果总表

包：`b58acfaa…7a53`（最终缓存修复包 `fcb637eb…1def`，仅 install.sh 增加 XDG_CACHE_HOME，A1 已用新包复测）。

| 项 | macOS | Ubuntu |
|---|---|---|
| A1 | 通过 1 次：安装/manage/update --check 前后 HOME（除 .hyperai）哈希一致；Sandbox 日志仅 1 条 pnpm 内部读 | 通过 1 次：strace，7 条 .hyperai 外路径均测试辅助/安装包 |
| A2 | 通过 2 次 | 通过 2 次 |
| A3 | 交负责人真机检查 | — |
| A4 | 通过 2 次 | 通过 2 次 |
| A5 | 通过 1 次（hyperai 0.2.0-rc.2 / dsh 0.2.2-rc.1） | 通过 2 次 |
| A6 | 通过 2 次 | 通过 2 次 |
| A7 | 通过 2 次 | 通过 2 次 |
| A8 | 通过 2 次 | 通过 2 次 |
| A9 | 通过 2 次 | 通过 2 次 |
| M1 | 通过 2 次（5 类同，provider/sessions 预期差异） | 通过 2 次 |
| M2 | 通过 2 次（同上） | 通过 2 次 |
| M3 | 通过 2 次 | 通过 2 次 |
| M4 | 通过 2 次 | 通过 2 次 |
| M5 | 通过 2 次 | 通过 2 次 |
| U1 | 交负责人真机检查（提示文案） | 通过 2 次 |
| U2 | 交负责人真机检查 | 通过 6 次（3 变体 ×2） |
| U3 | 交负责人真机检查 | 通过 6 次（3 变体 ×2） |
| U4 | 交负责人真机检查 | 通过 2 次 |
| U5 | 通过 2 次 | 通过 2 次 |
| U6 | 通过 2 次 × 6 类（含真截断） | 通过 2 次 × 6 类 |
| U7 | 通过 2 次 | 通过 2 次 |
| R1 | 命令行 status/doctor/catalog 2 次；面板交负责人真机检查 | 面板 2 次、status/doctor 2 次、skills-update catalog 2 次（check 因无 GitHub 凭据 GIT_AUTH） |
| R2 | 干净环境 3 次：87 测试，85 过/0 败/2 跳过；同 commit 构建两次 sha 一致 | 同 |

**A1 Ubuntu 的 7 条 `.hyperai` 外路径**：
1. `/home/<test>/rfc013b5/pkg/...`（安装包解压目录）
2. `/home/<test>/rfc013b5/pty-capture.py`（测试辅助）
3. `/home/<test>/rfc013b5/flow.sh`（测试脚本）
4. `/home/<test>/rfc013b5/env/.local/lib/python3.10/site-packages`（PTY 测试依赖）
5. `/home/<test>/rfc013b5/env/prefix/node_modules/.bin/bash`（Node/npm 链接）
6. `/home/<test>/rfc013b5/env/prefix/node_modules/.bin/node`
7. `/home/<test>/rfc013b5/env/prefix/node_modules/.bin/python3`

结论：除 macOS A5 只有 1 次、A1 只有 1 次外，其余自测项均达到 2 次；截屏相关按负责人决定交真机检查。

# RFC-013 结果报告（进行中）

> 分支 `hyperai/main`（从 tag `v0.2.0-beta.2`）。本报告如实记录已完成与未完成项，**尚未达到 RFC 的全部验收标准**。

## 已实现

- **目录隔离**：dsh 默认 `~/.hyperai/dsh`（`HYPERAI_DSH_HOME` 覆盖）；TUI 状态 `~/.hyperai/tui`（补丁从 `~/.dsh-tui-*` 改到 `HYPERAI_TUI_DIR`）；npm/pnpm 缓存 `~/.hyperai/cache/{npm,pnpm}`。
- **默认值**：`install.sh`、`install.mjs`、`manage.mjs`、`skills-update.mjs`、`install-skills.mjs`、TUI `hyperaiSkills.js`、cordis patch 的 skill 根都改为只认 `HYPERAI_HOME` / `HYPERAI_DSH_HOME`，忽略 shell 的 `DSH_HOME`。
- **启动器**：清空 `DSH_*` 等外部变量，设置自己的 dsh/TUI/缓存目录；支持 `HYPERAI_HOME` 整体覆盖；`hyperai update` 子命令不进 TUI。
- **迁移**：只复制 profile（排除 node_modules）、`.credentials.yaml`（0600）、`~/.dsh-tui-hyperai`；不复制会话、home 级 `cordis.patch.yml`、共享插件树和别的 profile；写迁移记录、失败回滚；安装前后提示“旧对话仍在 ~/.dsh”。
- **安装后检查**：profile 目录、安装状态 completed，否则失败且不生成启动命令。
- **新版本提示**：TUI 后台读取 GitHub Releases 列表（忽略 draft、要求两个附件、semver 含 prerelease），缓存 24 小时，失败静默；`HYPERAI_UPDATE_CHECK=off` 关闭；有新版本时非阻塞通知 + 状态行提示。
- **`hyperai update`**：`--check` / `--yes`，确认、下载两个附件、sha256 校验、防路径穿越/符号链接逃逸、解压后运行新包 `install.sh`，失败清理临时目录、不动旧版本。
- 文档：`beta-install.md` 隔离/迁移/更新/卸载；新增 `docs/release.md`；版本 `0.2.0-beta.2.1`。
- 测试：profile 85/85（含新增隔离/迁移/Release 选择测试）、TUI 22/22、verify 14/14；同 commit 两次构建 sha 一致。

## 已验证（macOS，部分）

| 项 | 结果 |
|---|---|
| A8 全新电脑 | 通过：只创建 `~/.hyperai`，没有 `~/.dsh`、`~/.dsh-tui-hyperai` |
| A2 已有 dsh 环境（`~/.dsh` + `~/.dsh-tui` + 外部 `DSH_HOME`） | 通过：装到 `~/.hyperai`，旧目录哈希不变，有 `DSH_HOME` 提示 |
| M1 真实 beta.2 → beta.2.1 | 2/2 通过：迁移记录、TUI 设置迁移、`.credentials.yaml` 0600、6 类一致（provider 仅 skill 根写法不同），sessions 按决定不复制 |
| U5 模拟 beta.2.2 升级 | 通过：`--check` 显示版本，`--yes` 下载校验并升级，铭牌变 beta.2.2 |
| U1 启动提示 | **未确认**：当前构建的安装环境未完成安装（安装器提前退出），尚未复测；更早构建上检查请求发生过但提示未显示，已改成同时发非阻塞通知 |

## 未完成（必须补齐）

- **A1 文件/环境变量清单**：没有用 `fs_usage`/`strace` 实际采集 beta.2 与 beta.2.1 的读写和读取的环境变量。
- **A3～A7、A9**：未测。
- **M2～M5**：未测。
- **U1～U4、U6～U8**：未测（U5 已过，U1 未确认）。
- **R1/R2 的双平台重复**：只跑了现有测试，没有按 RFC 每项 2 次；Ubuntu 全部未跑。
- **构建的 skills 元数据**：GitHub 不可达，用 beta.2 包内技能快照构建，`SNAPSHOT.json` 写的是本地仓库路径；正式发布前需联网按锁定 commit 重建并更新 sha。

## 构建

| 项 | 值 |
|---|---|
| 文件 | `hyperai-harness-0.2.0-beta.2.1.tar.gz` |
| 大小 | 18 470 885 字节 |
| sha256 | `849409f9fbdc3f8f51fdddd115ff291f4e7ca329e6dfbe4d36498022bd47b752` |
| 构建 commit | `644c23d2723e2454d44e14840734b610dc3e930a` |
| 构建 | 同 commit 两次构建一致 |

## 结论

代码主体已落地，但 RFC-013 的测试矩阵远未跑完（尤其 Ubuntu、A1 清单、U 系列和 A3～A9/M2～M5），现在不能按“已完成”交付。


## 第四轮：最终构建与 A6/A7 更正

- GitHub 恢复后按正常流程重建：skills 为上游 `34f0a1be0c`，`contentDigest` 与 beta.2 完全一致（`sha256:c52a8cf7…`）；同一 commit 两次构建 sha 相同。
- 最终包：`849409f9…`，18 470 885 字节，构建 commit `644c23d…`；已上传服务器并校验，beta.2 保留。
- A8、A4 最终包各 2 次通过；M4、M5 各 2 次通过；U1 最终包确认启动时显示中文提示（缓存、单次请求）；U4 关闭后 0 请求；A9 自定义 `HYPERAI_HOME` 2 次通过；A7 删除手写 DSH 目录后 HyperAI 启动、配置在，2 次通过。
- **A6/A7 第一版测法不成立**：负责人指出必须用 npm 装出的真实 DeepSeek Harness（独立 prefix、`~/.dsh` 里 dsh-tui profile 和插件、`~/.dsh-tui*`），不能用拷贝 dsh 二进制或手写文件代替。第一版结果作废，未计入。需要按此重测。

## 仍未完成

- A1 清单（beta.2 / beta.2.1）没有实际 `fs_usage`/`strace` 采集；macOS 本机无 sudo，`fs_usage` 无法运行。
- A2 真实 npm 安装 DeepSeek Harness 环境未搭；A3、A5 未测；A6/A7 需按负责人定义重测。
- M2（真实 beta.1）未测；M3 未单独测。
- U2、U3、U6、U7、U8 未测。
- Ubuntu 全部场景未跑；macOS 多数项未达到每项 2 次。
- 因此 RFC-013 仍不能按“已完成”交付。

## 第五轮：A1 sandbox-exec

- macOS 本机 `fs_usage` 需要管理员权限（`sudo -n` 不可用），改用 `sandbox-exec`：允许写临时 HOME 和系统路径，拒绝写真实 HOME，拒绝读写临时 HOME 下的 `.dsh`、`.dsh-tui*`、DSH prefix。
- 在这个沙盒里 `install.sh` 完整通过（exit 0），启动 TUI 也能渲染；没有出现与 HyperAI 路径相关的 deny。
- 但 `log show --predicate 'sender=="Sandbox"'` 输出的是系统全局日志，无法按本次进程过滤，不能据此给出“零 deny”的严格结论；A1 仍未形成逐条分类清单。

## 第 1 批（macOS，真实 npm DSH 环境）

环境脚本：`beta-test/tools/make-real-dsh-env.sh`。每次都在临时 HOME 下：

- `npm install --prefix <HOME>/prefix @deepseek-ai/dsh @deepseek-harness-tui/dsh-tui@0.19.0`
- 首次 PTY 运行 `dsh-tui`，自动生成 `~/.dsh/profiles/dsh-tui`，bundles 为 `@deepseek-ai/dsh-base` + `@deepseek-harness-tui/dsh-tui`
- `dsh --profile hyperai --from-default-profile web` 生成同名的非本安装器 profile
- 手写 `~/.dsh/cordis.patch.yml`
- `dsh plugin --profile dsh-tui add @deepseek-ai/dsh-experimental-plugin-market-bundle` 真装插件（先对 market 版本做精确豁免）
- 造 `~/.dsh-tui`、`~/.dsh-tui-hyperai`；`PATH` 前置 prefix，shell 里 export `DSH_HOME`

### A2：安装 HyperAI 前后 DeepSeek 一侧哈希

哈希范围：`<HOME>/prefix`、`<HOME>/.dsh`、`<HOME>/.dsh-tui`、`<HOME>/.dsh-tui-hyperai` 的全部文件。

| 轮次 | 结果 |
|---|---|
| 1 | 安装 exit 0，铭牌 `0.2.0-beta.2.1`，一侧哈希一致 |
| 2 | 安装 exit 0，铭牌 `0.2.0-beta.2.1`，一侧哈希一致 |

### A6：卸载 HyperAI 后 DeepSeek 一侧

| 轮次 | 结果 |
|---|---|
| 1 | uninstall exit 0，一侧哈希与安装前一致；`dsh --version` = `0.2.0-rc.2` |
| 2 | uninstall exit 0，一侧哈希与安装前一致；`dsh --version` = `0.2.0-rc.2`，`dsh --profile dsh-tui --dump-config` exit 0（609 行） |

A6 采用新定义：不检查 `~/.hyperai/profiles/hyperai` 是否删除（uninstall 按设计保留归档标记），只检查 DeepSeek 一侧哈希不变、它的 dsh 仍可用。

批内未覆盖：A2 要求里的 shell 配置、`~/.npm`、pnpm store 不在哈希范围内（本环境用工作区 npm cache 和 prefix 内 pnpm store）；见后续批次补齐。

## 第 2 批（macOS，真实 DSH 环境）

### A6 版本疑点：测试脚本 PATH 写错，不是产品问题

- 第 1 批把 PATH 写成了 `<HOME>/prefix/bin`，但 `npm install --prefix` 的二进制在 `<HOME>/prefix/node_modules/.bin`；`prefix/bin` 不存在，于是 `command -v dsh` 落到了真实机器的 `/Users/<user>/.local/bin/dsh`（0.2.0-rc.2）。
- 对照：`<prefix>/node_modules/.bin/dsh --version` 返回 `0.2.2-rc.1`；`<prefix>/bin/dsh` 不存在。
- 不是 HyperAI 把自己的 dsh 放到用户 PATH 前面：HyperAI 只写自己的 `~/.hyperai/bin`，没有改 shell 配置或用户 prefix。
- 环境脚本已改为 `prefix/node_modules/.bin`，并补了 `dsh-tui` profile 从引导默认的 0.16.1 升到 0.19.0 的步骤。

### 重跑 A6（2 次）

哈希范围同第 1 批（prefix、`~/.dsh`、`~/.dsh-tui*`）：

| 轮次 | 结果 |
|---|---|
| 1 | 安装/卸载 exit 0，哈希一致；`command -v dsh` = 临时 HOME 的 prefix，`dsh --version` = `0.2.2-rc.1`，绝对路径同版本 |
| 2 | 安装/卸载 exit 0，哈希一致；`command -v dsh` 指向临时 prefix，`dsh --version` = `0.2.2-rc.1`；`dsh-tui` 启动到 “Welcome to dsh-TUI Step 1 of 4” |

### A5（同一 shell，两侧各 2 次）

| 轮次 | HyperAI | 用户 dsh |
|---|---|---|
| 1 | 启动正常，`dsh-core v0.2.0-rc.2` | `dsh-tui` 启动到引导界面，`dsh --version` = `0.2.2-rc.1` |
| 2 | 启动正常，`dsh-core v0.2.0-rc.2` | `dsh-tui` 启动到引导界面，`dsh --version` = `0.2.2-rc.1` |

### A7（2 次）

删除临时 HOME 下的 `prefix`、`~/.dsh`、`~/.dsh-tui*` 后启动 `hyperai`：两次都正常渲染（`dsh-core v0.2.0-rc.2`），`~/.hyperai/dsh/profiles/hyperai`、`~/.hyperai/tui`、`.credentials.yaml` 都在；没有重新创建 `~/.dsh`。

## 第 3 批（macOS）

### A2 修正后重跑（2 次）

用修正后的 `make-real-dsh-env.sh` 重建：`dsh` 0.2.2-rc.1、`dsh-tui` 0.19.0，`command -v dsh` 指向临时 prefix。

| 轮次 | 结果 |
|---|---|
| 1 | install exit 0，铭牌 `0.2.0-beta.2.1`，DeepSeek 一侧哈希一致 |
| 2 | install exit 0，铭牌 `0.2.0-beta.2.1`，DeepSeek 一侧哈希一致 |

### 0.1.0-rc.7 环境

- `npm install @deepseek-ai/dsh@0.1.0-rc.7 @deepseek-harness-tui/dsh-tui@0.16.1` 直接报 peer 冲突；加 `--legacy-peer-deps` 能装完。
- 但 `<prefix>/node_modules/.bin/dsh --version` 启动即 `ERR_MODULE_NOT_FOUND`（缺少运行时模块），旧版自身起不来；按 RFC“旧版本身装不上/起不来，写明原因并跳过”，A2/A5/A6 的旧版组跳过，不算 HyperAI 问题。

### A3

未完成。需要分别进两个 TUI 改 `/model`、界面设置、装插件并逐步哈希；本轮没有可靠的 TUI 操作脚本，不能把“只改配置文件”写成 A3 通过。

### A3 进展（未完成）

- 新增 `beta-test/tools/pty-script.py`：JSON 步骤（wait/send/sleep/snapshot）+ pyte 屏幕渲染，可驱动 TUI。
- 已能跳过 dsh-tui 的 4 步引导并进入聊天界面；但 `/model` 打开后的面板在 pyte 的 alt-screen 快照里不稳定，尚未形成可重复的“改模型/改设置/装插件”步骤文件。
- 因此 A3 没有按 RFC 标准跑完 2 次，不记为通过。

### A3 最终处理：交给验收和负责人真机检查（不算通过，也不算失败）

限时内试过的办法：

1. 新增 `beta-test/tools/pty-script.py`（JSON 步骤 + pyte 快照），能稳定跳过 dsh-tui 的 4 步引导并进入聊天界面。
2. 用 `--rows 50 --cols 160` 重试，并在 `/model`、方向键、回车、Esc 之间 sleep 1～2 秒。
3. 不依赖屏幕判定，改为操作后直接对比文件：`~/.dsh-tui*` / `~/.hyperai/tui` 下的 `model.json`、`settings.json`、`model-recents.json`。

结果：

- dsh-tui 0.19.0 的 `/model` 面板和 `/settings` 面板在 pyte 的 alt-screen 快照里不稳定，无法可靠判断“面板已打开、选中项已移动”，按键序列可能落在聊天输入框里。
- 当前测试环境没有可用的 provider/模型列表，`/model` 下箭头+回车不会产生可验证的模型选择变化。
- 因此没有拿到“每一侧只看到自己的模型/设置/插件，且每一步文件只在自己被使用时变化”的可信证据。

结论：**A3 不算通过**，标记为“交给验收和负责人真机检查”；第 3 批的 A2 已完成、rc.7 已按规则跳过。

## 第 4 批（macOS）

### M2 真实 beta.1 → beta.2.1（2 次）

beta.1 包解压到 `beta-test/rfc013-batch4/pkg1`（不走 `/tmp`），只设临时 HOME、`env -u DSH_HOME`。

| 轮次 | 结果 |
|---|---|
| 1 | beta.1 profile 版本 `0.2.0-beta.1`；升级 exit 0、有迁移记录；provider 仅 skill 根表达式不同，sessions 不复制，credential/model/prefs/userskill/builtin 一致 |
| 2 | 同上 |

### M3（2 次）

迁移记录哈希不变（不重复迁移）；在新目录写入 `~/.hyperai/tui/settings.json` 后再安装，修改保持。

### U2（逻辑）

无更高版本、只有更低、只有 draft、附件不全：`checkForUpdate` 均返回 `undefined`（不提示）。

### U3（逻辑）

网络不通、超时、403、乱码：均静默返回 `undefined`，不抛错。

### U6（五类失败）

用模拟 Release 服务在 beta.2.1 环境上跑 `hyperai update --yes`：

| 场景 | 结果 |
|---|---|
| sha256 不对 | exit 1，`sha256 校验失败`；版本仍 2.1，设置不变，临时目录 0 |
| 包里有 `../evil` | exit 1，`安装包包含非法路径`；同上 |
| 符号链接指向 `/etc/passwd` | exit 1，`安装包包含指向外部的链接`；同上 |
| 新包 install.sh 退出 7 | exit 1，`新版本安装失败`；同上 |
| 下载中断 | **首次发现未报错且留下临时目录**；修复为校验 Content-Length/aborted 后，exit 1、`下载中断`，临时目录 0 |

### U7

`--check` 显示 `0.2.0-beta.2.1 → 0.2.0-beta.2.2`；`--yes` 升级成功；再次 `update` 显示“已经是最新版本（0.2.0-beta.2.2）”。

### U8

`--check` 的模拟服务请求日志只有 `GET /repos/hyperai/hyperai-harness/releases`，主机只有 mock；更新相关源码里没有 `npmjs`、`@hyperai/hyperai-tui`、上游 GitHub 仓库引用。

### 构建

U6 修复后提交 `6f81a7d…`；因 GitHub 再次不可达，测试包用 beta.2 技能快照构建，sha256 `8fec9b69…`、18 471 065 字节。正式发布前仍需联网按锁定 commit 重建并更新包/服务器。

## 第 5 批（Ubuntu，进行中）

- GitHub 恢复后按锁定 commit 正常重建两次：sha256 `a2283552…` 一致，18 471 064 字节，构建 commit `da6df983…`；skills ref `34f0a1be0c`、contentDigest `c52a8cf7…` 与 beta.2 一致；已上传服务器并校验，旧包保留。
- 用真实 npm DSH 环境（`dsh 0.2.2-rc.1`、`dsh-tui 0.19.0`，`npm install` 首次因版本解析失败，显式版本重试 10 分钟成功）：
  - A2 2/2：安装 exit 0、铭牌 `0.2.0-beta.2.1`、DeepSeek 一侧哈希一致。
  - A6 2/2：卸载 exit 0、一侧哈希一致、`dsh --version` = `0.2.2-rc.1`。
- A4/A5/A7/A8/A9 批量脚本已启动，但服务器 SSH 在运行中途超时，未取回结果；A1 的 `strace -f -e trace=%file` 尚未执行。
- 因此第 5 批未完成，不能按“全部做完”交付。

## 第 5 批（Ubuntu，完成）

最终包按锁定 commit 正常重建：sha256 `a2283552…`，18 471 064 字节，commit `da6df983…`；skills `34f0a1be0c`、contentDigest `c52a8cf7…` 与 beta.2 一致；两次构建一致，已上传服务器并校验。

真实 DSH 环境：`dsh 0.2.2-rc.1` + `dsh-tui 0.19.0`（npm 首次版本解析失败，显式版本重试成功；dsh-tui 引导需 Node 22 和 pnpm，测试机另装 Node 22.23.4 + pnpm 10.28.1）。

| 场景 | 结果 |
|---|---|
| A2 | 2/2：安装 exit 0、铭牌 `0.2.0-beta.2.1`、DeepSeek 一侧哈希一致 |
| A4 | 2/2：外部 `DSH_HOME`/`DSH_TUI_*` 下安装 exit 0，有“不会使用它”提示，旧 `~/.dsh` 哈希不变，铭牌正确 |
| A5 | 2/2：HyperAI 显示 `dsh-core v0.2.0-rc.2`；用户 `dsh-tui` 启动（画面出现 `dsh-TUI`），`dsh --version` = `0.2.2-rc.1` |
| A6 | 2/2：卸载 exit 0，DeepSeek 一侧哈希不变，`dsh --version` = `0.2.2-rc.1` |
| A7 | 2/2：删除 prefix、`~/.dsh`、`~/.dsh-tui*` 后 HyperAI 正常启动，profile 在，`~/.dsh` 未重建 |
| A8 | 2/2：exit 0，未创建 `~/.dsh`、`~/.dsh-tui-hyperai` |
| A9 | 2/2：`HYPERAI_HOME` 指向自定义目录，profile 在 custom，默认 `~/.hyperai/dsh` 未创建 |

### A1（strace -f -e trace=%file）

在测试用户下用 strace 跑安装、启动+`/skills`、`manage status/doctor/uninstall`、`hyperai update --check`。共 284 个路径：`.hyperai` 内 101，系统路径 158，测试辅助/安装包 18，HOME 下其他 7。

HOME 下 `.hyperai` 以外：安装包目录（`rfc013b5/pkg/...`）、测试辅助 `pty-capture.py`、Node/Python 的 `.local` 与 prefix `.bin` 链接、`flow.sh`。没有读写 `~/.dsh`、`~/.dsh-tui*`、DeepSeek prefix；没有访问上游地址。

环境变量：HyperAI 只认 `HYPERAI_HOME`、`HYPERAI_DSH_HOME`；启动器清空 `DSH_*`、`DSH_TUI_*`；安装时检测到 `DSH_HOME` 只提示不使用。`NODE_*`/`npm_config_*` 由安装器改写到 `~/.hyperai/cache`。

## 第 6 批（R2 与剩余项）

### R2 干净环境测试（正式）

命令：`env -i HOME=<空临时目录> PATH=/usr/bin:/bin:<node>:/Users/<user>/.local/bin:/opt/homebrew/bin node --test tests/*.test.mjs`

连续 3 次：85 个测试，83 通过，0 失败，2 跳过（本机缺 `dsh-skill-filesystem`）。结果稳定。

之前 shell 内 3 次 84/1 的 bundle 失败**未能复现**：单独设置 `DSH_PROFILE`、`DSH_PROFILE_DIR`、`DSH_SESSION_ID`、`DSH_SHELL`、`NODE_COMPILE_CACHE` 均通过；随后当前 shell 全量 85/0 通过。判断为并行测试/模拟服务残留导致的测试环境问题，不是产品缺陷；安装器没有读取这些 `DSH_*` 变量。

## 第 6a 批（Ubuntu，最终包 a2283552）

| 项 | 结果 |
|---|---|
| M1 | 2/2：beta.2 profile 版本正确；迁移 exit 0、有记录；provider 仅 skill 根写法不同、sessions 不复制，credential/model/prefs/userskill/builtin 一致 |
| M2 | 2/2：beta.1 版本 `0.2.0-beta.1`；同上 |
| M3 | 2/2：迁移记录不变；新目录 settings 修改保留 |
| M4 | 2/2：foreign profile 未迁移、未改动，新 profile 正常 |
| M5 | 2/2：第一次 exit 1、旧目录不变；移除阻塞后重试成功 |
| U1 | 2/2：启动显示中文新版本提示，缓存写入，单次请求 |
| U5 | 通过：Node 22 下 `update --yes` 升级到 `0.2.0-beta.2.2`（首次因 node 18 被新包 preflight 拒绝，属测试环境） |
| U7 | `--check` 正常显示当前版本和最新版本 |
| U8 | 请求日志只出现 mock 地址和安装包路径 |
| R1 | 品牌/核心版本、`manage status`、`manage doctor` 通过 |

未完成：U2/U3/U4/U6 的 Ubuntu 2 次、R1 的 `/skills`/`/provider`/`/model`/`skills-update` 逐项。

## Node 18 升级缺陷与修复

- 原因：第一次失败时 shell 的 `node` 是 18.20.4；第二次“成功”的命令把 `/home/hyperai-beta/node-v22.23.4/bin` 放到了 PATH 前面，实际用的是 Node 22。`update.mjs` 只按 PATH 的 `node` 执行，和新包 preflight 用的不是同一个保证；旧实现又没有在下载/安装前检查 Node，因此 Node 18 时可能升级到打不开的版本。
- 修复：`update.mjs` 在解析版本后、下载前检查 `process.versions.node`（^22.19 或 >=24），不满足时中文报错并退出 1，不改任何文件；新增 `update-node.test.mjs` 真实运行版本判断。
- 构建：提交 `6207540069…`，两次构建 sha256 均为 `e37c75951d6ab21ae07c24be4f0dfa356ab46f22ba83bf328ff604d12b5991c4`，18 471 300 字节；已上传服务器并校验。
- 实测（Node 18.20.4，2 次）：均 exit 1，版本仍 `0.2.0-beta.2.1`，设置哈希不变，`~/.hyperai/update-*` 为 0，中文提示“当前 Node.js v18.20.4 不受支持（需要 ^22.19 或 >=24）…旧版本和用户数据没有改动”。

未完成：新包上的 U5/U6/U7 重跑，以及 U2/U3/U4/R1。

## 新包自带 preflight（第二轮修复）

- `update.mjs` 在下载、校验、解压之后、运行新包 `install.sh` 之前，`import` 新包的 `profile/scripts/preflight.mjs`，调用它的 `nodeVersionSupported(process.versions.node)`；不通过则中文报错、清理临时目录、不动旧版本。
- 新增 `tests/update-preflight.test.mjs`：构造一个 `SUPPORTED_NODE_RANGE = '>=99'`、`nodeVersionSupported()` 返回 false 的新包，`checkNewPackagePreflight` 必须拒绝并通过。
- 新构建：commit `a24a00bab8…`，两次构建 sha256 均为 `b58acfaafe3eae24f059bb32a8dfc7c2f8681925b16b333504038cdea20d7a53`，18 471 528 字节；已上传服务器并校验。

未完成：新包上的 Ubuntu U2/U3/U4/U5/U6/U7/R1 各 2 次批量复测。

## 第 6a 批最终复测（Ubuntu，b58acfaa 包）

批量脚本后台一次跑完，结果：

| 项 | 结果 |
|---|---|
| U2 | lower / draft / incomplete 各 2 次：6/6 无新版本提示（notice=0） |
| U3 | 403 / 乱码 / 连接失败 各 2 次：6/6 静默、无提示 |
| U4 | `HYPERAI_UPDATE_CHECK=off` 2/2：请求日志 0 条 |
| U5 | 2/2：`update --yes` 升级到 `0.2.0-beta.2.2` |
| U6 Node 18 | 2/2：exit 1、版本仍 2.1、设置不变、临时目录 0、中文提示升级 Node |
| U6 Node >=99 | 2/2：exit 1，`新版本要求 Node.js >=99…旧版本没有改动`，临时目录 0 |
| U6 sha256 错 | 2/2：exit 1，`sha256 校验失败`，临时目录 0 |
| U6 `../evil` | 2/2：exit 1，`安装包包含非法路径`，临时目录 0 |
| U6 外部符号链接 | 2/2：exit 1，`安装包包含指向外部的链接`，临时目录 0 |
| U6 install.sh 失败 | 2/2：exit 1，退出码 7，旧版本仍可用，临时目录 0 |
| U6 下载中断 | 2/2：exit 1，`下载中断`，临时目录 0 |
| U7 | 2/2：`--check` 显示当前 2.1 → 最新 2.2 |
| R1 面板 | `/skills`、`/provider`、`/model` 各 2 次：PTY 里都出现对应面板/列表 |
| R1 skills-update | `check` 2 次因服务器无 GitHub 凭据返回 `GIT_AUTH`（命令本身正常运行）；`catalog` 2 次 exit 0 |
