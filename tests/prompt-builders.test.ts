import { describe, it, expect } from 'vitest';
import { buildPrompt as researchBuildPrompt, type ResearchType } from '../agents/research-agent.js';
import { buildPrompt as criticBuildPrompt, type CritiqueType } from '../agents/critic-agent.js';
import { buildPrompt as analystBuildPrompt, type AnalysisType } from '../agents/analyst-agent.js';
import { buildPrompt as discoveryBuildPrompt, type ScanFocus } from '../agents/discovery-agent.js';
import { buildPrompt as repairBuildPrompt } from '../agents/repair-agent.js';
import { buildPrompt as ctoBuildPrompt } from '../agents/cto-agent.js';

// ─── Research Agent ──────────────────────────────────────

describe('research buildPrompt', () => {
  const allTypes: ResearchType[] = ['general', 'vision', 'tech', 'product', 'competitor', 'paper', 'idea', 'news'];

  it.each(allTypes)('type "%s" includes topic in prompt', (type) => {
    const prompt = researchBuildPrompt(type, 'AI Agent Frameworks');
    expect(prompt).toContain('AI Agent Frameworks');
  });

  it.each(allTypes)('type "%s" includes json-metadata block', (type) => {
    const prompt = researchBuildPrompt(type, 'test topic');
    expect(prompt).toContain('json-metadata');
    expect(prompt).toContain(`"research_type": "${type}"`);
  });

  it('general type includes comprehensive research instructions', () => {
    const prompt = researchBuildPrompt('general', 'test');
    expect(prompt).toContain('comprehensive research');
  });

  it('vision type includes forward-looking language', () => {
    const prompt = researchBuildPrompt('vision', 'AI tools');
    expect(prompt).toContain('VISION Agent');
    expect(prompt).toContain('Product Ideas');
    expect(prompt).toContain('ONE Recommendation');
  });

  it('tech type includes comparison instructions', () => {
    const prompt = researchBuildPrompt('tech', 'Next.js');
    expect(prompt).toContain('Compare with alternatives');
    expect(prompt).toContain('Strengths / Weaknesses');
  });

  it('product type requires minimum word count', () => {
    const prompt = researchBuildPrompt('product', 'SaaS market');
    expect(prompt).toContain('3000 words');
    expect(prompt).toContain('Competitive Matrix');
  });

  it('competitor type asks for top 10', () => {
    const prompt = researchBuildPrompt('competitor', 'CRM tools');
    expect(prompt).toContain('Top 10 Competitors');
    expect(prompt).toContain('Pricing Comparison');
  });

  it('paper type looks for academic sources', () => {
    const prompt = researchBuildPrompt('paper', 'LLM reasoning');
    expect(prompt).toContain('papers');
    expect(prompt).toContain('Implementations');
  });

  it('idea type includes validation structure', () => {
    const prompt = researchBuildPrompt('idea', 'AI code review tool');
    expect(prompt).toContain('Verdict');
    expect(prompt).toContain('GO / MAYBE / KILL');
    expect(prompt).toContain('TAM/SAM/SOM');
  });

  it('news type includes date-aware instructions', () => {
    const prompt = researchBuildPrompt('news', 'AI developments');
    expect(prompt).toContain('last week');
    expect(prompt).toContain('Action Items');
  });

  it('all types include tavily and WebSearch rules', () => {
    for (const type of allTypes) {
      const prompt = researchBuildPrompt(type, 'test');
      expect(prompt).toContain('tavily');
      expect(prompt).toContain('WebSearch');
    }
  });

  it('includes anti-hallucination rule', () => {
    const prompt = researchBuildPrompt('general', 'test');
    expect(prompt).toContain('NEVER fabricate');
  });
});

// ─── Critic Agent ────────────────────────────────────────

describe('critic buildPrompt', () => {
  it('general type includes topic text', () => {
    const prompt = criticBuildPrompt('general', 'Build a SaaS product');
    expect(prompt).toContain('Build a SaaS product');
    expect(prompt).toContain('Verdict');
  });

  it('report type includes report context when provided', () => {
    const prompt = criticBuildPrompt('report', 'test report', 'This is the report content about AI trends.');
    expect(prompt).toContain('This is the report content about AI trends.');
    expect(prompt).toContain('Fact Check');
    expect(prompt).toContain('Quality Score');
  });

  it('report type shows placeholder when no context', () => {
    const prompt = criticBuildPrompt('report', 'test report');
    expect(prompt).toContain('(No report loaded)');
  });

  it('idea type includes Devil Advocate structure', () => {
    const prompt = criticBuildPrompt('idea', 'AI writing assistant');
    expect(prompt).toContain('Hard Truth');
    expect(prompt).toContain('Already Exists');
    expect(prompt).toContain('GO / PIVOT / KILL');
  });

  it('plan type includes architecture analysis', () => {
    const prompt = criticBuildPrompt('plan', 'Microservices migration');
    expect(prompt).toContain('Architecture Weaknesses');
    expect(prompt).toContain('Over-Engineering');
    expect(prompt).toContain('Vendor Lock-in');
  });

  it('all types include base critic role', () => {
    const types: CritiqueType[] = ['general', 'report', 'idea', 'plan'];
    for (const type of types) {
      const prompt = criticBuildPrompt(type, 'test');
      expect(prompt).toContain('Critic Agent');
      expect(prompt).toContain('Devil\'s Advocate');
    }
  });

  it('all types include metadata block', () => {
    const types: CritiqueType[] = ['general', 'report', 'idea', 'plan'];
    for (const type of types) {
      const prompt = criticBuildPrompt(type, 'test');
      expect(prompt).toContain('json-metadata');
      expect(prompt).toContain('"research_type": "critic"');
    }
  });

  it('topic is truncated to 100 chars in metadata', () => {
    const longTopic = 'A'.repeat(200);
    const prompt = criticBuildPrompt('general', longTopic);
    // The metadata topic uses .slice(0, 100)
    expect(prompt).toContain(`"topic": "${longTopic.slice(0, 100)}"`);
  });
});

// ─── Analyst Agent ───────────────────────────────────────

describe('analyst buildPrompt', () => {
  it('project type includes single path', () => {
    const prompt = analystBuildPrompt('project', ['/my/project']);
    expect(prompt).toContain('/my/project');
    expect(prompt).toContain('Architecture');
    expect(prompt).toContain('Hidden Gems');
  });

  it('compare type includes both paths', () => {
    const prompt = analystBuildPrompt('compare', ['/project/a', '/project/b']);
    expect(prompt).toContain('/project/a');
    expect(prompt).toContain('/project/b');
    expect(prompt).toContain('Comparison Table');
    expect(prompt).toContain('Best-of-Both');
  });

  it('patterns type focuses on reusability', () => {
    const prompt = analystBuildPrompt('patterns', ['/my/app']);
    expect(prompt).toContain('reusable patterns');
    expect(prompt).toContain('Extractable Libraries');
    expect(prompt).toContain('Anti-Patterns');
  });

  it('health type includes scoring', () => {
    const prompt = analystBuildPrompt('health', ['/my/app']);
    expect(prompt).toContain('Health Score');
    expect(prompt).toContain('A-F');
    expect(prompt).toContain('Critical Issues');
  });

  it('all types include base role', () => {
    const types: AnalysisType[] = ['project', 'compare', 'patterns', 'health'];
    for (const type of types) {
      const prompt = analystBuildPrompt(type, ['/test']);
      expect(prompt).toContain('Analyst Agent');
      expect(prompt).toContain('code archaeologist');
    }
  });

  it('all types include metadata block', () => {
    const types: AnalysisType[] = ['project', 'compare', 'patterns', 'health'];
    for (const type of types) {
      const prompt = analystBuildPrompt(type, ['/test']);
      expect(prompt).toContain('json-metadata');
      expect(prompt).toContain('"research_type": "analyst"');
    }
  });

  it('includes read-only rule', () => {
    const prompt = analystBuildPrompt('project', ['/app']);
    expect(prompt).toContain('NEVER modify files');
  });
});

// ─── Discovery Agent ─────────────────────────────────────

describe('discovery buildPrompt', () => {
  it('full focus includes all categories', () => {
    const prompt = discoveryBuildPrompt('/my/project', 'full', false);
    expect(prompt).toContain('Dead Code');
    expect(prompt).toContain('Type Problems');
    expect(prompt).toContain('Security Problems');
    expect(prompt).toContain('Tech Debt');
  });

  it('security focus is security-specific', () => {
    const prompt = discoveryBuildPrompt('/my/project', 'security', false);
    expect(prompt).toContain('Command Injection');
    expect(prompt).toContain('SQL Injection');
    expect(prompt).toContain('XSS');
  });

  it('dead-code focus looks for unused exports', () => {
    const prompt = discoveryBuildPrompt('/my/project', 'dead-code', false);
    expect(prompt).toContain('Exported functions');
    expect(prompt).toContain('Commented-out code');
  });

  it('quick=true limits scan depth', () => {
    const prompt = discoveryBuildPrompt('/my/project', 'full', true);
    expect(prompt).toContain('QUICK SCAN');
    expect(prompt).toContain('Max 15 files');
  });

  it('quick=false enables deep scan', () => {
    const prompt = discoveryBuildPrompt('/my/project', 'full', false);
    expect(prompt).toContain('DEEP SCAN');
  });

  it('includes project path', () => {
    const prompt = discoveryBuildPrompt('/home/user/my-app', 'full', false);
    expect(prompt).toContain('/home/user/my-app');
  });

  it('includes metadata block with focus', () => {
    const prompt = discoveryBuildPrompt('/project', 'security', false);
    expect(prompt).toContain('"scan_focus": "security"');
  });
});

// ─── Repair Agent ────────────────────────────────────────

describe('repair buildPrompt', () => {
  it('dry-run mode instructs not to modify files', () => {
    const prompt = repairBuildPrompt('/project', 'fix types', undefined, true);
    expect(prompt).toContain('DRY RUN');
    expect(prompt).toContain('DO NOT modify');
  });

  it('live mode instructs to perform repairs', () => {
    const prompt = repairBuildPrompt('/project', 'fix types', undefined, false);
    expect(prompt).toContain('LIVE MODE');
    expect(prompt).toContain('Edit/Write');
  });

  it('with report context shows discovery report', () => {
    const report = '## Critical\n- File:10 — SQL injection found';
    const prompt = repairBuildPrompt('/project', 'fix it', report, false);
    expect(prompt).toContain('SQL injection found');
    expect(prompt).toContain('P0 first');
  });

  it('without report context shows issue description', () => {
    const prompt = repairBuildPrompt('/project', 'fix all any types', undefined, false);
    expect(prompt).toContain('fix all any types');
    expect(prompt).toContain('ISSUE DESCRIPTION');
  });

  it('includes project path', () => {
    const prompt = repairBuildPrompt('/home/user/app', 'fix', undefined, false);
    expect(prompt).toContain('/home/user/app');
  });
});

// ─── CTO Agent ───────────────────────────────────────────

describe('cto buildPrompt', () => {
  it('dry-run mode prevents modifications', () => {
    const prompt = ctoBuildPrompt('/project', 'fix types', undefined, true);
    expect(prompt).toContain('DRY RUN');
    expect(prompt).toContain('DO NOT modify');
  });

  it('live mode allows modifications', () => {
    const prompt = ctoBuildPrompt('/project', 'fix types', undefined, false);
    expect(prompt).toContain('LIVE MODE');
  });

  it('includes safety rule for project scope', () => {
    const prompt = ctoBuildPrompt('/my/project', 'fix', undefined, false);
    expect(prompt).toContain('Only modify files under /my/project/');
  });

  it('includes CTO identity', () => {
    const prompt = ctoBuildPrompt('/project', 'fix', undefined, false);
    expect(prompt).toContain('CTO Agent');
    expect(prompt).toContain('senior engineer');
  });

  it('metadata reflects dry_run state', () => {
    const dryPrompt = ctoBuildPrompt('/p', 'fix', undefined, true);
    const livePrompt = ctoBuildPrompt('/p', 'fix', undefined, false);
    expect(dryPrompt).toContain('"dry_run": true');
    expect(livePrompt).toContain('"dry_run": false');
  });
});
