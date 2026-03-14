#!/usr/bin/env npx tsx
/**
 * Repair Agent — Automated Bug Fixer
 *
 * Takes Discovery Agent findings (or manual issue descriptions) and fixes them.
 * Uses code-pathfinder for call analysis and context for library docs.
 *
 * Usage:
 *   npx tsx agents/repair-agent.ts --project /path/to/project --report <discovery-report>
 *   npx tsx agents/repair-agent.ts --project /path/to/project --issue "description"
 *   npx tsx agents/repair-agent.ts --project <path> --report <file> --dry-run
 *   npx tsx agents/repair-agent.ts --sonnet --project <path> --issue "..."
 */

import { runAgent, loadReportAsContext, type AgentConfig } from './lib/base-agent.js';
import { pickMcp } from './lib/mcp-config.js';
import { readdir } from 'fs/promises';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPORTS_DIR = resolve(__dirname, '../reports');

/** @internal Exported for testing */
export function getConfig(dryRun: boolean): AgentConfig {
  return {
    name: 'Repair Agent',
    type: 'repair',
    defaultModel: 'claude-opus-4-6',
    maxTurns: 40,
    mcpServers: pickMcp('code-pathfinder', 'context'),
    extraTools: dryRun
      ? ['Read', 'Glob', 'Grep', 'Bash']
      : ['Read', 'Edit', 'Write', 'Glob', 'Grep', 'Bash'],
  };
}

/** @internal Exported for testing */
export function buildPrompt(projectPath: string, issue: string, reportContext: string | undefined, dryRun: boolean): string {
  const modeInstruction = dryRun
    ? `DRY RUN MODE: Create ONLY a repair plan. DO NOT modify any files!
Show for each fix: file, line, current code, planned code.`
    : `LIVE MODE: Actually perform the repairs.
Use Edit/Write to modify files. Test after each change with Bash (typecheck, tests).`;

  const contextSection = reportContext
    ? `DISCOVERY REPORT (problems to fix):
---
${reportContext}
---

Work through the problems by priority: P0 first, then P1. P2 only if time permits.`
    : `ISSUE DESCRIPTION:
"${issue}"

Find and fix the described problem.`;

  return `You are the Repair Agent — a precise, careful bug fixer.
Your job: FIX problems, not just find them. You work methodically and verify every fix.

TARGET PROJECT: ${projectPath}

${modeInstruction}

${contextSection}

APPROACH:
1. **Understand** — Read project structure, package.json, README
2. **Locate** — Use code-pathfinder (find_symbol, get_callers) and Grep to find affected code
3. **Analyze** — get_callers / get_callees to understand blast radius
4. **Check Docs** — context tools (get_docs, search_packages) for library-specific fixes
5. **Fix** — Edit/Write for the actual repair
6. **Verify** — Bash for typecheck (\`npx tsc --noEmit\`) and tests

REPAIR RULES:
- **Minimal-Invasive** — Only change what's necessary. No refactoring trips.
- **Check Blast Radius** — Before every change: who uses this function/file?
- **Typecheck after every fix** — \`npx tsc --noEmit\` or \`npm run build\`
- **Tests must stay green** — if tests exist, they must pass after the fix
- **No new problems** — your fix must not break anything else
- **Document** — Comment only where the change is not self-explanatory

REPORT FORMAT:

## Repair Summary
- Project: name
- Source: Discovery Report / Issue
- Fixes performed: count
- Fixes failed: count

## Performed Fixes
For each fix:
### Fix #N: [Short title]
- **File:** path:line
- **Problem:** What was broken
- **Solution:** What was changed
- **Verification:** Typecheck/test result
- **Blast Radius:** Which other areas affected

## Failed Fixes
(If any: why it couldn't be fixed)

## Open Items
(What needs manual review)

RULES:
- NEVER fabricate code that doesn't fit the project
- When uncertain: DON'T fix, mark as "open" instead
- Security fixes have highest priority
- If a fix is too complex (>50 lines change): mark as "manual"

At the END, add this metadata block:
\`\`\`json-metadata
{
  "total_fixes": <count>,
  "successful_fixes": <count>,
  "failed_fixes": <count>,
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
      issue = `Repair: ${match}`;
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
    console.log(`Agent Fleet — Repair Agent (Automated Bug Fixer)

Usage:
  npx tsx agents/repair-agent.ts --project <path> --report <discovery-report>  # Fix discovery findings
  npx tsx agents/repair-agent.ts --project <path> --issue "description"       # Fix specific issue
  npx tsx agents/repair-agent.ts --project <path> --report <file> --dry-run    # Plan only

Options:
  --sonnet    Use Sonnet instead of Opus
  --haiku     Use Haiku instead of Opus
  --dry-run   Show repair plan without making changes

Examples:
  npx tsx agents/repair-agent.ts --project ./my-app --report discovery-full-scan
  npx tsx agents/repair-agent.ts --project ./my-app --issue "fix any types in src/"
  npx tsx agents/repair-agent.ts --project ./my-app --issue "add missing error handling"
`);
    return;
  }

  const agentConfig = getConfig(dryRun);
  const topic = issue.startsWith('Repair:') ? issue : `repair: ${issue.slice(0, 80)}`;

  const result = await runAgent(agentConfig, {
    topic,
    prompt: buildPrompt(projectPath, issue, reportContext, dryRun),
    model,
    project: projectPath,
    tags: ['repair', dryRun ? 'dry-run' : 'live', projectPath.split('/').pop() ?? ''],
  });

  console.log(result.content.slice(0, 5000));
  if (result.content.length > 5000) {
    console.log(`\n... (${result.content.length} chars, full report in reports/${result.filename})`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
