#!/usr/bin/env npx tsx
/**
 * Analyst Agent — Code Archaeologist & Project Analyst
 *
 * Analyzes existing projects, finds reusable patterns,
 * forgotten gems, and optimization potential.
 *
 * Usage:
 *   npx tsx agents/analyst-agent.ts "/path/to/project"              # Analyze a project
 *   npx tsx agents/analyst-agent.ts --compare "/path/a" "/path/b"   # Compare two projects
 *   npx tsx agents/analyst-agent.ts --patterns "/path/to/project"   # Find reusable patterns
 *   npx tsx agents/analyst-agent.ts --health "/path/to/project"     # Code health check
 */

import { runAgent, type AgentConfig } from './lib/base-agent.js';
import { pickMcp } from './lib/mcp-config.js';

const config: AgentConfig = {
  name: 'Analyst Agent',
  type: 'analyst',
  defaultModel: 'claude-opus-4-6',
  maxTurns: 30,
  mcpServers: pickMcp('code-pathfinder', 'context'),
  extraTools: ['Read', 'Glob', 'Grep', 'Bash', 'WebSearch'],
};

type AnalysisType = 'project' | 'compare' | 'patterns' | 'health';

function buildPrompt(type: AnalysisType, paths: string[]): string {
  const baseRole = `You are the Analyst Agent — an experienced code archaeologist and system analyst.
Your job: Analyze existing projects, recognize patterns, find gems, suggest improvements.
You look FORWARD: Not just what's broken, but what we could do BETTER or NEW.

IMPORTANT:
- You have Read, Glob, Grep and Bash tools. Use them ACTIVELY.
- ALWAYS read package.json, CLAUDE.md, README.md and the project structure first.
- Critique CODE and ARCHITECTURE, not the business.`;

  const typeInstructions: Record<AnalysisType, string> = {
    project: `Analyze this project thoroughly: ${paths[0]}

Approach:
1. Read package.json, CLAUDE.md/README.md for overview
2. Scan directory structure (Glob: **/*.ts, **/*.tsx)
3. Read the most important files (entry points, config, core logic)
4. Analyze dependencies (package.json)
5. Check Docker/deployment setup if present

Report Structure:
- **Project Profile** (name, purpose, tech stack, status, LOC estimate)
- **Architecture** (how is it structured? ASCII diagram)
- **Strengths** (what's well done?)
- **Weaknesses** (what's problematic? tech debt?)
- **Reusable** (patterns, libraries, components other projects could use)
- **Hidden Gems** (features/code that work but are unused)
- **Recommendations** (top 3 improvements, prioritized)`,

    compare: `Compare these two projects:
- Project A: ${paths[0]}
- Project B: ${paths[1]}

Read both projects (package.json, structure, core logic) and compare:

Report Structure:
- **Comparison Table** (tech stack, LOC, dependencies, architecture)
- **Similarities** (shared patterns, libraries, approaches)
- **Differences** (where does which project have the better solution?)
- **Synergies** (what could be shared/unified?)
- **Best-of-Both** (ideal approach combining the best)`,

    patterns: `Find reusable patterns in: ${paths[0]}

Read the code systematically and find:
1. Architecture patterns (how are APIs built? state management? auth?)
2. Utility functions that are generic enough
3. Configuration approaches
4. Testing patterns
5. Custom hooks / middleware / helpers

Report Structure:
- **Found Patterns** (each: name, file, description, reusability 1-5)
- **Extractable Libraries** (code that would work as a standalone package)
- **Anti-Patterns** (things NOT to reuse, with reasoning)
- **Pattern Catalog** (table: Pattern | Project | File | Description | Reuse Score)`,

    health: `Do a code health check for: ${paths[0]}

Check systematically:
1. TypeScript configuration (strict? any usage?)
2. Dependencies (outdated? security issues? duplicates?)
3. Code quality (file sizes, complexity, naming)
4. Tests (do they exist? coverage estimate?)
5. Docker/deployment (clean? optimized?)
6. Security (secrets in code? SQL injection? XSS?)
7. Performance (obvious bottlenecks?)

Report Structure:
- **Health Score** (A-F, like SSL Labs)
- **Scorecard** (table: Category | Score | Findings)
- **Critical Issues** (fix immediately)
- **Improvements** (medium-term)
- **Nice-to-Have** (long-term)`,
  };

  return `${baseRole}

${typeInstructions[type]}

RULES:
- Read the CODE, not just the filenames
- Use Glob for file search, Read for file contents, Grep for text search
- Bash only for system commands (ls, wc, git log, etc.)
- Be thorough but efficient — don't read every file, but the important ones
- NEVER modify files — only read and analyze
- NEVER fabricate information

At the END, add this metadata block:
\`\`\`json-metadata
{
  "total_sources": <files read count>,
  "projects_analyzed": <count>,
  "research_type": "analyst",
  "topic": "${paths.join(', ').slice(0, 100)}"
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

  // Determine type and paths
  let type: AnalysisType = 'project';
  let paths: string[] = [];

  if (filteredArgs[0] === '--compare' && filteredArgs[1] && filteredArgs[2]) {
    type = 'compare';
    paths = [filteredArgs[1], filteredArgs[2]];
  } else if (filteredArgs[0] === '--patterns' && filteredArgs[1]) {
    type = 'patterns';
    paths = [filteredArgs[1]];
  } else if (filteredArgs[0] === '--health' && filteredArgs[1]) {
    type = 'health';
    paths = [filteredArgs[1]];
  } else if (filteredArgs[0] && !filteredArgs[0].startsWith('--')) {
    paths = [filteredArgs[0]];
  }

  if (paths.length === 0) {
    console.log(`Agent Fleet — Analyst Agent (Code Archaeologist)

Usage:
  npx tsx agents/analyst-agent.ts "/path/to/project"            # Analyze a project
  npx tsx agents/analyst-agent.ts --compare "/path/a" "/path/b" # Compare two projects
  npx tsx agents/analyst-agent.ts --patterns "/path/to/project"  # Find reusable patterns
  npx tsx agents/analyst-agent.ts --health "/path/to/project"    # Code health check

Options:
  --sonnet    Use Sonnet instead of Opus
  --haiku     Use Haiku instead of Opus`);
    return;
  }

  const topic = type === 'compare'
    ? `Compare: ${paths.join(' vs ')}`
    : `${type}: ${paths[0]}`;

  const result = await runAgent(config, {
    topic,
    prompt: buildPrompt(type, paths),
    model,
    tags: ['analyst', type],
  });

  console.log(result.content.slice(0, 3000));
  if (result.content.length > 3000) {
    console.log(`\n... (${result.content.length} chars, full report in reports/${result.filename})`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
