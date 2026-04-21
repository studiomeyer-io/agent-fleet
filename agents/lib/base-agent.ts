/**
 * Base Agent — Shared infrastructure for all Agent Fleet agents.
 *
 * Each agent: Claude CLI subprocess + MCP tools + optional DB persistence.
 */

import { spawn } from 'child_process';
import { writeFile, mkdir, readFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';
import { saveReport, closePool } from './db.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = resolve(__dirname, '../../reports');

export interface AgentConfig {
  name: string;
  type: string;
  defaultModel: string;
  maxTurns: number;
  /** MCP servers this agent needs */
  mcpServers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
  /** Additional allowed tools beyond MCP */
  extraTools: string[];
  /** Directory for file output */
  outputDir?: string;
}

export interface RunOptions {
  topic: string;
  prompt: string;
  model?: string;
  maxTurns?: number;
  project?: string;
  parentReportId?: string;
  tags?: string[];
  /** Don't save to DB, just return output */
  dryRun?: boolean;
}

export interface RunResult {
  reportId?: string;
  content: string;
  filename?: string;
  durationMs: number;
}

/**
 * Run a Claude agent with configured MCP tools and save result to DB + file.
 */
export async function runAgent(config: AgentConfig, options: RunOptions): Promise<RunResult> {
  const model = options.model ?? config.defaultModel;
  const maxTurns = options.maxTurns ?? config.maxTurns;
  const outputDir = config.outputDir ?? REPORTS_DIR;

  const startMs = Date.now();

  console.log(`\n[${config.name}] Starting: "${options.topic}" (${model})\n`);

  // Build MCP config
  const mcpConfig = JSON.stringify({
    mcpServers: Object.fromEntries(
      Object.entries(config.mcpServers).map(([name, srv]) => [
        name,
        { type: 'stdio', command: srv.command, args: srv.args, env: srv.env },
      ]),
    ),
  });

  // Build allowed tools list
  const mcpToolPatterns = Object.keys(config.mcpServers).map(name => `mcp__${name}__*`);
  const allTools = [...mcpToolPatterns, ...config.extraTools].join(',');

  // Build CLI args
  const args = [
    '-p',
    '--model', model,
    '--max-turns', String(maxTurns),
    '--output-format', 'text',
    ...(allTools ? ['--allowedTools', allTools] : []),
    ...(Object.keys(config.mcpServers).length > 0 ? ['--mcp-config', mcpConfig] : []),
  ];

  // Run Claude
  const content = await new Promise<string>((resolveP, reject) => {
    const cleanEnv = { ...process.env };
    delete cleanEnv.CLAUDECODE;
    // CRITICAL: do not pass ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN to the
    // spawned `claude` process. With a key present the CLI talks directly
    // to the API and bills per token — bypassing the user's Claude subscription.
    // Opt back in for automation/CI use via AGENT_FLEET_USE_API_KEY=1.
    if (!process.env.AGENT_FLEET_USE_API_KEY) {
      delete cleanEnv.ANTHROPIC_API_KEY;
      delete cleanEnv.ANTHROPIC_AUTH_TOKEN;
    }

    const child = spawn('claude', args, {
      cwd: resolve(__dirname, '../..'),
      stdio: ['pipe', 'pipe', 'inherit'],
      timeout: 600_000,
      env: cleanEnv,
    });

    let stdout = '';
    const STDOUT_CAP = 200 * 1024; // 200KB cap
    child.stdout.on('data', (data: Buffer) => {
      if (stdout.length < STDOUT_CAP) {
        const chunk = data.toString();
        stdout += chunk.slice(0, STDOUT_CAP - stdout.length);
      }
    });
    child.stdout.on('error', (err) => reject(err));
    child.on('error', (err) => reject(err));
    child.on('close', (code, signal) => {
      if (stdout.length >= STDOUT_CAP) stdout += '\n\n[TRUNCATED: Output exceeded ' + (STDOUT_CAP / 1024) + 'KB cap]';
      if (code === 0) {
        resolveP(stdout);
      } else if (signal === 'SIGTERM' && stdout.includes('## ') && stdout.length > 500) {
        // Interrupted run — accept only if the output already looks like a
        // real report (has a heading and ≥500 bytes). Otherwise a 100-byte
        // partial greeting would silently pass as "success".
        resolveP(stdout + '\n\n> ⚠️ Agent was interrupted — output may be partial\n');
      } else {
        reject(new Error(`${config.name} exited: code=${code} signal=${signal}`));
      }
    });

    child.stdin.on('error', () => {});
    child.stdin.write(options.prompt);
    child.stdin.end();
  });

  const durationMs = Date.now() - startMs;

  // Parse metadata from output
  const metadata = parseMetadata(content);
  metadata.duration_seconds = Number((durationMs / 1000).toFixed(1));
  metadata.model = model;

  // Clean content
  const cleanContent = content
    .replace(/```json-metadata[\s\S]*?```/g, '')
    .replace(/```json\s*\n\{[\s\S]*?"total_sources"[\s\S]*?\}\n\s*```/g, '')
    .trim();

  // Save to file
  await mkdir(outputDir, { recursive: true });
  const filename = makeFilename(config.type, options.topic);
  const fileContent = `---
type: ${config.type}
topic: "${options.topic}"
date: ${new Date().toISOString()}
model: ${model}
duration: ${(durationMs / 1000).toFixed(1)}s
sources: ${metadata.total_sources ?? 0}
${options.project ? `project: ${options.project}\n` : ''}${options.parentReportId ? `parent: ${options.parentReportId}\n` : ''}---

${cleanContent}`;

  await writeFile(resolve(outputDir, filename), fileContent, 'utf-8');

  // Save to DB (optional — skipped if DATABASE_URL not set)
  let reportId: string | undefined;
  if (!options.dryRun) {
    try {
      reportId = (await saveReport({
        agentType: config.type,
        topic: options.topic,
        content: cleanContent,
        summary: extractSummary(cleanContent),
        sources: (Array.isArray(metadata.sources) ? metadata.sources : []) as string[],
        metadata,
        project: options.project,
        parentReportId: options.parentReportId,
        tags: options.tags ?? [],
      })) ?? undefined;
    } catch {
      // DB is optional — reports still save to files
    } finally {
      await closePool();
    }
  }

  console.log(`\n${'='.repeat(60)}`);
  console.log(`[${config.name}] Done: reports/${filename}`);
  console.log(`Duration: ${(durationMs / 1000).toFixed(1)}s | Model: ${model}${reportId ? ` | DB: ${reportId}` : ''}`);
  console.log('='.repeat(60));

  return { reportId, content: cleanContent, filename, durationMs };
}

/** @internal Exported for testing */
export function makeFilename(type: string, topic: string): string {
  const date = new Date().toISOString().slice(0, 10);
  const slug = topic.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').slice(0, 60);
  return `${date}-${type}-${slug}.md`;
}

/** @internal Exported for testing */
export function parseMetadata(content: string): Record<string, unknown> {
  const patterns = [
    /```json-metadata\s*\n([\s\S]*?)\n\s*```/,
    /```json\s*\n(\{[\s\S]*?"total_sources"[\s\S]*?\})\n\s*```/,
  ];
  for (const pattern of patterns) {
    const match = content.match(pattern);
    if (match) {
      try { return JSON.parse(match[1]) as Record<string, unknown>; } catch {
        // Ignore malformed metadata
      }
    }
  }
  return {};
}

/** @internal Exported for testing */
export function extractSummary(content: string, maxLength = 500): string {
  const summaryMatch = content.match(/## (?:Executive Summary|Summary|TL;DR)\s*\n([\s\S]*?)(?=\n## |\n---|\n$)/i);
  if (summaryMatch) return summaryMatch[1].trim().slice(0, maxLength);
  const firstPara = content.split('\n\n').find(p => p.trim().length > 50);
  return (firstPara ?? content.slice(0, maxLength)).trim().slice(0, maxLength);
}

/**
 * Load a report file for an agent to read as context.
 */
export async function loadReportAsContext(filename: string): Promise<string> {
  try {
    return await readFile(resolve(REPORTS_DIR, filename), 'utf-8');
  } catch {
    return '';
  }
}

/**
 * Lightweight agent run for discussion rounds.
 * No file save, no DB — just prompt in, content out.
 */
export async function runDiscussionRound(
  config: AgentConfig,
  prompt: string,
  opts?: { model?: string; maxTurns?: number; timeout?: number; onChild?: (child: import('child_process').ChildProcess) => void },
): Promise<{ content: string; durationMs: number }> {
  const model = opts?.model ?? config.defaultModel;
  const maxTurns = opts?.maxTurns ?? 10;
  const timeout = opts?.timeout ?? 300_000;

  const startMs = Date.now();

  const mcpConfig = JSON.stringify({
    mcpServers: Object.fromEntries(
      Object.entries(config.mcpServers).map(([name, srv]) => [
        name,
        { type: 'stdio', command: srv.command, args: srv.args, env: srv.env },
      ]),
    ),
  });

  const mcpToolPatterns = Object.keys(config.mcpServers).map(name => `mcp__${name}__*`);
  const allTools = [...mcpToolPatterns, ...config.extraTools].join(',');

  const args = [
    '-p',
    '--model', model,
    '--max-turns', String(maxTurns),
    '--output-format', 'text',
    ...(allTools ? ['--allowedTools', allTools] : []),
    ...(Object.keys(config.mcpServers).length > 0 ? ['--mcp-config', mcpConfig] : []),
  ];

  const content = await new Promise<string>((resolveP, reject) => {
    const cleanEnv = { ...process.env };
    delete cleanEnv.CLAUDECODE;

    const child = spawn('claude', args, {
      cwd: resolve(__dirname, '../..'),
      stdio: ['pipe', 'pipe', 'inherit'],
      timeout,
      env: cleanEnv,
    });

    opts?.onChild?.(child);

    let stdout = '';
    const STDOUT_CAP = 100 * 1024;
    child.stdout.on('data', (data: Buffer) => {
      if (stdout.length < STDOUT_CAP) {
        const chunk = data.toString();
        stdout += chunk.slice(0, STDOUT_CAP - stdout.length);
      }
    });
    child.stdout.on('error', (err) => reject(err));
    child.on('error', (err) => reject(err));
    child.on('close', (code, signal) => {
      if (stdout.length >= STDOUT_CAP) stdout += '\n\n[TRUNCATED: Output exceeded ' + (STDOUT_CAP / 1024) + 'KB cap]';
      if (code === 0) {
        resolveP(stdout.trim());
      } else if (signal === 'SIGTERM' && stdout.length > 100) {
        resolveP(stdout.trim());
      } else {
        reject(new Error(`${config.name} round exited: code=${code} signal=${signal}`));
      }
    });

    child.stdin.on('error', () => {});
    child.stdin.write(prompt);
    child.stdin.end();
  });

  return { content, durationMs: Date.now() - startMs };
}
