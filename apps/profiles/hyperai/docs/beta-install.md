# HyperAI Harness 内测版使用说明（v0.2.0-beta.7）

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

从分发人处获取安装包和 `.sha256` 文件：`hyperai-harness-0.2.0-beta.7.tar.gz` 与 `hyperai-harness-0.2.0-beta.7.tar.gz.sha256`。

### 2.2 校验并解压

```sh
# 校验（macOS）
shasum -a 256 -c hyperai-harness-0.2.0-beta.7.tar.gz.sha256
# 校验（Ubuntu）
sha256sum -c hyperai-harness-0.2.0-beta.7.tar.gz.sha256

# 解压
tar xzf hyperai-harness-0.2.0-beta.7.tar.gz
cd hyperai-harness-0.2.0-beta.7
```

### 2.3 安装包放在哪里、HyperAI 装在哪里

这是两件不同的事：

- **这次下载的压缩包**放在你下载/解压的地方（例如 `~/Downloads`）。校验、解压、运行 `./install.sh` 都在那个目录里完成。
- **HyperAI 本身**总是装到固定位置：启动命令和运行时在 `~/.hyperai/`，profile 在 **`~/.hyperai/dsh/profiles/hyperai/`**。安装完成后，下载的安装包目录可以删除，不影响使用。

HyperAI 使用**自己独立的 dsh 目录** `~/.hyperai/dsh`，不会读取、也不会修改你电脑上已有的 `~/.dsh`（包括里面的插件、profile、配置和对话）。因此已有 dsh 环境不会让 HyperAI 安装失败，HyperAI 也不会影响它。

- 如果你的 dsh 目录不想放在默认位置，安装时设置 `HYPERAI_DSH_HOME=/你的/目录`；启动时也认这个变量。
- 你在 shell 里 `export` 的 `DSH_HOME` 会被忽略；安装输出会提示“HyperAI 不会使用它”。

所以你不需要记得上次装在哪里，安装器会自己找到旧版本。

### 2.4 安装

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

进去以后看到粉色 `HYPERAI HARNESS` 像素字、右下角铭牌 `hyperai-tui v0.2.0-beta.7 · dsh-tui v0.16.1` 就说明装好了。

---

## 4. 登录 OpenBayes（推荐）

HyperAI Harness 启动时会检查 OpenBayes 登录。没有登录、或者登录已过期，会先显示登录界面，里面有 **登录 / 跳过 / 退出程序** 三个选项，默认选中「登录」。

- 选 **跳过**：不登录也能正常使用所有非 OpenBayes 功能；这个选择会记在 `~/.dsh-tui-hyperai/login-skip.json`，以后启动不再弹登录界面，覆盖升级和重装也会保留。
- 想登录时，随时输入 `/openbayes login`；登录成功后「已跳过」的记录会被清除，之后按登录有效期处理。
- 没登录时，输入框上方会一直显示「未登录 OpenBayes · /openbayes login」；OpenBayes 相关功能由 openbayes-user skill 自己提示需要登录。

登录一次后，有效期由你在浏览器里选择（1/7/30/90 天）；在有效期内，关掉、重启、覆盖升级都不会要求重新登录。登录信息保存在 `~/.config/openbayes-skills/`，卸载重装也不会删除。

登录后可以直接用自然语言操作自己的 OpenBayes 资源，例如「看看我正在运行的容器」「我的余额还有多少」「列一下我最近的训练任务」。

### 4.1 第一次登录

在 TUI 里执行：

```text
/openbayes login
```

TUI 会显示一个授权页链接。用已经登录 OpenBayes 的浏览器打开它，确认后选择令牌有效期，页面会给一个 **5 分钟内有效的一次性码**，把码粘贴回 TUI 的输入框即可。

> 授权链接很长，终端里可能会折行显示；复制时请确认是**一整行**，不要把换行或空格带进去。

- 令牌有效期按需要选：日常使用建议 **7 天或 30 天**；只在临时机器上用可以选 1 天。
- 一次性码在 TUI 的输入框里输入，不会进入对话，也不会写进会话记录。
- 授权链接本身也会过期：要在几分钟内确认；过期了就重新执行 `/openbayes login`。
- 如果链接不是以 `https://openbayes.com/` 开头，通常是环境里设置了 `OPENBAYES_GRAPHQL_ENDPOINT`（一般只出现在 OpenBayes 容器里）；先 `unset OPENBAYES_GRAPHQL_ENDPOINT`，再重新登录。

### 4.2 到期提醒与续期

- 登录有效、剩余时间 **≥ 3 天**：启动直接进入，不弹登录界面，也不提示。
- 剩余时间 **< 3 天**：照常进入，但每次启动都会提示「OpenBayes 登录将在 X 天后到期，输入 /openbayes login 续期」；`/openbayes status` 也会显示「即将到期」。
- **续期**：随时执行 `/openbayes login`，在浏览器里确认新的有效期，把一次性码贴回来即可；不需要重启，续期后到期时间按新选择重新计算。
- **已过期**：下次启动会回到登录界面，并说明登录已过期；这时仍然可以选「跳过」，以后不再弹出。
- **使用过程中到期**：当前会话不打断，只提示一次；不续期的话，下次启动会回到登录界面。

### 4.3 连不上 OpenBayes 或登录失效

- 本地登录仍然有效、但暂时连不上 OpenBayes（断网、服务故障）：照常进入，只提示一次「暂时连不上 OpenBayes，相关功能可能用不了」。
- 服务端拒绝认证（例如令牌被吊销）：如果已经进入聊天，只提示一次「OpenBayes 登录已失效，请输入 /openbayes login 重新登录」，不打断当前会话；如果还在启动阶段，会直接显示登录界面并说明原因。

### 4.4 退出登录

```text
/openbayes status    # 是否已登录、用户名、到期时间、是否过期
/openbayes logout    # 确认后删除本地登录，并立即回到登录界面
```

`/openbayes logout` **只删除本机的 session，不会吊销服务端的令牌**。要彻底撤销，请到 <https://openbayes.com/console/settings/account/personalAccessToken> 吊销名为 `CLI · <设备名>` 的令牌。

### 4.5 安全与更新

- 令牌等同于账号密码。不要发给别人，也不要贴进聊天、截图或日志。
- 涉及计费的操作（创建容器、启动 Serving 等）Agent 会先向你确认，请看清楚再同意。
- skill 会自动检查更新，按它给出的提示重新运行安装命令即可升级；安装器不会覆盖已有的 `openbayes-user` 目录。
- skill 每天会发一次只包含版本号和安装 ID 的心跳；设置 `OPENBAYES_NO_TELEMETRY=1` 可以关闭。
- 找不到 skill 时，按提示手动安装：`npx skills add https://openbayes.com/skills/openbayes-user`。

### 4.6 没有 OpenBayes 账号

请联系分发安装包给你的同事。

---

## 5. 首次配置模型

HyperAI 不预置任何模型服务，用 DSH 原生命令配置：

1. 输入 `/provider`：添加一个 OpenAI 兼容的服务（填路由名、Base URL、API key）；
2. 输入 `/model`：选择要用的模型。

API key 由 DSH 保存在 `~/.hyperai/dsh/.credentials.yaml`（权限 0600），不会进入安装包，也不会写进日志。provider 和模型选择保存在 profile 的 `cordis.patch.yml` 与 `~/.dsh-tui-hyperai/model.json`，重新运行 `install.sh` 不会清掉。

---

## 6. 确认 Skills 已加载

内测版自带两个官方 Skills：`ppt-generation`、`example-verified-skill`；安装器还会装上 OpenBayes 官方 Skill `openbayes-user`（见第 6 节）。

三种确认方式，任选其一：

1. 在 TUI 里输入 `/skills`，列表里能看到 `ppt-generation`；
2. 直接问 Agent：「你有哪些 skills？」；
3. 看文件：

```sh
ls ~/.hyperai/dsh/profiles/hyperai/skills/
ls ~/.agents/skills/openbayes-user/
cat ~/.hyperai/dsh/profiles/hyperai/.hyperai-skills/manifest.json
```

`ppt-generation` 需要 Python 3 和 `python-pptx`（安装器不会自动装）：

```sh
python3 -m pip install --user python-pptx
# 如果系统 Python 受管（PEP 668）或不想装到用户目录：
python3 -m venv ~/hyperai-ppt && ~/hyperai-ppt/bin/pip install python-pptx
# 用 venv 时，把 ~/hyperai-ppt/bin 加到 PATH 后再启动 hyperai
```

---

## 7. 升级

拿到新安装包后重复第 2 节（校验、解压、`./install.sh`）。从 beta.6 开始，启动时会提示登录 OpenBayes（可以跳过）；已登录的会直接进入。**安装程序会自动识别旧版本**，在开始写入之前显示：

```text
检测到已安装：HyperAI Harness 0.2.0-beta.1
本次安装：    HyperAI Harness 0.2.0-beta.7
这是一次覆盖升级，不需要先卸载。以下内容会保留：
  - 模型服务配置和 API key
  - 选中的模型和界面偏好
  - 对话记录
  - 你自己添加的 Skills 和文件
```

结束时会再总结一次，例如「已从 0.2.0-beta.1 升级到 0.2.0-beta.7，你的配置和对话记录已保留。」。

### 7.1 从旧版本升级（`~/.dsh` → `~/.hyperai/dsh`）

从 beta.6 及更早版本升级时，安装器发现 `~/.dsh/profiles/hyperai` 是本安装器创建的，会自动把 **profile（模型配置、Skills、自建 Skill）和 API key** 复制到 `~/.hyperai/dsh`，然后照常安装。

- **只复制，不改动**：`~/.dsh` 里的文件一个都不会删除或修改，安装前后哈希一致。
- **不复制对话记录**：`~/.dsh` 里的会话和 storages 可能被其他 dsh profile 共用，分不清归属。以前的对话仍然保存在 `~/.dsh` 里，**没有丢失，只是不会出现在新版本中**。
- **不复制** `~/.dsh/cordis.patch.yml`（home 级 patch 会叠加到所有 profile）和共享插件树，避免把旧插件带进来。
- 迁移只做一次，之后以新目录为准。确认新版本没问题后，你可以自己删除 `~/.dsh` 里的 HyperAI 数据（比如 `~/.dsh/profiles/hyperai`）；安装器不会替你删。
- `--dry-run` 会显示“是否会迁移”，但不会写任何文件。

### 7.2 查看自己装的是什么版本

推荐在解压后的安装包目录里运行：

```sh
./install.sh --dry-run
```

它只做识别、不写任何文件，会显示当前版本、目标版本和这次是全新安装还是升级。

### 7.3 降级

如果这个安装包比已安装的版本旧，安装器默认会停止，并说明「你已经装了更新的版本 X，这个安装包是 Y，降级不做保证」，**不会写入任何文件**。确认要降级时，加 `--allow-downgrade`：

```sh
./install.sh --allow-downgrade
```

降级不做数据兼容保证，请先备份重要对话。

### 7.4 升级细节

安装器是幂等的：

- 你的 provider/model 配置、API key、会话记录、`~/.dsh-tui-hyperai` 里的偏好都会保留；
- 被替换的受管文件会先备份到 `~/.hyperai/dsh/profiles/hyperai/.hyperai-backups/<时间戳>/`；
- 旧版本的 `~/.hyperai/runtime` 会被新版覆盖，启动命令不变；
- **从旧版（补丁方式）可以直接覆盖安装**，不需要先卸载：安装器会把依赖换成 `file:packages/…tgz`、去掉 `patchedDependencies`，并清理不再使用的 `patches/hyperai-tui.patch`；
- 安装日志会显示 `replace` / `create` / `unchanged` / `remove`，可以据此确认哪些文件变了。

---

## 8. 卸载

用安装包里自带的 `manage.mjs`（需要保留解压后的安装包目录）。在解压目录里直接执行即可，脚本会自己找到安装包根目录：

```sh
node profile/scripts/manage.mjs uninstall --yes
```

它会：

- 把 profile 归档到 `~/.hyperai/dsh/profiles/.hyperai-uninstall-backups/<时间戳>/`（包含 Skills、`cordis.patch.yml`、`.hyperai-skills`、`cordis.yml`、`pnpm-lock.yaml` 等用户数据，不含 `node_modules`）；
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

## 9. 已知问题与限制

- **平台**：只在 macOS（arm64）和 Ubuntu 20.04（x86_64）上验证过，其他平台未测。
- **Node 版本**：只支持 `^22.19 || >=24`；系统自带的 Node 18 会被拒绝（这是有意的）。
- **Skills 自动检查关闭**：内测版默认不自动检查 Skills 更新（同事一般没有内部 Skills 仓库权限）。手动 `/skills-update` 需要该仓库权限，失败时 TUI 会提示，不会刷屏报错。
- **`/update` 已禁用**：升级只走安装包，`/update` 会提示使用安装包流程。
- **上游更新**：内测版固定基于 `@deepseek-harness-tui/dsh-tui@0.16.1` 与 `dsh@0.2.0-rc.2`，不要自行升级这两个依赖。
- **`ppt-generation` 依赖**：需要 Python 3 + `python-pptx`，以及可用的模型服务。
- **首次启动**：没有配置 provider 时发消息会报 `no API key`，属于预期；先按第 5 节配置。
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
| `dsh plugin install` 失败 | 先 `node profile/scripts/manage.mjs doctor`，再把错误信息按第 10 节反馈 |
| 启动后发消息报 `no API key` | 正常：先用 `/provider` 配服务、`/model` 选模型 |
| 生成 PPT 时报 `python-pptx` 缺失 | `python3 -m pip install --user python-pptx` |
| 手动 `/skills-update` 失败 | 内测版默认关闭自动检查；手动检查需要内部 Skills 仓库权限，失败只提示一次，不影响对话 |
| 解压后 `./install.sh` 提示 Permission denied | `chmod +x install.sh` 后重试（部分解压工具会丢可执行位） |

磁盘占用：安装包约 18 MB，解压后约 18 MB，`~/.hyperai/runtime` 约 500 MB（dsh 依赖），profile（含自带的 TUI tarball 与 Skills）约 30 MB。确认够用再装。

---

## 10. 反馈

内测期间请直接联系分发安装包给你的同事。

反馈时请附上：操作系统与版本、`node -v`、安装包文件名、报错截图或文本、以及 `~/.hyperai/dsh/profiles/hyperai/.hyperai-install.json` 的内容（不含密钥）。
