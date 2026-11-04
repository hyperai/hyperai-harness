# HyperAI Harness 内测版使用说明（v0.2.0-beta.1）

这份说明写给第一次接触 HyperAI Harness 的同事。照着做就能装好，不需要 GitHub 权限，也不需要 clone 任何源码仓库。

HyperAI Harness 是带 HyperAI 品牌界面的 DeepSeek Harness：终端里启动后能看到粉色的 `HYPERAI HARNESS` 像素字，模型、会话、工具、Skills 都是 DSH 原生能力。

---

## 1. 前置条件

只需要 **Node.js**，版本要求 `^22.19 || >=24`（推荐 Node 24 LTS）。

macOS（Homebrew）：

```sh
brew install node@24
brew link --overwrite node@24
node -v
```

Ubuntu / Linux（nvm，装在当前用户目录，不动系统 Node）：

```sh
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
# 重新打开终端后
nvm install 24
nvm use 24
node -v
```

也可以从官网下载：<https://nodejs.org/zh-cn/download>。

其他依赖由 `install.sh` 自动处理：它会把固定版本的 `dsh@0.2.0-rc.2` 和 `pnpm@10.28.1` 装到 `~/.hyperai/runtime`，**不会覆盖或升级你机器上已有的 dsh / pnpm / Node**。

如果访问 npm 官方源很慢，可以换成镜像：

```sh
HYPERAI_NPM_REGISTRY=https://registry.npmmirror.com ./install.sh
```

---

## 2. 安装步骤

```sh
# 1) 校验安装包（macOS）
shasum -a 256 -c hyperai-harness-0.2.0-beta.1.tar.gz.sha256
# Ubuntu
sha256sum -c hyperai-harness-0.2.0-beta.1.tar.gz.sha256

# 2) 解压
tar xzf hyperai-harness-0.2.0-beta.1.tar.gz
cd hyperai-harness-0.2.0-beta.1

# 3) 安装
./install.sh
```

`install.sh` 会做四件事：检查 Node 版本、安装隔离的 dsh/pnpm、安装 `hyperai` profile（成品 TUI 包 + 内置 Skills）、生成启动命令 `~/.hyperai/bin/hyperai`。全程不访问 GitHub。

安装目录：

| 内容 | 位置 |
|---|---|
| 启动命令 | `~/.hyperai/bin/hyperai` |
| dsh / pnpm | `~/.hyperai/runtime/` |
| profile | `~/.dsh/profiles/hyperai/` |
| 界面偏好 | `~/.dsh-tui-hyperai/` |

如果 Node 版本不对，脚本会打印中文安装指引并退出，**不会写任何文件**。

---

## 3. 启动

```sh
~/.hyperai/bin/hyperai
```

想直接输入 `hyperai` 启动，把下面一行加进 `~/.zshrc` 或 `~/.bashrc`：

```sh
export PATH="$HOME/.hyperai/bin:$PATH"
```

进去以后看到粉色 `HYPERAI HARNESS` 像素字、右下角铭牌 `hyperai-tui v0.2.0-beta.1 · dsh-tui v0.16.1` 就说明装好了。

---

## 4. 首次配置模型

HyperAI 不预置任何模型服务，用 DSH 原生命令配置：

1. 输入 `/provider`：添加一个 OpenAI 兼容的服务（填路由名、Base URL、API key）；
2. 输入 `/model`：选择要用的模型。

API key 由 DSH 保存在 `~/.dsh/.credentials.yaml`（权限 0600），不会进入安装包，也不会写进日志。provider 和模型选择保存在 profile 的 `cordis.patch.yml` 与 `~/.dsh-tui-hyperai/model.json`，重新运行 `install.sh` 不会清掉。

---

## 5. 确认 Skills 已加载

内测版自带两个官方 Skills：`ppt-generation`、`example-verified-skill`。

三种确认方式，任选其一：

1. 在 TUI 里输入 `/skills`，列表里能看到 `ppt-generation`；
2. 直接问 Agent：「你有哪些 skills？」；
3. 看文件：

```sh
ls ~/.dsh/profiles/hyperai/skills/
cat ~/.dsh/profiles/hyperai/.hyperai-skills/manifest.json
```

`ppt-generation` 需要 Python 3 和 `python-pptx`（安装器不会自动装）：

```sh
python3 -m pip install python-pptx
```

---

## 6. 升级

拿到新安装包后重复第 2 节（校验、解压、`./install.sh`）。安装器是幂等的：

- 你的 provider/model 配置、API key、会话记录、`~/.dsh-tui-hyperai` 里的偏好都会保留；
- 被替换的受管文件会先备份到 `~/.dsh/profiles/hyperai/.hyperai-backups/<时间戳>/`；
- 旧版本的 `~/.hyperai/runtime` 会被新版覆盖，启动命令不变。

---

## 7. 卸载

用安装包里自带的 `manage.mjs`（需要保留解压后的安装包目录）：

```sh
# 归档用户数据并移除受管文件（保留会话/配置归档）
node profile/scripts/manage.mjs uninstall --yes

# 彻底删除 profile 目录（第二步）
node profile/scripts/manage.mjs uninstall --yes --purge
```

`uninstall` 会把 profile 里的 Skills、状态和用户文件归档到 `~/.dsh/profiles/.hyperai-uninstall-backups/`，同时删掉启动命令 `~/.hyperai/bin/hyperai`。

想连 dsh/pnpm 运行时一起清掉：

```sh
rm -rf ~/.hyperai
```

`~/.dsh/.credentials.yaml` 是 DSH 共享凭据，任何卸载命令都不会删它。

---

## 8. 已知问题与限制

- **平台**：只在 macOS（arm64）和 Ubuntu 20.04（x86_64）上验证过，其他平台未测。
- **Node 版本**：只支持 `^22.19 || >=24`；系统自带的 Node 18 会被拒绝（这是有意的）。
- **Skills 自动检查关闭**：内测版默认不自动检查 Skills 更新（同事一般没有内部 Skills 仓库权限）。手动 `/skills-update` 需要该仓库权限，失败时 TUI 会提示，不会刷屏报错。
- **`/update` 已禁用**：升级只走安装包，`/update` 会提示使用安装包流程。
- **上游更新**：内测版固定基于 `@deepseek-harness-tui/dsh-tui@0.16.1` 与 `dsh@0.2.0-rc.2`，不要自行升级这两个依赖。
- **`ppt-generation` 依赖**：需要 Python 3 + `python-pptx`，以及可用的模型服务。
- **首次启动**：没有配置 provider 时发消息会报 `no API key`，属于预期；先按第 4 节配置。
- **终端**：需要真实交互终端（iTerm2 / Terminal.app / gnome-terminal 等），不要在管道或 CI 里启动。

---

## 9. 反馈

遇到问题请反馈给：`<待负责人填写>`。

反馈时请附上：操作系统与版本、`node -v`、安装包文件名、报错截图或文本、以及 `~/.dsh/profiles/hyperai/.hyperai-install.json` 的内容（不含密钥）。
