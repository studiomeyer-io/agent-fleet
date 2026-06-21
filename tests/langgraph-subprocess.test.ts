/**
 * Tests for agents/lib/langgraph-subprocess.ts
 *
 * Pure-function tests (no spawn). spawn() integration is tested live via
 * the conductor-langgraph CLI — there's no cheap way to mock it without
 * losing the env-strip + marker contract that we actually care about.
 */

import { describe, it, expect } from 'vitest';
import {
  assertValidSlug,
  assertValidWorker,
  extractMarkerResult,
  isMarkerConsistent,
  runWorkerSubprocess,
  WorkerSubprocessError,
  LANGGRAPH_RESULT_BEGIN_MARKER,
  LANGGRAPH_RESULT_END_MARKER,
  type RunWorkerResult,
  type WorkerStdoutResult,
} from '../agents/lib/langgraph-subprocess.js';

describe('assertValidSlug', () => {
  it('accepts canonical slugs', () => {
    expect(() => assertValidSlug('my-workflow')).not.toThrow();
    expect(() => assertValidSlug('research-2026')).not.toThrow();
    expect(() => assertValidSlug('a')).not.toThrow();
  });

  it('rejects empty input', () => {
    expect(() => assertValidSlug('')).toThrow(/empty|not a string/);
  });

  it('rejects path-traversal patterns', () => {
    expect(() => assertValidSlug('../etc/passwd')).toThrow(/Invalid slug/);
    expect(() => assertValidSlug('foo/bar')).toThrow(/Invalid slug/);
    expect(() => assertValidSlug('foo\\bar')).toThrow(/Invalid slug/);
  });

  it('rejects uppercase + special chars', () => {
    expect(() => assertValidSlug('My-Workflow')).toThrow(/Invalid slug/);
    expect(() => assertValidSlug('foo bar')).toThrow(/Invalid slug/);
    expect(() => assertValidSlug('foo_bar')).toThrow(/Invalid slug/);
    expect(() => assertValidSlug('foo.bar')).toThrow(/Invalid slug/);
  });

  it('rejects slugs starting with hyphen', () => {
    expect(() => assertValidSlug('-foo')).toThrow(/Invalid slug/);
  });

  it('rejects slugs longer than 100 chars', () => {
    const long = 'a'.repeat(101);
    expect(() => assertValidSlug(long)).toThrow(/Invalid slug/);
  });

  it('accepts the boundary 100-char slug', () => {
    const exact = 'a'.repeat(100);
    expect(() => assertValidSlug(exact)).not.toThrow();
  });

  it('rejects null-byte injection', () => {
    expect(() => assertValidSlug('foo\0bar')).toThrow(/Invalid slug/);
  });
});

describe('assertValidWorker', () => {
  it('accepts the 6 spawnable agent types', () => {
    expect(() => assertValidWorker('research-agent')).not.toThrow();
    expect(() => assertValidWorker('critic-agent')).not.toThrow();
    expect(() => assertValidWorker('analyst-agent')).not.toThrow();
    expect(() => assertValidWorker('cto-agent')).not.toThrow();
    expect(() => assertValidWorker('discovery-agent')).not.toThrow();
    expect(() => assertValidWorker('repair-agent')).not.toThrow();
  });

  it('rejects conductor — the orchestrator, not a spawned worker', () => {
    expect(() => assertValidWorker('conductor-agent')).toThrow(/Invalid worker/);
  });

  it('error message does not advertise conductor as a valid worker', () => {
    // Regression: the message used to list "...|repair|conductor)-agent",
    // telling callers to use a value the pattern then rejects.
    let message = '';
    try {
      assertValidWorker('conductor-agent');
    } catch (err) {
      message = (err as Error).message;
    }
    expect(message).toContain('Invalid worker');
    // The allow-list shown to the user must NOT include conductor.
    expect(message).not.toMatch(/repair\|conductor/);
    expect(message).toMatch(/research\|critic\|analyst\|cto\|discovery\|repair\)-agent/);
  });

  it('rejects empty input', () => {
    expect(() => assertValidWorker('')).toThrow(/empty|not a string/);
  });

  it('rejects unknown workers', () => {
    expect(() => assertValidWorker('foo-agent')).toThrow(/Invalid worker/);
    expect(() => assertValidWorker('research')).toThrow(/Invalid worker/); // missing -agent
    expect(() => assertValidWorker('research-tool')).toThrow(/Invalid worker/);
  });

  it('rejects path-traversal in worker name', () => {
    expect(() => assertValidWorker('../research-agent')).toThrow(/Invalid worker/);
    expect(() => assertValidWorker('research-agent/../malicious')).toThrow(/Invalid worker/);
  });
});

describe('extractMarkerResult', () => {
  function wrapMarker(json: string): string {
    return `${LANGGRAPH_RESULT_BEGIN_MARKER}\n${json}\n${LANGGRAPH_RESULT_END_MARKER}`;
  }

  it('returns null for empty string', () => {
    expect(extractMarkerResult('')).toBeNull();
  });

  it('returns null when there is no begin marker', () => {
    expect(extractMarkerResult('arbitrary stdout content')).toBeNull();
  });

  it('returns null when there is no end marker', () => {
    expect(extractMarkerResult(`${LANGGRAPH_RESULT_BEGIN_MARKER}\n{"v":1}`)).toBeNull();
  });

  it('parses a valid marker block', () => {
    const stdout = `noise before\n${wrapMarker('{"v":1,"worker":"research","slug":"test","status":"ok","durationMs":1234}')}`;
    const result = extractMarkerResult(stdout);
    expect(result).not.toBeNull();
    expect(result?.worker).toBe('research');
    expect(result?.slug).toBe('test');
    expect(result?.status).toBe('ok');
    expect(result?.durationMs).toBe(1234);
  });

  it('returns null for marker missing required fields', () => {
    const stdout = wrapMarker('{"v":1,"slug":"test","status":"ok"}'); // missing worker
    expect(extractMarkerResult(stdout)).toBeNull();
  });

  it('returns null for marker with wrong version', () => {
    const stdout = wrapMarker('{"v":2,"worker":"research","slug":"test","status":"ok"}');
    expect(extractMarkerResult(stdout)).toBeNull();
  });

  it('returns null for marker with invalid status enum', () => {
    const stdout = wrapMarker('{"v":1,"worker":"research","slug":"test","status":"unknown"}');
    expect(extractMarkerResult(stdout)).toBeNull();
  });

  it('returns null for malformed JSON in marker block', () => {
    const stdout = wrapMarker('{not valid json}');
    expect(extractMarkerResult(stdout)).toBeNull();
  });

  it('takes the LAST marker when multiple are present', () => {
    const first = wrapMarker('{"v":1,"worker":"research","slug":"first","status":"ok"}');
    const second = wrapMarker('{"v":1,"worker":"research","slug":"second","status":"error"}');
    const result = extractMarkerResult(`${first}\nsome interleaved noise\n${second}`);
    expect(result?.slug).toBe('second');
    expect(result?.status).toBe('error');
  });

  it('handles whitespace tolerance around the JSON', () => {
    const stdout = `${LANGGRAPH_RESULT_BEGIN_MARKER}\n\n  {"v":1,"worker":"critic","slug":"x","status":"ok"}  \n\n${LANGGRAPH_RESULT_END_MARKER}`;
    const result = extractMarkerResult(stdout);
    expect(result?.worker).toBe('critic');
  });

  it('rejects markers where status is the right type but wrong value', () => {
    const stdout = wrapMarker('{"v":1,"worker":"research","slug":"test","status":"pending"}');
    expect(extractMarkerResult(stdout)).toBeNull();
  });
});

describe('isMarkerConsistent', () => {
  const baseMarker: WorkerStdoutResult = {
    v: 1,
    worker: 'research',
    slug: 'test-slug',
    status: 'ok',
  };

  it('returns false for null marker', () => {
    expect(isMarkerConsistent(null, 'research-agent', 'test-slug')).toBe(false);
  });

  it('returns true for matching slug + bare worker name', () => {
    expect(isMarkerConsistent(baseMarker, 'research-agent', 'test-slug')).toBe(true);
  });

  it('returns true for matching slug + full worker-agent name', () => {
    const marker: WorkerStdoutResult = { ...baseMarker, worker: 'research-agent' };
    expect(isMarkerConsistent(marker, 'research-agent', 'test-slug')).toBe(true);
  });

  it('returns false when slugs differ', () => {
    expect(isMarkerConsistent(baseMarker, 'research-agent', 'different-slug')).toBe(false);
  });

  it('returns false when worker types differ', () => {
    expect(isMarkerConsistent(baseMarker, 'critic-agent', 'test-slug')).toBe(false);
  });

  it('handles cross-field mismatch (correct slug, wrong worker)', () => {
    const marker: WorkerStdoutResult = { ...baseMarker, worker: 'malicious' };
    expect(isMarkerConsistent(marker, 'research-agent', 'test-slug')).toBe(false);
  });
});


// ─── runWorkerSubprocess input validation (no spawn) ─────────────
//
// These exercise the guard clauses that run BEFORE any `spawn()` — invalid
// worker / slug must reject the returned Promise (so `await` and
// `.rejects.toThrow()` behave the same) instead of launching a subprocess.
// We never reach the spawn here, so these stay fast and side-effect free.

describe('runWorkerSubprocess input validation', () => {
  it('rejects an unknown worker without spawning', async () => {
    await expect(
      runWorkerSubprocess({ worker: 'totally-fake-agent', args: [] }),
    ).rejects.toThrow(/Invalid worker/);
  });

  it('rejects the bare "research" name (missing -agent suffix)', async () => {
    // The single most likely forker mistake — copying `worker: 'research'`.
    await expect(
      runWorkerSubprocess({ worker: 'research', args: [] }),
    ).rejects.toThrow(/Invalid worker/);
  });

  it('rejects a path-traversal worker name without spawning', async () => {
    await expect(
      runWorkerSubprocess({ worker: '../../etc/passwd', args: [] }),
    ).rejects.toThrow(/Invalid worker/);
  });

  it('rejects a path-traversal slug without spawning', async () => {
    await expect(
      runWorkerSubprocess({ worker: 'research-agent', args: [], slug: '../escape' }),
    ).rejects.toThrow(/Invalid slug/);
  });

  it('rejects an empty slug when one is explicitly passed', async () => {
    await expect(
      runWorkerSubprocess({ worker: 'research-agent', args: [], slug: '' }),
    ).rejects.toThrow(/Invalid slug/);
  });

  it('returns a rejected Promise (not a synchronous throw) on bad input', () => {
    // Contract: the function never throws synchronously, even for invalid
    // input — callers can rely on a single `await`/`.catch()` path.
    const ret = runWorkerSubprocess({ worker: 'nope', args: [] });
    expect(ret).toBeInstanceOf(Promise);
    return expect(ret).rejects.toThrow(/Invalid worker/);
  });
});

describe('WorkerSubprocessError', () => {
  const fakeResult: RunWorkerResult = {
    exitCode: 1,
    durationMs: 42,
    markerResult: null,
    stdoutTail: 'out',
    stderrTail: 'boom',
    timedOut: false,
  };

  it('is an Error subclass with name + worker + result preserved', () => {
    const err = new WorkerSubprocessError('it failed', 'critic-agent', fakeResult);
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe('WorkerSubprocessError');
    expect(err.message).toBe('it failed');
    expect(err.worker).toBe('critic-agent');
    expect(err.result).toBe(fakeResult);
    expect(err.result.exitCode).toBe(1);
  });

  it('is catchable as a generic Error', () => {
    try {
      throw new WorkerSubprocessError('x', 'repair-agent', fakeResult);
    } catch (e) {
      expect(e).toBeInstanceOf(Error);
      expect((e as WorkerSubprocessError).worker).toBe('repair-agent');
    }
  });
});
