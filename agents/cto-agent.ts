#!/usr/bin/env npx tsx
/**
 * CTO Agent — The One Who Actually Fixes
 *
 * Unlike other discussion agents who can only talk, the CTO reads, edits,
 * and writes code. During conductor discussions, the CTO implements fixes
 * while others analyze and debate. Restricted to a single project directory.
 *
 * Usage (standalone):
 *   npx tsx agents/cto-agent.ts --project /path/to/project --issue "fix all any types"
 *   npx tsx agents/cto-agent.ts --project /path/to/project --report <discovery-report>
 *   npx tsx agents/cto-agent.ts --project /path/to/project --issue "..." --dry-run
 *   npx tsx agents/cto-agent.ts --sonnet --project <path> --issue "..."
 *
 * Usage (conductor):
 *   npx tsx agents/conductor.ts --with-cto "Fix all bugs found in discovery scan"
 */

import { runAgent, loadReportAsContext, type AgentConfig } from './lib/base-agent.js';
import { pickMcp } from './lib/mcp-config.js';
import { readdir } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = resolve(__dirname, '../reports');

/** @internal Exported for testing */
export function getConfig(_projectPath: string, dryRun: boolean): AgentConfig {
  return {
    name: 'CTO Agent',
    type: 'cto',
    defaultModel: 'claude-opus-4-6',
    maxTurns: 50,
    mcpServers: pickMcp('code-pathfinder', 'context'),
    extraTools: dryRun
      ? ['Read', 'Glob', 'Grep', 'Bash']
      : ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'],
  };
}

/** Conductor-compatible config (always gets Edit/Write) */
export function getConductorConfig(): AgentConfig {
  return {
    name: 'CTO',
    type: 'cto',
    defaultModel: 'claude-opus-4-6',
    maxTurns: 25,
    mcpServers: pickMcp('code-pathfinder'),
    extraTools: ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'],
  };
}

/** CTO role for conductor discussions */
export function getConductorRole(mode: string): string {
  const roles: Record<string, string> = {
    open: `You are the CTO — the ONLY agent allowed to change code.
While the others talk, YOU FIX. Read the code, find the problems, and fix them DIRECTLY.
Use Edit/Write to modify files. Test with Bash (npx tsc --noEmit, npm test).
IMPORTANT: Only modify files in the current project. No other projects.
Report at the end what you changed: file, line, what was there before, what is there now.`,

    debate: `You are the CTO. While the others debate, you check technical feasibility.
Read the relevant code, estimate the effort, and if a quick fix is possible — do it directly.
Report: what's feasible, what's not, what have you already fixed.`,

    review: `You are the CTO. The report is being discussed — you check if the mentioned problems are real in the code.
Read the mentioned files/lines. If a fix is trivial (<10 lines), fix it directly.
Report: what's correct, what's not, what have you fixed.`,

    improve: `You are the CTO. The others suggest improvements — you implement those that make sense.
Prioritize: Security > Crashes > Correctness > Style. Only fix what is clearly right.
Test after each fix. Report what you did.`,
  };
  return roles[mode] ?? roles.open;
}

/** @internal Exported for testing */
export function buildPrompt(projectPath: string, issue: string, reportContext: string | undefined, dryRun: boolean): string {
  const modeInstruction = dryRun
    ? `DRY RUN MODE: Create ONLY a repair plan. DO NOT modify any files!
Show for each fix: file, line, current code, planned code.`
    : `LIVE MODE: Actually perform the fixes.
Use Edit/Write to modify files. Test after each change with Bash.`;

  const contextSection = reportContext
    ? `DISCOVERY REPORT (problems to fix):
---
${reportContext}
---

Work through the problems by priority: P0 first, then P1. P2 only if time permits.`
    : `ISSUE DESCRIPTION:
"${issue}"

Find and fix the described problem.`;

  return `You are the CTO Agent — a senior engineer who FIXES code, not just analyzes it.
You are the only agent with write permissions. The others can only read and talk — you ACT.

TARGET PROJECT: ${projectPath}
SAFETY RULE: Only modify files under ${projectPath}/. No other projects.

${modeInstruction}

${contextSection}

APPROACH:
1. **Understand** — Read package.json, README, project structure
2. **Locate** — Use code-pathfinder (find_symbol, get_callers) and Grep to find affected code
3. **Blast Radius** — get_callers / get_callees — who uses this function?
4. **Fix** — Edit/Write for the repair. Minimal-invasive.
5. **Verify** — Bash: \`npx tsc --noEmit\` and/or tests
6. **Next Fix** — Repeat until done

CTO RULES:
- **Minimal-Invasive** — Only change what's necessary. No refactoring trips.
- **Check Blast Radius BEFORE** — who uses this function/file?
- **Typecheck after EVERY fix** — \`npx tsc --noEmit\` or \`npm run build\`
- **Tests must stay green** — if tests exist
- **No new damage** — your fix must not break anything else
- **When uncertain: DON'T fix** — mark as "open", don't guess

REPORT FORMAT:
## CTO Fix Report
- Project: ${projectPath}
- Fixes performed: count
- Fixes skipped: count

## Performed Fixes
### Fix #N: [Short title]
- **File:** path:line
- **Before:** What was there
- **After:** What is there now
- **Verification:** Typecheck/test OK?

## Skipped Fixes
(Why not fixed — too complex, unclear, blast radius too large)

## Open Items
(What needs manual review)

At the END, add this metadata block:
\`\`\`json-metadata
{
  "total_fixes": <count>,
  "successful_fixes": <count>,
  "skipped_fixes": <count>,
  "files_modified": <count>,
  "project": "${projectPath}",
  "dry_run": ${dryRun}
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

  // Parse --dry-run
  const dryRun = filteredArgs.includes('--dry-run');
  const remaining = filteredArgs.filter(a => a !== '--dry-run');

  // Parse --report or --issue
  let issue = '';
  let reportContext: string | undefined;

  const reportIdx = remaining.indexOf('--report');
  if (reportIdx !== -1 && remaining[reportIdx + 1]) {
    const reportName = remaining[reportIdx + 1];
    const files = await readdir(REPORTS_DIR).catch(() => [] as string[]);
    const match = files.find(f => f.includes(reportName));
    if (match) {
      reportContext = await loadReportAsContext(match);
      issue = `CTO Fix: ${match}`;
    } else {
      console.log(`Report "${reportName}" not found in reports/`);
      return;
    }
  }

  const issueIdx = remaining.indexOf('--issue');
  if (issueIdx !== -1 && remaining[issueIdx + 1]) {
    issue = remaining.slice(issueIdx + 1).join(' ');
  }

  if (!projectPath || !issue) {
    console.log(`Agent Fleet — CTO Agent (The One Who Actually Fixes)

Usage:
  npx tsx agents/cto-agent.ts --project <path> --issue "description"       # Fix specific issue
  npx tsx agents/cto-agent.ts --project <path> --report <discovery-report>  # Fix discovery findings
  npx tsx agents/cto-agent.ts --project <path> --issue "..." --dry-run      # Plan only

Options:
  --sonnet    Use Sonnet instead of Opus
  --haiku     Use Haiku instead of Opus
  --dry-run   Show fix plan without making changes

Examples:
  npx tsx agents/cto-agent.ts --project ./my-app --issue "fix any types in src/lib/"
  npx tsx agents/cto-agent.ts --project ./my-app --report discovery-full-scan
`);
    return;
  }

  const agentConfig = getConfig(projectPath, dryRun);
  const topic = issue.startsWith('CTO Fix:') ? issue : `cto: ${issue.slice(0, 80)}`;

  const result = await runAgent(agentConfig, {
    topic,
    prompt: buildPrompt(projectPath, issue, reportContext, dryRun),
    model,
    project: projectPath,
    tags: ['cto', dryRun ? 'dry-run' : 'live', projectPath.split('/').pop() ?? ''],
  });

  console.log(result.content.slice(0, 5000));
  if (result.content.length > 5000) {
    console.log(`\n... (${result.content.length} chars, full report in reports/${result.filename})`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
