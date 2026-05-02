# StudioMeyer Ecosystem

Agent Fleet is part of the StudioMeyer open source toolkit. Here is everything we build and maintain.

## MCP Server Products (Hosted)

| Product | Tools | What it does | Link |
|---------|-------|-------------|------|
| **StudioMeyer Memory** | 56 | Persistent AI memory with knowledge graph, semantic search, multi-agent support | [memory.studiomeyer.io](https://memory.studiomeyer.io) |
| **StudioMeyer CRM** | 33 | Headless CRM — contacts, companies, deals, pipeline, health scores, Stripe sync | [crm.studiomeyer.io](https://crm.studiomeyer.io) |
| **StudioMeyer GEO** | 24 | AI visibility monitoring across 8 LLM platforms | [geo.studiomeyer.io](https://geo.studiomeyer.io) |
| **MCP Crew** | 10 | 8 expert personas with domain frameworks | [crew.studiomeyer.io](https://crew.studiomeyer.io) |

All MCP products use OAuth 2.1 + Magic Link authentication. Free tiers available. EU Frankfurt hosting.

## Open Source Tools

| Project | Description | Install |
|---------|-------------|---------|
| **[AI Shield](https://github.com/studiomeyer-io/ai-shield)** | LLM security — prompt injection, PII, cost tracking, tool policies | `npm install ai-shield-core` |
| **[Darwin Agents](https://github.com/studiomeyer-io/darwin-agents)** | Self-evolving AI agents with A/B testing and safety gates | `npm install darwin-agents` |
| **[Agent Fleet](https://github.com/studiomeyer-io/agent-fleet)** | Multi-agent orchestration for Claude Code CLI — parallel rounds (`Conductor`) or stateful workflows with crash-resume + HITL (`Conductor-LangGraph`, opt-in v0.2) | `git clone` + `npm install` |
| **[MCP Video](https://github.com/studiomeyer-io/mcp-video)** | Cinema-grade video production via MCP | `npx mcp-video` |

## How Agent Fleet fits in

Agent Fleet is the orchestration layer. It runs multiple specialized agents — each with their own MCP tools — in either parallel mode (`Conductor`, the default) or stateful mode with Postgres-backed crash-resume + Human-in-the-Loop (`Conductor-LangGraph`, opt-in since v0.2). Combined with StudioMeyer Memory for persistent context and Darwin for self-improving prompts, you get a full production agent stack.

Typical stack: **Agent Fleet** (orchestration) + **Darwin** (evolution) + **AI Shield** (security) + **StudioMeyer Memory** (persistence).

## License

All open source projects are MIT licensed.

---

Built by [StudioMeyer](https://studiomeyer.io) — AI agency from Mallorca, Spain.
