import { fileURLToPath } from 'node:url';

/**
 * True when the module identified by `metaUrl` is the process entry point — the
 * file `node` (or tsx) was actually invoked with — rather than a module that was
 * imported by another.
 *
 * Each agent guards its top-level `main()` with this so importing one agent from
 * another (the conductor imports the cto agent for its config) or from a test
 * (the suites import the builder functions) does NOT kick off a second agent's
 * CLI. Compares resolved paths, so it's robust to file:// URL encoding.
 */
export function isEntrypoint(metaUrl: string): boolean {
  if (!process.argv[1]) return false;
  try {
    return process.argv[1] === fileURLToPath(metaUrl);
  } catch {
    return false;
  }
}
