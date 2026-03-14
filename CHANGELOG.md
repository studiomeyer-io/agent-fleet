# Changelog

## 0.1.0 (2026-03-14)

### Added

- **Research Agent** — 8 research modes: general, vision, tech, product, competitor, paper, idea, news
- **Critic Agent** — Devil's advocate with independent verification. Modes: general, report, idea, plan
- **Analyst Agent** — Code archaeologist with project analysis, comparison, pattern finding, health checks
- **Discovery Agent** — Code scanner with 7 focus areas: full, security, dead-code, types, errors, patterns, debt
- **Repair Agent** — Automated bug fixer that works from Discovery findings or manual issues. Dry-run mode available
- **CTO Agent** — Live code fixer with blast radius checking. Standalone and conductor-compatible
- **Conductor** — Multi-agent parallel discussion orchestrator. 4 modes: open, debate, review, improve. 2-4 rounds with synthesis
- **Base Agent** (`agents/lib/base-agent.ts`) — Claude CLI subprocess runtime with MCP config, output parsing, file saving
- **MCP Config** (`agents/lib/mcp-config.ts`) — Type-safe MCP server registry with `pickMcp()`. 6 npx-based servers
- **DB** (`agents/lib/db.ts`) — Optional PostgreSQL persistence. Silent no-op without DATABASE_URL
- **Schema** (`schema.sql`) — PostgreSQL schema for agent_reports and agent_discussions tables
