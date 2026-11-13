# HyperAI Harness 发布流程

1. **改版本号**：`apps/tui/package.json`、`apps/tui/src/brand.json` 引用处、`apps/profiles/hyperai` 文档与测试里的旧版本号统一改成新版本，例如 `0.2.0-beta.2.2`。
2. **构建两次**：
   ```sh
   node apps/profiles/hyperai/scripts/build-beta.mjs --upstream <dsh-tui-0.16.1.tgz>
   node apps/profiles/hyperai/scripts/build-beta.mjs --upstream <dsh-tui-0.16.1.tgz> --out /tmp/dist-check
   ```
   两个 `dist/hyperai-harness-<版本>.tar.gz.sha256` 必须一致。
3. **创建 tag 和 Release**：在 `hyperai/hyperai-harness` 上创建 tag `v<版本>` 和 Release；prerelease 也照常创建（不要依赖 `/releases/latest`，客户端读取 Release 列表）。
4. **上传两个附件**：
   - `hyperai-harness-<版本>.tar.gz`
   - `hyperai-harness-<版本>.tar.gz.sha256`
   缺一个客户端就会忽略该 Release。
5. **验证**：在一台装着旧版本的电脑上启动，确认 TUI 出现新版本提示；运行 `hyperai update --check`，再运行 `hyperai update`，确认升级后铭牌为新版本、7 类用户数据不变。
6. **不要**把测试用的 `HYPERAI_UPDATE_BASE_URL`、假 Release 或本地包发到正式仓库。
