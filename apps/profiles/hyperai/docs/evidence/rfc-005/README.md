# RFC-005 证据说明

四个 beta.3 遗留修复的验证证据。被验证的安装包：

| 项 | 值 |
|---|---|
| 文件 | `hyperai-harness-0.2.0-beta.4.tar.gz` |
| 大小 | 18 474 567 字节 |
| sha256 | `795f21aeeec83c61fc231deb13450070841a8275171128e171ad0e631226e30b` |
| 构建 commit | `9ec5f6633a903b0bb6bbfdded8b057dad2c1eab9` |

## 文件索引

| 文件 | 对应 |
|---|---|
| `*/install.log` | T3 的环境准备：beta.4 全新安装成功 |
| `macos/t3-input.screen.txt`、`ubuntu/t3-input.screen.txt` | T3：粘贴假码后输入框只显示 `•`，屏幕没有明文 |
| `macos/t3-submit.screen.txt`、`ubuntu/t3-submit.screen.txt` | T3：提交后得到「一次性码无效或已过期」的中文提示 |
| `macos/t4-upstream-input.screen.txt` | T4：`/provider` 自定义流程的上游文本输入仍然明文显示（`visible-plain-123`） |
| `*/t5-failure.log` | T5：外来 profile 导致安装失败，中文说明原因与处理办法，exit 非 0，没有打印「安装完成」 |
| `macos/t6-profile-alt.log` | T6：`--profile alt` 安装成功，结果检查没有误报 |
| `*/t7-beta3.log`、`t7-beta4.log`、`t7-doctor.log` | T7：从 beta.3 覆盖升级，provider/语言/会话保留，openbayes-user 仍在，doctor OK |
| `*/t7-startup.screen.txt` | T7：升级后铭牌 `hyperai-tui v0.2.0-beta.4 · dsh-tui v0.16.1` |

## 脱敏

- 测试服务器路径替换成 `$HOME` / `$BETA_ROOT`，测试用户名替换成「测试用户」，设备名替换成 `$HOST`。
- 没有提交 `/skills` 列表截取、内部 Skills 描述、令牌或一次性码（T3 的假码也没有出现在证据里）。
