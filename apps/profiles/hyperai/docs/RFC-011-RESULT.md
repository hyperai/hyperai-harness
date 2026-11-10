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
| 大小 | 18 487 439 字节 |
| sha256 | `9967457d26db1451a8bdc0c86399e5466f804262827aa70ea36b2fc173b0328d` |
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


## 补测（2026-11-10 第二轮）

### M2、M4、M6、R3

| 项 | macOS | Ubuntu |
|---|---|---|
| M2 beta.6 → beta.7 | 通过：迁移、6 类一致（provider 只差 skill 根表达式，sessions 按决定不复制） | 通过（2 次，版本标记 beta.1） |
| M2 beta.1 → beta.7 | **通过（真实 beta.1，2 次）**：解压到非软链目录后装出 beta.1 profile，升级 beta.7 迁移；provider 仅差 skill 根表达式，sessions 按决定不复制，其余 5 类一致 | 通过（真实 beta.1，2 次，7 类快照一致） |
| M4 旧目录还有其他 profile | 通过：只迁移 hyperai，`dsh-tui` 未复制，`~/.dsh` 哈希不变 | 通过（2 次） |
| M6 迁移失败回滚 | 通过：把 `~/.hyperai/dsh` 变成普通文件制造失败，安装 exit 1、`~/.dsh` 不变；移除阻塞后重跑成功 | 通过（2 次，fail=1、retry 成功） |
| R3 回归 | 通过：有效直接进入、跳过有标识、/openbayes status 显示已跳过、2 天提醒、过期门、logout 回门、/skills、/provider、/model、doctor 旧数据提示 | 通过（登录门四项各 2 次；doctor 通过） |

### 构建与 skills 快照

- 本地快照的 `contentDigest` = `sha256:c52a8cf76f483cf5ef5836044de9ba5503648f590830450f206464dc79424fa6`，与 beta.6 包（锁定 commit `34f0a1be0c`）完全一致。
- GitHub 恢复后按正常流程重新构建：`SNAPSHOT.json` 的 repository/ref 恢复为上游地址和 `34f0a1be`，文件内容/内容摘要不变，但元数据变了，因此 sha256 从 `5061edb8…` 变为 `9967457d…`；两次构建一致，服务器已覆盖为 `9967457d…`。
- 新构建 commit：`157521bd0f8ca286d767720ab647b2fbd0074847`。

### 仍未完成

- **I1**：同事那条 `is incompatible … 0.1.0-rc.7` 仍未复现；已确认 dsh 只读 `$DSH_HOME` 内部位置。
- Ubuntu 的 I2、I4 没有在最终构建上重跑（I3、I5 已各 2 次）；M1 的 7 类逐项对比在 Ubuntu 上只核对了迁移记录/storages/哈希。

## 第三轮补测（负责人指定）

### 真实 beta.1 → beta.7

**尝试的方法：**

1. 临时 `HOME` + 临时 `DSH_HOME`：beta.1 安装器返回成功，但临时目录下没有生成 profile。
2. 只设临时 `HOME`、显式 `env -u DSH_HOME`：macOS 上仍然返回成功但没有生成 profile（`~/.dsh/profile` 也不存在，真实 `~/.dsh` 未被改动）；**Ubuntu 上成功**，profile 落在临时 `HOME/.dsh/profiles/hyperai`，版本为 `0.2.0-beta.1`。

**结果：**

- Ubuntu：真实 beta.1 装好后在同一临时 HOME 装 beta.7，2 次均迁移成功；7 类快照（provider、credential、model、prefs、sessions、userskill、builtinskill）升级前后逐行相同（该 fixture 的 sessions 为空，迁移不复制会话由 macOS M1 的“有会话”场景单独验证）。
- macOS：两种方法都无法在临时 HOME 生成 beta.1 profile，按负责人允许的兜底方案，用 beta.6 profile 把版本标记改为 `0.2.0-beta.1` 验证迁移路径；6 类与迁移前一致，sessions 按决定不复制，provider 仅差 skill 根表达式。

### I1 收口

按负责人决定：**无法复现同事的 `is incompatible … 0.1.0-rc.7`**。证据与结论：

- 三种构造（旧依赖写 manifest、旧依赖放 profile node_modules、home 级 `cordis.patch.yml` 插入旧插件）都没有触发同样的拒绝；
- `dsh --dump-config` 证明 home 级 patch 会被加载，但 `dsh plugin install` 不报兼容性错误；
- 已确认 dsh 只读 `$DSH_HOME` 内部：`profiles/<name>`、home 级 `cordis.patch.yml`、共享 `profiles/node_modules`，不读 `$DSH_HOME` 之外的位置；
- 因此“换目录隔离”成立。beta.7 发出后请那位同事实际安装一次，作为最终确认。

### Ubuntu 最终构建补测

| 场景 | 结果 |
|---|---|
| I2 旧 `~/.dsh`（含旧插件/patch）→ beta.7 | 2/2：迁移成功，旧目录哈希不变 |
| I4 `HYPERAI_DSH_HOME` | 2/2：装到自定义目录，默认目录未创建 |
| M1 beta.6 → beta.7 | 2/2：迁移成功；6 类快照一致，sessions 未复制（fixture 无会话） |
| 真实 beta.1 → beta.7 | 2/2：版本确认为 beta.1，升级后 7 类快照一致 |

### 构建

本轮没有代码改动，安装包仍是正常流程构建的 `9967457d…`；skills `SNAPSHOT.json` 为上游仓库 + `34f0a1be…`，内容摘要 `c52a8cf7…`，与锁定 commit 一致；服务器文件已核对。


## 真实 beta.1 的 macOS 失败原因（已定位）

此前 macOS 上 beta.1 “安装完成但没生成 profile”，根因不是 beta.1 装不上，而是解压位置经过软链接：

- 安装包解压在 `/tmp/b1pkg`；macOS 的 `/tmp` 是指向 `/private/tmp` 的软链接。
- beta.1 的 `install.mjs` 用 `process.argv[1] === fileURLToPath(import.meta.url)` 判断是否主模块；一边是 `/tmp/...`，一边是 `/private/tmp/...`，字符串不相等，主逻辑没有执行，进程仍然 exit 0，于是 `install.sh` 打印“安装完成”。
- 后续版本改成 `realpathSync` 比较，所以 beta.6/beta.7 不受影响。
- 把 beta.1 解压到不经过软链接的目录（`beta-test/…`）后，只设临时 `HOME`、`env -u DSH_HOME`，macOS 上真实 beta.1 安装成功，profile 落在临时 `HOME/.dsh/profiles/hyperai`，版本为 `0.2.0-beta.1`。

### macOS 真实 beta.1 → beta.7（2 次，7 类逐项）

| 类别 | 结果 |
|---|---|
| provider 配置 | 仅 skill 根表达式从 `DSH_HOME ?? ~/.dsh` 变为 `HYPERAI_DSH_HOME ?? DSH_HOME ?? ~/.hyperai/dsh`，模型配置未变 |
| API key | 一致（0600 复制） |
| 选中模型 | 一致 |
| 界面偏好 | 一致 |
| 对话记录 | **预期差异**：按选项 2 不迁移，旧会话完整留在 `~/.dsh`，新目录为空 |
| 自建 Skill | 一致 |
| 内置 Skill 目录文件 | 一致 |

`~/.dsh` 前后哈希不变；两次都生成了迁移记录。

## beta.7 install.sh 的安装结果核对

beta.7 的 `install.sh` 第 4 节已经有“确认安装真的成功”：检查 profile 目录存在、`.hyperai-install.json` 存在且 `status === "completed"`，否则 fail，不会生成启动命令。因此不需要改代码；beta.1 缺少这一步，是当时“静默成功”的原因之一。
