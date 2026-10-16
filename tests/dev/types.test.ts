import { it } from 'vitest';
import { runProgram } from '../../src/engine/run';
import { readFileSync } from 'node:fs';
it.runIf(!!process.env.TRY)('types', () => {
  const r = runProgram(readFileSync(process.env.TRY!, 'utf8'), { platform: (process.env.PLAT as any) || 'linux' });
  for (const e of r.events) if (e.t === 'var' && e.line > 0 && e.line < 1e6) console.log(e.name, e.kind, JSON.stringify(r.types[e.id]));
  for (const e of r.events) if (e.t === 'alloc' && e.line > 0 && e.line < 1e6) console.log('alloc', JSON.stringify(e), JSON.stringify(r.types[e.id]));
});
