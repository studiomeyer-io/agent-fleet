/**
 * MCP Server Configuration — Single Source of Truth
 *
 * Registry of MCP servers the agents can use. Agents pick servers via pickMcp().
 *
 * Every entry here is a real, npx-installable MCP server (verified on npm).
 * Code analysis (symbol search, callers/callees) is handled by Claude Code's
 * built-in Read/Glob/Grep/Bash tools — no extra MCP server required — so the
 * registry stays small and every entry actually resolves on `npx -y`.
 *
 * Bring your own: add an entry below. For a local server, resolve its path via
 * the MCP_BASE env var (its parent directory), e.g.:
 *
 *   'my-search': {
 *     command: 'node',
 *     args: [`${process.env.MCP_BASE}/my-search/dist/server.js`],
 *   },
 *
 * Remote/hosted servers (e.g. GitHub's official MCP at
 * https://api.githubcopilot.com/mcp/) are wired into your Claude Code settings,
 * not here — this registry is for the stdio/npx servers the agents spawn.
 */

export const mcpServers = {
  // ─── Knowledge & Research ───
  /** Up-to-date library documentation. https://github.com/upstash/context7 */
  context7: {
    command: 'npx',
    args: ['-y', '@upstash/context7-mcp'],
  },

  // ─── Reasoning ───
  /** Structured step-by-step reasoning. Official MCP reference server. */
  'sequential-thinking': {
    command: 'npx',
    args: ['-y', '@modelcontextprotocol/server-sequential-thinking'],
  },

  // ─── Deep Research ───
  /** Multi-engine web research. Needs TAVILY_API_KEY. https://tavily.com */
  tavily: {
    command: 'npx',
    args: ['-y', 'tavily-mcp@latest'],
    env: { TAVILY_API_KEY: process.env.TAVILY_API_KEY ?? '' },
  },
} as const;

export type McpServerName = keyof typeof mcpServers;

/** Shape of a resolved MCP server config (deep-cloned, safe to mutate). */
export interface McpServerConfig {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/** One Tavily-key warning per process — pickMcp runs once per agent config. */
let tavilyWarned = false;

/** Pick specific MCP servers by name. Returns deep-cloned configs. */
export function pickMcp(...names: McpServerName[]): Record<string, McpServerConfig> {
  const result: Record<string, McpServerConfig> = {};
  for (const name of names) {
    const srv = mcpServers[name];
    result[name] = {
      command: srv.command,
      args: [...srv.args],
      env: 'env' in srv ? { ...srv.env } : undefined,
    };
  }

  if (names.includes('tavily') && !process.env.TAVILY_API_KEY && !tavilyWarned) {
    tavilyWarned = true;
    console.warn('[mcp-config] TAVILY_API_KEY is not set — Tavily-based agents will fail on API calls.');
  }

  return result;
}

/** List all available MCP server names. */
export function listMcpServers(): McpServerName[] {
  return Object.keys(mcpServers) as McpServerName[];
}
