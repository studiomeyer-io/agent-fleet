import { describe, it, expect } from 'vitest';
import {
  agentRole,
  buildRound1Prompt,
  buildFollowupPrompt,
  buildSynthesisPrompt,
  buildFullReport,
  type DiscussionConfig,
  type DiscussionMode,
  type RoundContribution,
} from '../agents/conductor.js';
import type { AgentConfig } from '../agents/lib/base-agent.js';

// ─── Helpers ─────────────────────────────────────────────

const mockAgentMap: Record<string, AgentConfig> = {
  research: {
    name: 'Research',
    type: 'research',
    defaultModel: 'claude-opus-4-6',
    maxTurns: 10,
    mcpServers: {},
    extraTools: [],
  },
  critic: {
    name: 'Critic',
    type: 'critic',
    defaultModel: 'claude-opus-4-6',
    maxTurns: 10,
    mcpServers: {},
    extraTools: [],
  },
  analyst: {
    name: 'Analyst',
    type: 'analyst',
    defaultModel: 'claude-opus-4-6',
    maxTurns: 10,
    mcpServers: {},
    extraTools: [],
  },
};

const baseConfig: DiscussionConfig = {
  mode: 'open',
  question: 'What should we build next?',
  rounds: 2,
};

// ─── agentRole ───────────────────────────────────────────

describe('agentRole', () => {
  const agents = ['research', 'critic', 'analyst'];
  const modes: DiscussionMode[] = ['open', 'debate', 'review', 'improve'];

  it('returns non-empty string for all agent/mode combos', () => {
    for (const agent of agents) {
      for (const mode of modes) {
        const role = agentRole(agent, mode);
        expect(role.length).toBeGreaterThan(0);
      }
    }
  });

  it('research open mode mentions research', () => {
    const role = agentRole('research', 'open');
    expect(role).toContain('Research Agent');
    expect(role).toContain('facts');
  });

  it('critic open mode mentions Devil\'s Advocate', () => {
    const role = agentRole('critic', 'open');
    expect(role).toContain('Critic');
    expect(role).toContain('Devil\'s Advocate');
  });

  it('analyst open mode mentions code', () => {
    const role = agentRole('analyst', 'open');
    expect(role).toContain('Analyst');
    expect(role).toContain('code');
  });

  it('different modes produce different roles for same agent', () => {
    const openRole = agentRole('research', 'open');
    const debateRole = agentRole('research', 'debate');
    const reviewRole = agentRole('research', 'review');
    expect(openRole).not.toBe(debateRole);
    expect(openRole).not.toBe(reviewRole);
  });

  it('research debate mode mentions both sides', () => {
    const role = agentRole('research', 'debate');
    expect(role).toContain('BOTH sides');
  });

  it('critic review mode mentions fact check', () => {
    const role = agentRole('critic', 'review');
    expect(role).toContain('Fact check');
  });

  it('unknown agent returns empty string', () => {
    const role = agentRole('nonexistent', 'open');
    expect(role).toBe('');
  });
});

// ─── buildRound1Prompt ──────────────────────────────────

describe('buildRound1Prompt', () => {
  it('includes the question', () => {
    const prompt = buildRound1Prompt('research', baseConfig, mockAgentMap);
    expect(prompt).toContain('What should we build next?');
  });

  it('includes agent role', () => {
    const prompt = buildRound1Prompt('critic', baseConfig, mockAgentMap);
    expect(prompt).toContain('Critic');
    expect(prompt).toContain('Devil\'s Advocate');
  });

  it('includes Round 1 label', () => {
    const prompt = buildRound1Prompt('research', baseConfig, mockAgentMap);
    expect(prompt).toContain('Round 1');
  });

  it('includes agent count', () => {
    const prompt = buildRound1Prompt('research', baseConfig, mockAgentMap);
    expect(prompt).toContain('3 Agents');
  });

  it('includes report context when provided', () => {
    const config: DiscussionConfig = {
      ...baseConfig,
      reportContext: 'The report found 5 critical bugs.',
    };
    const prompt = buildRound1Prompt('research', config, mockAgentMap);
    expect(prompt).toContain('5 critical bugs');
    expect(prompt).toContain('REPORT UNDER DISCUSSION');
  });

  it('no report context section when not provided', () => {
    const prompt = buildRound1Prompt('research', baseConfig, mockAgentMap);
    expect(prompt).not.toContain('REPORT UNDER DISCUSSION');
  });

  it('includes word limit rule', () => {
    const prompt = buildRound1Prompt('research', baseConfig, mockAgentMap);
    expect(prompt).toContain('800 words');
  });

  it('uses agent name in heading instruction', () => {
    const prompt = buildRound1Prompt('analyst', baseConfig, mockAgentMap);
    expect(prompt).toContain('[Analyst] Round 1');
  });
});

// ─── buildFollowupPrompt ────────────────────────────────

describe('buildFollowupPrompt', () => {
  const round1: RoundContribution[] = [
    { agent: 'research', content: 'I found these trends...', durationMs: 5000 },
    { agent: 'critic', content: 'There are issues with...', durationMs: 4000 },
    { agent: 'analyst', content: 'The code shows...', durationMs: 6000 },
  ];

  it('includes previous contributions', () => {
    const prompt = buildFollowupPrompt('research', baseConfig, [round1], 2, mockAgentMap);
    expect(prompt).toContain('I found these trends...');
    expect(prompt).toContain('There are issues with...');
    expect(prompt).toContain('The code shows...');
  });

  it('includes round number', () => {
    const prompt = buildFollowupPrompt('critic', baseConfig, [round1], 2, mockAgentMap);
    expect(prompt).toContain('Round 2');
  });

  it('includes own previous contributions', () => {
    const prompt = buildFollowupPrompt('research', baseConfig, [round1], 2, mockAgentMap);
    expect(prompt).toContain('YOUR PREVIOUS CONTRIBUTIONS');
    expect(prompt).toContain('I found these trends...');
  });

  it('shows (none) when agent had no previous contributions', () => {
    const partial: RoundContribution[] = [
      { agent: 'critic', content: 'Only critic here', durationMs: 3000 },
    ];
    const prompt = buildFollowupPrompt('research', baseConfig, [partial], 2, mockAgentMap);
    expect(prompt).toContain('(none)');
  });

  it('includes multiple rounds of history', () => {
    const round2: RoundContribution[] = [
      { agent: 'research', content: 'Updated findings...', durationMs: 4000 },
      { agent: 'critic', content: 'Still concerned about...', durationMs: 3000 },
    ];
    const prompt = buildFollowupPrompt('analyst', baseConfig, [round1, round2], 3, mockAgentMap);
    expect(prompt).toContain('Round 1');
    expect(prompt).toContain('Round 2');
    expect(prompt).toContain('Round 3');
  });

  it('has shorter word limit than round 1', () => {
    const prompt = buildFollowupPrompt('research', baseConfig, [round1], 2, mockAgentMap);
    expect(prompt).toContain('600 words');
  });
});

// ─── buildSynthesisPrompt ───────────────────────────────

describe('buildSynthesisPrompt', () => {
  const contributions: RoundContribution[][] = [
    [
      { agent: 'research', content: 'Found 3 competitors.', durationMs: 5000 },
      { agent: 'critic', content: 'Market is saturated.', durationMs: 4000 },
    ],
    [
      { agent: 'research', content: 'Updated: actually 5 competitors.', durationMs: 4000 },
      { agent: 'critic', content: 'Agree, but opportunity exists.', durationMs: 3000 },
    ],
  ];

  it('includes all contributions', () => {
    const prompt = buildSynthesisPrompt(baseConfig, contributions, mockAgentMap);
    expect(prompt).toContain('Found 3 competitors');
    expect(prompt).toContain('Market is saturated');
    expect(prompt).toContain('actually 5 competitors');
  });

  it('includes synthesis structure', () => {
    const prompt = buildSynthesisPrompt(baseConfig, contributions, mockAgentMap);
    expect(prompt).toContain('Consensus');
    expect(prompt).toContain('Controversies');
    expect(prompt).toContain('Key Findings');
    expect(prompt).toContain('Recommended Next Steps');
  });

  it('includes word limit', () => {
    const prompt = buildSynthesisPrompt(baseConfig, contributions, mockAgentMap);
    expect(prompt).toContain('1000 words');
  });

  it('labels agent contributions with names', () => {
    const prompt = buildSynthesisPrompt(baseConfig, contributions, mockAgentMap);
    expect(prompt).toContain('Research');
    expect(prompt).toContain('Critic');
  });
});

// ─── buildFullReport ────────────────────────────────────

describe('buildFullReport', () => {
  const rounds: RoundContribution[][] = [
    [
      { agent: 'research', content: 'Research findings here.', durationMs: 5000 },
      { agent: 'critic', content: 'Critic response here.', durationMs: 4000 },
    ],
  ];
  const synthesis = 'The team agreed on key points.';
  const totalDurationMs = 120000;

  it('includes YAML frontmatter', () => {
    const report = buildFullReport(baseConfig, rounds, synthesis, totalDurationMs, mockAgentMap);
    expect(report).toContain('---');
    expect(report).toContain('type: discussion');
    expect(report).toContain('mode: open');
  });

  it('includes topic in frontmatter', () => {
    const report = buildFullReport(baseConfig, rounds, synthesis, totalDurationMs, mockAgentMap);
    expect(report).toContain('topic: "What should we build next?"');
  });

  it('includes duration in seconds', () => {
    const report = buildFullReport(baseConfig, rounds, synthesis, totalDurationMs, mockAgentMap);
    expect(report).toContain('duration: 120s');
  });

  it('includes round sections', () => {
    const report = buildFullReport(baseConfig, rounds, synthesis, totalDurationMs, mockAgentMap);
    expect(report).toContain('# Round 1');
    expect(report).toContain('Research findings here.');
    expect(report).toContain('Critic response here.');
  });

  it('includes synthesis section', () => {
    const report = buildFullReport(baseConfig, rounds, synthesis, totalDurationMs, mockAgentMap);
    expect(report).toContain('# Synthesis');
    expect(report).toContain('The team agreed on key points.');
  });

  it('includes agent names in frontmatter', () => {
    const report = buildFullReport(baseConfig, rounds, synthesis, totalDurationMs, mockAgentMap);
    expect(report).toContain('agents: research, critic, analyst');
  });

  it('formats multiple rounds correctly', () => {
    const multiRounds: RoundContribution[][] = [
      [{ agent: 'research', content: 'Round 1 content', durationMs: 5000 }],
      [{ agent: 'research', content: 'Round 2 content', durationMs: 4000 }],
    ];
    const report = buildFullReport(baseConfig, multiRounds, synthesis, totalDurationMs, mockAgentMap);
    expect(report).toContain('# Round 1');
    expect(report).toContain('# Round 2');
    expect(report).toContain('Round 1 content');
    expect(report).toContain('Round 2 content');
  });
});
