#!/usr/bin/env npx tsx
/**
 * Conductor — Multi-Agent Discussion Orchestrator
 *
 * Runs multiple Claude agents in parallel discussion rounds.
 * Each round: agents see the question + all previous contributions.
 * Flat-rate via Max Plan — parallel agents cost nothing extra.
 *
 * Usage:
 *   npx tsx agents/conductor.ts "What should we build next?"
 *   npx tsx agents/conductor.ts --debate "Option A vs Option B"
 *   npx tsx agents/conductor.ts --review <report-filename>
 *   npx tsx agents/conductor.ts --improve "Project or feature"
 *   npx tsx agents/conductor.ts --rounds 3 "Topic"
 *   npx tsx agents/conductor.ts --with-cto "Fix all bugs from discovery"
 *   npx tsx agents/conductor.ts --sonnet "Topic"
 */

import { runDiscussionRound, loadReportAsContext, type AgentConfig } from './lib/base-agent.js';
import { getConductorConfig, getConductorRole } from './cto-agent.js';
import { saveReport, saveDiscussion, closePool } from './lib/db.js';
import { pickMcp } from './lib/mcp-config.js';
import { writeFile, mkdir, unlink } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = resolve(__dirname, '../reports');

// Track child processes for SIGINT cleanup
const activeChildren: Set<import('child_process').ChildProcess> = new Set();
function trackChild(child: import('child_process').ChildProcess) {
  activeChildren.add(child);
  child.on('close', () => activeChildren.delete(child));
}
process.on('SIGINT', async () => {
  console.log(`\n\nSIGINT — killing ${activeChildren.size} active agents...`);
  for (const child of activeChildren) {
    child.kill('SIGTERM');
  }
  await closePool().catch(() => {});
  process.exit(1);
});

// ─── Agent Configs (lightweight for discussion) ───────────

const agents: Record<string, AgentConfig> = {
  research: {
    name: 'Research',
    type: 'research',
    defaultModel: 'claude-opus-4-6',
    maxTurns: 10,
    mcpServers: pickMcp('tavily', 'context7'),
    extraTools: ['WebSearch', 'WebFetch'],
  },
  critic: {
    name: 'Critic',
    type: 'critic',
    defaultModel: 'claude-opus-4-6',
    maxTurns: 10,
    mcpServers: pickMcp('tavily'),
    extraTools: ['WebSearch', 'WebFetch'],
  },
  analyst: {
    name: 'Analyst',
    type: 'analyst',
    defaultModel: 'claude-opus-4-6',
    maxTurns: 10,
    mcpServers: pickMcp('code-pathfinder', 'context'),
    extraTools: ['Read', 'Glob', 'Grep', 'Bash'],
  },
};

// CTO agent — added dynamically via --with-cto (the only agent who can edit code)
const ctoAgent: AgentConfig = getConductorConfig();

// ─── Discussion Types ─────────────────────────────────────

type DiscussionMode = 'open' | 'debate' | 'review' | 'improve';

interface DiscussionConfig {
  mode: DiscussionMode;
  question: string;
  rounds: number;
  model?: string;
  withCto?: boolean;
  reportContext?: string;
}

interface RoundContribution {
  agent: string;
  content: string;
  durationMs: number;
}

// ─── Role Prompts ─────────────────────────────────────────

function agentRole(agent: string, mode: DiscussionMode): string {
  const roles: Record<string, Record<DiscussionMode, string>> = {
    research: {
      open: 'You are the Research Agent. ACTIVELY research the topic (tavily_search, WebSearch). Deliver facts, data, market info, trends. No opinions without sources.',
      debate: 'You are the Research Agent. Research BOTH sides of the debate. Deliver facts and data for both options. Stay neutral.',
      review: 'You are the Research Agent. Research INDEPENDENTLY on the same topic. Compare your findings with the report. Find what\'s missing or outdated.',
      improve: 'You are the Research Agent. Research best practices, competitors, and relevant trends. Deliver concrete improvement ideas with sources.',
    },
    critic: {
      open: 'You are the Critic — Devil\'s Advocate. Question EVERYTHING. Find risks, blind spots, weaknesses. Every criticism needs an improvement suggestion.',
      debate: 'You are the Critic. Check both sides\' arguments for logic errors, missing data, exaggerated claims. Who has the stronger arguments?',
      review: 'You are the Critic. Fact check: Are the numbers correct? Are the conclusions logical? What is one-sided or outdated?',
      improve: 'You are the Critic. Find the REAL problems, not the obvious ones. What would a customer criticize? What would go wrong? Be sharp but constructive.',
    },
    analyst: {
      open: 'You are the Analyst — Code Archaeologist. Check what we ALREADY HAVE in code, infra, tools (use code-pathfinder). What can we reuse? What\'s missing technically?',
      debate: 'You are the Analyst. Check the technical feasibility of both options. What do we already have? What would we need to build? Effort estimate.',
      review: 'You are the Analyst. Read the code mentioned in the report. Are the technical claims correct? What\'s missing in the analysis?',
      improve: 'You are the Analyst. Analyze the current code. Find concrete technical improvements, tech debt, quick wins.',
    },
  };

  // CTO has dynamic roles from cto-agent.ts
  if (agent === 'cto') return getConductorRole(mode);

  return roles[agent]?.[mode] ?? '';
}

// ─── Prompt Builders ──────────────────────────────────────

function buildRound1Prompt(agent: string, config: DiscussionConfig, agentMap: Record<string, AgentConfig>): string {
  const role = agentRole(agent, config.mode);
  const context = config.reportContext
    ? `\n\n--- REPORT UNDER DISCUSSION ---\n${config.reportContext}\n--- END REPORT ---\n`
    : '';

  const agentNames = Object.values(agentMap).map(a => a.name);
  const agentListStr = `${agentNames.length} Agents (${agentNames.join(', ')})`;

  return `${role}

You are part of a multi-agent discussion with ${agentListStr}.
This is Round 1 — give your FIRST assessment.

QUESTION/TOPIC: ${config.question}
${context}
DISCUSSION RULES:
- SHORT and CONCISE: Max 800 words. Quality > Quantity.
- Use your tools ACTIVELY (research / read code / search)
- Structure clearly: core point on top, details below
- NO metadata blocks, NO frontmatter — just your contribution
- Start with "## [${agentMap[agent]?.name ?? agent}] Round 1" as heading`;
}

function buildFollowupPrompt(
  agent: string,
  config: DiscussionConfig,
  allPreviousRounds: RoundContribution[][],
  roundNum: number,
  agentMap: Record<string, AgentConfig>,
): string {
  const role = agentRole(agent, config.mode);

  const history = allPreviousRounds.map((round, i) => {
    const contributions = round
      .map(c => `**${agentMap[c.agent]?.name ?? c.agent}:** ${c.content}`)
      .join('\n\n');
    return `### Round ${i + 1}\n${contributions}`;
  }).join('\n\n---\n\n');

  const ownPrevious = allPreviousRounds
    .map((round, i) => {
      const own = round.find(c => c.agent === agent);
      return own ? `Round ${i + 1}: ${own.content}` : null;
    })
    .filter(Boolean)
    .join('\n\n');

  return `${role}

You are part of a multi-agent discussion. This is Round ${roundNum}.

QUESTION/TOPIC: ${config.question}

PREVIOUS DISCUSSION (all rounds):
${history}

YOUR PREVIOUS CONTRIBUTIONS:
${ownPrevious || '(none)'}

YOUR TASK IN ROUND ${roundNum}:
- React to the other agents' contributions
- Where do you agree? Disagree? What was overlooked?
- Build on the others' findings
- You CAN do NEW research if needed
- Change your mind if the others' arguments are stronger
- Do NOT repeat yourself — only new insights

RULES:
- SHORT: Max 600 words
- Concrete: Reference specific points ("Analyst says X — but...")
- Start with "## [${agentMap[agent]?.name ?? agent}] Round ${roundNum}"`;
}

function buildSynthesisPrompt(config: DiscussionConfig, allContributions: RoundContribution[][], agentMap: Record<string, AgentConfig>): string {
  const rounds = allContributions.map((round, i) =>
    round.map(c => `### ${agentMap[c.agent]?.name ?? c.agent} — Round ${i + 1}\n${c.content}`).join('\n\n'),
  ).join('\n\n---\n\n');

  return `You are the Synthesis Agent. Your job: Summarize the entire discussion and deliver clear results.

QUESTION/TOPIC: ${config.question}

COMPLETE DISCUSSION:
${rounds}

YOUR TASK:
Create a clear, action-oriented synthesis:

## Consensus
What do all (or almost all) agents agree on?

## Controversies
Where was there disagreement? Who had the stronger arguments?

## Key Findings
The 3-5 most important takeaways from the discussion (prioritized).

## Recommended Next Steps
Concrete, actionable items (who does what?).

## Open Questions
What could the discussion NOT resolve? What needs a human decision?

RULES:
- Max 1000 words
- No own opinion — only summarize what the agents worked out
- For disagreements: present both positions, name the stronger argument`;
}

// ─── Discussion Runner ────────────────────────────────────

async function runRound(
  roundNum: number,
  agentNames: string[],
  agentMap: Record<string, AgentConfig>,
  promptBuilder: (agent: string) => string,
  model?: string,
): Promise<RoundContribution[]> {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`ROUND ${roundNum} — ${agentNames.length} Agents parallel`);
  console.log('─'.repeat(50));

  const results = await Promise.allSettled(
    agentNames.map(async (name) => {
      const agentCfg = agentMap[name];
      if (!agentCfg) throw new Error(`Unknown agent: ${name}`);
      const prompt = promptBuilder(name);
      console.log(`  [${agentCfg.name}] Round ${roundNum} starting...`);

      const maxTurns = agentCfg.type === 'cto' ? agentCfg.maxTurns : 10;
      const result = await runDiscussionRound(agentCfg, prompt, { model, maxTurns, onChild: trackChild });

      console.log(`  [${agentCfg.name}] Round ${roundNum} done (${(result.durationMs / 1000).toFixed(0)}s)`);
      return { agent: name, content: result.content, durationMs: result.durationMs };
    }),
  );

  const contributions: RoundContribution[] = [];
  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    const name = agentNames[i];
    if (r.status === 'fulfilled') {
      contributions.push(r.value);
    } else {
      const errMsg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      const agentLabel = agentMap[name]?.name ?? name;
      console.error(`  [${agentLabel}] FAILED: ${errMsg.slice(0, 200)}`);
      contributions.push({
        agent: name,
        content: `[${agentLabel} could not participate in Round ${roundNum}: ${errMsg.slice(0, 100)}]`,
        durationMs: 0,
      });
    }
  }

  const succeeded = contributions.filter(c => c.durationMs > 0).length;
  if (succeeded < 2) {
    throw new Error(`Only ${succeeded} of ${agentNames.length} agents succeeded — discussion aborted.`);
  }

  return contributions;
}

async function runDiscussion(config: DiscussionConfig): Promise<void> {
  const startMs = Date.now();

  const activeAgents: Record<string, AgentConfig> = { ...agents };

  if (config.withCto) {
    activeAgents.cto = ctoAgent;
    console.log('  + CTO Agent activated — fixes code LIVE during discussion');
  }

  const agentNames = Object.keys(activeAgents);
  const allRounds: RoundContribution[][] = [];

  console.log('\n' + '='.repeat(60));
  console.log('CONDUCTOR — Multi-Agent Discussion');
  console.log('='.repeat(60));
  console.log(`Topic: ${config.question}`);
  console.log(`Mode: ${config.mode} | Rounds: ${config.rounds} | Agents: ${agentNames.length}`);
  console.log(`Model: ${config.model ?? 'claude-opus-4-6'}`);
  console.log('='.repeat(60));

  // Round 1: Initial positions (parallel)
  const round1 = await runRound(
    1,
    agentNames,
    activeAgents,
    (agent) => buildRound1Prompt(agent, config, activeAgents),
    config.model,
  );
  allRounds.push(round1);

  for (const c of round1) {
    const preview = c.content.split('\n').slice(0, 3).join(' ').slice(0, 120);
    console.log(`  ${activeAgents[c.agent]?.name ?? c.agent}: "${preview}..."`);
  }

  // Additional rounds: React to each other
  for (let r = 2; r <= config.rounds; r++) {
    const roundN = await runRound(
      r,
      agentNames,
      activeAgents,
      (agent) => buildFollowupPrompt(agent, config, allRounds, r, activeAgents),
      config.model,
    );
    allRounds.push(roundN);
  }

  // Save rounds to file BEFORE synthesis (crash protection)
  const partialSlug = config.question.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').slice(0, 50);
  const partialFile = resolve(REPORTS_DIR, `.partial-${partialSlug}.json`);
  try {
    await mkdir(REPORTS_DIR, { recursive: true });
    await writeFile(partialFile, JSON.stringify({ config, rounds: allRounds }, null, 2), 'utf-8');
  } catch { /* best effort */ }

  // Synthesis round
  console.log(`\n${'─'.repeat(50)}`);
  console.log('SYNTHESIS');
  console.log('─'.repeat(50));

  const synthesisConfig: AgentConfig = {
    name: 'Synthesizer',
    type: 'synthesis',
    defaultModel: config.model ?? 'claude-opus-4-6',
    maxTurns: 3,
    mcpServers: {},
    extraTools: [],
  };

  let synthesis: { content: string; durationMs: number };
  try {
    synthesis = await runDiscussionRound(
      synthesisConfig,
      buildSynthesisPrompt(config, allRounds, activeAgents),
      { model: config.model, maxTurns: 3, onChild: trackChild },
    );
  } catch (err) {
    console.error('Synthesis failed:', (err as Error).message);
    synthesis = { content: '[Synthesis could not be created — round data saved in .partial-*.json]', durationMs: 0 };
  }

  // Combine into report
  const totalDuration = Date.now() - startMs;
  const fullReport = buildFullReport(config, allRounds, synthesis.content, totalDuration, activeAgents);

  await mkdir(REPORTS_DIR, { recursive: true });
  const slug = config.question.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').slice(0, 50);
  const filename = `${new Date().toISOString().slice(0, 10)}-discussion-${slug}.md`;
  await writeFile(resolve(REPORTS_DIR, filename), fullReport, 'utf-8');

  await unlink(partialFile).catch(() => {});

  // Save to DB (optional)
  try {
    const reportId = await saveReport({
      agentType: 'discussion',
      topic: config.question,
      content: fullReport,
      summary: synthesis.content.slice(0, 500),
      metadata: {
        mode: config.mode,
        rounds: config.rounds,
        agents: Object.keys(activeAgents),
        totalDurationSeconds: Number((totalDuration / 1000).toFixed(1)),
      },
      tags: ['discussion', config.mode],
    });

    if (reportId) {
      for (let i = 0; i < allRounds.length; i++) {
        for (const contrib of allRounds[i]) {
          await saveDiscussion({
            reportId,
            agentType: contrib.agent,
            position: i === 0 ? 'extend' : 'synthesize',
            content: contrib.content,
          });
        }
      }
      console.log(`\nDB: Report ${reportId}`);
    }
  } catch {
    // DB is optional
  } finally {
    await closePool();
  }

  console.log('\n' + '='.repeat(60));
  console.log('DISCUSSION COMPLETE');
  console.log('='.repeat(60));
  console.log(`File: reports/${filename}`);
  console.log(`Duration: ${(totalDuration / 1000).toFixed(0)}s | ${config.rounds} rounds + synthesis`);
  console.log('='.repeat(60));

  console.log('\n' + synthesis.content);
}

function buildFullReport(
  config: DiscussionConfig,
  rounds: RoundContribution[][],
  synthesis: string,
  totalDurationMs: number,
  agentMap: Record<string, AgentConfig>,
): string {
  const header = `---
type: discussion
mode: ${config.mode}
topic: "${config.question}"
date: ${new Date().toISOString()}
rounds: ${config.rounds}
agents: ${Object.keys(agentMap).join(', ')}
duration: ${(totalDurationMs / 1000).toFixed(0)}s
---

# Multi-Agent Discussion: ${config.question}

**Mode:** ${config.mode} | **Rounds:** ${config.rounds} | **Duration:** ${(totalDurationMs / 1000).toFixed(0)}s

---

`;

  const roundSections = rounds.map((round, i) => {
    const contributions = round.map(c => c.content).join('\n\n');
    return `# Round ${i + 1}\n\n${contributions}`;
  }).join('\n\n---\n\n');

  const synthSection = `\n\n---\n\n# Synthesis\n\n${synthesis}`;

  return header + roundSections + synthSection;
}

// ─── CLI ──────────────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  let mode: DiscussionMode = 'open';
  let model: string | undefined;
  let rounds = 2;
  let question = '';
  let reportContext: string | undefined;
  let withCto = false;

  const remaining: string[] = [];
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--debate') { mode = 'debate'; }
    else if (arg === '--review') { mode = 'review'; }
    else if (arg === '--improve') { mode = 'improve'; }
    else if (arg === '--sonnet') { model = 'claude-sonnet-4-6'; }
    else if (arg === '--haiku') { model = 'claude-haiku-4-5-20251001'; }
    else if (arg === '--opus') { /* default */ }
    else if (arg === '--with-cto' || arg === '--cto') { withCto = true; }
    else if (arg === '--rounds' && args[i + 1]) { rounds = parseInt(args[++i], 10) || 2; }
    else if (!arg.startsWith('--')) { remaining.push(arg); }
  }

  question = remaining.join(' ');

  if (mode === 'review' && remaining[0]) {
    const ctx = await loadReportAsContext(remaining[0]);
    if (ctx) {
      reportContext = ctx;
      question = `Review: ${remaining[0]}`;
    }
  }

  if (!question) {
    console.log(`Agent Fleet — Conductor (Multi-Agent Discussion)

Usage:
  npx tsx agents/conductor.ts "Open question"
  npx tsx agents/conductor.ts --debate "Option A vs Option B"
  npx tsx agents/conductor.ts --review <report-filename>
  npx tsx agents/conductor.ts --improve "Project or feature"

Options:
  --rounds N      Number of discussion rounds (default: 2)
  --sonnet        Use Sonnet instead of Opus
  --haiku         Use Haiku instead of Opus
  --with-cto      CTO Agent — fixes code LIVE during the discussion

Agents: Research (Web), Critic (Devil's Advocate), Analyst (Code)
Optional: CTO (Code Fixer, via --with-cto)
Each round runs in parallel — agents discuss simultaneously.`);
    return;
  }

  rounds = Math.max(1, Math.min(rounds, 4));

  await runDiscussion({ mode, question, rounds, model, reportContext, withCto });
}

main().catch((err) => { console.error(err); process.exit(1); });
