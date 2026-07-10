# @codex-auto/cli

The bundled `codex-auto` command. Build with `pnpm --filter @codex-auto/cli build`, then run `node dist/bin.mjs --help` from this directory.

## Tmux

After exposing the built `dist/bin.mjs` as `codex-auto` on `PATH`, install or remove the managed status bar with:

```bash
pnpm build
codex-auto tmux install
tmux source-file ~/.tmux.conf
codex-auto tmux uninstall
```

The installer preserves existing config, inserts one idempotent block before TPM initialization, and refreshes every 10 seconds. It renders the active pane's Codex session through `statusline --format tmux`, with a short-lived cache under `~/.codex-auto/statusline-cache`.

`statusline` also supports `--format ansi|plain|tmux`, `--width <columns>`, `--cache-ttl <seconds>`, and `--state-dir <path>`. Tmux output uses native formatting rather than ANSI. This status bar is independent of Codex's native `/statusline` and the Codex Insights MCP plugin.
