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
  const resolve = (input: { cwd?: string; codexHome?: string }) => ({
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
  return server;
}

