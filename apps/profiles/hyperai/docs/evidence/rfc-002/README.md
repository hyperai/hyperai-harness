# RFC-002 证据说明

本目录是 RFC-002（HyperAI Harness 内测安装包 v0.2.0-beta.1）的验证证据，两个平台各一套。被验证的安装包：

| 项 | 值 |
|---|---|
| 文件 | `hyperai-harness-0.2.0-beta.1.tar.gz` |
| 大小 | 18 459 942 字节 |
| sha256 | `60fd3d7e4d654d4c266febd01d53b48b293515025de1363b097a04edd9a4513f` |
| 构建 commit | `8cee5aeb92fbe4a44062627687a608c6f560539a` |
| TUI 成品包 sha256 | `ae43b7f50ce9e54cd5e7e17544d2c807f71a26c980a4214d29f6290e3562ad68`（3296 个文件） |
| Skills 快照 | `hyperai-skills@34f0a1be0cb3ae9905aecebba13efae6a8657be1`（`feat/ppt-generation-upstream`，2 个 Skill，27 个文件） |

## 环境

| 平台 | OS | Node | 安装方式 |
|---|---|---|---|
| macOS | macOS 26.1（25B78），arm64 | 系统 v26.9.0 | 全新临时 `HOME` + `DSH_HOME` |
| Ubuntu | Ubuntu 20.04.6 LTS，x86_64 | 系统 v18.20.4（E1 用）；用户目录 v22.23.4（其余检查） | 普通用户 `hyperai-beta`，Node 22 装在 `$HOME/node` |

两个平台都使用安装包自带的 dsh `0.2.0-rc.2` 与 pnpm `10.28.1`（装在 `~/.hyperai/runtime`）。

## 复现命令

```sh
# 构建（开发机，需要能访问 npm registry 与 hyperai-skills 仓库）
cd apps/profiles/hyperai
node scripts/build-beta.mjs            # -> dist/hyperai-harness-0.2.0-beta.1.tar.gz(.sha256)

# 安装（任意机器）
shasum -a 256 -c hyperai-harness-0.2.0-beta.1.tar.gz.sha256   # Ubuntu: sha256sum -c
tar xzf hyperai-harness-0.2.0-beta.1.tar.gz
cd hyperai-harness-0.2.0-beta.1
./install.sh
```

验证脚本不在仓库里（它们依赖真实 PTY，且属于一次性测试工具），执行步骤与产物在本目录可见：截图文本来自 PTY 录制后回放成屏幕，`dump-config.txt` 是 `dsh --profile hyperai --dump-config` 的完整输出。

## 文件索引

| 文件 | 对应检查 |
|---|---|
| `macos/e1-node18.log`、`ubuntu/e1-node18.log` | E1：Node 版本不满足时拒绝安装、不写文件（macOS 用 shim 模拟 Node 18，Ubuntu 用真实系统 Node 18） |
| `*/install.log` | E2：全新环境安装成功的完整日志（带 ISO 时间戳） |
| `*/pty/startup.screen.txt` | E3/E4：启动画面（粉色像素字、无鲸鱼）与版本铭牌 |
| `*/dump-config.txt`、`*.err` | E5：`@hyperai/hyperai-tui` bundle、`skill-filesystem`、无跳过、stderr 为空 |
| `*/pty/update.screen.txt`、`provider.screen.txt`、`model.screen.txt` | E6：`/update` 禁用提示、`/provider`、`/model` 能打开 |
| `*/pty/skills.screen.txt` | E7：`/skills` 列出 `ppt-generation` 与 `example-verified-skill` |
| `*/install-e8.log`、`*/cordis.after.yml`、`*/settings.after.json`、`macos/session-index.*.json` | E8：第二次安装后用户数据保留 |
| `*/install-e10.log` | E10：已存在的其它 dsh 未被改动 |
| `*/uninstall.json` | E9：卸载归档路径、启动命令清理 |
| `brand-pixel-check.json` | E3 的像素统计：splash 区域只有 `#FF6096` 与背景色 |
| `runs-summary.txt` | 两个平台每项检查的实际输出（含退出码） |
| `ubuntu/session-files.txt` | E7/E8：Ubuntu 上真实产生的会话文件清单 |

## 脱敏与取舍

- 所有文本证据里的本机绝对路径已替换成 `$HOME`、`$REPO`、`$BETA_ROOT`，主机名替换成 `$HOST`；测试服务器地址、账号和口令不在任何证据里。
- 屏幕截图（PNG）没有提交：像素图无法逐像素脱敏，画面里的工作目录会暴露本机路径。改为提交同样内容的屏幕文本（`*.screen.txt`），并用 `brand-pixel-check.json` 记录品牌色像素统计。
- `E11`（真实模型轮次 + 用 `ppt-generation` 生成 `.pptx`）需要测试用 API key，本次没有提供，按 RFC 标记为“未测”。
