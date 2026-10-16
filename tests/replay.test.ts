import { describe, it, expect } from 'vitest';
import { runProgram } from '../src/engine/run';
import { Replay } from '../src/ui/replay';

const SRC = `#include <iostream>
struct P { int x; double y; };
int sum(int a, int b) { int s = a + b; return s; }
int main() {
  int n = 5;
  P p{1, 2.5};
  int* h = new int[3]{1, 2, 3};
  int r = sum(n, h[1]);
  std::cout << r << "\\n";
  delete[] h;
}
`;

function digest(r: Replay) {
  return JSON.stringify({
    pos: r.pos, frames: [...r.frames], vars: [...r.liveVars].sort((a, b) => a - b), live: [...r.liveAllocs], freed: [...r.freedAllocs],
    line: r.line, brk: r.brk,
    mem: r.liveHeap().map((a) => Array.from(r.read(a.a, a.size))),
    out: r.stdout,
  });
}

describe('replay', () => {
  const res = runProgram(SRC, { platform: 'linux' });
  it('compiles and has user steps', () => {
    expect(res.compileError).toBeUndefined();
    const r = new Replay(res);
    expect(r.steps.length).toBeGreaterThan(5);
    expect(r.steps[0].line).toBe(5);
  });
  it('rewinding reproduces earlier states exactly', () => {
    const r = new Replay(res);
    const snaps: string[] = [];
    for (let k = 0; k <= r.steps.length; k++) { r.seekStep(k); snaps.push(digest(r)); }
    // now go backwards
    for (let k = r.steps.length; k >= 0; k--) { r.seekStep(k); expect(digest(r)).toBe(snaps[k]); }
    // random jumps
    const order = [3, 9, 1, 7, 0, 8, 2];
    for (const k of order) { if (k > r.steps.length) continue; r.seekStep(k); expect(digest(r)).toBe(snaps[k]); }
    r.seek(0);
    expect(r.frames.length).toBe(0);
    expect(r.liveAllocs.size).toBe(0);
  });
  it('sees the heap block and the output', () => {
    const r = new Replay(res);
    r.seek(res.events.length);
    expect(r.stdout).toBe('7\n');
    expect(r.freedAllocs.size).toBeGreaterThan(0);
  });
  it('shows main and the callee as user frames', () => {
    const r = new Replay(res);
    const k = r.steps.findIndex((s) => s.line === 3);
    r.seekStep(k);
    expect(r.userFrames(false).map((f) => f.name)).toEqual(['sum', 'main']);
    expect(r.steps[k].depth).toBe(2);
  });
});
