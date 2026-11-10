# RFC-003 证据说明

RFC-003（beta.2 修复）的验证证据。被验证对象：

| 项 | 值 |
|---|---|
| 安装包 | `hyperai-harness-0.2.0-beta.2.tar.gz` |
| 大小 | 18 461 924 字节 |
| sha256 | `5e393a5020c471724e36783f56cfc4e46d8933114e4afc0aaef8ae0ccf762ada` |
| 构建 commit | `7dc323d35a7824b1ba715248cfd654559553a881` |

## 文件索引

| 文件 | 对应 |
|---|---|
| `t2-builds.txt` | T2：同 commit 两次构建的 sha256 |
| `macos/t1-tests.log` | T1：四个测试入口的输出 |
| `macos/t3-install.log`、`macos/t3-dump.*`、`macos/t3-startup.screen.txt` | T3：解压到 `/tmp`（符号链接）后安装、启动、铭牌 |
| `ubuntu/t3-install.log`、`ubuntu/t3-dump.*`、`ubuntu/t3-startup.txt` | T3：Ubuntu 上自建符号链接目录后安装、启动、铭牌 |
| `macos/t4-install.log` | T4：外来 profile 导致安装失败，以非 0 退出，不打印“安装完成” |
| `macos/t5-doctor.log`、`ubuntu/t5-doctor.log` | T5：干净环境照抄说明的 `doctor`，返回 OK，无补丁警告 |
| `macos/t6-install-beta1.log`、`t6-install-beta2.log`、`t6-startup.screen.txt`；`ubuntu/t6-*` | T6：先装 beta.1（含假 provider 与偏好），再用 beta.2 覆盖，数据保留、铭牌为 beta.2 |
| `runs-summary.txt` | 两个平台每项检查的实际输出 |

## 脱敏

- 本机绝对路径替换成 `$HOME`、`$REPO`、`$BETA_ROOT`、`$T3_ROOT`，主机名替换成 `$HOST`；测试服务器地址、账号和口令不在证据里。
- 没有提交任何 `/skills` 列表或 Skills 内容的截取；日志里只出现安装脚本的 `ppt-generation` 提示（技能名，不是内部仓库文本）。
