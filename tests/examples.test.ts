import { describe, it, expect } from 'vitest';
import { EXAMPLES } from '../src/content/examples';
import { runProgram } from '../src/engine/run';
import type { PlatformId } from '../src/engine/platform';

describe('bundled examples run on every platform', () => {
  for (const ex of EXAMPLES) {
    for (const plat of ['windows', 'linux', 'macos'] as PlatformId[]) {
      it(`${ex.id} on ${plat}`, () => {
        const r = runProgram(ex.code, { platform: plat });
        expect(r.compileError).toBeUndefined();
        expect(['return', 'exit', 'fault', 'abort']).toContain(r.reason);
        expect(r.reason === 'limit').toBe(false);
        if (!ex.id.startsWith('bug-')) expect(r.exitCode === 0).toBe(true);
      });
    }
  }
});
