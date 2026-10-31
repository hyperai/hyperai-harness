# 落地路线图与风险

目标：在 dsh（`0.2.2-alpha.2` fork）上交付 HyperAI TUI。设计见 [integration-design.md](integration-design.md)，操作见 [development-guide.md](development-guide.md)。

## 1. 执行进度与剩余路线

> 实际执行采用 [development-plan.md](development-plan.md) 的 P0–P4 划分（与本文件早期草拟的"阶段 0–3"不同，已按实际对齐）。**P0–P4 全部完成**；本节记录达成情况与剩余项。

| 阶段 | 状态 | 达成 |
|---|---|---|
| P0 地基 | ✅ | OpenTUI `@opentui/core` 选型与 Node ≥26.4 验证、工具链（Node 26 + pnpm）、键位表 |
| P1 骨架 | ✅ | `apps/tui` 包 + `tui` profile + `tui-startup`/`tui-runtime`、门禁接线（F1–F6 全解决）、最小流式闭环 |
| P2 交互 | ✅ | 流式渲染、工具卡、审批/提问弹层、输入回灌；demo 5/5 |
| P2.5 UI | ✅ | HyperAI 主题（配色 token/横幅/布局/命令弹层/历史）；修复视口裁剪与 thinking 落定两个渲染 bug |
| P3 会话配置 | ✅ | 会话管理、模型/力度、权限预设、指标、OSC 9 通知、markdown-lite、键位完善、中英 locale、优雅退出 |
| 模型配置 | ✅ | HyperAI OpenAI-compatible 供应商（pi-ai 路由）+ `.env` 安全纪律，真实端点验证通过 |
| P4 质量 | ✅（T4.5 待授权） | 单测 26 项、无密钥 e2e（mock + node-pty）、覆盖率豁免登记、README 契约；提交/PR 等待用户授权 |

### 剩余项

- **T4.5 交付**：提交 `hyperai-tui` 分支 + PR（dsh-pr-description 规范），待用户授权。
- **`snapshots/tui/` 顶层快照**：需为 `dsh-session-snapshot` 编写 TUI 帧适配器（记录/回放按键 + 捕获帧）；当前无密钥场景在 `test:expected` 层。
- **v2 体验**（对照 [dsh-tui-ccch-reference.md](dsh-tui-ccch-reference.md) 分层）：Launchpad/向导、时间轴、侧边面板、diff 工具卡、图片/Mermaid/LaTeX、鼠标、goals/todos 面板、rewind/fork、历史搜索、费用估算、多行草稿、思考/工具卡展开。

## 2. 风险清单

| 风险 | 影响 | 缓解 |
|---|---|---|
| OpenTUI 原生模块与 Node ≥ 24.9 / pnpm / 三平台 ABI 不兼容 | 安装/启动失败 | 阶段 0 即验证三平台安装；`pnpm run hygiene` 门禁；必要时 vendor 预编译产物 |
| upstream 快速演进（developer preview，破坏性变更多） | 合并冲突、API 失效 | 保持包名与插件边界最小；能力只经 seam 取用，不 fork 内部实现 |
| TUI 接管 tty 与 dsh 日志/stderr 冲突 | 输出污染、退出挂起 | 诊断改写文件或 TUI 面板；退出路径走 launcher 的受控 exit |
| 审批/提问无 answerer 时 fail-closed | 功能"卡死" | answerer 与 runtime 同 bundle 挂载；启动即校验 |
| 人类可见输出无快照覆盖 | 回归不可见 | 阶段 3 起补 `snapshots/tui/`，规划先行 |
| SDK 协议面缺口（路径 B 依赖） | 原型能力受限 | 原型只用已暴露面；缺口回改 dsh 协议并同步 SDK 期望输出 |
| 双路径渲染组件漂移 | 重复实现 | 视图模型接口固定，渲染层单实现 |
| 许可证/品牌 | 发布合规 | OpenTUI MIT；品牌规范见 `BRAND_GUIDELINES.md`，文案 locale-owned |

## 3. 决策记录（本目录内）

1. **TUI 以 `dsh` profile 形式交付**，不做独立 bin（应用启动规则）。
2. **能力复用 dsh seam**，不另起 agent 栈（DeepSeek-TUI 教训，见其参考文档 §5）。
3. **UI 库选 OpenTUI + React**；ratatui/DeepSeek-TUI 仅作 UX 参考。
4. **主交付走进程内插件（A）**，SDK 子进程（B）用于原型与嵌入形态。
5. 包名默认保持 `@deepseek-ai/dsh-tui-*`，除非明确长期分叉。
