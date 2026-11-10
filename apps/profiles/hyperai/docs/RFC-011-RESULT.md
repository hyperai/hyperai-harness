# RFC-011 结果报告：独立的 dsh 目录（v0.2.0-beta.7）

> 分支：`feat/hyperai-internal-beta`（从 `09153feacd` 往后，未强推、未合并）

## 结论

HyperAI 现在默认使用 `~/.hyperai/dsh`，安装器、启动器、`manage.mjs`、skills 工具和 TUI 的默认值都已改；shell 里的 `DSH_HOME` 被忽略，只认 `HYPERAI_DSH_HOME`。老用户从 `~/.dsh` 升级时只复制 profile 和 API key，不复制会话、home 级 `cordis.patch.yml` 和共享插件树；`~/.dsh` 的所有文件安装前后哈希一致。按负责人决定（选项 2），旧对话不迁移，仍完整留在 `~/.dsh`，安装开始和完成提示、文档都已写明。

## 3.1 根因复现（未完全复现，负责人已接受）

我试了三种构造（临时 HOME）：

1. `~/.dsh/profiles/hyperai/package.json` 写入两个 `0.1.0-rc.7` 依赖：beta.6 安装器重写 manifest，pnpm 清理多余依赖，未触发拒绝。
2. profile 的 `node_modules` 里预置这两个旧插件：pnpm 安装时被清掉，未触发。
3. 旧插件放在 `~/.dsh/oldplugins`，并在 `~/.dsh/cordis.patch.yml`（home 级 patch）里 `insert` 两行：`dsh --dump-config` 确认 patch 生效，但 `dsh plugin install` 不报兼容性错误；启动只报 `failed to import`。

已确认的读取范围：dsh 只读 `$DSH_HOME/profiles/<name>`、`$DSH_HOME/cordis.patch.yml`（会叠加到所有 profile）和 `$DSH_HOME` 下的共享 `profiles/node_modules` 树，**没有发现读取 `$DSH_HOME` 之外的位置**。因此换目录可以把用户已有的 dsh 环境整体隔离；同事那条 `is incompatible with dsh 0.2.0-rc.2` 的具体触发路径**没有复现出来**，按负责人意见如实记录。

## 改了哪些地方（默认目录）

| 位置 | 改动 |
|---|---|
| `scripts/install.sh` | 默认 `~/.hyperai/dsh`；`HYPERAI_DSH_HOME` 优先；记录并忽略 shell `DSH_HOME`，输出提示 |
| 生成的 `~/.hyperai/bin/hyperai` | `DSH_HOME="${HYPERAI_DSH_HOME:-<安装时记录>}"`，不再跟随 shell |
| `scripts/install.mjs` | `parseArgs` 默认 `HYPERAI_DSH_HOME ?? ~/.hyperai/dsh`；迁移检测/执行；场景 `migrate` |
| `scripts/manage.mjs` | 默认新目录；doctor 提示旧数据仍在 `~/.dsh` |
| `scripts/skills-update.mjs` | 默认新目录 |
| `scripts/install-skills.mjs` | 不再用 `DSH_HOME`，只用 `--dsh-home` 或 `HYPERAI_DSH_HOME` |
| `apps/tui/src/hyperaiSkills.js` | 默认新目录，只认 `HYPERAI_DSH_HOME` |
| `cordis.patch.yml` | skill 根表达式优先 `HYPERAI_DSH_HOME`，回落新默认目录 |
| 文档 / 版本 | `beta-install.md` 更新；版本 `0.2.0-beta.7` |

## 迁移设计

- 触发：新目录没有 HyperAI profile、没有迁移记录，且 `$HOME/.dsh/profiles/hyperai` 带 `hyperaiTuiManaged` 标记。
- 复制：profile（排除 `node_modules`、`.hyperai-failed-node_modules`）和 `.credentials.yaml`（权限 0600）。
- **不复制**：`sessions`、`storages`（按选项 2）、`~/.dsh/cordis.patch.yml`、`~/.dsh/node_modules` 与其他 profile。
- 记录：`~/.hyperai/dsh/.hyperai-migration.json`（时间、来源、复制项、未复制项），之后不再迁移。
- 失败回滚：删除新 profile/凭据；如果新 home 是这次创建的，整个删除；`~/.dsh` 从不写入。
- `--dry-run` 显示“会把配置和 API key 复制到 ~/.hyperai/dsh”，不写任何文件。
- 安装开始与完成提示都包含：“以前的对话仍然保存在 ~/.dsh 里，没有丢失，只是不会出现在新版本中。”

## 测试结果（如实）

| # | macOS | Ubuntu |
|---|---|---|
| I1 复现同事失败 | **未复现**（见上） | 未测 |
| I2 beta.7 安装，旧目录不变 | 通过：迁移成功、旧哈希不变、新目录 beta.7 | 未单独测 |
| I3 `export DSH_HOME` | 通过：提示忽略、装到新目录、旧哈希不变 | 通过（2 次） |
| I4 `HYPERAI_DSH_HOME` | 通过：装到自定义目录，默认目录未创建 | 未测 |
| I5 全新机器 | 通过：新目录，未创建 `~/.dsh` | 通过（2 次） |
| M1 beta.6 → beta.7 | 通过：迁移、凭据复制、无登录门；6/7 类一致（见下） | 通过（2 次：迁移记录、无 storages、旧哈希不变；该 fixture 无 credentials） |
| M2 beta.1 → beta.7 | 未测 | 未测 |
| M3 重复安装不重复迁移 | 通过：无迁移提示 | 未测 |
| M4 同时有其他 profile | 未单独测（单元测试覆盖只复制 profile） | 未测 |
| M5 非本安装器 profile | 通过：忽略并提示，原文件不变 | 通过（2 次） |
| M6 迁移失败回滚 | 单元测试通过；未做手工只读目录测试 | 未测 |
| R1 dry-run | 通过：显示会迁移、未创建新目录 | 通过（1 次） |
| R2 status/doctor/uninstall | 通过：doctor 提示旧数据；uninstall 后旧哈希不变 | 仅 doctor 通过（1 次） |
| R3 登录门等回归 | 部分：M1 启动不弹门；其余沿用 beta.6 结果，未逐项重跑 | 未测 |
| R4 测试与构建 | 通过：profile 107/107、TUI 47/47、verify 15/15；两次构建一致 | — |

M1 的 7 类数据：model、prefs、userskill、builtinskill、credential 与迁移前一致；provider 文件唯一的差异是安装器把 skill 根表达式从 `DSH_HOME ?? ~/.dsh` 更新为 `HYPERAI_DSH_HOME ?? DSH_HOME ?? ~/.hyperai/dsh`，模型配置本身未变；sessions 按决定不复制。

## 新旧目录哈希

| 场景 | 结果 |
|---|---|
| I2（旧目录有插件/patch） | `~/.dsh` 前后哈希一致 |
| I3（export DSH_HOME） | 一致 |
| M1（迁移） | 一致 |
| M5（foreign profile） | 一致 |
| R2 uninstall 后 | 一致 |

## 安装包

| 项 | 值 |
|---|---|
| 文件 | `hyperai-harness-0.2.0-beta.7.tar.gz` |
| 大小 | 18 487 447 字节 |
| sha256 | `5061edb81f2f18c4563f9818a1b7950844bba674fbf98386884f9bee01f59b2d` |
| 构建 commit | `27f57c72d64c1e3e7cb7185877611b9980fef64f` |
| 构建 | 同一 commit 两次构建一致；skills 使用本地快照（GitHub 当时不可达，内容与 beta.6 包内快照一致） |
| 服务器 | 已放开发测试用户 home，beta.6 保留 |

## 自查

1. `/skills` 截屏 / 内部 Skill 描述：证据 PNG = 0，`Use when` = 0。
2. 主机名前缀 grep = 0。
3. 令牌 / 一次性码 / 假 key / `/Users/<名字>` / `/home/<测试用户>` = 0。
4. stub 不在安装包里：`tar tzf` 无 `openbayes-stub`。

## 未完成与风险

- I1 的具体兼容性拒绝未复现；已确认 dsh 不读 `$DSH_HOME` 之外的位置。
- M2/M4/M6、R3 的逐项回归、以及 Ubuntu 的部分场景未按 RFC 要求各跑 2 次；上表逐项写明。
- 迁移后的 profile `cordis.patch.yml` 会被安装器更新 skill 根表达式（内容语义不变）。
