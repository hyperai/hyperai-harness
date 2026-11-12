# HyperAI Harness 内测版使用说明（v0.2.0-beta.2.1）

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

### 2.1 获取安装包

从分发人处获取安装包和 `.sha256` 文件：`hyperai-harness-0.2.0-beta.2.1.tar.gz` 与 `hyperai-harness-0.2.0-beta.2.1.tar.gz.sha256`。

### 2.2 校验并解压

```sh
# 校验（macOS）
shasum -a 256 -c hyperai-harness-0.2.0-beta.2.1.tar.gz.sha256
# 校验（Ubuntu）
sha256sum -c hyperai-harness-0.2.0-beta.2.1.tar.gz.sha256

# 解压
tar xzf hyperai-harness-0.2.0-beta.2.1.tar.gz
cd hyperai-harness-0.2.0-beta.2.1
```

### 2.3 安装

两种方式，按你的网络情况选一种：

```sh
# 方式 A：官方源（默认）
./install.sh

# 方式 B：国内镜像（官方源慢或超时时用）
HYPERAI_NPM_REGISTRY=https://registry.npmmirror.com ./install.sh
```

**怎么选：**

- 在国内，或者前面用官方源下载很慢、报超时，就用**方式 B**；
- 网络访问 npm 官方源正常，用**方式 A** 即可。

**`install.sh` 默认使用官方源，不会自动切换到镜像**，选择权在你手里。安装过程会下载 dsh 与 pnpm（约 500 MB、500 多个包）：网络正常时几分钟，慢的时候可能十几分钟甚至更久；卡住不动就换方式 B 重跑（脚本是幂等的，可以重复执行）。

`install.sh` 会做四件事：检查 Node 版本、安装隔离的 dsh/pnpm、安装 `hyperai` profile（成品 TUI 包 + 内置 Skills）、生成启动命令 `~/.hyperai/bin/hyperai`。全程不访问 GitHub。

安装目录：

| 内容 | 位置 |
|---|---|
| 启动命令 | `~/.hyperai/bin/hyperai` |
| dsh / pnpm | `~/.hyperai/runtime/` |
| profile | `~/.hyperai/dsh/profiles/hyperai/` |
| 界面偏好 | `~/.hyperai/tui/` |

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

进去以后看到粉色 `HYPERAI HARNESS` 像素字、右下角铭牌 `hyperai-tui v0.2.0-beta.2.1 · dsh-tui v0.16.1` 就说明装好了。

---

## 4. 首次配置模型

HyperAI 不预置任何模型服务，用 DSH 原生命令配置：

1. 输入 `/provider`：添加一个 OpenAI 兼容的服务（填路由名、Base URL、API key）；
2. 输入 `/model`：选择要用的模型。

API key 由 DSH 保存在 `~/.hyperai/dsh/.credentials.yaml`（权限 0600），不会进入安装包，也不会写进日志。provider 和模型选择保存在 profile 的 `cordis.patch.yml` 与 `~/.hyperai/tui/model.json`，重新运行 `install.sh` 不会清掉。

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
python3 -m pip install --user python-pptx
# 如果系统 Python 受管（PEP 668）或不想装到用户目录：
python3 -m venv ~/hyperai-ppt && ~/hyperai-ppt/bin/pip install python-pptx
# 用 venv 时，把 ~/hyperai-ppt/bin 加到 PATH 后再启动 hyperai
```

---

## 6. 升级

拿到新安装包后重复第 2 节（校验、解压、`./install.sh`）。安装器是幂等的：

- 你的 provider/model 配置、API key、`~/.hyperai/tui` 里的偏好都会保留；旧对话按迁移规则留在 `~/.dsh`；
- 被替换的受管文件会先备份到 `~/.dsh/profiles/hyperai/.hyperai-backups/<时间戳>/`；
- 旧版本的 `~/.hyperai/runtime` 会被新版覆盖，启动命令不变；
- **从旧版（补丁方式）可以直接覆盖安装**，不需要先卸载：安装器会把依赖换成 `file:packages/…tgz`、去掉 `patchedDependencies`，并清理不再使用的 `patches/hyperai-tui.patch`；
- 安装日志会显示 `replace` / `create` / `unchanged` / `remove`，可以据此确认哪些文件变了。

---

### 6.1 从 beta.1 / beta.2 升级（迁移）

旧版本的 HyperAI 数据在 `~/.dsh/profiles/hyperai` 和 `~/.dsh-tui-hyperai`。安装 beta.2.1 时，如果新目录还没有 profile，安装器会自动把 **profile、API key、TUI 偏好**复制到 `~/.hyperai`：

- 只复制，不改动；`~/.dsh` 和 `~/.dsh-tui*` 在安装前后哈希一致。
- **不复制对话**：旧对话仍然保存在 `~/.dsh`，没有丢失，只是不会出现在新版本中。
- 不复制 `~/.dsh/cordis.patch.yml`、共享插件树和别的 profile。
- 只迁移一次，写迁移记录；确认新版本没问题后，可以自己删除 `~/.dsh/profiles/hyperai` 和 `~/.dsh-tui-hyperai`。

### 6.2 新版本提示与 `hyperai update`

启动时会在后台检查 hyperai/hyperai-harness 的 GitHub Releases（最多 24 小时一次，失败静默跳过）。有新版本时 TUI 显示一行提示；退出后运行：

```sh
hyperai update          # 显示版本并确认，然后下载、校验、安装
hyperai update --check  # 只看有没有新版本
hyperai update --yes    # 跳过确认
```

只从 GitHub Releases 下载，校验 sha256，失败不会动旧版本和用户数据。`HYPERAI_UPDATE_CHECK=off` 可以关闭检查。

## 7. 卸载

用安装包里自带的 `manage.mjs`（需要保留解压后的安装包目录）。在解压目录里直接执行即可，脚本会自己找到安装包根目录：

```sh
node profile/scripts/manage.mjs uninstall --yes
```

它会：

- 把 profile 归档到 `~/.dsh/profiles/.hyperai-uninstall-backups/<时间戳>/`（包含 Skills、`cordis.patch.yml`、`.hyperai-skills`、`cordis.yml`、`pnpm-lock.yaml` 等用户数据，不含 `node_modules`）；
- 删除安装器写入的受管文件（`package.json`、`pnpm-workspace.yaml`、`packages/`、`node_modules/`、`.hyperai-install.json` 等）；
- 删除启动命令 `~/.hyperai/bin/hyperai`。

`skills/`、`.hyperai-skills`、`cordis.yml`、`pnpm-lock.yaml` 会留在 profile 目录里（已归档一份），这样误卸载后还能手工恢复；确认不要了再走第二步：

```sh
# 彻底删除 profile 目录
node profile/scripts/manage.mjs uninstall --yes --purge
```

想连 dsh/pnpm 运行时一起清掉：

```sh
rm -rf ~/.hyperai
```

`~/.hyperai/dsh/.credentials.yaml` 是 DSH 共享凭据，任何卸载命令都不会删它。

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

### 排障

先看状态和诊断（同样在解压目录里执行）：

```sh
node profile/scripts/manage.mjs status
node profile/scripts/manage.mjs doctor
```

`doctor` 会自动使用本次安装记录的 dsh/pnpm（不需要先把 `~/.hyperai/runtime` 加进 `PATH`，也不需要传 `--dsh-bin`）。只有想检查另一份 dsh 时，才需要显式 `--dsh-bin <路径>`。

| 现象 | 处理 |
|---|---|
| `install.sh` 提示 Node 版本不满足 | 按第 1 节装 Node 24；脚本不会自动改系统 Node |
| 下载 dsh/pnpm 失败（`ETIMEDOUT`/`EAI_AGAIN`） | 换镜像：`HYPERAI_NPM_REGISTRY=https://registry.npmmirror.com ./install.sh` |
| `dsh plugin install` 失败 | 先 `node profile/scripts/manage.mjs doctor`，再把错误信息按第 9 节反馈 |
| 启动后发消息报 `no API key` | 正常：先用 `/provider` 配服务、`/model` 选模型 |
| 生成 PPT 时报 `python-pptx` 缺失 | `python3 -m pip install --user python-pptx` |
| 手动 `/skills-update` 失败 | 内测版默认关闭自动检查；手动检查需要内部 Skills 仓库权限，失败只提示一次，不影响对话 |
| 解压后 `./install.sh` 提示 Permission denied | `chmod +x install.sh` 后重试（部分解压工具会丢可执行位） |

磁盘占用：安装包约 18 MB，解压后约 18 MB，`~/.hyperai/runtime` 约 500 MB（dsh 依赖），profile（含自带的 TUI tarball 与 Skills）约 30 MB。确认够用再装。

---

## 9. 反馈

内测期间请直接联系分发安装包给你的同事。

反馈时请附上：操作系统与版本、`node -v`、安装包文件名、报错截图或文本、以及 `~/.dsh/profiles/hyperai/.hyperai-install.json` 的内容（不含密钥）。
