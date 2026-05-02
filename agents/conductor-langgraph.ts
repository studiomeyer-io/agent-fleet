#!/usr/bin/env npx tsx
/**
 * Conductor-LangGraph — stateful multi-agent workflow with Postgres-backed
 * crash-resume + Human-in-the-Loop.
 *
 * This is the *opt-in* counterpart to `conductor.ts` (parallel mode).
 *
 *   - Conductor (parallel mode) — best for most cases. Low overhead,
 *     no Postgres dependency, agents run simultaneously and one synthesis
 *     pass merges their reports.
 *
 *   - Conductor-LangGraph (stateful mode) — opt-in for long-running pipelines
 *     where you want crash-resume (kill mid-run, resume from last checkpoint),
 *     conditional branching native to the graph, and Human-in-the-Loop
 *     pauses at decision points (e.g. when the Critic flags HIGH risk).
 *
 * Example workflow shipped in this file:
 *
 *   research --> critic --> [router: high-risk?] --user_approval--> analyst --> END
 *                                              |--> analyst --> END
 *
 * The Critic agent emits its report; if it contains a "HIGH" or "CRITICAL"
 * finding marker, the workflow pauses via interrupt() and waits for a
 * human decision (approve / reject / revise).
 *
 * Usage:
 *
 *   # Fresh run (or resume after crash with same slug)
 *   npx tsx agents/conductor-langgraph.ts <slug> --question "Your topic"
 *
 *   # Resume after interrupt() pause with a decision
 *   npx tsx agents/conductor-langgraph.ts <slug> --resume --decision approve
 *
 *   # State inspect
 *   npx tsx agents/conductor-langgraph.ts <slug> --status
 *
 * Thread-ID convention: `agent-fleet-{slug}` — one thread per workflow run.
 *
 * Setup (idempotent, run once):
 *
 *   npx tsx scripts/setup-langgraph-checkpointer.ts
 *
 * Requires:
 *   - DATABASE_URL env (PostgreSQL connection string)
 *   - @langchain/langgraph and @langchain/langgraph-checkpoint-postgres
 *     in node_modules (install via `npm install --include=optional`)
 *
 * @since 0.2.0
 */

// LangGraph imports are wrapped to give a friendly error if the user installed
// without `--include=optional`. The pattern mirrors `lib/db.ts`'s graceful
// handling of `pg`. We do the dynamic import at module-init time so type
// inference still works on the named bindings below.
//
// LangGraph 1.x (^1.2.9) is on the LTS channel as of October 2025 — graph
// primitives (Annotation, StateGraph, interrupt, Command) are the same as
// 0.x. The 1.0 migration guide only covers `createAgent` (prebuilt agents),
// not graph primitives. https://docs.langchain.com/oss/javascript/migrate/langchain-v1
let langgraphMod: typeof import('@langchain/langgraph');
let pgSaverMod: typeof import('@langchain/langgraph-checkpoint-postgres');
try {
  langgraphMod = await import('@langchain/langgraph');
  pgSaverMod = await import('@langchain/langgraph-checkpoint-postgres');
} catch (err) {
  console.error(
    '[conductor-langgraph] @langchain/langgraph is not installed.\n' +
      'Stateful workflow mode is opt-in. To enable it:\n' +
      '  npm install --include=optional\n' +
      '\n' +
      'Or just use `npm run conductor` for the parallel-mode fleet (no Postgres needed).\n' +
      '\n' +
      `Underlying error: ${(err as Error).message}`,
  );
  process.exit(2);
}
const { Annotation, StateGraph, START, END, interrupt, Command } = langgraphMod;
const { PostgresSaver } = pgSaverMod;
import {
  runWorkerSubprocess,
  isMarkerConsistent,
  assertValidSlug,
  type WorkerStdoutResult,
} from './lib/langgraph-subprocess.js';

// ─── State Schema ────────────────────────────────────────────

export type UserDecision = 'approve' | 'reject' | 'revise';

export interface WorkerRunRecord {
  worker: string;
  status: 'ok' | 'error' | 'timeout';
  durationMs: number;
  exitCode: number | null;
  startedAt: string;
}

export interface WorkflowError {
  worker: string;
  message: string;
  timestamp: string;
}

const StateAnnotation = Annotation.Root({
  /** Workflow slug — validated /^[a-z0-9][a-z0-9-]{0,99}$/. */
  slug: Annotation<string>(),
  /** Topic / question being researched + critiqued + analyzed. */
  question: Annotation<string>({
    reducer: (_curr, next) => next,
    default: () => '',
  }),
  /** Research-Agent has run + report exists. */
  researchDone: Annotation<boolean>({
    reducer: (_curr, next) => next,
    default: () => false,
  }),
  /** Critic-Agent has run + report exists. */
  criticDone: Annotation<boolean>({
    reducer: (_curr, next) => next,
    default: () => false,
  }),
  /** Analyst-Agent has run + report exists. */
  analystDone: Annotation<boolean>({
    reducer: (_curr, next) => next,
    default: () => false,
  }),
  /** Critic flagged HIGH or CRITICAL findings — triggers HITL. */
  criticHighRisk: Annotation<boolean>({
    reducer: (_curr, next) => next,
    default: () => false,
  }),
  /** Append-list of all worker runs (audit trail). */
  workerResults: Annotation<WorkerRunRecord[]>({
    reducer: (curr, next) => [...curr, ...next],
    default: () => [],
  }),
  /** Append-list of all errors. */
  errors: Annotation<WorkflowError[]>({
    reducer: (curr, next) => [...curr, ...next],
    default: () => [],
  }),
  /** User decision after interrupt(). */
  userDecision: Annotation<UserDecision | undefined>({
    reducer: (_curr, next) => next,
    default: () => undefined,
  }),
  /** Reason given to the user at interrupt() time. */
  approvalReason: Annotation<string>({
    reducer: (_curr, next) => next,
    default: () => '',
  }),
  /** Last marker from a worker (for debugging). */
  lastWorkerMarker: Annotation<WorkerStdoutResult | null>({
    reducer: (_curr, next) => next,
    default: () => null,
  }),
});

export type FleetState = typeof StateAnnotation.State;
export type FleetStateUpdate = typeof StateAnnotation.Update;

// ─── Helpers ─────────────────────────────────────────────────

function nowIso(): string {
  return new Date().toISOString();
}

function recordWorkerRun(
  worker: string,
  exitCode: number | null,
  durationMs: number,
  timedOut: boolean,
  startedAtIso: string,
): WorkerRunRecord {
  return {
    worker,
    status: timedOut ? 'timeout' : exitCode === 0 ? 'ok' : 'error',
    durationMs,
    exitCode,
    startedAt: startedAtIso,
  };
}

/**
 * Naive heuristic: scan the worker's stdout summary for HIGH/CRITICAL
 * findings. The Critic agent emits these as level-headers in its report
 * (e.g. "## CRITICAL: API key leakage"). A real production setup might
 * parse a structured field — for the example workflow this is enough.
 */
function detectHighRisk(text: string | undefined): boolean {
  if (!text) return false;
  // Match HIGH/CRITICAL as a level marker (after a colon, in a heading,
  // or as a standalone token). Avoid false positives on words like "highest".
  return /\b(CRITICAL|HIGH[\s:-])/i.test(text);
}

// ─── Node Implementations ────────────────────────────────────

/**
 * Research-Node: spawns the research agent.
 */
async function researchNode(state: FleetState): Promise<FleetStateUpdate> {
  assertValidSlug(state.slug);

  const startedAt = nowIso();
  const runResult = await runWorkerSubprocess({
    worker: 'research-agent',
    args: [state.question],
    slug: state.slug,
    timeoutMs: 12 * 60_000,
    pipe: true,
  });

  const wr = recordWorkerRun(
    'research',
    runResult.exitCode,
    runResult.durationMs,
    runResult.timedOut,
    startedAt,
  );
  const consistentMarker = isMarkerConsistent(runResult.markerResult, 'research-agent', state.slug)
    ? runResult.markerResult
    : null;

  const update: FleetStateUpdate = {
    workerResults: [wr],
    lastWorkerMarker: consistentMarker,
    researchDone: runResult.exitCode === 0 && !runResult.timedOut,
  };

  if (runResult.timedOut || runResult.exitCode !== 0) {
    update.errors = [
      {
        worker: 'research',
        message: `exit ${runResult.exitCode}, timedOut=${runResult.timedOut}, stderr: ${runResult.stderrTail.slice(-300)}`,
        timestamp: nowIso(),
      },
    ];
  }
  return update;
}

/**
 * Critic-Node: spawns the critic agent + parses its summary for high-risk
 * findings. If found, criticHighRisk=true triggers the user_approval node
 * via the conditional router.
 */
async function criticNode(state: FleetState): Promise<FleetStateUpdate> {
  assertValidSlug(state.slug);

  if (!state.researchDone) {
    return {
      errors: [
        {
          worker: 'critic',
          message: 'research not done — critic cannot run',
          timestamp: nowIso(),
        },
      ],
    };
  }

  const startedAt = nowIso();
  const runResult = await runWorkerSubprocess({
    worker: 'critic-agent',
    args: ['--idea', state.question],
    slug: state.slug,
    timeoutMs: 12 * 60_000,
    pipe: true,
  });

  const wr = recordWorkerRun(
    'critic',
    runResult.exitCode,
    runResult.durationMs,
    runResult.timedOut,
    startedAt,
  );
  const consistentMarker = isMarkerConsistent(runResult.markerResult, 'critic-agent', state.slug)
    ? runResult.markerResult
    : null;

  const summaryText = consistentMarker?.markdownSummary ?? runResult.stdoutTail;
  const highRisk = detectHighRisk(summaryText);

  const update: FleetStateUpdate = {
    workerResults: [wr],
    lastWorkerMarker: consistentMarker,
    criticDone: runResult.exitCode === 0 && !runResult.timedOut,
    criticHighRisk: highRisk,
  };

  if (runResult.timedOut || runResult.exitCode !== 0) {
    update.errors = [
      {
        worker: 'critic',
        message: `exit ${runResult.exitCode}, timedOut=${runResult.timedOut}, stderr: ${runResult.stderrTail.slice(-300)}`,
        timestamp: nowIso(),
      },
    ];
  }
  return update;
}

/**
 * Analyst-Node: spawns the analyst agent.
 */
async function analystNode(state: FleetState): Promise<FleetStateUpdate> {
  assertValidSlug(state.slug);

  const startedAt = nowIso();
  const runResult = await runWorkerSubprocess({
    worker: 'analyst-agent',
    args: ['--patterns', state.question],
    slug: state.slug,
    timeoutMs: 12 * 60_000,
    pipe: true,
  });

  const wr = recordWorkerRun(
    'analyst',
    runResult.exitCode,
    runResult.durationMs,
    runResult.timedOut,
    startedAt,
  );
  const consistentMarker = isMarkerConsistent(runResult.markerResult, 'analyst-agent', state.slug)
    ? runResult.markerResult
    : null;

  const update: FleetStateUpdate = {
    workerResults: [wr],
    lastWorkerMarker: consistentMarker,
    analystDone: runResult.exitCode === 0 && !runResult.timedOut,
  };

  if (runResult.timedOut || runResult.exitCode !== 0) {
    update.errors = [
      {
        worker: 'analyst',
        message: `exit ${runResult.exitCode}, timedOut=${runResult.timedOut}, stderr: ${runResult.stderrTail.slice(-300)}`,
        timestamp: nowIso(),
      },
    ];
  }
  return update;
}

/**
 * User-Approval-Node: pauses via interrupt() until a Command({ resume: ... })
 * is delivered. Three decisions:
 *
 *   approve — proceed to analyst (continue the workflow)
 *   reject  — end the workflow without running analyst
 *   revise  — re-run critic (would loop back; not wired in the example)
 */
function userApprovalNode(state: FleetState): FleetStateUpdate {
  const reason = `Critic flagged HIGH/CRITICAL findings. Workflow paused for human review.`;

  // LangGraph 1.x: `interrupt<I, R>(value: I): R`. First generic = the value
  // we hand TO interrupt() (shown to the user); second generic = the resume
  // value we get BACK (delivered via `Command({ resume: { decision } })`).
  const userInput = interrupt<
    { approvalReason: string; state: FleetState },
    { decision: UserDecision }
  >({ approvalReason: reason, state });

  const decision: UserDecision =
    userInput && (userInput.decision === 'approve' || userInput.decision === 'reject' || userInput.decision === 'revise')
      ? userInput.decision
      : 'reject';

  return { userDecision: decision, approvalReason: reason };
}

// ─── Routers (conditional edges) ─────────────────────────────

function researchRouter(state: FleetState): 'critic' | typeof END {
  return state.researchDone ? 'critic' : END;
}

function criticRouter(state: FleetState): 'analyst' | 'user_approval' | typeof END {
  if (!state.criticDone) return END;
  if (state.criticHighRisk) return 'user_approval';
  return 'analyst';
}

function userApprovalRouter(state: FleetState): 'analyst' | typeof END {
  if (state.userDecision === 'approve') return 'analyst';
  return END; // reject or revise (revise would need a critic-loop, not wired)
}

function analystRouter(_state: FleetState): typeof END {
  return END;
}

// ─── Graph Builder ───────────────────────────────────────────

/** Build the StateGraph (uncompiled). Public for tests with MemorySaver. */
export function buildAgentFleetWorkflow() {
  return new StateGraph(StateAnnotation)
    .addNode('research', researchNode)
    .addNode('critic', criticNode)
    .addNode('analyst', analystNode)
    .addNode('user_approval', userApprovalNode)
    .addEdge(START, 'research')
    .addConditionalEdges('research', researchRouter, ['critic', END])
    .addConditionalEdges('critic', criticRouter, ['analyst', 'user_approval', END])
    .addConditionalEdges('user_approval', userApprovalRouter, ['analyst', END])
    .addConditionalEdges('analyst', analystRouter, [END]);
}

/** Singleton checkpointer. Caller owns calling closeCheckpointer() at shutdown. */
let checkpointerSingleton: InstanceType<typeof PostgresSaver> | null = null;

export function getCheckpointer(): InstanceType<typeof PostgresSaver> {
  if (!checkpointerSingleton) {
    const dbUrl = process.env.DATABASE_URL;
    if (!dbUrl) {
      throw new Error('DATABASE_URL not set — checkpointer cannot connect');
    }
    const schema = process.env.LANGGRAPH_SCHEMA ?? 'langgraph';
    checkpointerSingleton = PostgresSaver.fromConnString(dbUrl, { schema });
  }
  return checkpointerSingleton;
}

export async function closeCheckpointer(): Promise<void> {
  if (checkpointerSingleton) {
    try {
      await checkpointerSingleton.end();
    } catch {
      // already closed
    }
    checkpointerSingleton = null;
  }
}

/** Compile the workflow with the Postgres checkpointer attached. */
export function compileAgentFleetGraph() {
  const checkpointer = getCheckpointer();
  return buildAgentFleetWorkflow().compile({ checkpointer });
}

// ─── CLI ─────────────────────────────────────────────────────

const VALID_DECISIONS: UserDecision[] = ['approve', 'reject', 'revise'];

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const slug = args.find((a) => !a.startsWith('--'));
  const isResume = args.includes('--resume');
  const isStatus = args.includes('--status');

  const questionIdx = args.indexOf('--question');
  const question = questionIdx >= 0 ? args[questionIdx + 1] : '';

  const decisionIdx = args.indexOf('--decision');
  const decisionArg = decisionIdx >= 0 ? args[decisionIdx + 1] : undefined;
  const decision: UserDecision | undefined = VALID_DECISIONS.includes(decisionArg as UserDecision)
    ? (decisionArg as UserDecision)
    : undefined;

  if (!slug) {
    console.error(`Agent Fleet — Conductor-LangGraph (Stateful Workflow)

Usage:
  npx tsx agents/conductor-langgraph.ts <slug> --question "Your topic"
  npx tsx agents/conductor-langgraph.ts <slug> --resume --decision approve|reject|revise
  npx tsx agents/conductor-langgraph.ts <slug> --status

Setup (idempotent, run once):
  npx tsx scripts/setup-langgraph-checkpointer.ts

Workflow: research --> critic --> [HIGH risk?] --user_approval--> analyst --> END
                                              |--> analyst --> END

Requires:
  - DATABASE_URL env (PostgreSQL)
  - @langchain/langgraph + @langchain/langgraph-checkpoint-postgres installed
    (npm install --include=optional)
`);
    process.exit(2);
  }

  try {
    assertValidSlug(slug);
  } catch (err) {
    console.error(`[langgraph] ${(err as Error).message}`);
    process.exit(2);
  }

  if (isResume && !decision) {
    console.error('[langgraph] --resume requires --decision approve|reject|revise');
    process.exit(2);
  }

  const graph = compileAgentFleetGraph();

  // Setup checkpointer schema (idempotent). Surface non-idempotent errors.
  // PostgresSaver.setup() is part of the public API in 1.x.
  try {
    await getCheckpointer().setup();
  } catch (err) {
    const msg = (err as Error).message ?? '';
    const isIdempotentRetryable =
      msg.includes('already exists') ||
      msg.includes('duplicate') ||
      msg.includes('ERROR_DUPLICATE');
    if (!isIdempotentRetryable) {
      console.error(`[langgraph] Checkpointer setup failed: ${msg}`);
      console.error(`[langgraph] Run \`npx tsx scripts/setup-langgraph-checkpointer.ts\` separately and check DB connectivity.`);
      throw err;
    }
  }

  const threadId = `agent-fleet-${slug}`;
  const config = { configurable: { thread_id: threadId } };

  if (isStatus) {
    const snapshot = await graph.getState(config);
    if (!snapshot.values || Object.keys(snapshot.values).length === 0) {
      console.log(`[langgraph] No checkpoint for thread ${threadId}.`);
      process.exit(0);
    }
    const state = snapshot.values as FleetState;
    console.log(`[langgraph] Status for ${threadId}:`);
    console.log(`  Slug:               ${state.slug}`);
    console.log(`  Question:           ${state.question}`);
    console.log(`  Research done:      ${state.researchDone}`);
    console.log(`  Critic done:        ${state.criticDone} (high-risk: ${state.criticHighRisk})`);
    console.log(`  Analyst done:       ${state.analystDone}`);
    console.log(`  Worker runs:        ${state.workerResults.length}`);
    console.log(`  Errors:             ${state.errors.length}`);
    console.log(`  User decision:      ${state.userDecision ?? '(none)'}`);
    console.log(`  Next nodes:         ${snapshot.next.length > 0 ? snapshot.next.join(', ') : '(none — workflow complete or interrupted)'}`);
    if (snapshot.tasks.some((t) => t.interrupts && t.interrupts.length > 0)) {
      const interrupts = snapshot.tasks.flatMap((t) => t.interrupts ?? []);
      console.log(`  ⏸️ INTERRUPTED: ${interrupts.length} interrupt(s) waiting`);
      for (const i of interrupts) {
        const v = i.value as { approvalReason?: string };
        console.log(`     reason: ${v?.approvalReason ?? '(unknown)'}`);
      }
      console.log(`  Resume with: --resume --decision approve|reject|revise`);
    }
    process.exit(0);
  }

  let result: FleetState;
  if (isResume) {
    console.log(`[langgraph] Resuming ${threadId} with decision=${decision}`);
    // LangGraph 1.x: `Command<Resume, Update, Nodes>`. Pinning all three
    // generics fights the StateGraph's inferred Node-union type — the public
    // API is graph.invoke(Command, config) and the resume payload is typed
    // upstream via the `interrupt<I, R>(...)` call site. The runtime cast on
    // `decision` validates the payload shape before serialization.
    const resumePayload: { decision: UserDecision } = { decision: decision as UserDecision };
    result = (await graph.invoke(
      new Command({ resume: resumePayload }),
      config,
    )) as FleetState;
  } else {
    if (!question) {
      console.error('[langgraph] --question is required on first run');
      process.exit(2);
    }
    console.log(`[langgraph] Starting/Resuming ${threadId}`);
    result = (await graph.invoke(
      { slug, question },
      config,
    )) as FleetState;
  }

  console.log('\n' + '='.repeat(60));
  console.log(`Agent Fleet LangGraph Result — ${threadId}`);
  console.log('='.repeat(60));
  console.log(`Research done:     ${result.researchDone}`);
  console.log(`Critic done:       ${result.criticDone} (high-risk: ${result.criticHighRisk})`);
  console.log(`Analyst done:      ${result.analystDone}`);
  console.log(`User decision:     ${result.userDecision ?? '(none)'}`);
  console.log(`Worker runs:       ${result.workerResults.length}`);
  console.log(`Errors:            ${result.errors.length}`);
  if (result.errors.length > 0) {
    console.log('\nErrors:');
    for (const e of result.errors) {
      console.log(`  [${e.worker}] ${e.message.slice(0, 200)}`);
    }
  }

  const finalSnapshot = await graph.getState(config);
  if (finalSnapshot.tasks.some((t) => t.interrupts && t.interrupts.length > 0)) {
    console.log(`\n⏸️ Workflow PAUSED at user_approval. Resume:`);
    console.log(`   npx tsx agents/conductor-langgraph.ts ${slug} --resume --decision approve|reject|revise`);
  }
  console.log('='.repeat(60));
}

// Only run main() when this file is invoked directly (not when imported by a
// test or another module). The dual-purpose pattern: tests import
// `buildAgentFleetWorkflow` etc. without triggering CLI side-effects.
const invokedDirectly = import.meta.url === `file://${process.argv[1]}`;
if (invokedDirectly) {
  main()
    .then(async () => {
      // The conductor-langgraph workflow does not write to the agent_reports
      // pool itself — workers do, but each worker's own subprocess closes its
      // own pool. Only the LangGraph checkpointer pool needs cleanup here.
      await closeCheckpointer().catch(() => {});
      process.exit(0);
    })
    .catch(async (err) => {
      console.error(`[conductor-langgraph] Fatal: ${(err as Error).message}`);
      if ((err as Error).stack) {
        console.error((err as Error).stack);
      }
      await closeCheckpointer().catch(() => {});
      process.exit(1);
    });
}
