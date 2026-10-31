# HyperAI TUI 开发计划与 TODO

> 状态：**决策已定稿，待开工确认**。方案 A（进程内插件）+ OpenTUI `@opentui/core` 直写；代码位置 `apps/tui/`；分支 `hyperai-tui`。设计依据见 [integration-design.md](integration-design.md)，现状见 [tui-support-status.md](tui-support-status.md)。

## 0. 目标与范围

在 dsh fork 上交付 `dsh --profile tui` 的终端交互界面：输入 → 流式渲染 → 工具卡片 → 审批/提问 → 会话恢复。能力全部复用 dsh seam，不做第二套 agent 栈。

**v1 范围**（本计划交付）：对话流、token 级流式（text + reasoning）、工具卡片、审批弹层、结构化提问、会话列表/恢复、权限预设与模型/力度切换、优雅退出、locale。

**v2 之后**：jobs 面板、斜杠命令、费用状态栏、帮助/命令面板、工作区回滚、doctor 自检、快照场景扩面。

## 1. 已定决策

| # | 决策 | 依据 |
|---|---|---|
| 1 | 路径 A：进程内插件 + `tui` profile | 与官方 app 同构、流式延迟最优 |
| 2 | 代码位置 `apps/tui/`（用户指定） | `apps/*` 已在 pnpm workspace glob 内 |
| 3 | 分支 `hyperai-tui` | 用户指定 |
| 4 | 经 `dsh` profile 启动，不设 package `bin` | `verify-application-entrypoints` 硬规则 |
| 5 | 能力只复用 dsh seam（agents/approval/userQuestions/jobs） | 避免双 agent 栈 |
| 6 | 渲染层与驱动层解耦（`TuiSurface` 接口） | 后续可换 SDK 数据源（路径 B 形态） |

## 2. 决策记录（已定稿）

**D1 渲染层 = `@opentui/core` 直写 TypeScript（无 React）** — 绕开 React 18/19 版本冲突与 `@types/react` 声明规则；组件用普通函数 + 自管状态。不用 `@opentui/react` / `@opentui/solid`。

**D2 包名 = `@hyperai/hyperai-harness-tui`**（用户指定）。注意：仓库命名规则是 `@deepseek-ai/dsh-<name>`，`@hyperai/*` scope 与之不符，Phase 1 需为命名/产品包策略门禁登记 fork 侧例外（发现项 F6）。

**D3 v1 范围 = §0**：对话流、token 级流式（text + reasoning）、工具卡片、审批弹层、结构化提问、会话列表/恢复、权限预设与模型/力度切换、优雅退出、locale。费用栏与斜杠命令放 v2。

## 3. 目标结构

```
apps/tui/                        @hyperai/hyperai-harness-tui（workspace 包，无 bin）
├── package.json                 dsh.bundle.patch → ./cordis.patch.yml
├── cordis.patch.yml             插入 tui-startup / tui-runtime 两行
├── src/
│   ├── startup.ts               cmdline 解析 → ctx.tuiStartup（--resume/--session-id/--model/--effort）
│   ├── driver.ts                agents 驱动：followup/steer、订阅 assistant-stream / session/event
│   ├── answerers.ts             approval/request + user-questions 终端应答者
│   ├── surface.ts               TuiSurface 实现（驱动 ↔ 渲染的视图模型层）
│   ├── render/                  OpenTUI 渲染层（按 D1 选 core 直写）
│   │   ├── app.ts               根布局：会话区/输入区/状态栏/弹层
│   │   ├── components/          TurnCard / ToolCard / Composer / ApprovalModal / QuestionModal
│   │   └── theme.ts             配色与尺寸 token
│   └── locale/                  文案字典（en / zh-Hans）
├── tests/                       驱动/应答者/折叠 单元测试
├── tsconfig.json                extends tsconfig.base.json
└── README.md                    包契约 + Model Experience 节
```

若 bundle 解析或产品包策略门禁要求 bundle 独立成包，再补一个薄壳 `packages/bundle/tui-app`（Phase 1 发现项 F2）。

## 4. 阶段计划与 TODO

### Phase 0 — 地基与决策验证（0.5–1 天）
- [x] 创建分支 `hyperai-tui`（自 master，含 hyperai-docs/）
- [x] T0.1 OpenTUI 依赖引入 spike：`@opentui/core@0.8.0` 安装成功（macOS arm64）
- [x] T0.2 渲染层验证：`@opentui/core` 直写 demo 跑通（会话文本 + 输入框 + 流式追加 + Enter 提交接线），Node **26.13.0** 实测渲染与终端恢复正常
- [x] T0.3 Node/ABI 结论：**OpenTUI 要求 Node ≥26.4**（engines 声明 + FFI 实测；Node 24 报 "native FFI is not available"）；开发与 CI 统一 Node 26.x（满足仓库 ≥24.9）。macOS arm64 ABI 通过；Linux/Windows 列入 CI 计划
- [x] T0.4 v1 功能清单已冻结（D3）；键位表初稿见 [keymap.md](keymap.md)

**出口达成**：D1/D2 拍板、OpenTUI 可安装可渲染、版本基线确定（Node 26.x）。

### Phase 1 — 可启动骨架（1–2 天）
- [x] T1.1 `apps/tui` 包骨架（`@hyperai/hyperai-harness-tui`：package.json / tsconfig / cordis.patch.yml / README）
- [x] T1.2 `tui-startup` 插件（`--resume`/`--session-id` + task positional，提供 `ctx.tuiStartup`）
- [x] T1.3 `tui` profile 模板注册（`PROFILE_TEMPLATES` in `packages/util/official-bundles`；`dsh --profile tui` 自动初始化并 boot，`--dump-config` 组合树正确）
- [x] T1.4 最小闭环：创建 Agent → `followup()` → OpenTUI 会话视图 + 流式订阅 + 回合结果→退出码映射。boot/渲染/终端恢复/错误路径（`dsh:` 诊断 + exit 1）已验证；**成功路径（流式回答 + exit 0）待有效 API key**（当前环境存有失效密钥 `****vW6Q`）
- [x] T1.5 门禁登记：无 bin、无 `#!` 源（entrypoints 免分类）；F6 三处例外落地（workspaceRange、constraints 仓库 URL 规则、tsconfig.base.json 手写 paths alias）
- [x] T1.6 门禁绿：`build:artifacts` + `build:check` + `typecheck` + `lint` + `hygiene`（23 gates）全过

**出口**：`dsh --profile tui "hello"` 可启动、可渲染、错误映射正确；流式回答验证待密钥。

### Phase 2 — 渲染层与交互闭环（2–4 天）
- [x] T2.1 布局：会话滚动区（ScrollBox + sticky 跟随）/ 输入区（InputRenderable）/ 状态栏（模型、running/idle、键位提示）
- [x] T2.2 流式渲染：text-delta + reasoning-delta（`[thinking]` 分节）；回合错误/中止显示为 `[error]`/`[aborted]` 行
- [x] T2.3 工具卡片：`tool/call` + `tool/result` 按 callId 关联，`> tool …` / `ok|err tool …` 单行卡
- [x] T2.4 回合状态：turn/start/end → 状态栏 running/idle
- [x] T2.5 审批弹层 + `approval/request` 应答者（a/r/Esc/方向键/Enter；sandbox 升级请求实测弹出）
- [x] T2.6 提问弹层 + `user-questions/request` 应答者（选项/多选/自定义文本 i 模式/Esc 跳过）
- [x] T2.7 输入回灌：Enter followup、Ctrl+J steer、运行中 Esc/Ctrl+C 取消回合、空闲 Ctrl+C 退出
- [x] Demo 跑通（mock LLM + expect 驱动）：启动 → 思考/文本流式 → 工具卡 → 审批弹层 → 允许 → 工具执行 → 续答 → 干净退出，5/5 标记通过

**出口达成**：`dsh --profile tui` 可交互完成完整 demo 使用。

### Phase 3 — 会话与配置（按 [dsh-tui-ccch-reference](dsh-tui-ccch-reference.md) 优化；2–3 天）
- [x] T3.1 会话管理：`/resume` 列表（`sessionQuery.listSessions` + 标题快照，最新优先，live/current 标记）+ 切换/恢复；`--resume <id>`；`/new` 新会话（切换时先取消+静默+flush 旧 Agent）
- [x] T3.2 模型与力度：`/model` 显示路由/力度/会话/工作区；`/effort` 循环 off→low→high→max（`agent.model.select`，作用于下一请求）
- [x] T3.3 权限模式：Shift+Tab 循环 `permissionPresets` 目录预设（fallback ask/never），状态栏与输入框边框反馈
- [x] T3.4 状态栏指标：`tokenMeter.contextPressure` 的上下文用量（turn/end 刷新）
- [x] T3.5 任务完成通知：回合完成（completed）发 OSC 9，`/settings` 可关（`taskNotifications` 语义）
- [x] T3.6 转录完善：thinking 落定折叠 ✅、工具卡渲染 ✅（P2.5 修复）、`/tools` 全量详情（args/result）、markdown-lite（代码块/行内码/粗体/标题）
- [x] T3.7 键位基线：Ctrl+Enter 打断并发送、Alt+Up 历史、双 Ctrl+C 退出、`?` 帮助、Ctrl+U/Ctrl+W 删行/删词
- [x] T3.8 locale（en / zh-Hans，locale.ts 字典 + `t()`）+ `/settings`（语言 l、通知 n，持久化 `$DSH_HOME/hyperai-tui/settings.json`）
- [x] T3.9 优雅退出：`/exit` 或双 Ctrl+C → 取消回合 → whenIdle → flush → 终端恢复 → exit 0

**出口达成**：基础完整体验（会话/模型/力度/权限/指标/通知/双语/键位/退出）。demo 回归 5/5。

> 排除出 P3（按参照项目分层挪后）：Launchpad/向导、时间轴轨、侧边面板、diff 工具卡、图片/Mermaid/LaTeX、鼠标、goals/todos 面板、rewind/fork、历史搜索、迁移工具、多后端。

### Phase 4 — 质量与交付（1–2 天）
- [x] T4.1 单元测试（`apps/tui/tests/*.spec.ts`，26 项）：转录折叠、renderLine/Markdown/工具详情、PromptHistory（持久化/草稿/上限/脏文件）、locale 设置（切换/持久化/容错）、banner
- [x] T4.2 无密钥场景自动化（`apps/tui/tests/tui-demo.expected.e2e.ts`，`test:expected` 层）：mock 服务 + node-pty 驱动完整 demo（流式 → 工具卡 → 审批弹层 → 执行 → 双 Ctrl+C 退出）；answerer 的委派分支由该 e2e 过真实 seam 覆盖（认领/放行），abort/unowned 分支为两行委托逻辑不单测。`snapshots/tui/` 顶层场景推迟：需要 `dsh-session-snapshot` 的 TUI 帧适配器（记录/回放驱动按键 + 捕获帧），另立后续项
- [x] T4.3 覆盖率登记豁免：门禁 `include: ['packages/*/*/src/**']` 按上游设计只圈 packages（"application/config fixtures are out of scope"），`apps/*` 不在 per-file 100% 范围；apps/tui 的质量由 `pnpm run test`（单测 26 项）+ `test:expected`（e2e）+ lint/typecheck 保障
- [x] T4.4 README 契约 + Model Experience 节维护
- [ ] T4.5 预推送检查（dsh-pre-push-checks）+ PR（dsh-pr-description）——**待用户授权提交**

## 5. 发现项（Phase 1 前先查清）

| # | 问题 | 落点 | 结论 |
|---|---|---|---|
| F1 | shipped profile 模板的注册机制 | `packages/util/official-bundles/src/bundles.ts` 的 `PROFILE_TEMPLATES` | ✅ 已加 `tui` 条目；bundle 须为 `apps/cli` 的运行时依赖 |
| F2 | bundle 可否自带 `dsh.bundle` 留在 apps/ | headless 同构验证 | ✅ 可以；`apps/tui` 自带 patch，profile 模板引用包名 |
| F3 | `verify-application-entrypoints` 分类要求 | 仅 `#!` 开头的可执行源需登记 | ✅ 免登记（无 shebang、无 bin） |
| F4 | OpenTUI 原生模块安装 | macOS arm64 通过；**需 Node ≥26.4**（FFI） | ✅ 工具链定 Node 26.x |
| F5 | OpenTUI 独占 tty 与日志分工 | `dsh:` 诊断在 alt-screen 退出后落在 stderr，可见 | ✅ 错误走 stderr + 退出码 |
| F6 | `@hyperai/*` 命名门禁例外 | 三处：`workspaceRange()`、`check-workspace-constraints` 仓库 URL 规则、`tsconfig.base.json` 手写 paths alias；包清单补 `publishConfig.public` + 非 private | ✅ 已落地 |

## 6. 风险

| 风险 | 缓解 |
|---|---|
| React 18 vs `@opentui/react` ≥19.2 冲突（D1） | 推荐 `@opentui/core` 直写；若坚持 React 渲染器，需为类型声明规则开例外并评估双 React |
| OpenTUI 原生 ABI / 安装链路失败 | Phase 0 spike 先行；失败则回退评估其它 TUI 库 |
| tty 接管污染日志/退出挂起 | 诊断走文件或 TUI 内面板；退出统一走 launcher 受控 exit（F5） |
| 审批/提问缺应答者 fail-closed | answerer 与 runtime 同包同 patch 挂载，boot 即校验 |
| upstream 快速演进合并冲突 | 插件边界最小化，能力只经 seam；分支及时 merge-forward |
| 人类可见输出无快照回归 | Phase 4 起建 `snapshots/tui/` |

## 7. 里程碑总览

| 阶段 | 工作量 | 出口 |
|---|---|---|
| P0 地基 | 0.5–1 天 | D1/D2 拍板，OpenTUI 可渲染 |
| P1 骨架 | 1–2 天 | `dsh --profile tui` 流式问答可跑 |
| P2 交互 | 2–4 天 | 多轮 + 工具卡 + 审批/提问 |
| P3 会话配置 | 1–2 天 | 可日常使用 |
| P4 质量交付 | 1–2 天 | 测试/快照/文档/PR |

合计约 **6–11 天**（单人，视 D1 选型与 F 项发现浮动）。
