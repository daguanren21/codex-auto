# Encore

[English](./README.md) | [中文](./README.zh-CN.md)

Encore keeps local Codex work moving through usage-limit interruptions. It watches Codex sessions, schedules an automatic resume after a confirmed rate-limit reset, optionally prewarms a usage window before configured work times, and exposes local status and usage data through the terminal, tmux, cmux, and a read-only MCP plugin.

Encore is local-first. It reads `~/.codex/config.toml` and `~/.codex/sessions`, stores its own scheduler state under `~/.codex-auto`, and does not upload conversation data.

## What Encore Does

- Detects sessions blocked by primary or secondary Codex usage limits.
- Schedules each affected session to resume ten minutes after the reported reset.
- Restores the session model and reasoning effort when launching `codex resume`.
- Cancels pending work when normal assistant activity shows that a session was resumed manually.
- Optionally runs a low-cost prewarm probe four hours before configured work times.
- Shows model, context, Git, cache, timing, speed, token usage, sessions, and rate limits.
- Provides terminal output, tmux and cmux integrations, and read-only MCP tools.

## Requirements

- Node.js 22 or newer
- pnpm 10
- Codex installed and available as `codex`
- Git for repository status
- macOS or Linux for automatic terminal-based resume

## Install From This Repository

```bash
pnpm install
pnpm build
install -d ~/.local/bin
ln -sf "$PWD/packages/cli/dist/bin.mjs" ~/.local/bin/encore
encore doctor
```

Make sure `~/.local/bin` is on `PATH`. The package also publishes the legacy `codex-auto` bin name for compatibility, but new commands and documentation use `encore`.

Without the symlink, replace `encore` in the examples with:

```bash
node packages/cli/dist/bin.mjs
```

## Quick Start

Configure optional work times and proxy values:

```bash
encore config \
  --workat 10:30,14:00 \
  --http-proxy http://127.0.0.1:7890 \
  --https-proxy http://127.0.0.1:7890
```

Start the foreground watcher and leave it running:

```bash
encore watch
```

The watcher scans local Codex sessions, reconciles resume and prewarm jobs, launches due work, and saves state under `~/.codex-auto/state.json`. Only one watcher can use a state directory at a time.

Run one cycle without staying alive when checking configuration or automation:

```bash
encore watch --once
```

Use a shorter polling interval when needed:

```bash
encore watch --interval 60
```

`--interval` is measured in seconds and defaults to `1800`.

## Commands

### `encore watch`

Runs the resume and prewarm scheduler. Important options:

```text
--once                 Run one reconciliation cycle and exit
--interval <seconds>   Polling interval; default 1800
--codex-home <path>    Codex data directory; default ~/.codex
--state-dir <path>     Encore state directory; default ~/.codex-auto
```

Automatic resume opens a new terminal on macOS or a supported terminal emulator on Linux. The resumed command uses the original session directory, model, reasoning effort, and session id.

### `encore config`

Writes `config.json` under the selected state directory. Configuration is non-interactive.

```bash
# Set daily local work times
encore config --workat 10:30,14:00

# Clear all work times
encore config --clear-workat

# Set proxy variables used by prewarm probes
encore config \
  --http-proxy http://127.0.0.1:7890 \
  --https-proxy http://127.0.0.1:7890 \
  --all-proxy socks5://127.0.0.1:7890

# Inspect the resulting configuration
encore config --json
```

Each `workat` value is a local `HH:MM` time. Encore schedules a five-minute prewarm window four hours before it. The current probe uses `gpt-5.4-mini`, low reasoning, an ephemeral `Just say Hi` request, and never opens an interactive terminal. A due resume takes priority over prewarm work.

### Status And Context

```bash
encore status
encore status --json
encore context
encore statusline --color always
encore dock --color never
```

`status` renders a compact current-session line. `context` prints a detailed token and performance breakdown. `statusline` is intended for shell and tmux integrations. `dock` renders the multiline cmux view.

Encore selects the newest session matching the requested working directory. If there is no exact match, it can use the nearest parent workspace session. Pass `--cwd <path>` or `--codex-home <path>` to override discovery.

### Usage Reports

```bash
encore usage --today
encore usage --date 2026-07-10
encore usage --recent 7
encore usage \
  --since 2026-07-10T00:00:00+08:00 \
  --until 2026-07-11T00:00:00+08:00 \
  --json
```

Usage is calculated from complete local `last_token_usage` events and grouped by the model active for each turn. Encore reports input, cached input, output, reasoning output, total tokens, cache ratio, and session count.

### Diagnostics

```bash
encore doctor
encore doctor --json
encore --help
encore watch --help
```

`doctor` checks the Codex home, session directory, Codex config, and Git availability.

## tmux Status Bar

```bash
pnpm build
encore tmux install --executable "$HOME/.local/bin/encore"
tmux source-file ~/.tmux.conf
```

The installer manages one idempotent block in `~/.tmux.conf`, follows the active pane directory, and uses a render cache under `~/.codex-auto/statusline-cache`. Remove only the managed block with:

```bash
encore tmux uninstall
```

Manual configuration is also possible:

```tmux
set -g status-interval 10
set -g status-right '#(encore statusline --format tmux --cache-ttl 10 --cwd #{q:pane_current_path} --width #{client_width})'
```

## cmux Dock

Install one global Dock control that follows each cmux workspace directory:

```bash
encore cmux install --executable "$HOME/.local/bin/encore"
```

Reload the Dock from cmux if it is already open. Test the same frame directly with `encore dock --color never`. Remove only Encore's managed control with:

```bash
encore cmux uninstall
```

## Codex Insights Plugin

The read-only MCP plugin is separate from the watcher and terminal displays. Build the workspace, then install or refresh the plugin from the personal marketplace:

```bash
pnpm build
codex plugin add codex-insights@personal
codex plugin list
```

Start a new Codex thread after reinstalling. The plugin exposes:

- `get_status`
- `get_context_stats`
- `get_rate_limits`
- `get_usage_summary`
- `list_sessions`

The tools expose session metadata and aggregate usage, not conversation content.

## Compatibility With Codex Auto-Resume

Encore is the TypeScript successor to [`codex-auto-resume`](https://github.com/ayqy/codex-auto-resume). Common command mappings are:

| Previous command | Encore command |
| --- | --- |
| `make run` | `encore watch` |
| `make today` | `encore usage --today` |
| `make usage D=2026-07-10` | `encore usage --date 2026-07-10` |
| `make recent N=7` | `encore usage --recent 7` |
| `make config` | `encore config ...` |
| `make status` | `encore status` for current session status |

The current TypeScript CLI does not yet expose the old manual availability probe, interactive configuration flow, watcher debug dashboard, or selectable silent-resume mode. Do not run the Python and TypeScript watchers against the same sessions in normal use.

## Workspace

- `packages/core`: rollout/config readers, Git and performance snapshots, usage aggregation, and scheduling domain logic.
- `packages/cli`: the `encore` CLI plus macOS/Linux terminal, tmux, and cmux adapters.
- `packages/mcp-server`: the read-only MCP adapter.
- `packages/plugins/codex-insights`: Codex plugin skills and standalone MCP bundle.

## Development

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm check
```
