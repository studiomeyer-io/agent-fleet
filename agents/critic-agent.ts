#!/usr/bin/env npx tsx
/**
 * Critic Agent — Devil's Advocate
 *
 * Challenges ideas, reports, and plans. Finds weaknesses, blind spots, risks.
 * Can critique a report from another agent or a freeform idea.
 *
 * Usage:
 *   npx tsx agents/critic-agent.ts "idea or plan to critique"
 *   npx tsx agents/critic-agent.ts --report <filename>     # Critique a research report
 *   npx tsx agents/critic-agent.ts --idea "business idea"  # Challenge a business idea
 *   npx tsx agents/critic-agent.ts --plan "technical plan" # Challenge a technical plan
 *   npx tsx agents/critic-agent.ts --sonnet "topic"        # Use Sonnet
 */

import { runAgent, loadReportAsContext, type AgentConfig } from './lib/base-agent.js';
import { pickMcp } from './lib/mcp-config.js';
import { readdir } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = resolve(__dirname, '../reports');

const config: AgentConfig = {
  name: 'Critic Agent',
  type: 'critic',
  defaultModel: 'claude-opus-4-6',
  maxTurns: 15,
  mcpServers: pickMcp('tavily'),
  extraTools: ['WebSearch', 'WebFetch'],
};

type CritiqueType = 'general' | 'report' | 'idea' | 'plan';

function buildPrompt(type: CritiqueType, topic: string, reportContext?: string): string {
  const baseRole = `You are the Critic Agent — a sharp, analytical Devil's Advocate.
Your job: critically examine IDEAS and PLANS. Find weaknesses, blind spots, propose alternatives.
You are constructively critical — every criticism comes with a BETTER suggestion.`;

  const typeInstructions: Record<CritiqueType, string> = {
    general: `Analyze and critically examine the following:

"${topic}"

Structure your analysis:
- **Strengths** (what's good? max 3 points)
- **Weaknesses** (what's problematic? detailed)
- **Blind Spots** (what was overlooked?)
- **Risks** (what can go wrong? probability + impact)
- **Missing Data** (what would you need to know to judge better?)
- **Improvement Suggestions** (concrete, actionable)
- **Verdict** (GO / REWORK / KILL — with clear reasoning)`,

    report: `Analyze and critique this research report:

${reportContext ?? '(No report loaded)'}

---

YOUR TASK:
1. **Research INDEPENDENTLY** on the same topic (tavily_search + WebSearch) — INDEPENDENT from the report
2. Compare your findings with the report
3. Find: missing sources, outdated info, one-sided presentation, wrong conclusions

Structure:
- **Fact Check** (are the numbers correct? sources verified?)
- **Missing Perspectives** (what did the report overlook?)
- **Outdated Info** (what has changed since?)
- **Logic Errors** (conclusions that don't follow from the data)
- **Own Findings** (what did YOU find that the report doesn't have?)
- **Quality Score** (1-10, with reasoning)
- **Recommendation** (use report / rework / discard)`,

    idea: `Play Devil's Advocate for this business idea:

"${topic}"

ACTIVELY research (tavily_search + WebSearch) for:
- Existing solutions that already do this
- Failed attempts in this space
- Market data that argues against the idea

Structure:
- **The Hard Truth** (1-2 sentences: what's the biggest problem?)
- **Already Exists** (who does this? how successful?)
- **Why It Could Fail** (top 5 risks with probability)
- **What's Missing** (team? money? market? timing?)
- **Counter-Arguments** (arguments FOR the idea that withstand the risks)
- **Improvement Suggestions** (how to minimize the risks?)
- **Verdict** (GO / PIVOT / KILL — with reasoning)
- **If GO:** What needs to happen on DAY ONE?`,

    plan: `Critically examine this technical plan / architecture proposal:

"${topic}"

ACTIVELY research alternatives and best practices.

Structure:
- **Architecture Weaknesses** (scalability, maintainability, complexity)
- **Alternative Approaches** (what would a senior architect do differently?)
- **Over-Engineering** (is more being built than necessary?)
- **Under-Engineering** (is something important missing?)
- **Vendor Lock-in / Dependencies** (problematic dependencies?)
- **Security Concerns** (obvious gaps?)
- **Maintenance Cost** (how expensive will this be in 6 months?)
- **Recommendation** (implement / simplify / completely different approach)`,
  };

  return `${baseRole}

${typeInstructions[type]}

RULES:
- Use tavily_search AND WebSearch for your own research
- Be SHARP but FAIR — no criticism without reasoning
- Every criticism needs a concrete improvement suggestion
- NEVER fabricate information

At the END, add this metadata block:
\`\`\`json-metadata
{
  "total_sources": <count of your own sources>,
  "quality_score": <1-10>,
  "verdict": "<GO|REWORK|PIVOT|KILL>",
  "research_type": "critic",
  "topic": "${topic.slice(0, 100)}"
}
\`\`\``;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  // Determine model
  let model: string | undefined;
  const filteredArgs = args.filter(a => {
    if (a === '--sonnet') { model = 'claude-sonnet-4-6'; return false; }
    if (a === '--haiku') { model = 'claude-haiku-4-5-20251001'; return false; }
    if (a === '--opus') { return false; }
    return true;
  });

  // Determine type and topic
  let type: CritiqueType = 'general';
  let topic = '';
  let reportContext: string | undefined;

  if (filteredArgs[0] === '--report' && filteredArgs[1]) {
    type = 'report';
    const files = await readdir(REPORTS_DIR).catch(() => []);
    const match = files.find(f => f.includes(filteredArgs[1]));
    if (match) {
      reportContext = await loadReportAsContext(match);
      topic = `Critique: ${match}`;
    } else {
      console.log(`Report "${filteredArgs[1]}" not found in reports/`);
      return;
    }
  } else if (filteredArgs[0] === '--idea' && filteredArgs[1]) {
    type = 'idea';
    topic = filteredArgs.slice(1).join(' ');
  } else if (filteredArgs[0] === '--plan' && filteredArgs[1]) {
    type = 'plan';
    topic = filteredArgs.slice(1).join(' ');
  } else if (filteredArgs[0] && !filteredArgs[0].startsWith('--')) {
    topic = filteredArgs.join(' ');
  }

  if (!topic) {
    console.log(`Agent Fleet — Critic Agent (Devil's Advocate)

Usage:
  npx tsx agents/critic-agent.ts "idea or plan"           # General critique
  npx tsx agents/critic-agent.ts --report <filename>      # Critique a research report
  npx tsx agents/critic-agent.ts --idea "business idea"   # Challenge business idea
  npx tsx agents/critic-agent.ts --plan "technical plan"  # Challenge technical plan

Options:
  --sonnet    Use Sonnet instead of Opus
  --haiku     Use Haiku instead of Opus`);
    return;
  }

  const result = await runAgent(config, {
    topic,
    prompt: buildPrompt(type, topic, reportContext),
    model,
    tags: ['critic', type],
  });

  console.log(result.content.slice(0, 3000));
  if (result.content.length > 3000) {
    console.log(`\n... (${result.content.length} chars, full report in reports/${result.filename})`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
