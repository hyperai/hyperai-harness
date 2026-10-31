# dsh-TUI（ccch1mneyyy）参考：功能特点整理

> 项目：<https://github.com/ccch1mneyyy/dsh-TUI>（npm `@deepseek-harness-tui/dsh-tui`，6.2k stars，DSH 官方首推社区 TUI 插件）
> 技术栈：Ink（React for terminal）+ DSH 插件/adapter 模式，与我们的 OpenTUI 路线不同；**交互与功能设计可借鉴，渲染代码不可移植**。
> 用途：作为 HyperAI TUI 的功能清单与 P3+ 排期依据。徽标/文案/IP 形象一律替换为 HyperAI 品牌。

## 1. 产品形态

- **安装**：`npm install -g @deepseek-ai/dsh @deepseek-harness-tui/dsh-tui`，`dsh-tui` / `dst` 一键启动；Windows 离线安装器；`dsh plugin add` 手动路径。
- **架构定位**：out-of-tree bundle 骑在 dsh-base 上（与我们的方案 A 同构）；声明"零核心修改，只消费 DSH 公开导出"；卸载不留补丁。
- **多后端（实验）**：DSH kernel 之外可切 Claude Agent SDK / Codex app-server 后端，同一 UI 驱动；`/kernel` 切换需重启会话。
- **自动化 CLI**：`dst -p "task"`、`dst run --json`、`dst session list --json`（独立引擎，不加载 TUI）。
- **自维护**：`/update` 一键升级并续接当前会话；`dsh-tui doctor` / `safe` 诊断与救援 profile。

## 2. 核心界面能力（对我们 P3/P4 的直接参照）

| 能力 | 它的做法 | 对我们的意义 |
|---|---|---|
| 启动引导 | Launchpad 落地页（大输入框+快捷操作）+ 首次运行四步向导（API key/语言主题/模型工作区/快捷键），`/setup` 重跑 | P4 体验项；v1 用欢迎横幅即可 |
| 会话管理 | 一个会话管理器：`/resume /home /agentview /bg`，项目内会话列表、搜索、工作区栏 | **P3 核心**：`/resume` 列表 + `/new` |
| 会话工作流 | `/new /compact /export /btw`，模型热切换、fork、**双击 Esc 时间回退（rewind）**、vim、全屏草稿编辑器 | P3：new/compact；rewind/fork 列 v2 |
| 工具卡 | 折叠单行 + `/details`（Ctrl+O）展开全卡；**split diff 卡**（单边增删全宽、普通编辑左右分栏） | P3：折叠行修完后做展开 overlay（/tools 已有雏形） |
| 思考显示 | 流式 `✦ thinking` 动画行，落定折叠为一行摘要，全文进 trajectory | 已实现（待修 settle bug） |
| Markdown/图表 | 流式 Markdown、Mermaid Unicode 图、LaTeX 公式（Unicode 或图片渲染） | P4：markdown-lite 优先 |
| 图片 | Kitty/Sixel 缩略图、居中预览缩放平移、@path 引用、粘贴适配 | v2 |
| 实时状态 | 活动动画、**上下文进度条**、TPS 仪表、缓存命中率、effort、token、会话费用估算（含 subagent）、Git/会话元数据 | **P3**：状态栏扩充（token-meter/费用） |
| 时间轴轨 | 每回合可点击 timeline / 滚动条 | v2 |
| 侧边面板 | Ctrl+B 分栏，8 个内置面板 + 插件面板，拖拽调宽；todo 面板 Ctrl+Q 折叠 | v2 |
| 目标/待办 | goal dock 条、todo 面板、完成自动隐藏 | v2（dsh `ctx.goals`/`ctx.todo` seam 已备） |
| 任务完成通知 | OSC 9/777/99、BEL、Windows toast；`/settings` 三态（unfocused/always/off）；回复单行预览 | **P3 轻量版**（BEL/OSC9 即可） |
| 原生光标 | 输入框继承终端光标形态/闪烁；选择器 0.5s 静止隐藏 | v2 |
| 鼠标 | 选择/复制、分栏拖拽、点击路径、时间轴点击 | v2 |
| 键位 | Enter 发送 · Tab 补全 · Ctrl+Enter 打断并发送 · Alt+Up 历史 · Esc 层级关闭/打断 · 双击 Esc 回退 · Ctrl+B/O/R/V/E · `?` 帮助 · ← 会话管理器 | **P3 键位基线**（对齐其约定） |
| 输入编辑 | readline 级（Ctrl+U/W/词移动）、多行草稿、`/` 与 `@` 补全、`#L12-14` 行域引用、历史搜索（Ctrl+R，按项目作用域） | P3：readline 基本集；补全 v2 |
| 设置 | `/settings` 分页（General + 插件页签）；TUI 设置存 `~/.dsh-tui/settings.json` | P4：主题/通知/键位配置 |
| 国际化 | zh/en UI | P3 locale |

## 3. 工程特点（值得学的非功能项）

- **长会话工程**：事件驱动投影、虚拟化渲染、有界缓存（我们转录折叠已有雏形，长会话需补虚拟化）。
- **兼容矩阵**：明示主目标 DSH `0.2.1-rc.3` 与旧版兼容路径；host 能力缺失时优雅降级为提示。
- **状态协议**：OSC 7501 报告 idle/working/blocked/done/error，终端/收件箱可集成。
- **迁移工具**：`dsh-tui migrate` 导入 Claude Code/Codex/OMP 等历史进 DSH 会话存储（幂等、结构保留）。
- **可访问性/终端适配**：窄终端降级布局、tmux passthrough 说明、纯文本回退。
- **安全**：只读迁移、凭证走 DSH credential store、显式按键语义（Esc 先关层再打断）。

## 4. 与我们现状的差距分层

- **P3 应吸收**（基础完整体验）：会话管理、模型/力度、状态栏指标、完成通知（轻量）、键位基线对齐、locale、markdown-lite。
- **P4/体验**：Launchpad/向导、设置页、diff 工具卡、时间轴、历史搜索。
- **v2+**：侧边面板、图片、Mermaid/LaTeX、鼠标、goals/todos 面板、rewind/fork、迁移工具、多后端。
- **不做/改名**：像素鲸鱼 IP、其品牌文案 → 全部替换为 HyperAI；Claude/Codex 后端与迁移工具视产品需要再评估（我们的定位是 HyperAI TUI，非多后端通用壳）。
