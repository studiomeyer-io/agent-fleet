/**
 * MCP Server Configuration — Single Source of Truth
 *
 * All MCP server configs in one place. Agents pick servers via pickMcp().
 * Custom servers use MCP_BASE env var for path resolution.
 */

const MCP_BASE = process.env.MCP_BASE;

export const mcpServers = {
  // ─── Code Intelligence ───
  'code-pathfinder': {
    command: 'npx',
    args: ['-y', '@anthropic/code-pathfinder-mcp'],
  },

  // ─── Knowledge & Research ───
  'context7': {
    command: 'npx',
    args: ['-y', '@upstash/context7-mcp'],
  },
  'context': {
    command: 'npx',
    args: ['-y', '@nicholasarner/context-mcp'],
  },

  // ─── GitHub ───
  'github': {
    command: 'npx',
    args: ['-y', '@anthropic/github-mcp'],
  },

  // ─── Reasoning ───
  'sequential-thinking': {
    command: 'npx',
    args: ['-y', '@anthropic/sequential-thinking-mcp'],
  },

  // ─── Deep Research ───
  'tavily': {
    command: 'npx',
    args: ['-y', 'tavily-mcp@latest'],
    env: { TAVILY_API_KEY: process.env.TAVILY_API_KEY ?? '' },
  },

  // ─── Custom MCP Servers (requires MCP_BASE) ───
  // Add your own MCP servers here. Set MCP_BASE to their parent directory.
  // Example:
  // 'my-search': {
  //   command: 'node',
  //   args: [`${MCP_BASE}/my-search/dist/server.js`],
  // },
} as const;

type McpServerName = keyof typeof mcpServers;

/** Pick specific MCP servers by name */
export function pickMcp(...names: McpServerName[]): Record<string, { command: string; args: string[]; env?: Record<string, string> }> {
  const result: Record<string, { command: string; args: string[]; env?: Record<string, string> }> = {};
  for (const name of names) {
    const srv = mcpServers[name];
    result[name] = { command: srv.command, args: [...srv.args], env: 'env' in srv ? { ...srv.env } : undefined };
  }

  if (names.includes('tavily') && !process.env.TAVILY_API_KEY) {
    console.warn('[mcp-config] WARNING: TAVILY_API_KEY is not set. Tavily MCP server will fail on API calls.');
  }

  return result;
}

/** List all available MCP server names */
export function listMcpServers(): McpServerName[] {
  return Object.keys(mcpServers) as McpServerName[];
}
