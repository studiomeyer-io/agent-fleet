# Contributing to Agent Fleet

Thanks for your interest in contributing! Agent Fleet is a multi-agent orchestration framework for Claude Code CLI.

## Development Setup

```bash
git clone https://github.com/studiomeyer-io/agent-fleet.git
cd agent-fleet
npm install
```

### Prerequisites

- Node.js >= 18
- Claude Code CLI (`npm install -g @anthropic-ai/claude-code`)
- Claude Max Plan (recommended for flat-rate multi-agent usage)

### Type Check

```bash
npm run typecheck
```

## Project Structure

```
agents/
  lib/
    base-agent.ts            # Core runtime: Claude CLI subprocess + MCP + output
    mcp-config.ts            # MCP server registry with pickMcp()
    db.ts                    # Optional PostgreSQL persistence
    langgraph-subprocess.ts  # opt-in (v0.2): LangGraph subprocess adapter
  research-agent.ts          # 8 research modes
  critic-agent.ts            # Devil's advocate
  analyst-agent.ts           # Code analysis & health checks
  discovery-agent.ts         # Code scanning (7 focus areas)
  repair-agent.ts            # Automated bug fixing
  cto-agent.ts               # Live code fixes
  conductor.ts               # Multi-agent parallel discussion (v0.1)
  conductor-langgraph.ts     # Stateful workflow + crash-resume + HITL (v0.2, opt-in)
scripts/
  setup-langgraph-checkpointer.ts  # idempotent schema setup (v0.2, opt-in)
reports/                     # Generated reports (gitignored)
```

## How to Contribute

### Adding a New Agent

1. Create `agents/my-agent.ts`
2. Import `runAgent` from `./lib/base-agent.js` and `pickMcp` from `./lib/mcp-config.js`
3. Define an `AgentConfig` with name, type, model, MCP servers, and tools
4. Build a prompt and call `runAgent(config, options)`
5. Add an npm script in `package.json`
6. **If you want LangGraph orchestration to recognize the agent**, also:
   - Add the worker name to the whitelist regex in `agents/lib/langgraph-subprocess.ts` (`WORKER_PATTERN`)
   - Optionally call `emitLangGraphMarker()` at the end of your agent's `main()` so the StateGraph sees a structured run-result (the helper is no-op when `AGENT_FLEET_LANGGRAPH=1` is unset, so adding it doesn't change CLI behavior)

### Adding a Custom Stateful Workflow (v0.2+)

`agents/conductor-langgraph.ts` is the example workflow shipped with the repo. Copy it as a starting point:

1. Define your `Annotation.Root({ ... })` state schema with reducers for each field (`workerResults: append`, `totalCost: sum`, etc.)
2. Implement node functions — each is `async (state) => Promise<StateUpdate>` and typically calls `runWorkerSubprocess({worker, args, slug, ...})`
3. Wire conditional routers via `addConditionalEdges(node, router, [allowedTargets])`
4. Use `interrupt()` for Human-in-the-Loop pauses; resume via `Command({ resume: { decision } })` with the same thread_id
5. Tests can run against `MemorySaver` instead of `PostgresSaver` for unit tests

See `agents/conductor-langgraph.ts` for a concrete reference.

### Adding MCP Servers

Edit `agents/lib/mcp-config.ts` and add your server to the `mcpServers` object. Use `npx`-based servers for zero-install portability.

### Code Style

- TypeScript strict mode, no `any`
- ES modules (`import`/`export`)
- Minimal dependencies
- Prompts in English

### Pull Requests

1. Fork the repo
2. Create a feature branch (`git checkout -b feat/my-agent`)
3. Make your changes
4. Run `npm run typecheck`
5. Commit with a descriptive message
6. Open a PR

## Reporting Issues

Open an issue on GitHub with:
- What you expected
- What happened
- Steps to reproduce
- Your Node.js version and OS

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
