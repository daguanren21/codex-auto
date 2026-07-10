# Codex Auto Tmux Statusline Design

## Goal

Show Codex model, Git, context, cache, latest model-call timing, output speed, and cumulative tokens in a persistent tmux bottom status bar while preserving the user's existing TPM and `tmux-agent-status` configuration.

## User Stories

- As a Codex user inside tmux, I can see model, Git branch, context occupancy, cache ratio, response time, output speed, and cumulative tokens without leaving the conversation.
- As a user scanning the bar, I can distinguish modules and warning levels by color.
- As a user in a narrow terminal, I still see Git and context without overlapping text.
- As an existing tmux user, my current plugins and key bindings continue to work.

## Chosen Approach

Tmux evaluates `codex-auto statusline` through a `#()` status command. The CLI emits tmux-native format markup rather than ANSI escape sequences. Tmux supplies the active pane working directory and client width, so project selection and responsive degradation follow the focused pane.

This avoids a long-running updater process and its lifecycle, lock, and stale-process failure modes. A short-lived file cache prevents every tmux refresh from recursively scanning the full Codex rollout store.

## CLI Contract

`codex-auto statusline` gains:

- `--format ansi|plain|tmux`, with existing color behavior preserved for ANSI/plain callers.
- `--width <columns>`, overriding detected stdout width for tmux.
- `--cache-ttl <seconds>` and a cache under `~/.codex-auto/statusline-cache/`, keyed by normalized cwd and Codex home.

JSON commands do not use the presentation cache. Cache writes are atomic. Invalid, expired, or partially written cache entries are ignored and replaced. A cache hit must avoid rollout scanning but still render to the requested width and format.

## Tmux Rendering

The renderer produces tmux status-format spans and escapes user-controlled text so branch names and paths cannot inject tmux directives.

- Model: blue.
- Git: magenta; dirty state remains visible.
- Context: green below 60%, yellow from 60% through 84.9%, bold red from 85%.
- Cache: green at 50% or above, dim below 50%.
- Time: green below 15 seconds, yellow through 45 seconds, red above 45 seconds.
- Speed: green at 50 tok/s or above, yellow from 15 through 49.9, red below 15.
- Total: cyan.

Wide output contains every segment. Narrow output removes total, cache, model detail, and optional model information in that order while preserving Git and context. Tmux formatting bytes do not count toward visible-width calculations.

## Tmux Configuration

Installation adds an idempotent managed block to `~/.tmux.conf` immediately before the existing TPM initialization line:

```tmux
# BEGIN codex-auto statusline
set -g status on
set -g status-position bottom
set -g status-interval 10
set -g status-right-length 220
set -g status-right '#(codex-auto statusline --format tmux --cache-ttl 10 --cwd #{q:pane_current_path} --width #{client_width})'
# END codex-auto statusline
```

The installer preserves all content outside the managed block. Re-running it replaces the block instead of duplicating it. An uninstall path removes only that block. Tmux reload uses `tmux source-file ~/.tmux.conf`; no plugin installation or shell configuration changes are made.

## Failure Handling

- When no matching Codex session exists, the command exits quietly for tmux instead of filling the bar with an error.
- Git, rollout, or cache failures omit only the unavailable segment where possible.
- Tmux continues showing its previous `#()` result while a refresh command is running.
- If `codex-auto` is absent from tmux's server environment, installation reports the resolved executable path and writes that absolute path into the managed command.

## Testing And Verification

- Unit tests cover tmux escaping, native color markup, no ANSI bytes, threshold colors, and narrow widths.
- CLI tests cover `--format tmux`, `--width`, cache hits, stale cache replacement, and quiet no-session output.
- Installer tests use fixture tmux configs to verify insertion before TPM, idempotent replacement, preservation, and uninstall.
- Workspace verification runs lint, typecheck, all tests, and tsdown builds.
- Integration verification reloads the real tmux config, creates a temporary tmux session, inspects `status-right`, and confirms the command renders the active project branch and context.

## Out Of Scope

- Modifying or replacing the native Codex TUI footer.
- Adding cache, time, or speed to Codex's built-in `StatusLineItem` enum.
- Installing or changing tmux plugins, TPM, cmux, Ghostty, or shell configuration.
- Running a persistent background status daemon.
