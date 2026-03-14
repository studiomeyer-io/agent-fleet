import { describe, it, expect } from 'vitest';
import { pickMcp, listMcpServers } from '../agents/lib/mcp-config.js';

describe('pickMcp', () => {
  it('picks a single MCP server by name', () => {
    const result = pickMcp('context7');
    expect(result).toHaveProperty('context7');
    expect(result['context7'].command).toBe('npx');
    expect(result['context7'].args).toContain('-y');
  });

  it('picks multiple MCP servers', () => {
    const result = pickMcp('code-pathfinder', 'context7', 'context');
    expect(Object.keys(result)).toHaveLength(3);
    expect(result).toHaveProperty('code-pathfinder');
    expect(result).toHaveProperty('context7');
    expect(result).toHaveProperty('context');
  });

  it('returns cloned configs (no mutation)', () => {
    const result1 = pickMcp('tavily');
    const result2 = pickMcp('tavily');
    expect(result1['tavily'].args).not.toBe(result2['tavily'].args);
    expect(result1['tavily'].args).toEqual(result2['tavily'].args);
  });

  it('includes env for tavily', () => {
    const result = pickMcp('tavily');
    expect(result['tavily']).toHaveProperty('env');
    expect(result['tavily'].env).toHaveProperty('TAVILY_API_KEY');
  });

  it('returns empty object for no args', () => {
    const result = pickMcp();
    expect(result).toEqual({});
  });

  it('returns all 6 available servers', () => {
    const all = pickMcp(
      'code-pathfinder',
      'context7',
      'context',
      'github',
      'sequential-thinking',
      'tavily',
    );
    expect(Object.keys(all)).toHaveLength(6);
  });
});

describe('listMcpServers', () => {
  it('returns all available server names', () => {
    const names = listMcpServers();
    expect(names).toContain('code-pathfinder');
    expect(names).toContain('context7');
    expect(names).toContain('context');
    expect(names).toContain('github');
    expect(names).toContain('sequential-thinking');
    expect(names).toContain('tavily');
  });

  it('returns 6 servers', () => {
    expect(listMcpServers()).toHaveLength(6);
  });
});

describe('pickMcp deep clone safety', () => {
  it('mutating returned args does not affect future calls', () => {
    const result1 = pickMcp('context7');
    result1['context7'].args.push('--extra-flag');
    const result2 = pickMcp('context7');
    expect(result2['context7'].args).not.toContain('--extra-flag');
  });

  it('mutating returned env does not affect future calls', () => {
    const result1 = pickMcp('tavily');
    if (result1['tavily'].env) {
      result1['tavily'].env['NEW_KEY'] = 'test';
    }
    const result2 = pickMcp('tavily');
    expect(result2['tavily'].env).not.toHaveProperty('NEW_KEY');
  });
});

describe('mcpServers structure', () => {
  it('tavily server has TAVILY_API_KEY in env', () => {
    const result = pickMcp('tavily');
    expect(result['tavily'].env).toHaveProperty('TAVILY_API_KEY');
  });

  it('each server has a valid command (node or npx)', () => {
    const all = listMcpServers();
    for (const name of all) {
      const picked = pickMcp(name as any);
      const cmd = picked[name].command;
      expect(['node', 'npx']).toContain(cmd);
    }
  });

  it('servers without env return undefined env', () => {
    const result = pickMcp('context7');
    expect(result['context7'].env).toBeUndefined();
  });
});
