# Encore

[English](./README.md) | [中文](./README.zh-CN.md)

Encore keeps Codex coding sessions moving through usage-limit interruptions. It watches local sessions, resumes work after a confirmed rate-limit reset, optionally prewarms a usage window, and exposes status and usage through the terminal, tmux, cmux, and a read-only MCP plugin.

Encore is local-first: it reads `~/.codex/config.toml` and `~/.codex/sessions`, stores scheduler state under `~/.codex-auto`, and does not upload conversation data.

## Install

Requirements: Node.js 22.14 or newer.

Run Encore without installing it globally:

```bash
npx --package @daguanren21/encore encore --help
npx --package @daguanren21/encore encore watch
```

Or install the scoped package globally:

```bash
npm install --global @daguanren21/encore
encore watch
```

The package also provides `codex-auto` as a compatibility command. The npm package is scoped because the unscoped `encore` name is already used by another npm project.

## Quick Start

Configure optional work times and proxy values:

```bash
encore config \
  --workat 10:30,14:00 \
  --http-proxy http://127.0.0.1:7890 \
  --https-proxy http://127.0.0.1:7890
```

Start the watcher and leave it running:

```bash
encore watch
```

Run one reconciliation cycle for a quick check:

```bash
encore watch --once
```

The watcher detects sessions blocked by primary or secondary usage limits, schedules resume ten minutes after the reported reset, restores the original model and reasoning effort, and cancels jobs when normal assistant activity shows that a session was resumed manually.

## Commands

### Watch and configuration

```bash
encore watch                       # run the resume/prewarm watcher
encore watch --once                # run one cycle and exit
encore watch --interval 60         # poll every 60 seconds
encore config --workat 10:30,14:00
encore config --clear-workat
encore config --json
```

`--state-dir` defaults to `~/.codex-auto`; `--codex-home` defaults to `~/.codex`. Each configured `workat` schedules a five-minute prewarm window four hours earlier. A due resume takes priority over prewarm work.

### Status and context

```bash
encore status
encore status --json
encore context
encore statusline --color always
encore dock --color never
encore doctor
```

These commands report the current model, context occupancy, cache ratio, Git state, timing, output speed, cumulative tokens, sessions, and available rate limits.

### Usage reports

```bash
encore usage --today
encore usage --date 2026-07-10
encore usage --recent 7
encore usage \
  --since 2026-07-10T00:00:00+08:00 \
  --until 2026-07-11T00:00:00+08:00 \
  --json
```

Usage is calculated from complete local token events and grouped by the model active for each turn.

## tmux

Install Encore's managed tmux status bar:

```bash
encore tmux install
tmux source-file ~/.tmux.conf
```

Remove only the managed block with `encore tmux uninstall`. The statusline follows the active pane directory and uses a local render cache.

## cmux Dock

Install a global cmux Dock control:

```bash
encore cmux install
```

Reload the Dock in cmux after installation. Test the same view with `encore dock --color never`; remove it with `encore cmux uninstall`.

## Codex Insights MCP Plugin

The read-only MCP plugin exposes local status and usage tools without conversation content:

- `get_status`
- `get_context_stats`
- `get_rate_limits`
- `get_usage_summary`
- `list_sessions`

Install or refresh it from the personal marketplace:

```bash
codex plugin add codex-insights@personal
codex plugin list
```

Start a new Codex thread after reinstalling the plugin.

## From Codex Auto-Resume

Encore is the TypeScript successor to [`codex-auto-resume`](https://github.com/ayqy/codex-auto-resume).

```text
make run                         -> encore watch
make today                       -> encore usage --today
make usage D=2026-07-10         -> encore usage --date 2026-07-10
make recent N=7                 -> encore usage --recent 7
make config                     -> encore config ...
```

## Development

The published package is the recommended user installation. To work on Encore itself:

```bash
pnpm install
pnpm check
pnpm build
```

Releases use Changesets. Add a changeset with `pnpm changeset`; GitHub Actions opens a release PR and publishes later versions through npm Trusted Publishing (OIDC).
