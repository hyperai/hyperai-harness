# RFC-001 结果报告

> 关联 RFC：[RFC-001：HyperAI TUI 发布包可行性验证（PoC）](https://github.com/lizhenhhh/jihua/blob/main/RFC-001-tui-package-poc.md)
> 工作分支：`poc/rfc-001-tui-package`（基线 `feat/hyperai-tui-profile`）

## 结论（3～5 句）

三条路径（P1 改名发布、P2 改名 + 别名安装、P3 tarball URL 分发）和对照组（T5 现有安装方式）都在 npm 上已发布的 `@deepseek-ai/dsh@0.2.0-rc.2` 上跑通；三条路径安装阶段都不读取源码仓库（对照组必须读取，这正是要解决的问题），T4 的第 1～6 项在三条路径上全部通过，**不存在阻塞问题**。
推荐 **P1**：成品包叫 `@hyperai/hyperai-tui`，包内所有运行时自引用改写成新名，产物自洽——Cordis 插件行、bundle 头、设置清单、插件 feed 都不再依赖上游包名；旧会话可以 `--resume` 恢复，`~/.dsh-tui-hyperai` 里的偏好继续生效。
P2 也能走通，但 profile 的 `dsh.profile.bundles` **必须写别名的旧名** `@deepseek-harness-tui/dsh-tui`；写成品包真实的新名会让 bundle 被 `skippedBundles` 跳过（反例见 `evidence/p2b/`）。
P3 改动最小，成品保持上游包名，但把分发绑在 tarball 托管地址上，品牌身份仍是上游的，只建议作为应急通道。
T1 的离线可复现构建成立：从保存的原包重建出的补丁与已提交补丁逐字节相同（sha256 一致），断网条件下同样成立。

## 环境

| 项 | 值 |
|---|---|
| OS | macOS 26.1（25B78），arm64 |
| Node | v26.9.0 |
| npm | 11.19.1 |
| pnpm | 10.28.1 |
| dsh | `@deepseek-ai/dsh@0.2.0-rc.2`（npm 全局装在临时 HOME，不用仓库源码构建） |
| 上游 TUI | `@deepseek-harness-tui/dsh-tui@0.16.1`，integrity 与 RFC 3.1 一致 |
| P1 / P2 registry | Verdaccio 6.11.1，两个实例（`127.0.0.1:4873` / `127.0.0.1:4875`），uplink 到 registry.npmjs.org |
| P3 分发 | `python3 -m http.server` 模拟 Release 附件（`127.0.0.1:4874`） |
| 隔离方式 | 每条路径独立的临时 `HOME` + `DSH_HOME`；安装期间把 checkout 整个改名 |
| 基线分支 HEAD | `529589f396`（比 RFC 记录的 `fbf585af77` 多一个文档提交，见“偏离”） |
| 工作分支 | `poc/rfc-001-tui-package` |
| PoC 代码与证据提交 | `53cae490b23f16011ed2c28cd445ccce16e54485` |

产物（未入库，按 RFC 不提交 >5 MB 二进制）：

| 路径 | 包名 | 文件名 | 大小 | sha256 |
|---|---|---|---|---|
| P1 | `@hyperai/hyperai-tui@0.16.1` | `hyperai-hyperai-tui-0.16.1-p1.tgz` | 18 371 346 B | `02007274abd7f0407eee31b3a8f30fd2b34d154174aa3c79e72b0a4ce9c02553` |
| P2 | `@hyperai/hyperai-tui@0.16.1` | `hyperai-hyperai-tui-0.16.1-p2.tgz` | 18 371 364 B | `038073401204be5bc19c91adfc5bc39285387bea5d927afc46e1a0ec000bda08` |
| P3 | `@deepseek-harness-tui/dsh-tui@0.16.1` | `deepseek-harness-tui-dsh-tui-0.16.1-p3.tgz` | 18 371 362 B | `9060c0fe2882c02ca311434353179bc454299b7c6ac1be240fd1759f30f63b76` |

## T1 可复现构建

| 要求 | 结果 | 证据 |
|---|---|---|
| `npm pack` 的原包 integrity 等于 RFC 3.1 | **通过**：`sha512-xk8Nviy55RvLnAdjYj04DekUu6D1Pc0kEa5R+2EXoL3H/h6ZEzv8L0bxtSTrWxtNdXd4ufOXMu4TQ7HjrpYhbg==`，18 473 587 B，sha256 `2144b317…6e` | `evidence/t1/integrity.txt` |
| 从解包目录 `build-patch.mjs --from` 重建，与已提交补丁逐字节相同 | **通过**：`cmp` 无差异，两边 sha256 均为 `81e077bbaf637088518e0aabd45caf4ad17ca44f265c19fa81cf2148a93d65ab` | `evidence/t1/patch-sha256.txt`、`evidence/t1/offline-build.log` |
| 断网重复第 2 步 | **通过**：`npm_config_registry` 与 `HTTP(S)_PROXY` 都指向 `127.0.0.1:9`，构建成功且补丁哈希不变 | `evidence/t1/offline-build.log` |
| 原包保存方式对比 | 见下 | 分析 |

**原包保存方式推荐：GitHub Release 附件（或内部对象存储）+ 仓库内记录哈希，不进 git、不用 LFS。**

- 直接提交进仓库：18.5 MB 二进制会永久留在 git 历史里，每次 clone 都要付代价；也直接违反 RFC 第 6 节“不提交超过 5 MB 的二进制文件”。
- Git LFS：不污染历史，但要求所有构建者装 LFS、且 GitHub 免费额度只有 1 GB 存储/1 GB 带宽；本项目一年内会有多次上游版本，额度风险实在。另外 RFC 已确定“普通用户不需要 clone 源码仓库”，LFS 只服务开发侧，收益有限。
- Release 附件：单文件上限 2 GB，公开仓库匿名可下载，URL 稳定，可同页附 `SHA256SUMS`；不进入 clone。缺点是依赖 GitHub 可用性，所以建议同时留一份内部对象存储镜像。

构建脚本的查找与校验方式已在 `build-package.mjs` 里实现：`--upstream <tarball|dir>`，在解包前先按 `apps/tui/poc/upstream.json` 校验 size、sha256 和 npm integrity，任一项不符立即失败。CI 里把 `--upstream` 指向 Release 附件下载缓存即可，仓库只保存哈希。

## 路径对比矩阵

| 检查项 | P1 | P2 | P3 | 现有方式（T5） |
|---|---|---|---|---|
| 安装成功 | 通过 | 通过 | 通过 | 通过 |
| 安装时不读取源码仓库 | 通过 | 通过 | 通过 | **不通过**：安装器必须读 checkout（`../../tui/`） |
| 启动画面品牌正确 | 通过（21699 个 `#FF6096` 像素、splash 区域无其它颜色） | 同左 | 同左 | 同左 |
| 版本铭牌正确 | 通过：`hyperai-tui v0.2.0 · dsh-tui v0.16.1` | 通过 | 通过 | 通过 |
| `--dump-config` 正常 | 通过：611 行、stderr 0 字节 | 通过：611 行、stderr 0 | 通过：611 行、stderr 0 | 通过：611 行、stderr 0 |
| `/update` 被禁用 | 通过：显示“HyperAI Harness does not upgrade through /update; use the HyperAI profile installer/release flow.” | 通过 | 通过 | 通过 |
| `/provider`、`/model` 能打开 | 通过 | 通过 | 通过 | 通过 |
| 无 bundle 跳过或包名报错 | 通过 | 通过（`bundles` 写别名旧名；写真实新名时被跳过，见 p2b） | 通过 | 通过 |
| 旧会话和偏好兼容（仅 P1） | 通过：旧会话 `--resume` 恢复出原提问，`~/.dsh-tui-hyperai` 仍是同一目录，`lang=en` 偏好继续生效 | 未测（不适用） | 未测（不适用） | 未测（不适用） |

补充说明：

- 每条路径的 `dump-config` 都包含 TUI bundle 行与 `skill-filesystem` 行（`evidence/*/dump-config.txt` 第 200 行附近）。P1 的 bundle 头是 `# == @hyperai/hyperai-tui`，其余路径是 `# == @deepseek-harness-tui/dsh-tui`。
- 四份 `dump-config.stderr.txt` 均为 0 字节；各路径的 PTY 启动流里也没有 `skipping profile bundle` / `ERR_MODULE_NOT_FOUND` / `Cannot find module` 等关键字。
- P2 的反例 `p2b`（`bundles` 写 `@hyperai/hyperai-tui`）在 `--dump-config` 时明确报错：`cannot resolve profile bundle "@hyperai/hyperai-tui"`，只剩 3 个 bundle 头，TUI 那层完全缺失（`evidence/p2b/dump-config.stderr.txt`）。

## P1 自引用分析

原包里出现 `@deepseek-harness-tui/dsh-tui` 的文本文件共 **115 个**、命中 203 处。按性质分类：

| 类别 | 文件数 | 是否必须改 | 处理 |
|---|---|---|---|
| 运行时代码 / 配置 | 16 | 见下表 | 全包改写为新名，并断言零残留 |
| JSDoc `@module` 注释 | 50 | 否（行为无关） | 顺带改写，保持一致 |
| 类型声明 `.d.ts` | 36 | 否（运行时无关） | 顺带改写 |
| 文档 / 指南（`guide/`、`README*`） | 13 | 否（内容） | 顺带改写 |

16 个运行时文件逐项：

| 文件 | 用途 | 不改的后果 | 处理 |
|---|---|---|---|
| `package.json` | 包名 | `node_modules` 目录名与 manifest 不符，bundle 无法按名解析 | 改为 `@hyperai/hyperai-tui` |
| `cordis.yml`（9 处） | TUI 各子插件的模块说明符（`/workspaces`、`/scenes`、`/plugin-host`、`/working-activity` 等） | Cordis 加载器按名 `import()`，旧名解析失败，TUI 整层加载不出 | 改写 |
| `cordis.patch.yml`（11 处） | 同上，外加 `/panels`、`/oauth` | 同上 | 改写 |
| `lib/types/adapter/standard/descriptor.js`（2 处） | `import.meta.resolve('<包名>/package.json')` 与 `manifest.name` 比对 | `import.meta.resolve` 直接抛 `ERR_MODULE_NOT_FOUND` | 改写 |
| `lib/types/dsh-adapter/oauth/deepseek.js` | 同上，读自身 `package.json` 取版本 | 抛解析错误 | 改写 |
| `lib/types/preset-patch.js` | `PRESET_PATCH_MODULE`，运行期按名 `import()` | preset patch 模块加载失败 | 改写 |
| `lib/types/dsh-adapter/plugin-declaration.js` | `COMPOSITION_PACKAGE`，被 plugin-guard / plugin-install / plugin-manage 用作“我自己”的身份 | 保护器认不出自己的 bundle，安装/管理逻辑走错分支 | 改写 |
| `lib/types/dsh-adapter/packaged-presets.js` | `OWNER = '<包名>'`，随包 preset 的归属标记 | preset 归属判断失配 | 改写 |
| `lib/settings.json` | 设置清单的 `package` 字段 | 设置清单与包身份不一致 | 改写；**`namespace: "dsh-tui"` 保持不动**（偏好存储键，改了会让用户已有偏好失效） |
| `tui-profile/feed/first-party.json`（2 处） | 插件 feed 的 `name` 与 `scope` | feed 自我描述错误 | 改写（scope 也改成 `@hyperai`） |
| `presets/liangshen/.dsh-tui-managed.json` | 随包 preset 的 `owner` | 归属失配 | 改写 |
| `bin/dsh-tui.js`（4 处） | 独立启动器：自身名判断、`PACKAGE` 常量、`node_modules/@deepseek-harness-tui/dsh-tui` 路径片段 | 独立启动器找不到自己/找错 profile 包 | 改写（含路径两段） |
| `lib/types/dsh-adapter/entry-slot.js` | `Symbol.for('<包名>:host-entry')` 全局槽位键 | 只需内部一致，不会解析失败 | 改写（保持一致） |
| `lib/types/dsh-adapter/invariant.js` | invariant 注册名 | 注册名不一致，不影响启动 | 改写 |
| `lib/types/update.js` | `PACKAGE_NAME`，npm 自更新目标 | 自更新已被品牌补丁禁用，不会触发 | 改写 |
| `lib/types/i18n.js`（6 处） | 更新相关文案里出现的包名 | 仅文案；`/update` 已改成 HyperAI 禁用提示 | 改写 |

**不能改的两处**（本次刻意保留）：

1. `lib/settings.json` 的 `namespace: "dsh-tui"`：它是偏好存储命名空间，跟着包名改会让 `~/.dsh-tui-hyperai` 里已有偏好失效。
2. 品牌补丁本身：`patches/dsh-tui@0.16.1.patch` 逐字节不变，改名是 `build-package.mjs` 里独立的一步。P2/P3 产物的补丁内容与 P1 完全一致，差别只在有没有跑改名。

**P1 与 P2 的机制差异（实测）**：在 P1 的 profile 里 `import.meta.resolve('@deepseek-harness-tui/dsh-tui/package.json')` 返回 `ERR_MODULE_NOT_FOUND`，只有新名可解析；在 P2 的 profile 里正好相反——别名目录 `node_modules/@deepseek-harness-tui/dsh-tui` 让旧名可解析，新名不可解析。这就是 P1 必须改名、P2 不必改名（但也无法用新名写 bundle）的原因。

## 用户安装命令序列（推荐路径 P1）

从一台干净机器开始（macOS/Linux，Node `^22.19 || >=24`，已装 pnpm 10）：

```sh
# 1. 安装 DSH（RFC 3.3 指定的版本线）
npm install -g @deepseek-ai/dsh@0.2.0-rc.2

# 2. 建 profile 目录，放入三个文件（未来由产品安装入口提供，本 RFC 不实现）
mkdir -p "$HOME/.dsh/profiles/hyperai"
#   package.json         <- apps/tui/poc/profiles/p1/package.json
#   pnpm-workspace.yaml  <- apps/tui/poc/profiles/p1/pnpm-workspace.yaml
#   cordis.patch.yml     <- apps/profiles/hyperai/cordis.patch.yml
#   .npmrc               <- registry=<发布 @hyperai scope 的 registry>

# 3. 安装成品包（pnpm 拉取 @hyperai/hyperai-tui@0.16.1 及其依赖）
dsh plugin --profile hyperai install

# 4. 启动
dsh --profile hyperai
#    首次进入后用 /provider 配置 provider，用 /model 选模型（DSH 原生流程）
```

PoC 里第 3 步的实际调用是 `dsh plugin --profile hyperai install --no-frozen-lockfile`（首次安装没有 lockfile）。完成后 profile 里有 `pnpm-lock.yaml`，之后可以用 `--frozen-lockfile` 复现安装。

## 证据

目录：`apps/tui/poc/evidence/`

| 路径 | 内容 |
|---|---|
| `t1/integrity.txt` | 原包 size / sha256 / integrity 与 RFC 3.1 对照 |
| `t1/patch-sha256.txt` | 已提交补丁 sha256 |
| `t1/offline-build.log` | 断网重建补丁与逐字节比对结果 |
| `p1/build.json`、`p2a/build.json`、`p3/build.json` | 三种产物的包名、版本、大小、sha256、改名文件数（P1：115 个） |
| `<case>/install.log` | 隔离安装的完整日志，含“checkout 已改名、`test -e` 为假”的记录 |
| `<case>/dump-config.txt` / `.stderr.txt` | 合并配置与 stderr（全为 0 字节） |
| `<case>/startup.screen.txt` / `.png` | 启动画面：粉色像素字、版本铭牌、无鲸鱼 |
| `<case>/update.screen.txt` | `/update` 的 HyperAI 禁用提示 |
| `<case>/provider.screen.txt`、`model.screen.txt` | `/provider`、`/model` 面板 |
| `p2b/dump-config.stderr.txt` | 反例：bundle 写真实新名被跳过 |
| `compat/*` | T4.7：原包名安装（`old-package.screen.txt`）、切换改名包（`new-package.screen.txt`）、`--resume` 旧会话（`new-package-resume.screen.txt`）、会话索引前后对比、`settings.after.json` |

PNG 是用 pyte 回放 PTY 字节流后按单元格渲染的截图；`startup.screen.txt` 是同一帧的文本形式，进度条/交互内容以文本为准。

## 风险与未解决问题

1. **产物版本号策略**：成品 `version` 保持上游的 `0.16.1`，HyperAI 版本 `0.2.0` 记在新增的 `hyperai` 字段。若把 `version` 直接改成 `0.2.0`，版本铭牌里的 `dsh-tui v${tuiVersion}` 会变成 `v0.2.0`，与 T4.2 冲突。上游每个版本都要跟着发一个同版本号的成品包，长期是否合适需要负责人定。
2. **改名步骤的长期维护**：目前是“全包文本替换 + 零残留断言”，上游新增自引用会被自动覆盖；但如果上游将来引入“必须叫官方名”的语义（例如官方包检测、遥测上报里的包名），P1 会失效，届时需要退回 P2 或与上游协商。P2 因为不改内部引用，对这类变化天然免疫——这是 P2 唯一比 P1 强的地方。
3. **发布渠道未验证**：P1/P2 需要能往 `@hyperai` scope 发布，PoC 只用了本地 Verdaccio；真实 npm / 私有 registry 的权限、`--access` 设置、CI 发布流程都没有测。
4. **P3 的更新路径未测**：`dsh plugin update` 对 URL 依赖的行为没验证；tarball URL 的长期托管（Release vs 对象存储）也没定。
5. **会话兼容只测了“能恢复”**：旧会话在新包名下 `--resume` 成功、索引与偏好目录都保留，但没有逐字段核对会话格式里是否记录 TUI 包名（grep 结果是没有）。
6. **平台矩阵缺失**：只在 macOS arm64 + Node 26 上跑过；Windows、Linux、Node 22 线、pnpm 其它版本都没测。56/80/120 列只有 120 列截图。
7. **隔离安装依赖宿主 pnpm**：profile 的 `dsh plugin install` 用的是 `PATH` 上的 pnpm（10.28.1），没有验证 dsh 自带/其它 pnpm 版本。
8. **Skills 不在范围**：所有安装都用 `--no-skills` / 空 `skills/`，没有验证成品包与 Skills 安装的交互。

## 偏离 RFC 的地方

1. **基线 HEAD 不是 RFC 记录的 `fbf585af77`**：执行时 `feat/hyperai-tui-profile` 已前进到 `529589f396`（一个文档修正提交），我从分支最新 tip 切出工作分支，没有改基线分支。
2. **产物文件名加了路径后缀**（`-p1` / `-p2` / `-p3`）：P1 与 P2 同名同版本，直接 `npm pack` 会互相覆盖；内容本身不变。
3. **T2 的“package.json 写明 HyperAI 版本号和上游版本”用字段表达**：`version` 保留上游版本（原因见风险 1），HyperAI 版本写在 `hyperai.tuiVersion`，上游包与版本写在 `hyperai.upstreamPackage` / `hyperai.upstreamVersion`。
4. **P2 拆成两个变体**：`p2a`（`bundles` 写别名旧名，作为 P2 的正式结论）与 `p2b`（`bundles` 写真实新名，作为反例），用来回答 RFC “`dsh.profile.bundles` 应该写哪个名字”。
5. **T4.7 的会话是用一条会失败的消息创建的**：没有 API key，发送消息后模型轮次以 `turn error` 结束，但会话日志、标题和索引是真实生成的；偏好 `lang=en` 是直接写进 TUI 自己的 `settings.json`（等价于用户已经设置过），没有走 `/settings` 界面点击。
6. **PTY 运行需要更大权限**：本机沙箱默认拒绝 `openpty`，TUI 的所有运行都在提权下执行。这是执行环境限制，未记入方案结论。
7. **原包没有入库**：按 RFC 第 6 节只记录哈希（`apps/tui/poc/upstream.json`），没有提交 tarball，也没有创建 Release。
