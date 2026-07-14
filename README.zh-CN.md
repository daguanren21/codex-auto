# Encore

[English](./README.md) | [中文](./README.zh-CN.md)

Encore 用来避免 Codex 用量限制打断编码工作。它会监控本地会话，在确认额度重置后自动恢复工作，可选地预热用量窗口，并通过终端、tmux、cmux 和只读 MCP 插件提供状态与用量信息。

Encore 坚持 local-first：读取 `~/.codex/config.toml` 和 `~/.codex/sessions`，把调度状态保存在 `~/.codex-auto`，不会上传对话数据。

## 安装

环境要求：Node.js 22.14 或更高版本。

不全局安装，直接运行：

```bash
npx --package @daguanren21/encore encore --help
npx --package @daguanren21/encore encore watch
```

也可以全局安装 scoped npm 包：

```bash
npm install --global @daguanren21/encore
encore watch
```

包中同时提供 `codex-auto` 兼容命令。npm 包使用 scoped 名称，是因为未加 scope 的 `encore` 已被其他 npm 项目占用。

## 快速开始

配置可选的工作时间和代理：

```bash
encore config \
  --workat 10:30,14:00 \
  --http-proxy http://127.0.0.1:7890 \
  --https-proxy http://127.0.0.1:7890
```

启动 watcher 并保持运行：

```bash
encore watch
```

只运行一轮进行检查：

```bash
encore watch --once
```

Watcher 会检测被主用量窗口或次级用量窗口限制的会话，在报告的重置时间后十分钟安排恢复，恢复原模型和推理强度；如果检测到正常助手回复，也会取消已经被人工恢复的任务。

## 命令

### Watcher 和配置

```bash
encore watch                       # 运行恢复/预热 watcher
encore watch --once                # 只运行一轮
encore watch --interval 60         # 每 60 秒轮询
encore config --workat 10:30,14:00
encore config --clear-workat
encore config --json
```

`--state-dir` 默认是 `~/.codex-auto`，`--codex-home` 默认是 `~/.codex`。每个 `workat` 会在四小时前安排一个五分钟预热窗口；恢复任务到期时优先执行恢复。

### 状态和上下文

```bash
encore status
encore status --json
encore context
encore statusline --color always
encore dock --color never
encore doctor
```

这些命令可以查看当前模型、上下文占用、缓存率、Git 状态、耗时、输出速度、累计 Token、会话和用量限制。

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

用量根据本地完整 Token 事件计算，并按每轮实际使用的模型分组。

## tmux

安装 Encore 管理的 tmux 状态栏：

```bash
encore tmux install
tmux source-file ~/.tmux.conf
```

使用 `encore tmux uninstall` 只删除 Encore 管理的配置。状态栏会跟随当前 pane 的工作目录，并使用本地渲染缓存。

## cmux Dock

安装全局 cmux Dock 控件：

```bash
encore cmux install
```

安装后在 cmux 中重新加载 Dock。可以用 `encore dock --color never` 检查视图，用 `encore cmux uninstall` 卸载。

## Codex Insights MCP 插件

只读 MCP 插件提供本地状态和用量工具，不暴露对话内容：

- `get_status`
- `get_context_stats`
- `get_rate_limits`
- `get_usage_summary`
- `list_sessions`

从 personal marketplace 安装或刷新：

```bash
codex plugin add codex-insights@personal
codex plugin list
```

重新安装后请开启新的 Codex 会话。

## 从 Codex Auto-Resume 迁移

Encore 是 [`codex-auto-resume`](https://github.com/ayqy/codex-auto-resume) 的 TypeScript 后继版本。

```text
make run                         -> encore watch
make today                       -> encore usage --today
make usage D=2026-07-10         -> encore usage --date 2026-07-10
make recent N=7                 -> encore usage --recent 7
make config                     -> encore config ...
```

## 开发

普通用户推荐直接安装已发布的 npm 包。开发 Encore 本身时：

```bash
pnpm install
pnpm check
pnpm build
```

发布使用 Changesets。执行 `pnpm changeset` 创建变更记录，GitHub Actions 会创建 release PR，后续版本通过 npm Trusted Publishing（OIDC）发布。
