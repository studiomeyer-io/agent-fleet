/**
 * Optional DB access for report persistence.
 *
 * If DATABASE_URL is not set, all DB operations silently no-op.
 * Reports are always saved to files regardless.
 */

import { createRequire } from 'module';
import type { Pool as PgPool, PoolConfig } from 'pg';

interface DbPool {
  query(text: string, values?: unknown[]): Promise<{ rows: Record<string, unknown>[] }>;
  end(): Promise<void>;
}

let PoolCtor: (new (config: PoolConfig) => DbPool) | null = null;

async function getPool(): Promise<DbPool> {
  if (!PoolCtor) {
    try {
      const pg = await import('pg');
      PoolCtor = (pg.default?.Pool ?? pg.Pool) as unknown as NonNullable<typeof PoolCtor>;
    } catch {
      const require = createRequire(import.meta.url);
      const pg = require('pg') as typeof import('pg');
      PoolCtor = pg.Pool as unknown as typeof PoolCtor;
    }
  }

  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL not set');

  return new PoolCtor!({ connectionString: url, max: 2 });
}

let pool: DbPool | null = null;
let poolPromise: Promise<DbPool> | null = null;

async function db(): Promise<DbPool> {
  if (!process.env.DATABASE_URL) throw new Error('No DATABASE_URL');
  if (!pool) {
    if (!poolPromise) {
      poolPromise = getPool().catch((err) => {
        poolPromise = null;
        throw err;
      });
    }
    pool = await poolPromise;
  }
  return pool;
}

export interface AgentReport {
  id: string;
  agent_type: string;
  topic: string;
  content: string;
  summary?: string;
  sources: string[];
  metadata: Record<string, unknown>;
  project?: string;
  parent_report_id?: string;
  tags: string[];
  quality?: number;
  created_at: Date;
}

export async function saveReport(report: {
  agentType: string;
  topic: string;
  content: string;
  summary?: string;
  sources?: string[];
  metadata?: Record<string, unknown>;
  project?: string;
  parentReportId?: string;
  tags?: string[];
  quality?: number;
}): Promise<string | null> {
  if (!process.env.DATABASE_URL) return null;
  const p = await db();
  const result = await p.query(
    `INSERT INTO agent_reports (agent_type, topic, content, summary, sources, metadata, project, parent_report_id, tags, quality)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      report.agentType,
      report.topic,
      report.content,
      report.summary ?? null,
      report.sources ?? [],
      JSON.stringify(report.metadata ?? {}),
      report.project ?? null,
      report.parentReportId ?? null,
      report.tags ?? [],
      report.quality ?? null,
    ],
  );
  return (result.rows[0]?.id as string) ?? null;
}

export async function saveDiscussion(discussion: {
  reportId: string;
  agentType: string;
  position: 'agree' | 'disagree' | 'extend' | 'question' | 'synthesize';
  content: string;
  referencedReportIds?: string[];
}): Promise<string | null> {
  if (!process.env.DATABASE_URL) return null;
  const p = await db();
  const result = await p.query(
    `INSERT INTO agent_discussions (report_id, agent_type, position, content, referenced_report_ids)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [
      discussion.reportId,
      discussion.agentType,
      discussion.position,
      discussion.content,
      discussion.referencedReportIds ?? [],
    ],
  );
  return (result.rows[0]?.id as string) ?? null;
}

export async function getRecentReports(agentType?: string, limit = 10): Promise<AgentReport[]> {
  if (!process.env.DATABASE_URL) return [];
  const p = await db();
  const result = agentType
    ? await p.query('SELECT * FROM agent_reports WHERE agent_type = $1 ORDER BY created_at DESC LIMIT $2', [agentType, limit])
    : await p.query('SELECT * FROM agent_reports ORDER BY created_at DESC LIMIT $1', [limit]);
  return result.rows as unknown as AgentReport[];
}

export async function closePool(): Promise<void> {
  if (pool) {
    await pool.end();
    pool = null;
    poolPromise = null;
  }
}
