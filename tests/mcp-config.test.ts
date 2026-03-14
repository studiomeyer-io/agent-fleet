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
