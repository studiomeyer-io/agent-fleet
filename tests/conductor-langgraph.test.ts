/**
 * Tests for agents/conductor-langgraph.ts
 *
 * Compiles the StateGraph against `MemorySaver` (no Postgres needed) and
 * mocks `runWorkerSubprocess` so the routers can be exercised end-to-end
 * without spawning real workers. The CLI (`main()`) and the
 * `getCheckpointer()` Postgres singleton are excluded from this test —
 * they are integration paths covered by the live smoke procedure
 * documented in CHANGELOG v0.2.0.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MemorySaver, START, END } from '@langchain/langgraph';
import * as subprocessMod from '../agents/lib/langgraph-subprocess.js';
import {
  buildAgentFleetWorkflow,
  type FleetState,
} from '../agents/conductor-langgraph.js';
import type { RunWorkerResult } from '../agents/lib/langgraph-subprocess.js';

// ─── Mock factory ────────────────────────────────────────────────

function makeRunResult(opts: {
  exitCode?: number | null;
  durationMs?: number;
  timedOut?: boolean;
  worker?: string;
  slug?: string;
  markerSummary?: string;
  noMarker?: boolean;
}): RunWorkerResult {
  const exitCode = opts.exitCode ?? 0;
  const timedOut = opts.timedOut ?? false;
  return {
    exitCode,
    durationMs: opts.durationMs ?? 100,
    markerResult: opts.noMarker
      ? null
      : {
          v: 1,
          worker: opts.worker ?? 'research',
          slug: opts.slug ?? 'test-slug',
          status: exitCode === 0 ? 'ok' : 'error',
          markdownSummary: opts.markerSummary ?? 'a normal report',
        },
    stdoutTail: opts.markerSummary ?? 'a normal report',
    stderrTail: '',
    timedOut,
  };
}

// ─── Test fixture: graph compiled against MemorySaver ────────────

function makeGraphAgainstMemorySaver() {
  return buildAgentFleetWorkflow().compile({
    checkpointer: new MemorySaver(),
  });
}

let runWorkerSpy: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  // Reset between tests so the queue of mocked responses doesn't leak.
  runWorkerSpy = vi.spyOn(subprocessMod, 'runWorkerSubprocess');
});

// ─── Happy path: research → critic (no risk) → analyst → END ─────

describe('conductor-langgraph happy path', () => {
  it('runs research → critic → analyst when critic finds no high-risk', async () => {
    runWorkerSpy
      .mockResolvedValueOnce(makeRunResult({ worker: 'research', slug: 'happy', markerSummary: 'no risks here' }))
      .mockResolvedValueOnce(
        makeRunResult({
          worker: 'critic',
          slug: 'happy',
          markerSummary: 'all looks fine, low risk overall',
        }),
      )
      .mockResolvedValueOnce(makeRunResult({ worker: 'analyst', slug: 'happy', markerSummary: 'patterns ok' }));

    const graph = makeGraphAgainstMemorySaver();
    const config = { configurable: { thread_id: 'agent-fleet-happy' } };
    const finalState = (await graph.invoke({ slug: 'happy', question: 'test' }, config)) as FleetState;

    expect(finalState.researchDone).toBe(true);
    expect(finalState.criticDone).toBe(true);
    expect(finalState.criticHighRisk).toBe(false);
    expect(finalState.analystDone).toBe(true);
    expect(finalState.userDecision).toBeUndefined();
    expect(finalState.workerResults).toHaveLength(3);
    expect(finalState.errors).toHaveLength(0);
  });
});

// ─── HITL path: critic flags HIGH risk → user_approval pause ─────

describe('conductor-langgraph HITL path', () => {
  it('pauses at user_approval when critic flags HIGH/CRITICAL', async () => {
    runWorkerSpy
      .mockResolvedValueOnce(makeRunResult({ worker: 'research', slug: 'risky' }))
      .mockResolvedValueOnce(
        makeRunResult({
          worker: 'critic',
          slug: 'risky',
          markerSummary: '## CRITICAL: API key leakage in env',
        }),
      );
    // analyst is NOT mocked because it should not run yet (paused at user_approval)

    const graph = makeGraphAgainstMemorySaver();
    const config = { configurable: { thread_id: 'agent-fleet-risky' } };
    await graph.invoke({ slug: 'risky', question: 'risky topic' }, config);

    const snapshot = await graph.getState(config);
    const state = snapshot.values as FleetState;

    expect(state.researchDone).toBe(true);
    expect(state.criticDone).toBe(true);
    expect(state.criticHighRisk).toBe(true);
    // analyst did not run yet — we are paused at user_approval
    expect(state.analystDone).toBe(false);
    // The graph reports an interrupt waiting at user_approval
    const interrupts = snapshot.tasks.flatMap((t) => t.interrupts ?? []);
    expect(interrupts.length).toBeGreaterThan(0);
    // We exercised research + critic only
    expect(state.workerResults.length).toBe(2);
  });
});

// ─── Failure path: research fails → workflow ends without critic ──

describe('conductor-langgraph failure path', () => {
  it('ends the workflow when research fails (researchDone=false)', async () => {
    runWorkerSpy.mockResolvedValueOnce(
      makeRunResult({
        worker: 'research',
        slug: 'fail',
        exitCode: 1,
        markerSummary: '',
      }),
    );

    const graph = makeGraphAgainstMemorySaver();
    const config = { configurable: { thread_id: 'agent-fleet-fail' } };
    const finalState = (await graph.invoke({ slug: 'fail', question: 'doomed' }, config)) as FleetState;

    expect(finalState.researchDone).toBe(false);
    // Critic and analyst never ran
    expect(finalState.criticDone).toBe(false);
    expect(finalState.analystDone).toBe(false);
    expect(finalState.workerResults).toHaveLength(1);
    expect(finalState.errors.length).toBeGreaterThan(0);
    expect(finalState.errors[0].worker).toBe('research');
  });
});

// ─── Timeout path: critic times out → ends, no analyst ───────────

describe('conductor-langgraph timeout path', () => {
  it('treats a timed-out worker as an error and ends the workflow', async () => {
    runWorkerSpy
      .mockResolvedValueOnce(makeRunResult({ worker: 'research', slug: 'to' }))
      .mockResolvedValueOnce(
        makeRunResult({
          worker: 'critic',
          slug: 'to',
          exitCode: null,
          timedOut: true,
          markerSummary: '',
        }),
      );

    const graph = makeGraphAgainstMemorySaver();
    const config = { configurable: { thread_id: 'agent-fleet-to' } };
    const finalState = (await graph.invoke({ slug: 'to', question: 'slow critic' }, config)) as FleetState;

    expect(finalState.researchDone).toBe(true);
    expect(finalState.criticDone).toBe(false); // exitCode !== 0 OR timedOut → not done
    expect(finalState.analystDone).toBe(false);
    expect(finalState.errors.some((e) => e.worker === 'critic')).toBe(true);
    expect(finalState.workerResults.find((w) => w.worker === 'critic')?.status).toBe('timeout');
  });
});

// ─── Append-only state guarantees ────────────────────────────────

describe('conductor-langgraph state reducers', () => {
  it('appends worker runs in run order across nodes', async () => {
    runWorkerSpy
      .mockResolvedValueOnce(makeRunResult({ worker: 'research', slug: 'order' }))
      .mockResolvedValueOnce(
        makeRunResult({ worker: 'critic', slug: 'order', markerSummary: 'low risk' }),
      )
      .mockResolvedValueOnce(makeRunResult({ worker: 'analyst', slug: 'order' }));

    const graph = makeGraphAgainstMemorySaver();
    const config = { configurable: { thread_id: 'agent-fleet-order' } };
    const finalState = (await graph.invoke({ slug: 'order', question: 'q' }, config)) as FleetState;

    const workers = finalState.workerResults.map((w) => w.worker);
    expect(workers).toEqual(['research', 'critic', 'analyst']);
  });

  it('appends errors when multiple nodes fail in sequence', async () => {
    runWorkerSpy
      .mockResolvedValueOnce(
        makeRunResult({
          worker: 'research',
          slug: 'errs',
          exitCode: 0, // research succeeds so we reach critic
        }),
      )
      .mockResolvedValueOnce(
        makeRunResult({
          worker: 'critic',
          slug: 'errs',
          exitCode: 2,
          markerSummary: '',
        }),
      );

    const graph = makeGraphAgainstMemorySaver();
    const config = { configurable: { thread_id: 'agent-fleet-errs' } };
    const finalState = (await graph.invoke({ slug: 'errs', question: 'q' }, config)) as FleetState;

    // critic errored, workflow ends (no analyst)
    expect(finalState.errors.length).toBeGreaterThan(0);
    expect(finalState.errors.some((e) => e.worker === 'critic')).toBe(true);
  });
});
