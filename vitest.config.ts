import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      // Only agents/ is in the unit-coverage scope. scripts/ is live-Postgres
      // setup glue (run by `npm run langgraph:setup`), not unit-tested, so it's
      // left out of the scope rather than excluded — it would otherwise report
      // a misleading 0%.
      include: ['agents/**/*.ts'],
      exclude: [
        // CLI router + process spawn glue, and the re-export barrel — these are
        // integration surface (verified by the npm-pack install smoke test),
        // not unit logic.
        'agents/cli.ts',
        'agents/index.ts',
      ],
      reporter: ['text', 'lcov', 'html'],
      // Floors, not targets. Agent Fleet spawns the `claude` CLI as a
      // subprocess for the actual work, so runAgent / runDiscussionRound and the
      // per-agent main() CLI parsers are integration paths, not unit-covered.
      // The suite covers the pure logic (prompt + config builders, marker
      // parsing, LangGraph routers, slug/worker validation). These thresholds
      // guard that covered surface against regressions (deleted tests, newly
      // added untested logic) — they are not a quality target for spawn glue.
      thresholds: {
        statements: 24,
        branches: 23,
        functions: 42,
        lines: 24,
      },
    },
  },
});
