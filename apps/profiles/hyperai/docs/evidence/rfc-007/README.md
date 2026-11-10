# RFC-007 证据说明

安装场景识别与升级验证的证据。被验证的安装包：

| 项 | 值 |
|---|---|
| 文件 | `hyperai-harness-0.2.0-beta.5.tar.gz` |
| 大小 | 18 478 298 字节 |
| sha256 | `f11393d4523628bc4f745c4c06cc195c3dcb22eaef0d07846578aa78bc9694b6` |
| 构建 commit | `e444df1c3559822202493a278d199eb00ff41e0b` |

## 文件索引

| 文件 | 对应 |
|---|---|
| `*/s1-install.log`、`*/s1-startup.txt` | S1：全新安装的识别、完成总结、首次配置提示、铭牌 |
| `macos/s2-*`、`ubuntu/s2-*` | S2：beta.1 → beta.5 的识别/总结、7 类数据快照（before/after） |
| `macos/s3-*`、`ubuntu/s3-*` | S3：beta.4 → beta.5，同上 |
| `macos/s4-data2.log` | S4：beta.5 → beta.5 重新安装 |
| `macos/s5-refuse.log`、`s5-final-refuse.log`、`s5-allow3.log` | S5：降级默认拒绝（零写入）、加 `--allow-downgrade` 后继续 |
| `macos/s6.log` | S6：上次安装未完成，修复后状态 completed |
| `macos/s7-fresh.log`、`s7-installed.log` | S7：全新/已安装环境下的 `--dry-run` |
| `macos/scenario-*.log` | 版本未知、卸载过、非本安装器目录三种场景的实际输出 |

## 脱敏

- 测试路径替换成 `$HOME` / `$BETA_ROOT`，测试用户名替换成「测试用户」；没有提交假 API key 的值、令牌或一次性码。
- 没有提交 `/skills` 列表截屏或内部 Skills 描述。
