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
| 大小 | 18 470 883 字节 |
| sha256 | `ed42d7de5e5e618fdef77812054af15df4dec10b2db9ac7554c2d853a47145fe` |
| 构建 commit | `9f2524591fb82cf1cd81afa28fe53f1eb90a1614` |
| 构建 | 同 commit 两次构建一致 |

## 结论

代码主体已落地，但 RFC-013 的测试矩阵远未跑完（尤其 Ubuntu、A1 清单、U 系列和 A3～A9/M2～M5），现在不能按“已完成”交付。
