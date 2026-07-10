# Codex Auto

`codex-auto` is a local-first TypeScript rewrite of `codex-auto-resume`. It adds a terminal statusline and a read-only Codex plugin for context, tokens, Git, timing, speed, sessions, and rate limits.

## Workspace

- `packages/core`: rollout/config readers, Git and performance snapshots, formatting, usage aggregation, resume and prewarm scheduling.
- `packages/cli`: bundled `codex-auto` CLI and macOS/Linux terminal adapters.
- `packages/mcp-server`: bundled read-only MCP server.
- `packages/plugins/codex-insights`: Codex plugin manifest, skills, and standalone MCP bundle.

Node.js 22+ and pnpm 10 are required.

```bash
pnpm install
pnpm build
node packages/cli/dist/bin.mjs doctor
```

## Status And Context

```bash
node packages/cli/dist/bin.mjs statusline --color always
node packages/cli/dist/bin.mjs status --json
node packages/cli/dist/bin.mjs context
```

The active rollout model is authoritative. `~/.codex/config.toml` is used only when the session does not contain model metadata, so an older `gpt-5.4` session is not mislabeled as the configured `gpt-5.6-sol` model.

Token values are adaptive: raw below `1,000`, `k` below `1m`, and `m` from one million upward. Context is green below 60%, yellow from 60% to 84.9%, and bold red from 85%. Time is green below 15 seconds, yellow through 45 seconds, then red. Speed is green from 50 tok/s, yellow from 15 tok/s, then red. Model, Git, cache, output, reasoning, and totals use stable distinct colors. `NO_COLOR`, `FORCE_COLOR`, and `--color auto|always|never` are supported; JSON never contains ANSI.

### Tmux Status Bar

Build the CLI, make the executable available on `PATH`, and install the managed tmux block:

```bash
pnpm build
install -d ~/.local/bin
ln -sf "$PWD/packages/cli/dist/bin.mjs" ~/.local/bin/codex-auto
codex-auto tmux install
tmux source-file ~/.tmux.conf
```

Codex must be running inside tmux for the bar to be visible. The managed block follows the active pane working directory, requests a 10-second tmux refresh, and keeps a render-ready cache under `~/.codex-auto/statusline-cache`. Existing plugins may use a shorter global tmux interval; the 10-second cache still prevents rollout scans from running more often. The block is inserted before TPM initialization without changing existing plugin declarations or key bindings.

The renderer supports `--format ansi|plain|tmux`, `--width`, and `--cache-ttl`. Tmux format uses native `#[...]` styles and never emits ANSI escapes. This integration is separate from Codex's native `/statusline` and from the read-only Codex Insights MCP plugin.

Remove only the managed block with:

```bash
codex-auto tmux uninstall
tmux source-file ~/.tmux.conf
```

To configure tmux manually instead, use native tmux output and pass the active pane path and client width:

```tmux
set -g status-interval 10
set -g status-right '#(codex-auto statusline --format tmux --cache-ttl 10 --cwd #{q:pane_current_path} --width #{client_width})'
```

## Usage Totals

```bash
node packages/cli/dist/bin.mjs usage --today
node packages/cli/dist/bin.mjs usage --date 2026-07-10
node packages/cli/dist/bin.mjs usage --recent 7
node packages/cli/dist/bin.mjs usage --since 2026-07-10T00:00:00+08:00 --until 2026-07-11T00:00:00+08:00 --json
```

Usage is summed from complete local `last_token_usage` events, grouped by the model active for each turn, and never uploads conversation data.

## Auto Resume And Workat

Configure optional proxy settings and daily work times, then run the watcher:

```bash
node packages/cli/dist/bin.mjs config \
  --workat 10:30,14:00 \
  --http-proxy http://127.0.0.1:7890 \
  --https-proxy http://127.0.0.1:7890

node packages/cli/dist/bin.mjs watch
```

The watcher schedules a terminal ten minutes after a confirmed reset, restores the session model and reasoning effort, and cancels jobs when normal assistant activity shows that the session was resumed manually. It uses an atomic state file and a single-process lock under `~/.codex-auto`.

Each `workat` value schedules a silent probe four hours earlier. The probe uses `gpt-5.4-mini`, low reasoning, an ephemeral `Just say Hi` request, and a five-minute execution window. A due resume always takes priority over prewarm. Use `config --clear-workat` to disable it.

## Codex Plugin

Building `@codex-auto/mcp-server` copies a standalone bundle to `packages/plugins/codex-insights/start.mjs`. Install the `packages/plugins/codex-insights` directory through the Codex plugin development or personal marketplace workflow. It exposes these read-only tools:

- `get_status`
- `get_context_stats`
- `get_rate_limits`
- `get_usage_summary`
- `list_sessions`

The plugin reads `~/.codex/config.toml` and `~/.codex/sessions`; it does not mutate Codex data or expose conversation content through its tools.

## Migration From Python

The replacement for `make run` is `codex-auto watch`. The replacements for `make today`, `make usage D=...`, and `make recent N=...` are `codex-auto usage --today`, `--date`, and `--recent`. Move `config.json` values into `codex-auto config`; the TS watcher stores its own state under `~/.codex-auto`, so it can be tested alongside the Python version, but only one watcher should be left running in normal use.

## Development

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
pnpm check
```
