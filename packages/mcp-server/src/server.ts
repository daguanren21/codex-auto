import { homedir } from "node:os";
import { join } from "node:path";

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import * as z from "zod/v4";

import { createStatusService } from "./service.js";

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: "codex-insights", version: "0.1.0" });
  const service = createStatusService();
  const inputSchema = {
    cwd: z.string().optional().describe("Project working directory; defaults to the server cwd"),
    codexHome: z.string().optional().describe("Codex home; defaults to CODEX_HOME or ~/.codex"),
  };
  const resolve = (input: { cwd?: string | undefined; codexHome?: string | undefined }) => ({
    cwd: input.cwd ?? process.cwd(),
    codexHome: input.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex"),
  });

  server.registerTool(
    "get_status",
    {
      description: "Read the latest local Codex session, Git, context, token, timing, and limit status.",
      inputSchema,
      annotations: { readOnlyHint: true },
    },
    async (input) => service.getStatus(resolve(input)),
  );
  server.registerTool(
    "get_context_stats",
    {
      description: "Read current context occupancy, cache ratio, cumulative tokens, elapsed time, and output speed.",
      inputSchema,
      annotations: { readOnlyHint: true },
    },
    async (input) => service.getContextStats(resolve(input)),
  );
  server.registerTool(
    "get_rate_limits",
    {
      description: "Read the latest available primary and secondary Codex rate-limit windows.",
      inputSchema,
      annotations: { readOnlyHint: true },
    },
    async (input) => service.getRateLimits(resolve(input)),
  );
  server.registerTool(
    "get_usage_summary",
    {
      description: "Summarize local Codex token usage across sessions and models for a time range.",
      inputSchema: {
        codexHome: inputSchema.codexHome,
        start: z.string().optional().describe("Inclusive ISO date-time; defaults to the start of today"),
        end: z.string().optional().describe("Exclusive ISO date-time; defaults to now"),
      },
      annotations: { readOnlyHint: true },
    },
    async (input) => service.getUsageSummary({
      codexHome: input.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex"),
      ...(input.start ? { start: input.start } : {}),
      ...(input.end ? { end: input.end } : {}),
    }),
  );
  server.registerTool(
    "list_sessions",
    {
      description: "List local Codex sessions and their model/context metadata without conversation content.",
      inputSchema: { codexHome: inputSchema.codexHome },
      annotations: { readOnlyHint: true },
    },
    async (input) => service.listSessions({
      codexHome: input.codexHome ?? process.env.CODEX_HOME ?? join(homedir(), ".codex"),
    }),
  );
  return server;
}
