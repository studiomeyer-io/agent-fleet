# Changelog

## 0.2.0 (2026-05-02)

**Stateful workflows with LangGraph — opt-in, no breaking changes.**

`v0.1` (parallel `Conductor`) is the right tool for ~80% of cases. `v0.2` adds an opt-in stateful counterpart for the long pipelines where you want crash-resume, conditional branching native to the graph, and Human-in-the-Loop pauses on high-risk findings.

### Added

- **`agents/conductor-langgraph.ts`** — example stateful workflow using LangGraph 1.x:
  - 5-node graph: `research → critic → [HIGH risk?] → user_approval → analyst → END`
  - Postgres-backed checkpoints in a dedicated `langgraph` schema (separate from `agent_reports`)
  - Crash-resume: kill the workflow mid-run, resume with the same slug, LangGraph picks up from the last checkpoint — no re-running finished agents
  - `interrupt()` Human-in-the-Loop when the Critic agent surfaces HIGH/CRITICAL findings; resume via `--resume --decision approve|reject|revise`
  - Append-only audit trail (`workerResults`, `errors`) via Annotation reducers
  - `--status` flag for non-destructive state inspection
  - LangGraph imports are wrapped in a graceful try/catch so users who installed without `--include=optional` get a friendly error pointing at the install command instead of a stack trace
- **`agents/lib/langgraph-subprocess.ts`** — subprocess adapter that powers `conductor-langgraph.ts`:
  - `runWorkerSubprocess({worker, args, slug, timeoutMs, dryRun, pipe})` spawns Agent Fleet workers with the same env-strip pattern as `base-agent.ts` (subscription-flat by default; `AGENT_FLEET_USE_API_KEY=1` opts back into API billing)
  - `assertValidSlug()` rejects path-traversal patterns before they reach the Postgres `thread_id`
  - `assertValidWorker()` whitelist allowlists the 6 spawnable agent types (`research`, `critic`, `analyst`, `cto`, `discovery`, `repair`). `conductor` is the orchestrator, not a worker, and is intentionally excluded.
  - `extractMarkerResult()` parses the `__AGENT_FLEET_LANGGRAPH_RESULT_BEGIN__ … END` JSON marker workers may emit on stdout (last marker wins, malformed markers return null)
  - `isMarkerConsistent(marker, expectedWorker, expectedSlug)` cross-field check — if a worker's marker names the wrong worker or wrong slug, the StateGraph node ignores it and records an error in `state.errors` instead of letting it corrupt state
  - `emitLangGraphMarker(result)` helper for workers; no-op when `AGENT_FLEET_LANGGRAPH=1` is unset (additive, doesn't change CLI behavior). **Note:** the 6 existing agents in this repo do not yet call this helper — markers are an opt-in extension point. The adapter falls back to file-based detection (worker exit code + report file presence) so workflows still complete correctly without it.
  - `WorkerSubprocessError` typed class for crash diagnostics
- **`scripts/setup-langgraph-checkpointer.ts`** — idempotent Postgres schema setup. `await saver.setup()` is `CREATE IF NOT EXISTS` — re-running is safe.
- **`tests/langgraph-subprocess.test.ts`** — 30 unit tests covering slug validation, worker whitelist, marker extraction (incl. multiple-markers, malformed JSON, missing fields, whitespace tolerance), and cross-field consistency.
- **`tests/conductor-langgraph.test.ts`** — 6 integration tests that compile the `StateGraph` against `MemorySaver` (no Postgres needed) and mock `runWorkerSubprocess` to exercise the routers end-to-end: happy path, HITL-pause on high-risk, research-failure path, timeout path, and the append-only state-reducer guarantees.
- Total: 165 → 201 tests, all green.
- **`npm run conductor-langgraph`** + **`npm run langgraph:setup`** scripts in `package.json`.
- CI workflow now installs with `npm ci --include=optional` so the LangGraph code path is type-checked and tested in CI as well.
- `tsconfig.json` `include` extended with `scripts/**/*.ts` so the setup script is type-checked too.

### Optional Dependencies

`@langchain/langgraph` (^1.2.9) and `@langchain/langgraph-checkpoint-postgres` (^1.0.1) are added as **optional** dependencies. Both packages are on the LangGraph 1.0 LTS channel (released October 2025); the [v1 migration guide](https://docs.langchain.com/oss/javascript/migrate/langchain-v1) only covers prebuilt-agent helpers, the graph primitives we use (`Annotation.Root`, `StateGraph`, `interrupt`, `Command`) are unchanged from 0.x.

Install with `npm install --include=optional` if you want to use the LangGraph workflow. The default `npm install` skips them — `Conductor` (parallel mode) keeps working without any LangGraph install, and `conductor-langgraph` prints a friendly install-pointer error instead of a stack trace.

### Why opt-in (and not the default)

The parallel `Conductor` is simpler, has no Postgres dependency, and is the right answer for most discussions, idea reviews, and quick brainstorms. The LangGraph mode is for the cases where you want to kill the workflow mid-run and resume, or pause for human approval on findings that need a real decision. Both modes share the same Claude Code CLI subprocess pattern underneath — agents don't change.

### Migration path away from LangGraph

If LangGraph's licensing or pricing changes in 12-24 months: the subprocess adapter is library-free, the state schema is plain TypeScript types, the routing logic is 4 small if/else functions, the checkpoint tables are 4 normal Postgres tables. `interrupt()` replacement = a `PAUSED.json` marker file + a manual resume script. Migration effort: 1-2 days solo. **No vendor lock-in.**

---

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
