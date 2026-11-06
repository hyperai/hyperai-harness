# RFC-004 证据说明

OpenBayes Skill 与 `/openbayes` 命令的验证证据。被验证的安装包：

| 项 | 值 |
|---|---|
| 文件 | `hyperai-harness-0.2.0-beta.3.tar.gz` |
| 大小 | 18 474 512 字节 |
| sha256 | `cc219d5d96b455def35fbd291b3851069401b30b09542870fbec44a174f1574d` |
| 构建 commit | `283cd7f7007ebc0e3d5a942bbd025a236573f572` |

## 文件索引

| 文件 | 对应 |
|---|---|
| `*/o1-install.log` | O1：全新安装，安装日志里出现 `openbayes-user: 已安装 v0.38.1` |
| `*/o2.screen.txt` | O2：`/skills` 同时列出 `openbayes-user` 与 `ppt-generation` |
| `*/o3-reinstall.log` | O3：重复安装时 `已有 v0.38.1，保留不动` |
| `*/o4-download-failure.log` | O4：openbayes.com 不可达时安装继续，输出中文警告与手动安装命令 |
| `*/o5.screen.txt` | O5：删除 skill 目录后 `/openbayes login` 给出中文提示与手动安装方法 |
| `*/o6.screen.txt` | O6：未登录时 `/openbayes status` 显示未登录并提示 `/openbayes login` |
| `macos/o7-login-url.txt`、`macos/o7-exchange.log` | O7：`/openbayes login` 生成的授权链接与兑换结果（设备名已替换成 `$HOST`；不含一次性码与令牌） |
| `macos/o8.screen.txt` | O8：登录后 `/openbayes status` 显示用户名、到期时间、状态有效（用户名已打码为 `<负责人账号>`） |
| `macos/o10.screen.txt`、`ubuntu/o10.screen.txt` | O10：错误的一次性码，中文提示重新登录 |
| `macos/o11.screen.txt` | O11：退出确认后删除本地 session，并给出吊销令牌的链接 |
| `*/o13-uninstall.log` | O13：卸载后 `~/.agents/skills/openbayes-user/` 保留，并说明如何手动删除 |
| `*/o14-*.log`、`*/o14.screen.txt` | O14：从 beta.2 覆盖升级，用户数据保留，铭牌为 beta.3 |
| `*/final-install.log`、`*/final-startup.screen.txt` | 最终安装包在 macOS 与 Ubuntu 上的安装与启动复查 |
| `runs-summary.txt` | 两个平台的实际输出摘要 |

## 脱敏

- 负责人账号名替换成 `<负责人账号>`，设备名替换成 `$HOST`，本机与服务器路径替换成 `$HOME` / `$REPO` / `$BETA_ROOT`。
- 没有提交一次性码、令牌内容或 session 文件内容（只通过 `ls` 确认文件存在性）。
- 授权链接里的 `code_challenge` 是公开的 PKCE challenge，不是令牌；对应的 pending 已过期/被消费。
