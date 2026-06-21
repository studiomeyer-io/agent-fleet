#!/usr/bin/env node
/**
 * Agent Fleet CLI — unified entry point for the npm package.
 *
 * `agent-fleet <command> [...args]` dispatches to the matching agent. Each agent
 * keeps its own argument parsing; this router just forwards argv to the compiled
 * agent module as a child process (the agents have top-level `main()` calls, so
 * spawning keeps each one's lifecycle isolated). Run `agent-fleet <command> -h`
 * to see a command's own usage.
 *
 * In a git clone you'd run the agents directly via `npm run <command>` (tsx);
 * this CLI is the npm-install surface (`npx @studiomeyer-io/agent-fleet ...`).
 */

import { spawn } from 'node:child_process';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/** Subcommand → compiled script, resolved relative to this file (dist/agents/). */
const COMMANDS: Record<string, string> = {
  research: 'research-agent.js',
  critic: 'critic-agent.js',
  analyst: 'analyst-agent.js',
  discovery: 'discovery-agent.js',
  repair: 'repair-agent.js',
  cto: 'cto-agent.js',
  conductor: 'conductor.js',
  'conductor-langgraph': 'conductor-langgraph.js',
  'langgraph-setup': '../scripts/setup-langgraph-checkpointer.js',
};

const HELP = `agent-fleet — multi-agent orchestration for the Claude Code CLI

Usage:
  agent-fleet <command> [...args]

Commands:
  research              Deep research (8 modes: --tech, --product, --competitor, ...)
  critic                Devil's advocate — challenge an idea, plan, or report
  analyst               Code archaeologist — analyze a project, find patterns
  discovery             Code scanner (7 focus areas: --focus security, dead-code, ...)
  repair                Automated bug fixer from Discovery findings
  cto                   Live code fixer (--project <path> --issue "...")
  conductor             Multi-agent parallel discussion + synthesis
  conductor-langgraph   Stateful workflow with crash-resume + HITL (opt-in, needs Postgres)
  langgraph-setup       Create the LangGraph checkpoint schema (run once)

Each command has its own --help, e.g.:
  agent-fleet conductor --debate "PostgreSQL vs SQLite"
  agent-fleet research --tech "Model Context Protocol"

Requires the Claude Code CLI (npm i -g @anthropic-ai/claude-code) and a
Claude Pro/Max plan (or ANTHROPIC_API_KEY with AGENT_FLEET_USE_API_KEY=1).
Reports are written to ./reports in the current directory.`;

function main(): void {
  const [command, ...rest] = process.argv.slice(2);

  if (!command || command === '--help' || command === '-h' || command === 'help') {
    console.log(HELP);
    process.exit(command ? 0 : 1);
  }

  const script = COMMANDS[command];
  if (!script) {
    console.error(`Unknown command: ${command}\n`);
    console.log(HELP);
    process.exit(1);
  }

  const child = spawn(process.execPath, [resolve(__dirname, script), ...rest], {
    stdio: 'inherit',
  });

  child.on('error', (err) => {
    console.error(`[agent-fleet] failed to start "${command}": ${err.message}`);
    process.exit(1);
  });
  child.on('exit', (code, signal) => {
    if (signal) {
      process.kill(process.pid, signal);
    } else {
      process.exit(code ?? 0);
    }
  });
}

main();
