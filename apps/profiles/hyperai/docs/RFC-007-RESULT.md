# RFC-007 结果报告（v0.2.0-beta.5）

> 关联 RFC：[RFC-007：安装器自动识别全新安装和覆盖升级](https://github.com/lizhenhhh/jihua/blob/main/RFC-007-beta5-scenario.md)
> 工作分支：`feat/hyperai-internal-beta`（从 `a8fbf74f1a` 往后提交，未新建分支）

## 结论

安装器现在会在写入任何文件之前识别场景，并用中文说明当前版本、目标版本、会不会保留配置；结束时再总结一次。降级默认拒绝且零写入，`--allow-downgrade` 才继续；`--dry-run` 只做识别。macOS 与 Ubuntu 上 beta.1 → beta.5、beta.4 → beta.5 两条路径的 7 类用户数据哈希全部不变，全新安装正常。`v0.2.0-beta.5` 已构建并通过 S1～S7。

## 识别逻辑

新增 `detectInstallScenario()`（`scripts/install.mjs`），只读 profile 的 `package.json`、`.hyperai-install.json`、`.hyperai-uninstall.json` 和目录项；`install.sh` 用 `--detect-scenario` 显示、用 `--scenario-field mode|from|to` 取摘要字段，不解析 JSON。

| 场景 | 判断依据 | 行为 |
|---|---|---|
| 全新安装 | profile 目录不存在或为空 | 继续；提示「这是一次全新安装：X」 |
| 覆盖升级 | 有 `hyperaiTuiManaged` 标记，`hyperaiTui.version` < 目标版本 | 继续；打印旧/新版本、保留清单、备份位置 |
| 重新安装 | 版本相等 | 继续；提示「版本相同，这次相当于修复/重装」 |
| 降级 | 已装版本 > 目标版本 | 默认 exit 3（`install.sh` 再以 exit 1 停止），零写入；`--allow-downgrade` 继续 |
| 上次未完成 | `.hyperai-install.json` 状态为 `installing` / `failed` | 继续；提示版本与停在哪一阶段 |
| 卸载过 | 存在 `.hyperai-uninstall.json`（`status: uninstalled`） | 继续；提示归档路径且不会自动恢复 |
| 版本未知 | 受管 profile 但没有 `hyperaiTui.version` | 按覆盖升级处理，版本显示「未知」 |
| 非本安装器 | 目录存在但没有管理标记 | 识别为 foreign；后续仍由原拒绝分支处理 |

版本比较按 semver，含预发布号（`0.2.0-beta.1 < beta.4 < beta.5 < 0.2.0`），有单测覆盖。识别函数只读；单测在每种场景下比较目录树哈希，并确认没有创建 `node_modules` 等文件。

## 各场景的实际输出（节选）

全新安装：

```text
没有检测到已安装的 HyperAI Harness，这是一次全新安装：0.2.0-beta.5
...
已全新安装 0.2.0-beta.5。
首次使用：进入 TUI 后用 /provider 添加模型服务，再用 /model 选择模型。
```

覆盖升级：

```text
检测到已安装：HyperAI Harness 0.2.0-beta.1
本次安装：    HyperAI Harness 0.2.0-beta.5
这是一次覆盖升级，不需要先卸载。以下内容会保留：
  - 模型服务配置和 API key
  - 选中的模型和界面偏好
  - 对话记录
  - 你自己添加的 Skills 和文件
被替换的程序文件会先备份到 <profile>/.hyperai-backups/<时间戳>/
...
已从 0.2.0-beta.1 升级到 0.2.0-beta.5，你的配置和对话记录已保留。
```

降级（默认拒绝，exit 1，零写入）：

```text
检测到已安装：HyperAI Harness 0.2.0-beta.9
本次安装：    HyperAI Harness 0.2.0-beta.5
你已经装了更新的版本，这个安装包是旧版本，降级不做保证。
默认停止，没有写入任何文件。确认要降级时，加 --allow-downgrade 重新运行。
```

重新安装、上次未完成、卸载过、版本未知、非本安装器的输出见 `evidence/rfc-007/macos/s4-data2.log`、`s6.log`、`scenario-*.log`。

## S1～S7

| # | 场景 | macOS | Ubuntu | 证据 |
|---|---|---|---|---|
| S1 | 全新安装 beta.5 | 通过：全新提示、完成总结、首次配置提示、铭牌 beta.5 | 通过 | `*/s1-*` |
| S2 | beta.1 → beta.5 | 通过：识别/总结正确，7 类哈希不变，旧会话仍在 | 通过 | `*/s2-*` |
| S3 | beta.4 → beta.5 | 通过：同上，openbayes-user 仍在 | 通过 | `*/s3-*` |
| S4 | beta.5 → beta.5 重装 | 通过：提示重装，7 类哈希不变，计划里 8 个 unchanged | —（RFC 不要求） | `macos/s4-data2.log` |
| S5 | 降级 beta.9 | 通过：exit 1、零写入；`--allow-downgrade` 后继续 | — | `macos/s5-*` |
| S6 | failed 状态 | 通过：提示上次未完成，状态变 completed | — | `macos/s6.log` |
| S7 | `--dry-run` 全新/已安装 | 通过：版本正确、exit 0、未创建目录 | — | `macos/s7-*` |

## 7 类用户数据哈希对比

测试方式：在 TUI 里用 `/provider`（本地假 OpenAI 服务）正常添加 provider、写入 API key、选择模型，用 `/lang` 改偏好，发一条消息产生会话；再按用户正常方式添加自建 Skill 和内置 Skill 目录里的文件。升级前后逐项对比：

| 类别 | beta.1 → beta.5（macOS） | beta.4 → beta.5 | Ubuntu 两条路径 |
|---|---|---|---|
| provider 配置 | `aecc8182…f60773` 不变 | 不变 | 不变 |
| API key（只哈希） | `f30030f7…6f62bb` 不变 | 不变 | 不变 |
| 选中的模型 | `d8c3469d…94e460` 不变 | 不变 | 不变 |
| 界面偏好 | `9647d228…481bb2` 不变 | 不变 | 不变 |
| 对话记录 | `00953e18…7044f3` 不变 | 不变 | 不变 |
| 自建 Skill | `8707897a…7f9242` 不变 | 不变 | 不变 |
| 内置 Skill 目录里的文件 | `786d4283…0c900c` 不变 | 不变 | 不变 |

provider 配置的对比使用“去掉空行、去掉行尾空白后”的规范化哈希：beta.1 的 `cordis.patch.yml` 第一次被合并时会被重排一次（内容不变），之后再装就稳定。未规范化的原文件哈希在第一次升级时会变，但 provider 条目与字段都还在。

## 交付物

| 项 | 值 |
|---|---|
| 安装包 | `hyperai-harness-0.2.0-beta.5.tar.gz` |
| 大小 | 18 478 298 字节 |
| sha256 | `f11393d4523628bc4f745c4c06cc195c3dcb22eaef0d07846578aa78bc9694b6` |
| 构建 commit | `e444df1c3559822202493a278d199eb00ff41e0b` |
| 构建 | 同一 commit 两次构建，sha256 一致 |
| TUI 成品包 | 3298 个文件，版本 `0.2.0-beta.5` |
| 服务器 | 测试服务器测试用户主目录（beta.1～beta.4 保留，beta.5 新增） |

## 测试

- `apps/tui` verify 15/15、`node --test` 36/36（含上一轮的遮蔽测试）。
- `apps/profiles/hyperai` verify 12/12、`node --test` 100/100；新增 `tests/scenario.test.mjs` 覆盖 8 种场景、semver、只读性、`--json` 字段。
- 包内 `README.md` 与仓库 `docs/beta-install.md` 一致。

## 说明文档

- 第 2 节新增「安装包放在哪里、HyperAI 装在哪里」。
- 第 7 节改写：自动识别旧版本并显示从哪个版本升级、结束总结；新增「查看自己装的是什么版本」（推荐 `./install.sh --dry-run`）与「降级」（默认拒绝、`--allow-downgrade`）两小节。

## 固定自查

1. `/skills` 列表截屏 / 内部 Skills 描述：
   `git grep -nI "Use when" -- apps/profiles/hyperai/docs/evidence/rfc-007` → **0**；`find … -name '*.png'` → **0**。
2. 主机名前缀：`git grep -nI "<主机名前 10 个字符>" -- apps/` → **0**。
3. 令牌 / 一次性码 / 假 API key / 本机路径：
   `git grep -nIE "eyJ[A-Za-z0-9_-]{30,}" -- apps/` → **0**；
   `git grep -nI -e "<本次一次性码>" -e "<T3 假码>" -e "<假 API key>" -e "/Users/<用户名>" -- apps/` → **0**；
   绝对 `/home/<测试用户>` 路径（`-- apps/profiles/hyperai/docs apps/tui/docs`）→ **0**（证据里已替换成 `$HOME`；`apps/desktop`、`apps/web` 里上游测试夹具的同名示例不属于本轮改动）。

## 偏离 RFC 的地方

1. **`--dry-run` 提前退出**：识别完成后直接打印「没有写入任何文件」并退出，不再安装 `~/.hyperai/runtime`。这是为了满足 S7「不写任何文件」；正常安装/升级路径不变。
2. **provider 配置的哈希口径**：为了排除合并时的空白行重排，provider 使用规范化哈希；其余 6 类用原始文件哈希。报告里如实说明了这一点。
3. **`--allow-downgrade` 的字段查询**：`install.sh` 用 `--scenario-field` 取摘要字段时也要带 `--allow-downgrade`，否则降级 profile 的字段查询会被判为拒绝；已修复并复测。
4. 证据里的安装包位置按 RFC 要求只写在报告，不写服务器地址。

## 已知问题与限制

1. 降级允许后，完成总结走默认的「已安装 HyperAI Harness X。」，没有单独的「已降级」措辞（RFC 只要求升级/全新/重装三种总结）。
2. `manage.mjs status` 本来就会显示 `hyperai-tui` 版本，本轮未改，符合 3.4.3。
3. 识别只认可本安装器写入的 `hyperaiTui.version`；更早的非本安装器目录会按 foreign 走原拒绝逻辑。
4. 测试用的假 provider/假 key 只存在于临时环境，没有写进仓库、证据或报告。
