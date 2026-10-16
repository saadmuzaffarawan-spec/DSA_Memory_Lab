// Differential tests: the simulator (Linux profile) must print exactly what real g++ printed for the same program.
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { runProgram } from '../src/engine/run';

const dir = join(__dirname, 'programs');
const files = readdirSync(dir).filter((f) => f.endsWith('.cpp')).sort();

describe('corpus vs real g++', () => {
  for (const f of files) {
    const exp = join(dir, f.replace(/\.cpp$/, '.expected'));
    it.runIf(existsSync(exp))(f, () => {
      const src = readFileSync(join(dir, f), 'utf8');
      const r = runProgram(src, { platform: 'linux', maxSteps: 20_000_000, stdin: existsSync(join(dir, f.replace(/\.cpp$/, '.in'))) ? readFileSync(join(dir, f.replace(/\.cpp$/, '.in')), 'utf8') : undefined });
      expect(r.compileError, JSON.stringify(r.compileError)).toBeUndefined();
      expect(r.stdout).toBe(readFileSync(exp, 'utf8'));
    });
  }
});
