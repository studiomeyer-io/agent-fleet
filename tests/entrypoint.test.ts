import { describe, it, expect } from 'vitest';
import { isEntrypoint } from '../agents/lib/entrypoint.js';

describe('isEntrypoint', () => {
  const orig = process.argv[1];
  const restore = () => {
    process.argv[1] = orig;
  };

  it('returns true when the module url resolves to process.argv[1]', () => {
    process.argv[1] = '/abs/path/research-agent.js';
    try {
      expect(isEntrypoint('file:///abs/path/research-agent.js')).toBe(true);
    } finally {
      restore();
    }
  });

  it('returns false when an imported module is not the entry point', () => {
    // The conductor (entry) imports the cto agent — the cto module must NOT
    // see itself as the entry point.
    process.argv[1] = '/abs/path/conductor.js';
    try {
      expect(isEntrypoint('file:///abs/path/cto-agent.js')).toBe(false);
    } finally {
      restore();
    }
  });

  it('returns false when process.argv[1] is undefined', () => {
    process.argv[1] = undefined as unknown as string;
    try {
      expect(isEntrypoint('file:///abs/path/research-agent.js')).toBe(false);
    } finally {
      restore();
    }
  });

  it('returns false (does not throw) on a malformed url', () => {
    process.argv[1] = '/abs/path/research-agent.js';
    try {
      expect(isEntrypoint('not-a-file-url')).toBe(false);
    } finally {
      restore();
    }
  });
});
