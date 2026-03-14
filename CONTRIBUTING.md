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
    base-agent.ts    # Core runtime: Claude CLI subprocess + MCP + output
    mcp-config.ts    # MCP server registry with pickMcp()
    db.ts            # Optional PostgreSQL persistence
  research-agent.ts  # 8 research modes
  critic-agent.ts    # Devil's advocate
  analyst-agent.ts   # Code analysis & health checks
  discovery-agent.ts # Code scanning (7 focus areas)
  repair-agent.ts    # Automated bug fixing
  cto-agent.ts       # Live code fixes
  conductor.ts       # Multi-agent parallel discussion
reports/             # Generated reports (gitignored)
```

## How to Contribute

### Adding a New Agent

1. Create `agents/my-agent.ts`
2. Import `runAgent` from `./lib/base-agent.js` and `pickMcp` from `./lib/mcp-config.js`
3. Define an `AgentConfig` with name, type, model, MCP servers, and tools
4. Build a prompt and call `runAgent(config, options)`
5. Add an npm script in `package.json`

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
