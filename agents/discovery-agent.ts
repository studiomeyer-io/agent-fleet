#!/usr/bin/env npx tsx
/**
 * Discovery Agent — Code Scanner & Problem Finder
 *
 * Scans any project's codebase for problems: dead code, type issues,
 * missing error handling, security concerns, tech debt, and patterns.
 *
 * Usage:
 *   npx tsx agents/discovery-agent.ts --project /path/to/project               # Full scan
 *   npx tsx agents/discovery-agent.ts --project /path/to/project --quick       # Quick scan
 *   npx tsx agents/discovery-agent.ts --project /path/to/project --focus security
 *   npx tsx agents/discovery-agent.ts --project /path/to/project --focus dead-code
 *   npx tsx agents/discovery-agent.ts --project /path/to/project --focus types
 *   npx tsx agents/discovery-agent.ts --sonnet --project <path>
 */

import { runAgent, type AgentConfig } from './lib/base-agent.js';
import { pickMcp } from './lib/mcp-config.js';

type ScanFocus = 'full' | 'security' | 'dead-code' | 'types' | 'errors' | 'patterns' | 'debt';

const config: AgentConfig = {
  name: 'Discovery Agent',
  type: 'discovery',
  defaultModel: 'claude-opus-4-6',
  maxTurns: 30,
  mcpServers: pickMcp('code-pathfinder'),
  extraTools: ['Read', 'Glob', 'Grep', 'Bash'],
};

function buildPrompt(projectPath: string, focus: ScanFocus, quick: boolean): string {
  const focusInstructions: Record<ScanFocus, string> = {
    full: `Perform a COMPLETE code scan. Check ALL categories:
1. Dead Code (unused exports, unreachable functions, orphaned files)
2. Type Problems (any usage, missing types, unsafe casts)
3. Missing Error Handling (unhandled promises, missing try-catch, silent fails)
4. Security Problems (command injection, path traversal, unvalidated inputs)
5. Tech Debt (copy-paste code, overly complex functions, outdated patterns)
6. Architecture Problems (circular deps, god objects, feature envy)`,

    security: `Focus on SECURITY problems:
- Command Injection (exec/spawn with user input)
- Path Traversal (uncontrolled path construction)
- SQL Injection (string interpolation in queries)
- XSS (unescaped output)
- Secrets in Code (API keys, passwords, tokens)
- Unvalidated Inputs (missing sanitization)
- Insecure Dependencies
- Race Conditions in critical operations`,

    'dead-code': `Focus on DEAD CODE:
- Exported functions that are imported nowhere
- Files not referenced by any other file
- Unreachable code after returns/throws
- Commented-out code
- Unused variables and parameters
- Feature flags that are never activated
- Orphaned test files without corresponding code`,

    types: `Focus on TYPE PROBLEMS:
- \`any\` usage (explicit and implicit)
- Missing return types
- Unsafe type assertions (as)
- Missing null checks
- Inconsistent interfaces (same data type, different definitions)
- Generics that allow \`any\`
- Type widening problems`,

    errors: `Focus on ERROR HANDLING:
- Unhandled Promise rejections
- Empty catch blocks
- Silent failures (errors swallowed)
- Missing error boundaries (React)
- Missing validation at system boundaries
- Timeouts without fallback
- Race conditions`,

    patterns: `Focus on CODE PATTERNS:
- Copy-paste code (DRY violations)
- Inconsistent naming conventions
- Mixed patterns (callbacks + promises + async/await)
- God objects / god functions (>100 lines)
- Deep nesting (>3 levels)
- Magic numbers / strings
- Missing abstractions`,

    debt: `Focus on TECH DEBT:
- Outdated dependencies
- TODOs and FIXMEs in code
- Workarounds and hacks (with comments like "temporary", "hack", "workaround")
- Missing tests for critical paths
- Inconsistent configuration
- Outdated build scripts
- Documentation that doesn't match the code`,
  };

  const scanDepth = quick
    ? 'QUICK SCAN: Check only the most important files (entry points, config, API routes). Max 15 files.'
    : 'DEEP SCAN: Systematically work through the entire codebase. Follow the dependency tree.';

  return `You are the Discovery Agent — a precise code scanner.
Your job: Find problems, categorize, and prioritize them. You BUILD nothing — you FIND.

TARGET PROJECT: ${projectPath}

${scanDepth}

APPROACH:
1. Read package.json, README.md for project overview
2. Use code-pathfinder tools (find_symbol, get_callers, get_callees) for call analysis
3. Use Glob to scan the directory structure
4. Read suspicious files with Read to verify problems
5. Use Grep for pattern search (e.g. \`any\`, \`TODO\`, \`HACK\`, unhandled errors)

${focusInstructions[focus]}

REPORT FORMAT:

## Executive Summary
- Project: name and size
- Scan Type: ${focus}
- Problems Found: count by severity

## Critical (P0) — Fix immediately
For each problem:
- **File:Line** — Short description
- What: Exactly what the problem is
- Why: Why it's critical
- Fix: Concrete fix suggestion (1-2 sentences)

## Important (P1) — Fix soon
(same structure)

## Nice-to-have (P2) — When convenient
(same structure)

## Patterns & Metrics
- Most common problem category
- Files with the most problems
- Estimated fix time per severity

RULES:
- VERIFY every problem — read the code before reporting it
- No false positives — fewer but correct findings
- ALWAYS specify file:line
- Priority: Security > Crashes > Data Loss > Performance > Style
- NEVER fabricate problems — only what you SEE in the code

At the END, add this metadata block:
\`\`\`json-metadata
{
  "total_issues": <count>,
  "p0_count": <count>,
  "p1_count": <count>,
  "p2_count": <count>,
  "scan_focus": "${focus}",
  "project": "${projectPath}",
  "files_scanned": <count>
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

  // Parse --project
  let projectPath = '';
  const projectIdx = filteredArgs.indexOf('--project');
  if (projectIdx !== -1 && filteredArgs[projectIdx + 1]) {
    projectPath = filteredArgs[projectIdx + 1];
    filteredArgs.splice(projectIdx, 2);
  }

  // Parse --quick
  const quick = filteredArgs.includes('--quick');
  const remaining = filteredArgs.filter(a => a !== '--quick');

  // Parse --focus
  let focus: ScanFocus = 'full';
  const focusIdx = remaining.indexOf('--focus');
  if (focusIdx !== -1 && remaining[focusIdx + 1]) {
    const val = remaining[focusIdx + 1] as ScanFocus;
    if (['full', 'security', 'dead-code', 'types', 'errors', 'patterns', 'debt'].includes(val)) {
      focus = val;
    }
  }

  if (!projectPath) {
    console.log(`Agent Fleet — Discovery Agent (Code Scanner & Problem Finder)

Usage:
  npx tsx agents/discovery-agent.ts --project <path>                    # Full scan
  npx tsx agents/discovery-agent.ts --project <path> --quick            # Quick scan
  npx tsx agents/discovery-agent.ts --project <path> --focus security   # Security focus
  npx tsx agents/discovery-agent.ts --project <path> --focus dead-code  # Dead code focus
  npx tsx agents/discovery-agent.ts --project <path> --focus types      # Type issues
  npx tsx agents/discovery-agent.ts --project <path> --focus errors     # Error handling
  npx tsx agents/discovery-agent.ts --project <path> --focus patterns   # Code patterns
  npx tsx agents/discovery-agent.ts --project <path> --focus debt       # Tech debt

Options:
  --sonnet    Use Sonnet instead of Opus
  --haiku     Use Haiku instead of Opus
  --quick     Quick scan (fewer files, faster)`);
    return;
  }

  const topic = `${focus}-scan: ${projectPath.split('/').pop()}`;

  const result = await runAgent(config, {
    topic,
    prompt: buildPrompt(projectPath, focus, quick),
    model,
    project: projectPath,
    tags: ['discovery', focus, projectPath.split('/').pop() ?? ''],
  });

  console.log(result.content.slice(0, 5000));
  if (result.content.length > 5000) {
    console.log(`\n... (${result.content.length} chars, full report in reports/${result.filename})`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
