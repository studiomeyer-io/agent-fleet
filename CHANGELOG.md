# Changelog

## [Unreleased] — Round-4 OSS-Sweep (2026-04-24)

Triple-agent review surfaced two defects that had been documented internally
(Session 837) but never shipped to the public `agent-fleet` tree.

### Security

- **`spawn('claude')` no longer leaks user Anthropic API credentials.** Both
  `base-agent.ts` spawn call-sites (single-round + conductor-round) now
  strip `ANTHROPIC_API_KEY` and `ANTHROPIC_AUTH_TOKEN` from the cleaned env
  before invoking the Claude CLI. Without this strip every `agent-fleet`
  user with an API key in their shell was being billed at full API rates
  for each research/critic/analyst run instead of consuming their paid
  Claude Pro / Max subscription. Opt-in via `AGENT_FLEET_USE_API_KEY=1`
  for CI or server-side usage where a billed key is the intended credential.

### Fixed

- **SIGTERM output-guard tightened.** The previous `stdout.length > 100`
  bar accepted essentially any startup noise as a partial success — a
  mid-run timeout would resolve with whatever happened to be buffered.
  Now requires `stdout.length >= 500` **and** `stdout.includes('## ')`
  (a real markdown header) before treating SIGTERM as a usable partial
  result. Same guard applies to both spawn call-sites.

### Added

- **7 new static regression tests** (`tests/env-hardening.test.ts`) that
  pin the env-strip contract and the SIGTERM guard shape in source. Can't
  stub `spawn()` cheaply, but any refactor that silently drops the
  ANTHROPIC_API_KEY strip or re-introduces the permissive `> 100` bar now
  breaks the test suite. Total: 158 → 165 tests, all green.

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
