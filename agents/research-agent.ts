#!/usr/bin/env npx tsx
/**
 * Research Agent — Deep Research & Vision
 *
 * Dedicated research agent with multiple research modes.
 * Reports saved as Markdown files in reports/ directory + optional DB.
 *
 * Usage:
 *   npx tsx agents/research-agent.ts "topic"                    # General research
 *   npx tsx agents/research-agent.ts --vision "area"            # Vision: What could we build?
 *   npx tsx agents/research-agent.ts --tech "framework"         # Tech deep-dive
 *   npx tsx agents/research-agent.ts --product "idea or market" # Product/market analysis
 *   npx tsx agents/research-agent.ts --competitor "niche"       # Competitor analysis
 *   npx tsx agents/research-agent.ts --paper "topic"            # Academic/research papers
 *   npx tsx agents/research-agent.ts --idea "business idea"     # Idea validation
 *   npx tsx agents/research-agent.ts --news "topic"             # News roundup
 *   npx tsx agents/research-agent.ts --sonnet "topic"           # Use Sonnet instead
 *   npx tsx agents/research-agent.ts --list                     # List recent reports
 *   npx tsx agents/research-agent.ts --report <filename>        # Show specific report
 */

import { runAgent, type AgentConfig } from './lib/base-agent.js';
import { pickMcp } from './lib/mcp-config.js';
import { readdir, readFile } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = resolve(__dirname, '../reports');

// ─── Types ─────────────────────────────────────────

type ResearchType = 'general' | 'vision' | 'tech' | 'product' | 'competitor' | 'paper' | 'idea' | 'news';

// ─── Agent Config ─────────────────────────────────

function getConfig(type: ResearchType): AgentConfig {
  return {
    name: 'Research Agent',
    type: type === 'general' ? 'research' : type,
    defaultModel: 'claude-opus-4-6',
    maxTurns: type === 'news' ? 15 : 25,
    mcpServers: pickMcp('tavily', 'context7'),
    extraTools: ['WebSearch', 'WebFetch'],
  };
}

// ─── Prompt Builder ────────────────────────────────

function buildPrompt(type: ResearchType, topic: string): string {
  const typeInstructions: Record<ResearchType, string> = {
    general: `Conduct comprehensive research:
1. Start with broad searches using multiple search terms and angles
2. Extract the 3-5 most relevant sources in full text
3. For complex topics: use multiple search angles
4. Summarize everything with clear findings and actionable insights`,

    vision: `You are the VISION Agent — your job is to look FORWARD, not backward.
What could we build? What could we invent? What new products, tools, or systems?

YOUR TASK:
1. Research what OTHERS are building in the area of "${topic}"
2. Find trends, new technologies, market gaps
3. Think: What could WE build with our infrastructure?
4. Be creative but realistic

Report Structure:
- **Trend Scan** (3-5 relevant trends with sources)
- **What Others Are Building** (concrete examples, products, startups)
- **Our Superpowers** (what do we have that others don't?)
- **3 Product Ideas** (each: What, For whom, Why us, MVP timeline, Revenue potential)
- **The ONE Recommendation** (if we could only build 1 thing — which one?)
- **Next Step** (what do we do TOMORROW first?)`,

    tech: `Conduct a technical deep-dive:
1. Search official documentation and GitHub repos
2. Extract README, docs, and guides
3. Check recent news and updates
4. Compare with alternatives
5. Evaluate: maturity, community, performance, DX, suitability

Report Structure:
- **What Is It?** (brief description)
- **State of the Art** (version, maturity, community)
- **Strengths / Weaknesses**
- **Comparison with Alternatives** (table)
- **Relevance for Us** (concrete use cases)
- **Recommendation** (use / watch / ignore)`,

    product: `Conduct a DETAILED product and market analysis:
1. Search for market size, trends, and key players — at least 5 search terms
2. Identify Top 5-10 competitors and extract their websites
3. Use multiple search angles: market overview, competitors, pricing, reviews
4. Create a competitive matrix

Report Structure (minimum 3000 words):
- **Market Overview** (size, growth, trends — with numbers and sources)
- **Identified Market Gaps** (per gap: description, potential, why unfilled)
- **Competitive Matrix** (table: Name, URL, Pricing, USP, Strengths, Weaknesses)
- **Concrete Opportunities** (what exactly could we offer, to whom, at what price)
- **Go-to-Market Strategy** (first steps, distribution channels)
- **Risks and Challenges**
- **Recommendation** (prioritized action items)`,

    competitor: `Research the competitive landscape thoroughly:
1. Identify all relevant competitors
2. Extract their websites, pricing pages, feature lists
3. Analyze their positioning, strengths, weaknesses
4. Find differentiation opportunities

Report Structure:
- **Top 10 Competitors** (table: Name, URL, Founded, Funding, USP)
- **Feature Comparison** (matrix)
- **Pricing Comparison** (table)
- **Their Weaknesses** (where could we be better?)
- **Our Differentiation** (concrete suggestions)
- **Market Gaps** (what does NOBODY offer?)`,

    paper: `Research academic and technical publications:
1. Search for papers, blog posts, technical articles
2. Extract the most important sources
3. Search for implementations on GitHub
4. Summarize the current state of research

Report Structure:
- **Overview** (research field, context)
- **Key Papers/Articles** (title, authors, key findings)
- **State of the Art** (what works, what doesn't)
- **Open Problems** (current research questions)
- **Practical Applicability** (what could we build with this?)
- **Implementations** (GitHub repos, libraries)`,

    idea: `Validate this business idea thoroughly:
1. Search for existing solutions
2. Analyze the market and target audience
3. Check technical feasibility
4. Evaluate revenue potential

Report Structure:
- **Idea Summary** (1 sentence)
- **Does This Already Exist?** (competitors, similar products)
- **Target Audience** (who would buy/use this?)
- **Market Size** (TAM/SAM/SOM estimate)
- **Technical Feasibility** (what do we need, how long?)
- **Revenue Model** (how to monetize?)
- **Unfair Advantage** (what do we have that others don't?)
- **Risks** (what can go wrong?)
- **Verdict** (GO / MAYBE / KILL — with reasoning)
- **Next Steps** (if GO: what first?)`,

    news: `Collect current news and developments:
1. Search for news from the last week
2. Supplement with background articles
3. Extract the 2-3 most important articles
4. Assess: What does this mean for us?

Report Structure:
- **Top News** (each: headline, source, date, summary)
- **Analysis** (what does this mean for our projects?)
- **Action Items** (do we need to react to anything?)`,
  };

  return `You are a Research & Vision Agent — an expert at deep research and forward-thinking analysis.
Your job: Research AND think ahead. Not just collect facts, but recognize opportunities.

Topic: "${topic}"

${typeInstructions[type]}

RULES:
- Use BOTH research sources in parallel for best results:
  1. Tavily tools (tavily_search, tavily_extract, tavily_research, tavily_crawl) — multi-engine search
  2. WebSearch + WebFetch — additional web search, often different/better results
- Start with tavily_search AND WebSearch in parallel on the same topic, then deepen the best hits
- Provide ALL source URLs
- Separate facts from opinions
- For contradictory sources: present both sides
- NEVER fabricate information — if you find nothing, say so
- Write EVERYTHING into your output — not just a summary

At the END, add this metadata block:
\`\`\`json-metadata
{
  "total_sources": <count>,
  "extracted_pages": <count>,
  "research_type": "${type}",
  "topic": "${topic}"
}
\`\`\``;
}

// ─── CLI: List Reports ─────────────────────────────

async function listReports(): Promise<void> {
  try {
    const files = await readdir(REPORTS_DIR);
    const mdFiles = files.filter((f) => f.endsWith('.md')).sort().reverse();

    if (mdFiles.length === 0) {
      console.log('No reports found.');
      return;
    }

    console.log('\nReports\n');
    for (const file of mdFiles.slice(0, 20)) {
      const content = await readFile(resolve(REPORTS_DIR, file), 'utf-8');
      const topicMatch = content.match(/^topic:\s*"?(.+?)"?\s*$/m);
      const typeMatch = content.match(/^type:\s*(.+)$/m);
      const sourcesMatch = content.match(/^sources:\s*(\d+)$/m);
      const topic = topicMatch?.[1] ?? '?';
      const type = typeMatch?.[1] ?? '?';
      const sources = sourcesMatch?.[1] ?? '?';
      const date = file.slice(0, 10);

      console.log(`  ${date} | [${type.padEnd(10)}] ${topic} (${sources} sources)`);
      console.log(`  ${' '.repeat(13)}${file}`);
      console.log();
    }
  } catch {
    console.log('No reports found. Start a research!');
  }
}

// ─── CLI: Show Report ──────────────────────────────

async function showReport(filename: string): Promise<void> {
  try {
    const files = await readdir(REPORTS_DIR);
    const match = files.find((f) => f.includes(filename));
    if (!match) {
      console.log(`Report "${filename}" not found.`);
      return;
    }
    const content = await readFile(resolve(REPORTS_DIR, match), 'utf-8');
    console.log(content);
  } catch {
    console.log(`Report "${filename}" not found.`);
  }
}

// ─── Main ──────────────────────────────────────────

async function main(): Promise<void> {
  const args = process.argv.slice(2);

  if (args[0] === '--list') {
    await listReports();
    return;
  }

  if (args[0] === '--report' && args[1]) {
    await showReport(args[1]);
    return;
  }

  // Determine model
  let model: string | undefined;
  const filteredArgs = args.filter((a) => {
    if (a === '--sonnet') { model = 'claude-sonnet-4-6'; return false; }
    if (a === '--haiku') { model = 'claude-haiku-4-5-20251001'; return false; }
    if (a === '--opus') { return false; }
    return true;
  });

  // Determine research type and topic
  let type: ResearchType = 'general';
  let topic = '';

  const typeFlags: Record<string, ResearchType> = {
    '--vision': 'vision',
    '--tech': 'tech',
    '--product': 'product',
    '--competitor': 'competitor',
    '--paper': 'paper',
    '--idea': 'idea',
    '--news': 'news',
  };

  if (filteredArgs[0] && typeFlags[filteredArgs[0]] && filteredArgs[1]) {
    type = typeFlags[filteredArgs[0]];
    topic = filteredArgs.slice(1).join(' ');
  } else if (filteredArgs[0] && !filteredArgs[0].startsWith('--')) {
    topic = filteredArgs.join(' ');
  }

  if (!topic) {
    console.log(`Agent Fleet — Research Agent

Usage:
  npx tsx agents/research-agent.ts "topic"                    # General research
  npx tsx agents/research-agent.ts --tech "framework"         # Tech deep-dive
  npx tsx agents/research-agent.ts --product "idea or market" # Product/market analysis
  npx tsx agents/research-agent.ts --competitor "niche"       # Competitor analysis
  npx tsx agents/research-agent.ts --paper "topic"            # Academic/research papers
  npx tsx agents/research-agent.ts --idea "business idea"     # Idea validation
  npx tsx agents/research-agent.ts --news "topic"             # News roundup

Options:
  --sonnet    Use Sonnet instead of Opus
  --haiku     Use Haiku instead of Opus
  --list      List recent reports
  --report <name>  Show specific report`);
    return;
  }

  const config = getConfig(type);
  const prompt = buildPrompt(type, topic);

  const result = await runAgent(config, {
    topic,
    prompt,
    model,
    tags: ['research', type],
  });

  // Preview
  console.log(result.content.slice(0, 3000));
  if (result.content.length > 3000) {
    console.log(`\n... (${result.content.length} chars, full report in reports/${result.filename})`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
