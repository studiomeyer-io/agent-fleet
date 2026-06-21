/**
 * Public library surface for `@studiomeyer-io/agent-fleet`.
 *
 * Lets consumers build their own agents on top of the same runtime:
 *
 *   import { runAgent, pickMcp, type AgentConfig } from '@studiomeyer-io/agent-fleet';
 *
 * The CLI (`agent-fleet <command>`) is the other entry point — see cli.ts.
 */

export {
  runAgent,
  runDiscussionRound,
  loadReportAsContext,
  makeFilename,
  parseMetadata,
  extractSummary,
  type AgentConfig,
  type RunOptions,
  type RunResult,
} from './lib/base-agent.js';

export {
  pickMcp,
  listMcpServers,
  mcpServers,
  type McpServerName,
  type McpServerConfig,
} from './lib/mcp-config.js';
