# Global cmux Dock Integration Design

## Goal

Show the full `codex-auto` status dashboard in cmux's right-side Dock for every workspace, without requiring tmux or a persistent global daemon.

## User Stories

- As a cmux user, I can install the integration once and see Codex status in every workspace.
- As a user with existing Dock controls, installation and removal preserve controls not owned by `codex-auto`.
- As a Codex user, I can see model, Git, context, cache, timing, speed, and cumulative token information without starting tmux.
- As a user without an active Codex session in the current workspace, I see a quiet idle state instead of repeated errors.
- As a user who no longer wants the integration, I can remove only the `codex-auto` Dock control with one command.

## Selected Approach

Add a first-class cmux integration composed of two CLI surfaces:

- `codex-auto dock --watch` renders a multi-line ANSI dashboard and refreshes it in place.
- `codex-auto cmux install|uninstall` manages one stable control in the global cmux Dock configuration.

The global configuration lives at `~/.config/cmux/dock.json`. cmux starts the watch command inside a Ghostty-backed Dock section, supplies the workspace context, and owns the child process lifetime. Closing or restarting the Dock therefore stops the watcher without a separate daemon or process manager.

The integration does not modify `~/.tmux.conf`, remove the existing tmux integration, or require the cmux socket for normal status rendering.

## Dock Dashboard

The dashboard reuses the existing status snapshot and metric classifications. It displays:

- configured model and reasoning effort;
- Git branch, dirty state, and ahead/behind counts;
- context usage and token counts;
- cache ratio;
- latest model-call duration and output speed;
- cumulative session tokens.

The view uses compact labels, stable ANSI colors, and one metric per line so it remains readable in a narrow right sidebar. Context, duration, and speed keep their current threshold colors and warning text. The renderer has a non-color mode for deterministic tests and terminals that disable color.

When no matching Codex session exists, the control renders a single subdued idle message. Transient read failures render one concise diagnostic and are retried on the next interval instead of terminating the watcher or appending repeated lines.

## Refresh And Lifecycle

The default refresh interval is 10 seconds and can be overridden by a positive `--interval <seconds>` option. Each refresh:

1. resolves the current working directory inherited by the Dock control;
2. loads the latest matching Codex session and Git state through the existing core APIs;
3. renders the full Dock dashboard;
4. replaces the previous terminal frame with ANSI cursor control sequences.

The first frame renders immediately. The watcher handles `SIGINT` and `SIGTERM`, restores normal terminal presentation if necessary, and exits cleanly. It does not write a separate rolling log. Repeated frames may use the existing short-lived status cache, but cache failures remain non-fatal.

## Global Installation

`codex-auto cmux install` resolves the current executable to an absolute path and adds or replaces one control with the stable id `codex-auto` in `~/.config/cmux/dock.json`. The managed control runs:

```text
<absolute-executable> dock --watch
```

The control has a human-readable title and a fixed, practical initial height. It does not embed credentials, private project paths, or workspace identifiers.

Installation follows these rules:

- a missing file is created with a top-level `controls` array;
- an existing valid file keeps all unknown top-level fields and controls with other ids;
- an existing `codex-auto` control is replaced, making installation idempotent;
- malformed JSON stops installation with a path-specific error and leaves the file unchanged;
- writes use a temporary sibling file followed by an atomic rename;
- after a successful write, the CLI tells users with an already-open Dock to use cmux's documented **Reload Dock** action.

`codex-auto cmux uninstall` removes only the control whose id is `codex-auto`. It preserves every other field and control. If no managed control exists, uninstall succeeds without changing the file.

The installer targets the personal global Dock file because the selected behavior applies to every cmux workspace. It does not add a repository-local `.cmux/dock.json`.

## CLI Structure

The existing `tmux` command remains unchanged. The new command layout is:

```text
codex-auto dock [--watch] [--interval <seconds>] [existing status source options]
codex-auto cmux install [--config <path>] [--executable <path>]
codex-auto cmux uninstall [--config <path>]
```

`--config` and `--executable` support deterministic tests and advanced installations. Defaults point to `~/.config/cmux/dock.json` and the absolute current CLI executable. Non-watch `dock` mode renders one frame and exits, which makes the output scriptable and easy to verify.

## Error Handling

- Invalid interval values fail before the watcher starts.
- Missing sessions produce the idle dashboard and exit successfully in one-shot mode.
- Unsupported or absent cmux installations do not affect `dock` rendering; only `cmux install` reports the missing integration prerequisite.
- Configuration parse or write errors include the affected path and do not overwrite existing data.
- Watch refresh errors remain visible for one frame and are retried at the next scheduled refresh.
- Uninstall is idempotent and never deletes the global Dock file solely because its controls array becomes empty.

## Testing And Verification

Unit tests cover:

- complete, idle, warning, high-context, and no-color Dock rendering;
- interval validation, immediate first render, repeated refresh, and signal cleanup using fake timers and injected dependencies;
- creation, preservation, replacement, malformed input, idempotent install, and idempotent uninstall for Dock JSON;
- shell-safe serialization of the absolute executable command.

CLI tests cover command registration, defaults, explicit paths, one-shot output, watcher options, reload guidance, and path-specific diagnostics.

Deterministic project verification runs type checking, linting, tests, and the production build. Manual integration verification installs the control into the real global cmux Dock, reloads it, confirms that multiple workspaces show cwd-specific data, verifies the idle state in a workspace without a session, and then checks the uninstall path preserves unrelated controls.

## Non-Goals

- Replacing or automatically uninstalling the tmux integration.
- Adding status pills to the cmux workspace sidebar.
- Creating a repository-local Dock configuration.
- Running a launch agent or global background daemon.
- Changing cmux, Ghostty, shell, or terminal theme settings.
