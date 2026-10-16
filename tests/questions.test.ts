import { describe, it, expect } from 'vitest';
import { QUESTIONS } from '../src/content/questions';
import { runProgram } from '../src/engine/run';
import type { PlatformId } from '../src/engine/platform';

const PLATS: PlatformId[] = ['windows', 'linux', 'macos'];
describe('tricky questions', () => {
  it('has unique ids', () => { expect(new Set(QUESTIONS.map((q) => q.id)).size).toBe(QUESTIONS.length); });
  for (const q of QUESTIONS) for (const p of PLATS) {
    it(`${q.id} on ${p}`, () => {
      const r = runProgram(q.code, { platform: p });
      expect(r.compileError).toBeUndefined();
      const out = String((r as any).stdout ?? (r as any).output ?? "").trim();
      expect(q.options, `answer was "${out}"`).toContain(out);
      if (!q.varies && p !== 'windows') {
        // platform independent questions must agree everywhere
        const w = String((runProgram(q.code, { platform: "windows" }) as any).stdout).trim();
        expect(out).toBe(w);
      }
    });
  }
});
