// Developer tool: TRY=path/to/file.cpp PLAT=linux npx vitest run tests/dev/try.test.ts
(globalThis as any).__STACKYARD_DEV = true;
import { it } from 'vitest';
import { readFileSync } from 'node:fs';
import { runProgram } from '../../src/engine/run';

it.runIf(!!process.env.TRY)('try', () => {
  const src = readFileSync(process.env.TRY!, 'utf8');
  const r = runProgram(src, { platform: (process.env.PLAT as any) || 'linux' });
  if (r.compileError) console.log('COMPILE ERROR', JSON.stringify(r.compileError));
  console.log('--- stdout ---\n' + r.stdout);
  if (r.stderr) console.log('--- stderr ---\n' + r.stderr);
  console.log('exit', r.exitCode, r.reason, r.endMessage ?? '', 'events', r.events.length, 'steps', r.steps);
  for (const d of r.diagnostics) console.log(`[${d.severity}] ${d.title} — ${d.body}`);
  if (process.env.EVENTS) for (const e of r.events.slice(0, Number(process.env.EVENTS))) console.log(JSON.stringify(e, (_k, v) => (typeof v === 'bigint' ? v.toString() : v instanceof Uint8Array ? Array.from(v) : v)));
});
