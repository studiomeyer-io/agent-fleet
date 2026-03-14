import { describe, it, expect, vi, beforeEach } from 'vitest';

// Ensure DATABASE_URL is not set for these tests
beforeEach(() => {
  delete process.env.DATABASE_URL;
});

describe('db graceful degradation (no DATABASE_URL)', () => {
  it('saveReport returns null without DATABASE_URL', async () => {
    const { saveReport } = await import('../agents/lib/db.js');
    const result = await saveReport({
      agentType: 'test',
      topic: 'test topic',
      content: 'test content',
    });
    expect(result).toBeNull();
  });

  it('saveDiscussion returns null without DATABASE_URL', async () => {
    const { saveDiscussion } = await import('../agents/lib/db.js');
    const result = await saveDiscussion({
      reportId: '00000000-0000-0000-0000-000000000000',
      agentType: 'test',
      position: 'agree',
      content: 'test discussion',
    });
    expect(result).toBeNull();
  });

  it('getRecentReports returns empty array without DATABASE_URL', async () => {
    const { getRecentReports } = await import('../agents/lib/db.js');
    const result = await getRecentReports();
    expect(result).toEqual([]);
  });

  it('getRecentReports with agentType returns empty array', async () => {
    const { getRecentReports } = await import('../agents/lib/db.js');
    const result = await getRecentReports('research', 5);
    expect(result).toEqual([]);
  });

  it('closePool succeeds without active pool', async () => {
    const { closePool } = await import('../agents/lib/db.js');
    await expect(closePool()).resolves.toBeUndefined();
  });
});
