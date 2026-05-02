#!/usr/bin/env npx tsx
/**
 * LangGraph Postgres Checkpointer — setup script.
 *
 * Initializes the `langgraph` schema in the configured Postgres database
 * with the four tables that `@langchain/langgraph-checkpoint-postgres`
 * needs (checkpoints, checkpoint_blobs, checkpoint_writes, checkpoint_migrations).
 *
 * Idempotent: `await saver.setup()` is `CREATE IF NOT EXISTS` + migration —
 * re-running is safe.
 *
 * Usage:
 *   npx tsx scripts/setup-langgraph-checkpointer.ts
 *
 * Env:
 *   DATABASE_URL — Postgres connection string (e.g. postgres://user:pass@host:port/db)
 *   LANGGRAPH_SCHEMA — schema name, defaults to "langgraph"
 *
 * @since 0.2.0
 */

import { PostgresSaver } from '@langchain/langgraph-checkpoint-postgres';

const SCHEMA = process.env.LANGGRAPH_SCHEMA ?? 'langgraph';

async function main(): Promise<void> {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error('[setup-langgraph] DATABASE_URL not set in env');
    process.exit(2);
  }

  console.log(`[setup-langgraph] Schema: ${SCHEMA}`);
  console.log(`[setup-langgraph] DB: ${dbUrl.replace(/:[^:@/]+@/, ':***@')}`);

  const saver = PostgresSaver.fromConnString(dbUrl, { schema: SCHEMA });
  try {
    await saver.setup();
    console.log(
      `[setup-langgraph] Schema "${SCHEMA}" + 4 tables ready (checkpoints, checkpoint_blobs, checkpoint_writes, checkpoint_migrations).`,
    );
  } finally {
    await saver.end();
  }
}

main().catch((err) => {
  console.error(`[setup-langgraph] Fatal: ${(err as Error).message}`);
  process.exit(1);
});
