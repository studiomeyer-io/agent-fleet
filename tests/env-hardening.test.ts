import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// ============================================================
// Static regression guards for base-agent spawn hardening.
// Round-4 OSS-Sweep (2026-04-24).
//
// These aren't behavioural tests — we can't cheaply stub out `spawn('claude')`
// — but they pin two properties of the source that real refactors tend to
// silently break:
//
//   1. ANTHROPIC_API_KEY / ANTHROPIC_AUTH_TOKEN are stripped from cleanEnv
//      before spawning the Claude CLI (otherwise users get billed at full
//      API rates instead of consuming their Claude Pro / Max subscription).
//   2. SIGTERM is only accepted as a partial success when the captured
//      stdout has enough structured output to actually be useful — the
//      previous `> 100` bar accepted noise.
// ============================================================

const SOURCE = readFileSync(
  resolve(__dirname, '../agents/lib/base-agent.ts'),
  'utf-8',
);

describe('agent-fleet env hardening', () => {
  it('strips ANTHROPIC_API_KEY from spawned claude env', () => {
    expect(SOURCE).toMatch(/delete\s+cleanEnv\.ANTHROPIC_API_KEY/);
  });

  it('strips ANTHROPIC_AUTH_TOKEN from spawned claude env', () => {
    expect(SOURCE).toMatch(/delete\s+cleanEnv\.ANTHROPIC_AUTH_TOKEN/);
  });

  it('provides AGENT_FLEET_USE_API_KEY opt-out', () => {
    expect(SOURCE).toMatch(/AGENT_FLEET_USE_API_KEY/);
  });

  it('strips CLAUDECODE (so spawn looks like a fresh shell)', () => {
    expect(SOURCE).toMatch(/delete\s+cleanEnv\.CLAUDECODE/);
  });
});

describe('agent-fleet SIGTERM output guard', () => {
  it('requires >=500 bytes of stdout before accepting SIGTERM as partial success', () => {
    // There are two spawn sites; both must use the hardened guard.
    const matches = SOURCE.match(/signal === 'SIGTERM' && stdout\.length >= 500/g);
    expect(matches, 'expected the hardened SIGTERM guard in both spawn call-sites').toBeTruthy();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  it('requires structured output (## header) before accepting SIGTERM', () => {
    const matches = SOURCE.match(/stdout\.includes\('## '\)/g);
    expect(matches).toBeTruthy();
    expect(matches!.length).toBeGreaterThanOrEqual(2);
  });

  it('does not keep the old permissive "> 100" fallback anywhere', () => {
    expect(SOURCE).not.toMatch(/stdout\.length\s*>\s*100\b/);
  });
});
