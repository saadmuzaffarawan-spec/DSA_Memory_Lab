// Oracle: replay random malloc/free/realloc sequences on the real glibc (gcc) and on our model; pointers must match.
import { describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { LINUX } from '../../src/engine/platform';
import { Memory } from '../../src/engine/memory';
import { Glibc } from '../../src/engine/glibc';

type Op = { k: 'm'; n: number } | { k: 'f'; i: number } | { k: 'r'; i: number; n: number } | { k: 'c'; n: number };

function rng(seed: number) {
  let s = seed >>> 0;
  return () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
}

function genOps(seed: number, count: number, profile: 'small' | 'mixed' | 'big'): Op[] {
  const r = rng(seed);
  const ops: Op[] = [];
  let live: number[] = [];
  let slots = 0;
  const size = () => {
    const x = r();
    if (profile === 'small') return 1 + Math.floor(r() * 130);
    if (profile === 'big') return x < 0.5 ? 1 + Math.floor(r() * 3000) : 1000 + Math.floor(r() * 60000);
    return x < 0.55 ? 1 + Math.floor(r() * 200) : x < 0.85 ? 200 + Math.floor(r() * 1500) : 1500 + Math.floor(r() * 20000);
  };
  for (let i = 0; i < count; i++) {
    const x = r();
    if (live.length === 0 || x < 0.5) { ops.push({ k: 'm', n: size() }); live.push(slots++); }
    else if (x < 0.58) { ops.push({ k: 'c', n: size() }); live.push(slots++); }
    else if (x < 0.68) { const j = Math.floor(r() * live.length); ops.push({ k: 'r', i: live[j], n: size() }); }
    else { const j = Math.floor(r() * live.length); ops.push({ k: 'f', i: live[j] }); live.splice(j, 1); }
  }
  return ops;
}

function realRun(ops: Op[], name: string): Array<{ ptr: bigint; usable: number } | null> {
  const lines: string[] = [];
  let slot = 0;
  for (const o of ops) {
    if (o.k === 'm') { lines.push(`P[${slot}]=malloc(${o.n}); LOG(${slot});`); slot++; }
    else if (o.k === 'c') { lines.push(`P[${slot}]=calloc(1,${o.n}); LOG(${slot});`); slot++; }
    else if (o.k === 'f') lines.push(`free(P[${o.i}]); P[${o.i}]=0;`);
    else lines.push(`P[${o.i}]=realloc(P[${o.i}],${o.n}); LOGR(${o.i});`);
  }
  const src = `#include <stdlib.h>\n#include <stdio.h>\n#include <malloc.h>\n#include <stdint.h>\n
static void* P[4096]; static unsigned long long LP[8192]; static unsigned LU[8192]; static int LN=0;
#define LOG(i) do{LP[LN]=(unsigned long long)(uintptr_t)P[i];LU[LN]=(unsigned)malloc_usable_size(P[i]);LN++;}while(0)
#define LOGR(i) LOG(i)
int main(){ ${lines.join('\n')}
 for(int i=0;i<LN;i++) printf("%llx %u\\n",LP[i],LU[i]); return 0; }\n`;
  mkdirSync('tests/.tmp', { recursive: true });
  const c = `tests/.tmp/${name}.c`;
  writeFileSync(c, src);
  execFileSync('gcc', ['-O0', '-w', '-o', `tests/.tmp/${name}`, c]);
  const out = execFileSync(`tests/.tmp/${name}`, { encoding: 'utf8', env: { ...process.env, GLIBC_TUNABLES: 'glibc.malloc.tcache_count=7' } });
  return out.trim().split('\n').map((l) => { const [a, b] = l.split(' '); return { ptr: BigInt('0x' + a), usable: Number(b) }; });
}

function modelRun(ops: Op[]): Array<{ ptr: number; usable: number }> {
  const mem = new Memory(LINUX);
  let id = 1;
  const h = new Glibc(mem, LINUX, () => id++);
  const P: number[] = [];
  const log: Array<{ ptr: number; usable: number }> = [];
  let slot = 0;
  let opn = 0;
  for (const o of ops) {
    opn++;
    if (process.env.GLIBC_TRACE) {
      console.log('op', opn - 1, JSON.stringify(o), 'AUDIT:', h.audit());
      if (opn > 148) for (const l of h.freeLists()) console.log('   ', l.name, l.chunks.map((c) => (c.user - 16 - LINUX.heap.base).toString(16) + ':' + c.size.toString(16) + (mem.rd64(c.user - 16 + c.size + 8) & 1 ? '!P' : '')).join(' '));
    }
    if (o.k === 'm') { P[slot] = h.malloc(o.n, 'malloc'); log.push({ ptr: P[slot], usable: h.usable(P[slot]) }); slot++; }
    else if (o.k === 'c') { P[slot] = h.calloc(1, o.n); log.push({ ptr: P[slot], usable: h.usable(P[slot]) }); slot++; }
    else if (o.k === 'f') { h.free(P[o.i], 'free'); P[o.i] = 0; }
    else { P[o.i] = h.realloc(P[o.i], o.n); log.push({ ptr: P[o.i], usable: h.usable(P[o.i]) }); }
  }
  return log;
}

if (process.env.GLIBC_DBG) {
  const [profile, seed] = process.env.GLIBC_DBG.split(':');
  const ops = genOps(Number(seed) * 7919 + profile.length, 160, profile as any);
  const real = realRun(ops, 'dbg');
  const model = modelRun(ops);
  let li = 0; const lines: string[] = [];
  ops.forEach((o, k) => {
    let tag = '';
    if (o.k === 'm' || o.k === 'c' || o.k === 'r') { const a = real[li]; const b = model[li]; tag = ` -> real ${a ? Number(a.ptr - real[0]!.ptr) + 0x2a0 : 0} model ${b.ptr - LINUX.heap.base}`; li++; }
    lines.push(`${k}: ${JSON.stringify(o)}${tag}`);
  });
  console.log(lines.join('\n'));
}
describe('glibc model vs real glibc 2.39', () => {
  for (const profile of ['small', 'mixed', 'big'] as const) {
    for (let seed = 1; seed <= Number(process.env.GLIBC_SEEDS ?? 12); seed++) {
      it(`${profile} workload #${seed}`, () => {
        const ops = genOps(seed * 7919 + profile.length, Number(process.env.GLIBC_OPS ?? 160), profile);
        const real = realRun(ops, `g_${profile}_${seed}`);
        const model = modelRun(ops);
        expect(model.length).toBe(real.length);
        const baseReal = real[0]!.ptr;
        const bad: string[] = [];
        for (let i = 0; i < real.length; i++) {
          const rr = real[i]!;
          const rel = rr.ptr === 0n ? 0 : Number(rr.ptr - baseReal) + 0x2a0;
          const mrel = model[i].ptr === 0 ? 0 : model[i].ptr - LINUX.heap.base;
          if (rel !== mrel || rr.usable !== model[i].usable) bad.push(`#${i}: real +0x${rel.toString(16)} usable ${rr.usable} | model +0x${mrel.toString(16)} usable ${model[i].usable}`);
          if (bad.length > 4) break;
        }
        expect(bad).toEqual([]);
      });
    }
  }
});
