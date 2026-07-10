---
name: status
description: Show current local Codex model, context, timing, speed, Git state, sessions, and rate limits.
user-invocable: true
---

# Codex Insights Status

1. Call `mcp__codex-insights__get_status` with the current working directory.
2. Present model and effort, project and Git state, current context used/max/percentage, cache ratio, elapsed time, output tokens per second, cumulative session tokens, and available rate limits.
3. Use adaptive token units: raw below 1,000, `k` below one million, and `m` at one million or above.
4. Say `unavailable` for missing rate-limit data; never convert missing data to zero.
5. Do not expose session identifiers, rollout paths, or conversation content unless explicitly requested.
6. If the user asks for recent sessions, call `mcp__codex-insights__list_sessions` and keep the result limited to metadata.
