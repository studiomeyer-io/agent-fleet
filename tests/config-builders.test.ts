import { describe, it, expect } from 'vitest';
import { getConfig as researchGetConfig, type ResearchType } from '../agents/research-agent.js';
import { getConfig as repairGetConfig } from '../agents/repair-agent.js';
import { getConfig as ctoGetConfig, getConductorConfig, getConductorRole } from '../agents/cto-agent.js';

// ─── Research getConfig ──────────────────────────────────

describe('research getConfig', () => {
  it('news type has lower maxTurns (15)', () => {
    const config = researchGetConfig('news');
    expect(config.maxTurns).toBe(15);
  });

  it('non-news types have maxTurns 25', () => {
    const types: ResearchType[] = ['general', 'vision', 'tech', 'product', 'competitor', 'paper', 'idea'];
    for (const type of types) {
      expect(researchGetConfig(type).maxTurns).toBe(25);
    }
  });

  it('includes tavily and context7 MCP servers', () => {
    const config = researchGetConfig('general');
    expect(config.mcpServers).toHaveProperty('tavily');
    expect(config.mcpServers).toHaveProperty('context7');
  });

  it('includes WebSearch and WebFetch extra tools', () => {
    const config = researchGetConfig('general');
    expect(config.extraTools).toContain('WebSearch');
    expect(config.extraTools).toContain('WebFetch');
  });

  it('general type maps to "research" agent type', () => {
    expect(researchGetConfig('general').type).toBe('research');
  });

  it('non-general types use type name as agent type', () => {
    expect(researchGetConfig('vision').type).toBe('vision');
    expect(researchGetConfig('tech').type).toBe('tech');
    expect(researchGetConfig('product').type).toBe('product');
  });
});

// ─── Repair getConfig ────────────────────────────────────

describe('repair getConfig', () => {
  it('dryRun=true does NOT include Edit/Write tools', () => {
    const config = repairGetConfig(true);
    expect(config.extraTools).not.toContain('Edit');
    expect(config.extraTools).not.toContain('Write');
  });

  it('dryRun=false includes Edit/Write tools', () => {
    const config = repairGetConfig(false);
    expect(config.extraTools).toContain('Edit');
    expect(config.extraTools).toContain('Write');
  });

  it('both modes include Read, Glob, Grep, Bash', () => {
    for (const dryRun of [true, false]) {
      const config = repairGetConfig(dryRun);
      expect(config.extraTools).toContain('Read');
      expect(config.extraTools).toContain('Glob');
      expect(config.extraTools).toContain('Grep');
      expect(config.extraTools).toContain('Bash');
    }
  });

  it('includes code-pathfinder and context MCP', () => {
    const config = repairGetConfig(false);
    expect(config.mcpServers).toHaveProperty('code-pathfinder');
    expect(config.mcpServers).toHaveProperty('context');
  });
});

// ─── CTO getConfig ───────────────────────────────────────

describe('cto getConfig', () => {
  it('dryRun=true does NOT include Edit/Write tools', () => {
    const config = ctoGetConfig('/project', true);
    expect(config.extraTools).not.toContain('Edit');
    expect(config.extraTools).not.toContain('Write');
  });

  it('dryRun=false includes Edit/Write tools', () => {
    const config = ctoGetConfig('/project', false);
    expect(config.extraTools).toContain('Edit');
    expect(config.extraTools).toContain('Write');
  });

  it('has higher maxTurns than other agents (50)', () => {
    const config = ctoGetConfig('/project', false);
    expect(config.maxTurns).toBe(50);
  });
});

// ─── CTO getConductorConfig ──────────────────────────────

describe('cto getConductorConfig', () => {
  it('always includes Edit and Write tools', () => {
    const config = getConductorConfig();
    expect(config.extraTools).toContain('Edit');
    expect(config.extraTools).toContain('Write');
  });

  it('has lower maxTurns than standalone (25)', () => {
    const config = getConductorConfig();
    expect(config.maxTurns).toBe(25);
  });

  it('includes code-pathfinder MCP', () => {
    const config = getConductorConfig();
    expect(config.mcpServers).toHaveProperty('code-pathfinder');
  });

  it('has type "cto"', () => {
    const config = getConductorConfig();
    expect(config.type).toBe('cto');
  });
});

// ─── CTO getConductorRole ────────────────────────────────

describe('cto getConductorRole', () => {
  it('open mode mentions fixing code', () => {
    const role = getConductorRole('open');
    expect(role).toContain('FIX');
    expect(role).toContain('Edit/Write');
  });

  it('debate mode mentions feasibility', () => {
    const role = getConductorRole('debate');
    expect(role).toContain('feasibility');
  });

  it('review mode mentions checking problems', () => {
    const role = getConductorRole('review');
    expect(role).toContain('check');
  });

  it('improve mode mentions implementing', () => {
    const role = getConductorRole('improve');
    expect(role).toContain('implement');
  });

  it('all 4 modes return different text', () => {
    const modes = ['open', 'debate', 'review', 'improve'];
    const roles = modes.map(m => getConductorRole(m));
    const unique = new Set(roles);
    expect(unique.size).toBe(4);
  });

  it('unknown mode falls back to open', () => {
    const unknown = getConductorRole('nonexistent');
    const open = getConductorRole('open');
    expect(unknown).toBe(open);
  });
});
