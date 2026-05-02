<!-- studiomeyer-mcp-stack-banner:start -->
> **Part of the [StudioMeyer MCP Stack](https://studiomeyer.io)** — Built in Mallorca 🌴 · ⭐ if you use it
<!-- studiomeyer-mcp-stack-banner:end -->

<div align="center">

# Agent Fleet

**Multi-agent orchestration for Claude Code CLI.**

[![npm version](https://img.shields.io/npm/v/agent-fleet?color=blue)](https://www.npmjs.com/package/agent-fleet)
[![CI](https://github.com/studiomeyer-io/agent-fleet/actions/workflows/ci.yml/badge.svg)](https://github.com/studiomeyer-io/agent-fleet/actions)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue.svg)](tsconfig.json)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](https://nodejs.org)

Run specialized AI agents in parallel — research, critique, analyze, fix, and discuss.<br>
Built on [Claude Code](https://docs.anthropic.com/en/docs/claude-code) with [MCP](https://modelcontextprotocol.io/) tool integration.

[Quick Start](#quick-start) · [Agents](#agents) · [Conductor](#conductor-multi-agent-discussion) · [Architecture](#architecture) · [Custom Agents](#creating-custom-agents)

</div>

## Why Agent Fleet?

Most AI agent frameworks (CrewAI, AutoGen, LangGraph) treat LLMs as API endpoints — you manage tokens, tools, and prompts yourself. **Agent Fleet takes a different approach:** each agent is a full Claude Code session that can natively read files, edit code, run commands, and use MCP tools — just like a human developer.

- **Dual auth** — works with your Claude subscription (personal) or API key (commercial)
- **Native tool use** — agents read, write, and execute code directly (not through function-calling hacks)
- **MCP ecosystem** — plug in any MCP server for web search, code analysis, GitHub, and more
- **Parallel execution** — Conductor runs 3+ agents simultaneously, they discuss and synthesize
- **No token counting** — use your existing Claude Pro/Max plan, or set `ANTHROPIC_API_KEY` for API access

---

## Agents

| Agent | Role | Tools |
|-------|------|-------|
| **Research** | Deep research with 8 modes (general, vision, tech, product, competitor, paper, idea, news) | Tavily, Context7, WebSearch |
| **Critic** | Devil's advocate — challenges ideas, plans, and reports | Tavily, WebSearch |
| **Analyst** | Code archaeologist — analyzes projects, finds patterns, health checks | CodePathfinder, Read/Glob/Grep |
| **Discovery** | Code scanner with 7 focus areas (security, dead-code, types, errors, patterns, debt) | CodePathfinder, Read/Glob/Grep |
| **Repair** | Automated bug fixer — takes Discovery findings and fixes them | CodePathfinder, Read/Edit/Write |
| **CTO** | The one who actually fixes — live code changes during discussions | CodePathfinder, Read/Edit/Write |
| **Conductor** | Multi-agent discussion orchestrator — parallel rounds + synthesis | All of the above |

## Quick Start

```bash
# Prerequisites
npm install -g @anthropic-ai/claude-code  # Claude Code CLI
claude auth login                          # Authenticate

# Setup
git clone https://github.com/studiomeyer-io/agent-fleet.git
cd agent-fleet
npm install

# Optional: Copy and configure .env
cp .env.example .env
```

## Usage

### Individual Agents

```bash
# Research
npm run research -- "AI agent frameworks 2026"
npm run research -- --tech "Model Context Protocol"
npm run research -- --product "AI code review tools"
npm run research -- --competitor "LLM orchestration frameworks"
npm run research -- --idea "MCP marketplace for agent tools"

# Critic (Devil's Advocate)
npm run critic -- "We should build a SaaS product"
npm run critic -- --idea "AI-powered code review service"
npm run critic -- --plan "Migrate from SQLite to PostgreSQL"
npm run critic -- --report 2026-03-14-research-ai-agents.md

# Analyst (Code Health)
npm run analyst -- /path/to/project
npm run analyst -- --health /path/to/project
npm run analyst -- --patterns /path/to/project
npm run analyst -- --compare /path/a /path/b

# Discovery (Code Scanner)
npm run discovery -- --project /path/to/project
npm run discovery -- --project /path/to/project --focus security
npm run discovery -- --project /path/to/project --focus dead-code --quick

# Repair (Bug Fixer)
npm run repair -- --project /path/to/project --issue "fix all any types"
npm run repair -- --project /path/to/project --report discovery-report --dry-run

# CTO (Live Fixer)
npm run cto -- --project /path/to/project --issue "add error handling to API routes"
npm run cto -- --project /path/to/project --report discovery-report
```

### Conductor (Multi-Agent Discussion)

The Conductor runs 3 agents (Research, Critic, Analyst) in parallel discussion rounds. Each agent uses its own tools independently, then they react to each other's findings.

```bash
# Open discussion
npm run conductor -- "Should we migrate to a monorepo?"

# Structured debate
npm run conductor -- --debate "PostgreSQL vs SQLite for agent memory"

# Review a report
npm run conductor -- --review research-report.md

# Improvement brainstorm
npm run conductor -- --improve "Our CI/CD pipeline"

# With CTO (live code fixes during discussion)
npm run conductor -- --with-cto "Fix all issues from last discovery scan"

# Options
npm run conductor -- --rounds 3 "Topic"     # 3 rounds (default: 2, max: 4)
npm run conductor -- --sonnet "Topic"        # Use Sonnet (faster, cheaper)
```

### Model Selection

All agents default to `claude-opus-4-6`. Override with flags:

```bash
npm run research -- --sonnet "quick topic"   # Sonnet (faster)
npm run research -- --haiku "simple topic"   # Haiku (fastest)
```

## Architecture

```
agents/
  lib/
    base-agent.ts    # Core: Claude CLI subprocess + MCP config + file/DB output
    mcp-config.ts    # MCP server registry — pickMcp() for type-safe selection
    db.ts            # Optional PostgreSQL persistence (no-ops without DATABASE_URL)
  research-agent.ts  # 8 research modes, parallel search
  critic-agent.ts    # Devil's advocate with independent verification
  analyst-agent.ts   # Code analysis, pattern finding, health checks
  discovery-agent.ts # Code scanning with 7 focus areas
  repair-agent.ts    # Automated fixes from discovery findings
  cto-agent.ts       # Live code fixes, blast radius checking
  conductor.ts       # Multi-agent parallel discussion orchestrator
reports/             # Markdown reports with YAML frontmatter
```

### How It Works

1. Each agent is a **Claude CLI subprocess** (`claude -p --model X --max-turns Y`)
2. Agents get **MCP servers** for tool access (web search, code analysis, etc.)
3. Agents get **Claude Code tools** (Read, Edit, Write, Glob, Grep, Bash)
4. Output is parsed, cleaned, and saved as **Markdown reports**
5. Optionally persisted to **PostgreSQL** (no-ops without DATABASE_URL)

### MCP Servers

Agents use these MCP servers (all via `npx`, no local installation needed):

| Server | Purpose |
|--------|--------|
| `@anthropic/code-pathfinder-mcp` | Call analysis, symbol finding |
| `@upstash/context7-mcp` | Library documentation |
| `@nicholasarner/context-mcp` | Package search & docs |
| `@anthropic/github-mcp` | GitHub integration |
| `@anthropic/sequential-thinking-mcp` | Reasoning chains |
| `tavily-mcp` | Deep web research (needs API key) |

Add your own in `agents/lib/mcp-config.ts`.

## Database (Optional)

Reports are always saved to `reports/` as Markdown files. For structured persistence:

```bash
# Create the database
createdb agent_fleet
psql -d agent_fleet -f schema.sql

# Set the connection string
echo 'DATABASE_URL=postgresql://user:pass@localhost:5432/agent_fleet' >> .env
```

## Configuration

### Adding MCP Servers

Edit `agents/lib/mcp-config.ts`:

```typescript
export const mcpServers = {
  // ... existing servers ...
  'my-server': {
    command: 'node',
    args: ['/path/to/my-server/dist/server.js'],
  },
};
```

Then use in agents: `pickMcp('my-server', 'code-pathfinder')`.

### Creating Custom Agents

```typescript
import { runAgent, type AgentConfig } from './lib/base-agent.js';
import { pickMcp } from './lib/mcp-config.js';

const config: AgentConfig = {
  name: 'My Agent',
  type: 'custom',
  defaultModel: 'claude-opus-4-6',
  maxTurns: 20,
  mcpServers: pickMcp('tavily', 'code-pathfinder'),
  extraTools: ['Read', 'Glob', 'Grep', 'WebSearch'],
};

const result = await runAgent(config, {
  topic: 'My research topic',
  prompt: 'Your detailed prompt here...',
  tags: ['custom'],
});
```

## Requirements

- **Node.js** >= 18
- **Claude Code CLI** — `npm install -g @anthropic-ai/claude-code`
- **Claude Pro or Max Plan** — for personal use via Claude Code CLI
- **Anthropic API Key** — for commercial/production use (`ANTHROPIC_API_KEY` env var)
- **Tavily API Key** — optional, for deep web research

## About StudioMeyer

[StudioMeyer](https://studiomeyer.io) is an AI and design studio from Palma de Mallorca, building custom websites and AI infrastructure for small and medium businesses. Production stack on Claude Agent SDK, MCP, n8n and an in-house observability and guard layer.

## License

MIT

---

<div align="center">

Built by [StudioMeyer](https://studiomeyer.io)

[AI Shield](https://github.com/studiomeyer-io/ai-shield) · [Darwin Agents](https://github.com/studiomeyer-io/darwin-agents) · [MCP Video](https://github.com/studiomeyer-io/mcp-video)

</div>