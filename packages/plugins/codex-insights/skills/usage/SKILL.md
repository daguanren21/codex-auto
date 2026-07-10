---
name: usage
description: Summarize local Codex token usage across sessions and models for today or an explicit time range.
user-invocable: true
---

# Codex Insights Usage

1. Call `mcp__codex-insights__get_usage_summary`. Pass ISO `start` and `end` only when the user requests a specific range.
2. Present total, input, cached input, output, reasoning output, cache ratio, session count, and the per-model split.
3. Use adaptive token units: raw below 1,000, `k` below one million, and `m` at one million or above.
4. Keep JSON values exact when the user requests machine-readable output.
5. Do not expose session identifiers, rollout paths, prompts, or conversation content.
