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

Run specialized AI agents in **parallel rounds** (Conductor) or as **stateful workflows with crash-resume + Human-in-the-Loop** (Conductor-LangGraph, opt-in).<br>
Built on [Claude Code](https://docs.anthropic.com/en/docs/claude-code) with [MCP](https://modelcontextprotocol.io/) tool integration. Subscription-flat by default.

[Quick Start](#quick-start) · [Agents](#agents) · [Conductor](#conductor-multi-agent-discussion) · [LangGraph Workflow](#stateful-workflow-with-langgraph-opt-in) · [Architecture](#architecture) · [Custom Agents](#creating-custom-agents)

</div>

## Why Agent Fleet?

Most AI agent frameworks treat LLMs as API endpoints — you manage tokens, tools, and prompts yourself. **Agent Fleet runs each agent as a full Claude Code subprocess:** native file reads, edits, command execution, and MCP tools — like a human developer would. Your subscription, no token counting.

`v0.2` adds **optional** LangGraph orchestration (`Conductor-LangGraph`) for stateful workflows with Postgres-backed crash-resume and Human-in-the-Loop pauses. The Claude Code CLI subprocess pattern stays the same underneath — best of both worlds.

- **Dual auth** — works with your Claude subscription (personal, default) or API key (commercial, `AGENT_FLEET_USE_API_KEY=1`)
- **Native tool use** — agents read, write, and execute code directly (not through function-calling hacks)
- **MCP ecosystem** — plug in any MCP server for web search, code analysis, GitHub, and more
- **Parallel mode** — `Conductor` runs 3+ agents simultaneously, they discuss and synthesize
- **Stateful mode** *(opt-in, v0.2)* — `Conductor-LangGraph` adds Postgres checkpoints for crash-resume + `interrupt()` for HITL on high-risk findings
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

### Stateful Workflow with LangGraph (opt-in)

`Conductor-LangGraph` is the stateful counterpart to `Conductor`. Same Claude Code CLI subprocesses underneath, plus three things on top:

- **Postgres checkpoints** — kill the workflow mid-run, resume from the last checkpoint with the same slug. No re-running the agents that already finished.
- **Conditional branching** — routers in the graph decide the next node based on agent output (e.g. critic flagged HIGH risk → pause, otherwise continue to analyst).
- **Human-in-the-Loop** — `interrupt()` pauses the workflow at decision points, your CLI delivers the decision via `--resume --decision approve|reject|revise`.

**When to use which:**

| | `Conductor` (parallel) | `Conductor-LangGraph` (stateful) |
|---|---|---|
| **Best for** | Discussions, idea reviews, quick brainstorms | Long pipelines, security audits, multi-step builds |
| **Setup** | Zero — just run | Postgres + `npm install --include=optional` |
| **Recovery** | Re-run from scratch on failure | Resume from last checkpoint |
| **Cost** | Subscription-flat | Subscription-flat (Postgres is local) |
| **HITL** | No (synthesis at end) | Yes (interrupt + resume with decision) |

**Setup:**

```bash
# Install LangGraph + Postgres deps (optional dependencies)
# Note: requires Node >= 20 (transitively via @langchain/core).
# The parallel `Conductor` mode still works on Node 18.
npm install --include=optional

# Create the langgraph schema (idempotent — safe to re-run)
DATABASE_URL=postgresql://user:pass@host:5432/db npm run langgraph:setup
```

**Example workflow** — `research → critic → [HIGH risk?] → user_approval → analyst → END`:

```bash
# Fresh run
npm run conductor-langgraph -- my-pipeline --question "Should we migrate to Postgres?"

# Crash mid-run, then resume — same slug, last checkpoint resumes
npm run conductor-langgraph -- my-pipeline

# Critic flagged HIGH/CRITICAL → workflow pauses at user_approval
npm run conductor-langgraph -- my-pipeline --status   # see paused state
npm run conductor-langgraph -- my-pipeline --resume --decision approve
```

The example workflow is in [`agents/conductor-langgraph.ts`](agents/conductor-langgraph.ts) — copy it as the starting point for your own stateful pipelines. The subprocess adapter ([`agents/lib/langgraph-subprocess.ts`](agents/lib/langgraph-subprocess.ts)) handles env-strip (subscription-flat), worker validation, marker extraction, and slug path-traversal defense.

**Worker-marker emit (opt-in extension):** the adapter exposes `emitLangGraphMarker()` for workers that want to publish a structured run-result on stdout. The 6 existing agents in this repo don't yet call it — markers are an opt-in extension point and the workflow falls back to exit-code + report-file detection without them. See `CONTRIBUTING.md` for how to wire markers into a custom worker.

**Migration path away from LangGraph (12-24 months):** the subprocess adapter is library-free. State schema is plain TypeScript types. Routing logic is 4 small if/else functions. Checkpoint tables are 4 normal Postgres tables. `interrupt()` replacement = a `PAUSED.json` marker file + manual resume. Migration effort: 1-2 days solo. **No vendor lock-in.**

#### Related work

The "LangGraph orchestrates state, Claude runs as subprocess" pattern is described independently in [mager.co's "LangGraph + Claude Agent SDK Ultimate Guide" (March 2026)](https://www.mager.co/blog/2026-03-07-langgraph-claude-agent-sdk-ultimate-guide/) and [Khaled Elfakharany's integration article](https://www.khaledelfakharany.com/articles/langgraph-claude-sdk-integration). Agent Fleet's contribution is the production-hardening: env-strip for subscription-flat billing, slug path-traversal validation, marker cross-field consistency checks, and a friendly install-pointer error on missing optional dependencies.

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
    base-agent.ts            # Core: Claude CLI subprocess + MCP config + file/DB output
    mcp-config.ts            # MCP server registry — pickMcp() for type-safe selection
    db.ts                    # Optional PostgreSQL persistence (no-ops without DATABASE_URL)
    langgraph-subprocess.ts  # opt-in (v0.2): worker spawn + marker extract for LangGraph
  research-agent.ts          # 8 research modes, parallel search
  critic-agent.ts            # Devil's advocate with independent verification
  analyst-agent.ts           # Code analysis, pattern finding, health checks
  discovery-agent.ts         # Code scanning with 7 focus areas
  repair-agent.ts            # Automated fixes from discovery findings
  cto-agent.ts               # Live code fixes, blast radius checking
  conductor.ts               # Multi-agent parallel discussion orchestrator (v0.1)
  conductor-langgraph.ts     # Stateful workflow + crash-resume + HITL (v0.2, opt-in)
scripts/
  setup-langgraph-checkpointer.ts  # idempotent schema setup (v0.2, opt-in)
reports/                     # Markdown reports with YAML frontmatter
```

### How It Works

1. Each agent is a **Claude CLI subprocess** (`claude -p --model X --max-turns Y`)
2. Agents get **MCP servers** for tool access (web search, code analysis, etc.)
3. Agents get **Claude Code tools** (Read, Edit, Write, Glob, Grep, Bash)
4. Output is parsed, cleaned, and saved as **Markdown reports**
5. Optionally persisted to **PostgreSQL** (no-ops without DATABASE_URL)

**Stateful mode (v0.2, opt-in):** the same Claude CLI subprocess pattern, but a LangGraph StateGraph wraps the worker spawns, persists state after every node to `langgraph.*` Postgres tables, and pauses via `interrupt()` when a node decides a human decision is needed. The subprocess adapter (`agents/lib/langgraph-subprocess.ts`) strips `ANTHROPIC_API_KEY` + `ANTHROPIC_AUTH_TOKEN` before spawn (so workers stay subscription-flat), validates the slug against path-traversal, and parses an optional structured marker workers may emit on stdout. Workers don't need to change — the marker emit is no-op when `AGENT_FLEET_LANGGRAPH=1` is unset.

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

This gives you the `agent_reports` + `agent_discussions` tables (used by `Conductor`).

**For `Conductor-LangGraph` (v0.2 stateful mode)**, the same `DATABASE_URL` is reused for the LangGraph checkpointer — it adds 4 tables under a separate `langgraph` schema (`checkpoints`, `checkpoint_blobs`, `checkpoint_writes`, `checkpoint_migrations`). Run the idempotent setup script once:

```bash
npm run langgraph:setup
```

The schema name is configurable via `LANGGRAPH_SCHEMA` (default `langgraph`), so you can host both modes in the same database without conflict.

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

[StudioMeyer](https://studiomeyer.io) is an AI and design studio from Palma de Mallorca, building custom websites and AI infrastructure for small and medium businesses. Production stack on Claude Agent SDK, MCP and n8n, with Sentry, Langfuse and LangGraph for observability and an in-house guard layer.

## License

MIT

---

<div align="center">

Built by [StudioMeyer](https://studiomeyer.io)

[AI Shield](https://github.com/studiomeyer-io/ai-shield) · [Darwin Agents](https://github.com/studiomeyer-io/darwin-agents) · [MCP Video](https://github.com/studiomeyer-io/mcp-video)

</div>