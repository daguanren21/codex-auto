# Encore

[English](./README.md) | [中文](./README.zh-CN.md)

Encore 用来避免 Codex 用量限制打断本地编码工作。它会监控 Codex 会话，在确认额度重置后自动安排恢复；也可以在设定的工作时间前预热用量窗口，并通过终端、tmux、cmux 和只读 MCP 插件提供本地状态与用量数据。

Encore 坚持 local-first：读取 `~/.codex/config.toml` 和 `~/.codex/sessions`，把自己的调度状态保存在 `~/.codex-auto`，不会上传对话数据。

## 主要功能

- 检测被 Codex 主用量窗口或次级用量窗口限制的会话。
- 在报告的重置时间后十分钟自动安排恢复。
- 执行 `codex resume` 时恢复原会话的模型和推理强度。
- 检测到正常助手回复后，取消已经被人工恢复的待执行任务。
- 可在配置的工作时间前四小时执行低成本预热。
- 展示模型、上下文、Git、缓存率、耗时、速度、Token、会话和用量限制。
- 支持终端输出、tmux、cmux 和只读 MCP 工具。

## 环境要求

- Node.js 22 或更高版本
- pnpm 10
- 已安装 Codex，且可以通过 `codex` 命令运行
- 使用 Git 状态功能时需要安装 Git
- 自动打开终端恢复会话目前支持 macOS 和 Linux

## 从本仓库安装

```bash
pnpm install
pnpm build
install -d ~/.local/bin
ln -sf "$PWD/packages/cli/dist/bin.mjs" ~/.local/bin/encore
encore doctor
```

请确认 `~/.local/bin` 已加入 `PATH`。包中仍保留旧的 `codex-auto` 命令作为兼容入口，但新文档和新用法统一使用 `encore`。

如果不创建软链接，可以把示例中的 `encore` 替换为：

```bash
node packages/cli/dist/bin.mjs
```

## 从 npm 安装

Encore 发布为 scoped npm 包 `@daguanren21/encore`，安装后的命令仍然是 `encore`。

不全局安装，直接运行：

```bash
npx --package @daguanren21/encore encore --help
npx --package @daguanren21/encore encore watch
```

也可以全局安装：

```bash
npm install --global @daguanren21/encore
encore watch
```

## 快速开始

配置可选的工作时间和代理：

```bash
encore config \
  --workat 10:30,14:00 \
  --http-proxy http://127.0.0.1:7890 \
  --https-proxy http://127.0.0.1:7890
```

在前台启动 watcher，并保持该进程运行：

```bash
encore watch
```

Watcher 会扫描本地 Codex 会话、协调恢复和预热任务、执行到期任务，并把状态写入 `~/.codex-auto/state.json`。同一个状态目录同一时间只能运行一个 watcher。

如果只想验证配置和调度结果，可以只运行一轮：

```bash
encore watch --once
```

需要更短的轮询周期时：

```bash
encore watch --interval 60
```

`--interval` 的单位是秒，默认值为 `1800`。

## 命令说明

### `encore watch`

运行自动恢复和预热调度器。常用参数：

```text
--once                 只执行一轮协调，然后退出
--interval <seconds>   轮询间隔，默认 1800 秒
--codex-home <path>    Codex 数据目录，默认 ~/.codex
--state-dir <path>     Encore 状态目录，默认 ~/.codex-auto
```

自动恢复在 macOS 上会打开新终端，在 Linux 上会使用受支持的终端模拟器。恢复命令会使用原会话的工作目录、模型、推理强度和会话 ID。

### `encore config`

把配置写入所选状态目录下的 `config.json`。当前配置方式为非交互式。

```bash
# 设置每日工作时间，使用本地时区
encore config --workat 10:30,14:00

# 清除所有工作时间
encore config --clear-workat

# 设置预热探针使用的代理变量
encore config \
  --http-proxy http://127.0.0.1:7890 \
  --https-proxy http://127.0.0.1:7890 \
  --all-proxy socks5://127.0.0.1:7890

# 查看最终配置
encore config --json
```

每个 `workat` 都是本地时间的 `HH:MM`。Encore 会在该时间前四小时安排一个五分钟执行窗口。当前探针固定使用 `gpt-5.4-mini`、`low` 推理、临时的 `Just say Hi` 请求，不会打开交互式终端。如果恢复任务和预热任务同时到期，恢复任务优先。

### 状态和上下文

```bash
encore status
encore status --json
encore context
encore statusline --color always
encore dock --color never
```

`status` 输出当前会话的紧凑状态；`context` 输出详细 Token 和性能信息；`statusline` 用于 Shell 和 tmux；`dock` 输出 cmux 使用的多行视图。

Encore 会选择与工作目录匹配的最新会话。如果没有完全匹配，也可以使用最近的父级工作区会话。可通过 `--cwd <path>` 或 `--codex-home <path>` 覆盖默认查找位置。

### 用量报告

```bash
encore usage --today
encore usage --date 2026-07-10
encore usage --recent 7
encore usage \
  --since 2026-07-10T00:00:00+08:00 \
  --until 2026-07-11T00:00:00+08:00 \
  --json
```

用量根据本地完整的 `last_token_usage` 事件计算，并按每轮实际使用的模型分组。报告包括输入、缓存输入、输出、推理输出、总 Token、缓存率和会话数量。

### 诊断

```bash
encore doctor
encore doctor --json
encore --help
encore watch --help
```

`doctor` 会检查 Codex home、会话目录、Codex 配置文件和 Git 是否可用。

## tmux 状态栏

```bash
pnpm build
encore tmux install --executable "$HOME/.local/bin/encore"
tmux source-file ~/.tmux.conf
```

安装器只管理 `~/.tmux.conf` 中的一段幂等配置，会跟随当前 pane 的工作目录，并使用 `~/.codex-auto/statusline-cache` 中的渲染缓存。卸载时只删除 Encore 管理的配置：

```bash
encore tmux uninstall
```

也可以手动配置：

```tmux
set -g status-interval 10
set -g status-right '#(encore statusline --format tmux --cache-ttl 10 --cwd #{q:pane_current_path} --width #{client_width})'
```

## cmux Dock

安装一个全局 Dock 控件，让它跟随每个 cmux workspace 的目录：

```bash
encore cmux install --executable "$HOME/.local/bin/encore"
```

如果 Dock 已经打开，需要在 cmux 中重新加载。可以用 `encore dock --color never` 直接查看同一帧输出。卸载只会删除 Encore 自己管理的控件：

```bash
encore cmux uninstall
```

## Codex Insights 插件

只读 MCP 插件和 watcher、终端展示是相互独立的。构建 workspace 后，从 personal marketplace 安装或刷新插件：

```bash
pnpm build
codex plugin add codex-insights@personal
codex plugin list
```

重新安装后需要开启新的 Codex 会话。插件提供：

- `get_status`
- `get_context_stats`
- `get_rate_limits`
- `get_usage_summary`
- `list_sessions`

这些工具只暴露会话元数据和聚合用量，不暴露对话内容。

## 从 Codex Auto-Resume 迁移

Encore 是 [`codex-auto-resume`](https://github.com/ayqy/codex-auto-resume) 的 TypeScript 后继版本。常见命令对应关系：

| 旧命令 | Encore 命令 |
| --- | --- |
| `make run` | `encore watch` |
| `make today` | `encore usage --today` |
| `make usage D=2026-07-10` | `encore usage --date 2026-07-10` |
| `make recent N=7` | `encore usage --recent 7` |
| `make config` | `encore config ...` |
| `make status` | `encore status`，查看当前会话状态 |

当前 TypeScript CLI 还没有提供旧版的手动可用性探针、交互式配置、watcher 调试面板和可选 silent resume 模式。正常使用时不要同时运行 Python watcher 和 TypeScript watcher。

## 项目结构

- `packages/core`：rollout/config 读取、Git 和性能快照、用量聚合与调度领域逻辑。
- `packages/cli`：`encore` CLI，以及 macOS/Linux 终端、tmux 和 cmux 适配器。
- `packages/mcp-server`：只读 MCP 适配器。
- `packages/plugins/codex-insights`：Codex 插件技能和独立 MCP bundle。

## 开发命令

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm check
```

## 维护者发布流程

项目使用 Changesets 和 GitHub Actions 发布。只有 `@daguanren21/encore` 会发布到 npm；core 和 MCP workspace 包保持私有，并在 CLI 构建时打包进去。

首次发布请使用 Node.js 22.14+ 和 npm 11.5.1+ 在本地发布一次，然后配置 npm Trusted Publishing：

```bash
npm login
pnpm run version
pnpm install --lockfile-only
pnpm release
git add .
git commit -m "chore: release @daguanren21/encore"
git push
```

首次发布只会在你的本机使用 npm 登录状态。不要把 npm token 写入仓库或 GitHub secrets。`@daguanren21/encore@0.1.1` 发布成功后，在 npmjs.com 的包设置中添加 GitHub Actions Trusted Publisher：

- user：`daguanren21`
- repository：`codex-auto`
- workflow filename：`release.yml`
- allowed action：npm publish

之后的版本发布都通过 GitHub Actions 的短期 OIDC 凭据完成，不再需要 npm token。

后续发布时，为用户可见的改动创建 changeset：

   ```bash
   pnpm changeset
   ```

2. 将 changeset 提交并推送到 `main`。Release workflow 会自动创建或更新 Release PR。
3. 合并 Release PR。workflow 会自动更新版本、构建并通过 OIDC 发布 npm 包。

包通过 `publishConfig.access` 配置为 public。Release workflow 需要 `contents: write`、`pull-requests: write` 和 `id-token: write`，不会使用 `NPM_TOKEN` secret。
