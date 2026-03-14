# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in Agent Fleet, please report it responsibly:

1. **Do NOT** open a public GitHub issue
2. Email: security@studiomeyer.io
3. Include: description, steps to reproduce, potential impact

We will respond within 48 hours and work on a fix.

## Scope

Agent Fleet spawns Claude CLI subprocesses. Security considerations:

- **Process isolation**: Each agent runs as a separate subprocess
- **File system access**: Agents can read/write files via Claude Code tools. Use `--dry-run` for CTO/Repair agents when uncertain.
- **MCP servers**: All MCP servers run via `npx` and have their own security models
- **Database**: Optional PostgreSQL connection uses parameterized queries (no SQL injection)
- **Environment variables**: API keys and DATABASE_URL are read from environment, never hardcoded

## Best Practices

- Never run agents on untrusted codebases without `--dry-run` first
- Review Discovery/Repair reports before applying fixes
- Use environment variables for all secrets
- Keep Claude Code CLI updated
