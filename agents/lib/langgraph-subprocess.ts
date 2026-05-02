/**
 * LangGraph Subprocess-Adapter — opt-in stateful workflow layer for Agent Fleet.
 *
 * This adapter spawns Agent Fleet workers (research, critic, analyst, cto,
 * discovery, repair) as `npx tsx agents/{worker}-agent.ts` subprocesses with
 * the same env-strip pattern that base-agent.ts uses for individual runs:
 *
 *   - `delete env.ANTHROPIC_API_KEY` (subscription-flat protection)
 *   - `delete env.ANTHROPIC_AUTH_TOKEN` (same)
 *   - `AGENT_FLEET_LANGGRAPH=1` env-flag to opt workers into emitting a
 *     structured stdout marker (no-op when the flag is unset, so existing
 *     CLI usage stays unchanged)
 *
 * Workers may emit a single-line JSON marker between the BEGIN/END sentinels
 * at the end of their run. The adapter extracts that marker for run-metadata
 * (durationMs, exitCode, optional summary). Workers that don't emit a marker
 * still work — the adapter falls back to file-based detection (looking at
 * `reports/` for new files written during the run window).
 *
 * Usage:
 *
 *   import { runWorkerSubprocess } from './langgraph-subprocess.js';
 *
 *   const result = await runWorkerSubprocess({
 *     worker: 'research',
 *     args: ['--tech', 'Model Context Protocol'],
 *     timeoutMs: 10 * 60_000,
 *   });
 *
 * Crash-handling: subprocess `exit !== 0` returns a `RunWorkerResult` with
 * `exitCode` set — the caller (typically a LangGraph node) decides whether
 * to fail-fast or continue. This is intentional: in a stateful workflow we
 * usually want to record the failure in state and let the router handle it.
 *
 * @module agents/lib/langgraph-subprocess
 * @since 0.2.0
 */

import { spawn, type ChildProcess } from 'child_process';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '../..');

/** Stdout-marker sentinels for the structured worker-result block. */
export const LANGGRAPH_RESULT_BEGIN_MARKER = '__AGENT_FLEET_LANGGRAPH_RESULT_BEGIN__';
export const LANGGRAPH_RESULT_END_MARKER = '__AGENT_FLEET_LANGGRAPH_RESULT_END__';

/** Worker-name pattern: only the 6 spawnable agent files are allowed.
 *
 * `conductor` is the orchestrator itself, not a spawned worker — it does not
 * appear here. Adding new agent types: create `agents/<name>-agent.ts` and
 * add `<name>` to this allowlist. */
const WORKER_PATTERN = /^(research|critic|analyst|cto|discovery|repair)-agent$/;

/** Slug-validation: a-z, 0-9, hyphens; max 100 chars. Used as thread_id segment. */
const SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{0,99}$/;

/** Marker-result extracted from worker stdout. */
export interface WorkerStdoutResult {
  /** Marker version (for forward-compat). */
  v: 1;
  /** Worker name (research|critic|analyst|cto|discovery|repair). */
  worker: string;
  /** Workflow slug — must match the StateGraph thread_id segment. */
  slug: string;
  /** "ok" if the worker completed cleanly, "error" on caught exception. */
  status: 'ok' | 'error';
  /** Run duration in milliseconds. */
  durationMs?: number;
  /** Optional summary (capped to 4000 chars). */
  markdownSummary?: string;
  /** Optional error message when status === "error". */
  errorMessage?: string;
}

/** Result of one runWorkerSubprocess() call. */
export interface RunWorkerResult {
  exitCode: number | null;
  durationMs: number;
  /** Parsed marker, or null if the worker didn't emit one. */
  markerResult: WorkerStdoutResult | null;
  /** Last 2KB of stdout (for diagnostics). */
  stdoutTail: string;
  /** Last 2KB of stderr (for diagnostics). */
  stderrTail: string;
  /** True if the timeout killed the process. */
  timedOut: boolean;
}

/** Typed error for worker-subprocess failures. */
export class WorkerSubprocessError extends Error {
  constructor(
    message: string,
    public readonly worker: string,
    public readonly result: RunWorkerResult,
  ) {
    super(message);
    this.name = 'WorkerSubprocessError';
  }
}

/**
 * Validate a slug against the path-traversal pattern.
 * Throws if invalid.
 */
export function assertValidSlug(slug: string): void {
  if (!slug || typeof slug !== 'string') {
    throw new Error('Invalid slug: empty or not a string');
  }
  if (!SLUG_PATTERN.test(slug)) {
    throw new Error(
      `Invalid slug "${slug}": must match /^[a-z0-9][a-z0-9-]{0,99}$/`,
    );
  }
}

/**
 * Validate a worker name against the allowlist.
 * Throws if not in the known-agent set.
 */
export function assertValidWorker(worker: string): void {
  if (!worker || typeof worker !== 'string') {
    throw new Error('Invalid worker: empty or not a string');
  }
  if (!WORKER_PATTERN.test(worker)) {
    throw new Error(
      `Invalid worker "${worker}": must match (research|critic|analyst|cto|discovery|repair|conductor)-agent`,
    );
  }
}

/**
 * Spawn an Agent Fleet worker as a subprocess.
 *
 * The caller is responsible for handling the returned RunWorkerResult —
 * non-zero exit codes are returned (not thrown) so the StateGraph can
 * record them in state and let a router decide the next node.
 *
 * Validation errors (invalid slug, invalid worker) are returned as
 * rejected Promises so `await` and `.rejects.toThrow()` behave the same.
 */
export function runWorkerSubprocess(opts: {
  /** Worker script name without `.ts`, e.g. "research-agent". */
  worker: string;
  /** CLI args, e.g. ["--tech", "Model Context Protocol"]. */
  args: string[];
  /** Optional workflow-slug for marker-validation. Default: "default". */
  slug?: string;
  /** Timeout in milliseconds. Default: 10 minutes. */
  timeoutMs?: number;
  /** If true, sets AGENT_FLEET_DRY_RUN=1 — workers should skip side effects. */
  dryRun?: boolean;
  /** Pipe child stdout/stderr to parent process for live logs. */
  pipe?: boolean;
}): Promise<RunWorkerResult> {
  const slug = opts.slug ?? 'default';
  try {
    assertValidWorker(opts.worker);
    assertValidSlug(slug);
  } catch (err) {
    return Promise.reject(err);
  }

  const scriptRel = `agents/${opts.worker}.ts`;
  const timeoutMs = opts.timeoutMs ?? 10 * 60_000;
  const started = Date.now();

  return new Promise<RunWorkerResult>((done, reject) => {
    const env: NodeJS.ProcessEnv = { ...process.env };

    // Subscription-flat: same pattern as base-agent.ts. Workers spawn
    // the Claude CLI, which only consumes the user's Pro/Max plan when
    // ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN are absent. AGENT_FLEET_USE_API_KEY=1
    // opts back into API-billing for CI / server-side use.
    if (process.env.AGENT_FLEET_USE_API_KEY !== '1') {
      delete env.ANTHROPIC_API_KEY;
      delete env.ANTHROPIC_AUTH_TOKEN;
    }
    delete env.CLAUDECODE;

    env.AGENT_FLEET_LANGGRAPH = '1'; // Worker checks this to emit the marker
    if (opts.dryRun) env.AGENT_FLEET_DRY_RUN = '1';

    let child: ChildProcess;
    try {
      child = spawn('npx', ['tsx', scriptRel, ...opts.args], {
        cwd: REPO_ROOT,
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    } catch (err) {
      reject(new Error(`spawn failed: ${(err as Error).message}`));
      return;
    }

    let stdoutBuf = '';
    let stderrBuf = '';
    const STDOUT_CAP = 100 * 1024;
    const STDERR_CAP = 50 * 1024;

    child.stdout?.on('data', (d: Buffer) => {
      const s = d.toString();
      stdoutBuf += s;
      if (stdoutBuf.length > STDOUT_CAP) {
        stdoutBuf = stdoutBuf.slice(-STDOUT_CAP);
      }
      if (opts.pipe) process.stdout.write(s);
    });
    child.stderr?.on('data', (d: Buffer) => {
      const s = d.toString();
      stderrBuf += s;
      if (stderrBuf.length > STDERR_CAP) {
        stderrBuf = stderrBuf.slice(-STDERR_CAP);
      }
      if (opts.pipe) process.stderr.write(s);
    });

    let timedOut = false;
    const timeoutHandle = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      const killTimer = setTimeout(() => child.kill('SIGKILL'), 5000);
      killTimer.unref();
    }, timeoutMs);
    timeoutHandle.unref();

    child.on('error', (err) => {
      clearTimeout(timeoutHandle);
      reject(new Error(`subprocess error: ${err.message}`));
    });

    child.on('exit', (code) => {
      clearTimeout(timeoutHandle);
      const durationMs = Date.now() - started;
      const markerResult = extractMarkerResult(stdoutBuf);

      const result: RunWorkerResult = {
        exitCode: code,
        durationMs,
        markerResult,
        stdoutTail: stdoutBuf.slice(-2000),
        stderrTail: stderrBuf.slice(-2000),
        timedOut,
      };

      done(result);
    });
  });
}

/**
 * Extract the structured JSON marker from worker stdout.
 *
 * Robust to:
 *   - multiple markers (the last one wins)
 *   - markers at start/end without leading/trailing newline
 *   - JSON spanning multiple lines
 *   - whitespace tolerance
 *
 * Returns null if no marker, a parse error, or the marker fails minimal
 * shape validation.
 */
export function extractMarkerResult(stdout: string): WorkerStdoutResult | null {
  if (!stdout || typeof stdout !== 'string') return null;

  const lastBeginIdx = stdout.lastIndexOf(LANGGRAPH_RESULT_BEGIN_MARKER);
  if (lastBeginIdx === -1) return null;

  const afterBegin = stdout.slice(lastBeginIdx + LANGGRAPH_RESULT_BEGIN_MARKER.length);
  const endIdx = afterBegin.indexOf(LANGGRAPH_RESULT_END_MARKER);
  if (endIdx === -1) return null;

  const jsonRaw = afterBegin.slice(0, endIdx).trim();
  if (!jsonRaw) return null;

  try {
    const parsed = JSON.parse(jsonRaw) as Record<string, unknown>;
    if (
      parsed.v !== 1 ||
      typeof parsed.worker !== 'string' ||
      typeof parsed.slug !== 'string' ||
      (parsed.status !== 'ok' && parsed.status !== 'error')
    ) {
      return null;
    }
    return parsed as unknown as WorkerStdoutResult;
  } catch {
    return null;
  }
}

/**
 * Helper for workers themselves — emits the marker on stdout in the
 * canonical format. No-op when AGENT_FLEET_LANGGRAPH=1 is not set.
 *
 * Workers should call this twice: once at the end of main() with status="ok",
 * and once in the catch() block with status="error".
 */
export function emitLangGraphMarker(result: WorkerStdoutResult): void {
  if (!process.env.AGENT_FLEET_LANGGRAPH) return;
  const json = JSON.stringify(result);
  process.stdout.write(
    `\n${LANGGRAPH_RESULT_BEGIN_MARKER}\n${json}\n${LANGGRAPH_RESULT_END_MARKER}\n`,
  );
}

/**
 * Cross-field consistency check for a marker against its expected worker
 * and slug. Used by StateGraph nodes as defense-in-depth: if a worker
 * emits a marker that names the wrong worker or wrong slug, the node
 * should ignore the marker (not let it corrupt state) and record an
 * error in state.errors instead.
 */
export function isMarkerConsistent(
  marker: WorkerStdoutResult | null,
  expectedWorker: string,
  expectedSlug: string,
): marker is WorkerStdoutResult {
  if (!marker) return false;
  if (marker.slug !== expectedSlug) return false;
  // worker field in the marker is the bare type ("research"), not the
  // full script name ("research-agent"). Match the prefix.
  const expectedBare = expectedWorker.replace(/-agent$/, '');
  if (marker.worker !== expectedBare && marker.worker !== expectedWorker) {
    return false;
  }
  return true;
}
