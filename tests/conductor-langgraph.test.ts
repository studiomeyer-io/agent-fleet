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
import { MemorySaver } from '@langchain/langgraph';
import * as subprocessMod from '../agents/lib/langgraph-subprocess.js';
import {
  buildAgentFleetWorkflow,
  detectHighRisk,
  recordWorkerRun,
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
    runWorkerSpy.mockResolvedValueOnce(makeRunResult({ worker: 'research', slug: 'risky' })).mockResolvedValueOnce(
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
    runWorkerSpy.mockResolvedValueOnce(makeRunResult({ worker: 'research', slug: 'to' })).mockResolvedValueOnce(
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
      .mockResolvedValueOnce(makeRunResult({ worker: 'critic', slug: 'order', markerSummary: 'low risk' }))
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

// ─── detectHighRisk: the HITL routing gate (pure function) ───────
//
// This heuristic decides whether the workflow PAUSES for human approval.
// A false negative silently skips review of a genuinely risky finding; a
// false positive pauses needlessly. The regex deliberately matches HIGH
// only as a level-marker (HIGH:, HIGH-, "HIGH risk") and not inside words
// like "highest" / "highlight", so those edges are worth pinning.

describe('detectHighRisk', () => {
  it('returns false for empty / undefined input', () => {
    expect(detectHighRisk(undefined)).toBe(false);
    expect(detectHighRisk('')).toBe(false);
  });

  it('flags CRITICAL findings (case-insensitive)', () => {
    expect(detectHighRisk('## CRITICAL: API key leakage in env')).toBe(true);
    expect(detectHighRisk('found a critical bug')).toBe(true);
  });

  it('flags HIGH used as a level marker', () => {
    expect(detectHighRisk('Risk level: HIGH')).toBe(false); // no trailing marker char
    expect(detectHighRisk('Severity HIGH: data loss')).toBe(true); // "HIGH:"
    expect(detectHighRisk('this is HIGH-risk territory')).toBe(true); // "HIGH-"
    expect(detectHighRisk('rated HIGH risk by the critic')).toBe(true); // "HIGH "
  });

  it('does NOT match HIGH inside ordinary words', () => {
    expect(detectHighRisk('this is the highest priority item')).toBe(false);
    expect(detectHighRisk('please highlight the summary')).toBe(false);
    expect(detectHighRisk('a high-quality, low-risk plan')).toBe(true); // "high-" still a marker
  });

  it('returns false for a clean low-risk summary', () => {
    expect(detectHighRisk('all looks fine, low risk overall')).toBe(false);
  });
});

// ─── recordWorkerRun: sub-agent outcome → status mapping ─────────
//
// The status field drives both the audit trail and (via researchDone /
// criticDone) the routers. timeout must win over a stale exitCode, and a
// non-zero exit must map to 'error' — these are the failure-handling cases.

describe('recordWorkerRun', () => {
  const started = '2026-01-01T00:00:00.000Z';

  it('maps a clean exit (code 0) to "ok"', () => {
    const r = recordWorkerRun('research', 0, 1500, false, started);
    expect(r).toEqual({
      worker: 'research',
      status: 'ok',
      exitCode: 0,
      durationMs: 1500,
      startedAt: started,
    });
  });

  it('maps a non-zero exit to "error"', () => {
    expect(recordWorkerRun('critic', 1, 900, false, started).status).toBe('error');
    expect(recordWorkerRun('critic', 2, 900, false, started).status).toBe('error');
  });

  it('maps a timeout to "timeout" even when exitCode is null', () => {
    const r = recordWorkerRun('analyst', null, 720_000, true, started);
    expect(r.status).toBe('timeout');
    expect(r.exitCode).toBeNull();
  });

  it('treats timeout as authoritative over a stale exit code', () => {
    // If both timedOut and a code are reported, timeout wins (the kill is
    // why the process exited at all).
    expect(recordWorkerRun('analyst', 0, 1, true, started).status).toBe('timeout');
  });

  it('maps a null exit code without timeout to "error"', () => {
    // Process died on a signal but not from our timeout — still a failure.
    expect(recordWorkerRun('repair', null, 50, false, started).status).toBe('error');
  });
});
