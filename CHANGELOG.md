# Changelog

## 0.3.0 (2026-06-21)

**First release on npm as `@studiomeyer-io/agent-fleet`.**

### Added — npm distribution

- **Published to npm as `@studiomeyer-io/agent-fleet`** — `npx @studiomeyer-io/agent-fleet <command>`
  or `npm i -g`. (The unscoped `agent-fleet` name on npm belongs to an unrelated package.)
- **`agent-fleet` CLI** (`bin`) routing to every agent — `agent-fleet conductor`,
  `agent-fleet research --tech "..."`, etc. Compiled to `dist/` with `tsc`
  (`npm run build`; `prepublishOnly` gates publish on build + lint + typecheck + test).
- **`isEntrypoint` guard on every agent's `main()`** — importing one agent from
  another (the conductor imports the cto agent for its config) or from a test no
  longer kicks off a second agent's CLI. Fixes `agent-fleet conductor` printing the
  CTO usage.
- **Reports write to `./reports` in the current working directory** (was the package
  dir, unwritable under `node_modules`). Override with `AGENT_FLEET_REPORTS_DIR`.
- **LangGraph worker spawns auto-detect** compiled (`node dist/agents/*.js`) vs
  git-clone (`npx tsx agents/*.ts`) mode.
- **Library entry** — `import { runAgent, pickMcp } from '@studiomeyer-io/agent-fleet'`.
- **Release workflow** publishes to npm with provenance (OIDC) and cuts a GitHub
  Release on a `v*` tag.

### Changed

- **`pg` + LangGraph are now optional `peerDependencies`** — installed only if you
  use the DB persistence / stateful mode, keeping the default install lean.
- The Tavily-key warning now fires once per process instead of once per agent config.

### Security & Correctness

- **MCP registry no longer ships fictional npm packages.** Four of the six entries
  in `agents/lib/mcp-config.ts` (`@anthropic/code-pathfinder-mcp`,
  `@nicholasarner/context-mcp`, `@anthropic/github-mcp`,
  `@anthropic/sequential-thinking-mcp`) do not exist on npm — `npx -y` failed on
  them, so the Analyst / Discovery / Repair / CTO agents that depended on
  `code-pathfinder` could not start their advertised tooling. The registry is now
  three real, npx-resolvable servers (`@upstash/context7-mcp`, `tavily-mcp`,
  `@modelcontextprotocol/server-sequential-thinking`); code analysis runs on
  Claude Code's built-in Read/Glob/Grep/Bash tools. Agent prompts, the README MCP
  table, and the tests were updated to match. New regression test asserts every
  registered server resolves to a known package.
- **`db.ts` drops a non-null assertion for a real guard.** `new PoolCtor!(...)`
  became an explicit `if (!PoolCtor) throw …` with a clear "pg is not installed"
  message (pg is an optional dependency).

### Added — tooling & supply chain

- **Biome 2.5** (lint + format) — `biome.json` (recommended preset, single-quote
  TS style), `npm run check` / `check:fix` / `lint` / `format`, enforced in CI.
- **Vitest coverage gate** — `vitest.config.ts` with `@vitest/coverage-v8` and
  regression-floor thresholds (lines/statements 33, branches 30, functions 45),
  `npm run coverage`, wired into CI.
- **CodeQL** static analysis workflow (`javascript-typescript`, `build-mode: none`).
- **OpenSSF Scorecard** workflow + README badge (matches the rest of the
  studiomeyer-io OSS fleet).
- **Release workflow** — cuts a GitHub Release on a `v*` tag, gated on a green tree.
- **`.editorconfig`, `.nvmrc` (22), `CITATION.cff`.**

### Changed

- **Node floor raised 18 → 22.** Node 18 and 20 are both end-of-life (2025-04 /
  2026-03). `engines.node`, the CI matrix (now `[22, 24]`), README and CONTRIBUTING
  are aligned. CI also hardened: least-privilege `permissions: contents: read`,
  `concurrency` cancel-in-progress, and a `npm audit --audit-level=high` job.
- **`package.json` marked `private`.** The `agent-fleet` name on npm belongs to an
  unrelated package, and Agent Fleet is distributed by git clone — `private` makes
  that explicit and prevents an accidental publish.

### Removed

- **Stale npm-version badge** in the README — it pointed at the unrelated
  `agent-fleet` package on npm, not this project.

### Fixed

- **`runWorkerSubprocess` docs no longer steer forkers into a rejected call.** The
  module-level JSDoc example showed `worker: 'research'`, but `runWorkerSubprocess`
  validates the name against `WORKER_PATTERN` (which requires the `-agent` suffix)
  and maps it to `agents/<worker>.ts`. Copying the example verbatim threw
  `Invalid worker "research"`. The example now uses `worker: 'research-agent'` with
  a note on the naming rule.
- **`assertValidWorker` error message stopped advertising a value it rejects.** It
  listed `...|repair|conductor)-agent` even though `conductor` is intentionally not a
  spawnable worker (there is a test asserting it is rejected). The message now lists
  only the six real workers and explains that `conductor` is the orchestrator.
- **CHANGELOG/CI consistency:** the 0.2.0 note claimed CI installs with
  `npm ci --include=optional`; the workflow actually uses `npm install --include=optional`
  (npm ci skipped optional deps unreliably across the matrix). Corrected.

### Added

- **Test coverage on the orchestration core** (165 -> 201 -> **220** tests):
  - `runWorkerSubprocess` input-validation: invalid worker / bare `research` /
    path-traversal worker / path-traversal slug / empty slug all **reject the
    returned Promise before any `spawn()`** (fast, side-effect free).
  - `WorkerSubprocessError` shape: `Error` subclass, `name`/`worker`/`result` preserved.
  - `detectHighRisk` (the Human-in-the-Loop routing gate) — `CRITICAL` + `HIGH`-as-marker
    matching, and the false-positive guards (`highest`, `highlight` must NOT trigger a pause).
  - `recordWorkerRun` sub-agent outcome -> status mapping — `ok`/`error`/`timeout`,
    including timeout-wins-over-stale-exit-code and null-exit-without-timeout -> `error`.
  - `detectHighRisk` and `recordWorkerRun` are now exported (`@internal`) for direct unit testing.

### Docs

- **Quick Start** now shows the verify step (`npm run typecheck` + `npm test`) and notes
  the optional `--include=optional` install for LangGraph mode, so a fresh clone can confirm
  it works before wiring in agents.

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
- CI workflow now installs with `npm install --include=optional` so the LangGraph code path is type-checked and tested in CI as well. (`npm ci` skipped optional deps unreliably across the Node-version matrix.)
- `tsconfig.json` `include` extended with `scripts/**/*.ts` so the setup script is type-checked too.

### Optional Dependencies

`@langchain/langgraph` (^1.2.9) and `@langchain/langgraph-checkpoint-postgres` (^1.0.1) are added as **optional** dependencies. Both packages are on the LangGraph 1.0 LTS channel (released October 2025); the [v1 migration guide](https://docs.langchain.com/oss/javascript/migrate/langchain-v1) only covers prebuilt-agent helpers, the graph primitives we use (`Annotation.Root`, `StateGraph`, `interrupt`, `Command`) are unchanged from 0.x.

Install with `npm install --include=optional` if you want to use the LangGraph workflow. The default `npm install` skips them — `Conductor` (parallel mode) keeps working without any LangGraph install, and `conductor-langgraph` prints a friendly install-pointer error instead of a stack trace.

**Node version requirement for the LangGraph mode is Node >= 20** (transitively via `@langchain/core`'s `engines.node`). The repo's own `engines.node` stays at `>=18` because the parallel `Conductor` mode still works fine there — but if you opt into LangGraph, your runtime needs to be 20 or newer. CI matrix tests Node 20 and 22.

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
