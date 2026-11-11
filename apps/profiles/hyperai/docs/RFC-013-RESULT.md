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
