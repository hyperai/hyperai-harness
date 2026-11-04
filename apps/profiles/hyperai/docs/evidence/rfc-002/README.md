# RFC-002 证据说明

本目录是 RFC-002（HyperAI Harness 内测安装包 v0.2.0-beta.1）的验证证据，两个平台各一套。被验证的安装包是**验收反馈修复后**的版本：

| 项 | 值 |
|---|---|
| 文件 | `hyperai-harness-0.2.0-beta.1.tar.gz` |
| 大小 | 18 460 863 字节 |
| sha256 | `39e6e0c36c4bc9117c2555ddee7d6fd0ae846adaba1edd6ba54ba0b2e7339b74` |
| 构建 commit | `1ef6237a741d969840bcc1383b5ca6a16cb7a402` |
| TUI 成品包 sha256 | `01cfb379faac473c2edd5e70b140c63fdcadb90372454e321dd92ed6f5da9b3c`（3296 个文件） |
| Skills 快照 | `hyperai-skills@34f0a1be0cb3ae9905aecebba13efae6a8657be1`（`feat/ppt-generation-upstream`，2 个 Skill，27 个文件） |

## 环境

| 平台 | OS | Node | 安装方式 |
|---|---|---|---|
| macOS | macOS 26.1（25B78），arm64 | 系统 v26.9.0 | 全新临时 `HOME` + `DSH_HOME` |
| Ubuntu | Ubuntu 20.04.6 LTS，x86_64 | 系统 v18.20.4（E1 用）；用户目录 v22.23.4（其余检查） | 普通用户 `hyperai-beta`，Node 22 装在 `$HOME/node` |

两个平台都使用安装包自带的 dsh `0.2.0-rc.2` 与 pnpm `10.28.1`（装在 `~/.hyperai/runtime`）。

Ubuntu 的安装步骤使用 `HYPERAI_NPM_REGISTRY=https://registry.npmmirror.com`：执行时 npm 官方源在该测试服务器上极慢（单个 tarball 90–150 秒，`npm install` 45 分钟没有进展），换镜像后 2 分钟内完成。这是安装器支持的镜像路径，也是本次的环境事实；macOS 使用官方源。

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

验证脚本不在仓库里（依赖真实 PTY，属于一次性测试工具）；本目录保留它们的产物：PTY 录制回放后的屏幕文本、`dsh --profile hyperai --dump-config` 的完整输出、安装日志。

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
| `macos/upgrade-old.log`、`upgrade-new.log`、`upgrade-cordis.after.yml` | 从旧版（补丁方式）覆盖升级：旧补丁被删除、provider 保留、bundle 名更新 |
| `*/install-e10.log` | E10：已存在的其它 dsh 未被改动 |
| `*/uninstall.json` | E9：卸载归档路径、启动命令清理（两平台都按文档直接执行，未设 `HYPERAI_DIST_ROOT`） |
| `brand-pixel-check.json` | E3 的像素统计：整帧与 splash 区域两个口径 |
| `runs-summary.txt` | 两个平台每项检查的实际输出（含退出码） |
| `ubuntu/session-files.txt` | Ubuntu 上真实产生的会话文件清单 |

## 脱敏与取舍

- 所有文本证据里的本机绝对路径已替换成 `$HOME`、`$REPO`、`$BETA_ROOT`，主机名替换成 `$HOST`；测试服务器地址、账号和口令不在任何证据里。
- `*/pty/skills.screen.txt` 第 30、32 行原来的 Skills description 属于公司内部仓库内容，已替换成 `<描述已移除：内部仓库内容>`；技能名本身保留，仍能证明 `/skills` 能发现它们。
- 屏幕截图（PNG）没有提交：像素图无法逐像素脱敏，画面里的工作目录会暴露本机路径。改为提交同样内容的屏幕文本（`*.screen.txt`），并用 `brand-pixel-check.json` 记录品牌色像素统计。
- `brand-pixel-check.json` 给出两个口径：`pinkPixelsFullFrame`（整帧 1080×720，两平台都是 **40 176**）和 `pinkPixelsSplashRegion`（画面顶部 36% 的 splash 区域，两平台都是 21 699）。早期版本只写了一个没有标注区域的 21 699，容易被误读成整帧数字。
- `E11`（真实模型轮次 + 用 `ppt-generation` 生成 `.pptx`）由验收 agent 在两平台实测通过，证据在验收报告里，不在本目录。
