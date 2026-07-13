# @codex-auto/cli

The bundled `codex-auto` command. From the repository root, build with `pnpm build`; from this
package directory, use `pnpm --filter @codex-auto/cli build`. Then run `node dist/bin.mjs --help`.

## cmux Dock

The cmux Dock control and the Codex Insights MCP plugin are separate integrations. Install the
global right-sidebar control with:

```bash
codex-auto cmux install
```

The installer idempotently manages the `codex-auto` entry in `~/.config/cmux/dock.json` and
preserves all other controls. Use cmux's **Reload Dock** action if the sidebar was already open.
The managed command is `codex-auto dock --watch`; one-shot `codex-auto dock --color never` is
available for diagnostics. Remove only this control with:

```bash
codex-auto cmux uninstall
```

The Dock process inherits the current cmux workspace directory and refreshes every 10 seconds.

## Tmux

After exposing the built `dist/bin.mjs` as `codex-auto` on `PATH`, install or remove the managed status bar with:

```bash
pnpm build
codex-auto tmux install
tmux source-file ~/.tmux.conf
codex-auto tmux uninstall
```

The installer preserves existing config and inserts one idempotent block before TPM initialization. It requests a 10-second tmux refresh and renders the active pane's Codex session through `statusline --format tmux`, with a 10-second cache under `~/.codex-auto/statusline-cache`. Existing plugins may select a shorter global tmux interval without causing more frequent rollout scans.

`statusline` also supports `--format ansi|plain|tmux`, `--width <columns>`, `--cache-ttl <seconds>`, and `--state-dir <path>`. Tmux output uses native formatting rather than ANSI. This status bar is independent of Codex's native `/statusline` and the Codex Insights MCP plugin.
