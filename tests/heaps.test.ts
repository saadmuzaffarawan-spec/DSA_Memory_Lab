import { describe, expect, it } from 'vitest';
import { Memory, Fault } from '../src/engine/memory';
import { LINUX, MACOS, WINDOWS } from '../src/engine/platform';
import { Glibc } from '../src/engine/glibc';
import { MacHeap, WinDebugHeap } from '../src/engine/otherheaps';
import { S } from '../src/engine/trace';

const mk = <T,>(C: new (m: Memory, p: any, g: () => number) => T, p: any) => { const m = new Memory(p); let i = 1; return { m, h: new C(m, p, () => i++) }; };

describe('glibc model basics', () => {
  it('first malloc lands at heap+0x2a0 and tcache reuses LIFO', () => {
    const { m, h } = mk(Glibc, LINUX);
    const a = h.malloc(24, 'malloc');
    expect(a).toBe(LINUX.heap.base + 0x2a0);
    const b = h.malloc(24, 'malloc');
    expect(b).toBe(a + 0x20);
    h.free(a, 'free'); h.free(b, 'free');
    expect(h.malloc(24, 'malloc')).toBe(b);
    expect(h.malloc(24, 'malloc')).toBe(a);
    expect(m.stateAt(a)).toBe(S.Uninit);
  });
  it('safe-linking stores (addr>>12)^next in the freed chunk', () => {
    const { m, h } = mk(Glibc, LINUX);
    const a = h.malloc(24, 'malloc'); const b = h.malloc(24, 'malloc');
    h.free(a, 'free'); h.free(b, 'free');
    expect(BigInt(m.rd64(b)) ^ (BigInt(b) >> 12n)).toBe(BigInt(a));
  });
  it('double free aborts with the real glibc message', () => {
    const { h } = mk(Glibc, LINUX);
    const a = h.malloc(24, 'malloc');
    h.free(a, 'free');
    expect(() => h.free(a, 'free')).toThrow(/double free detected in tcache 2/);
  });
});

describe('windows debug heap', () => {
  it('fills 0xCD / 0xFD / 0xDD and detects buffer overruns on free', () => {
    const { m, h } = mk(WinDebugHeap, WINDOWS);
    const a = h.malloc(8, 'new');
    expect(Array.from(m.readRaw(a, 8))).toEqual(Array(8).fill(0xcd));
    expect(Array.from(m.readRaw(a + 8, 4))).toEqual([0xfd, 0xfd, 0xfd, 0xfd]);
    expect(Array.from(m.readRaw(a - 4, 4))).toEqual([0xfd, 0xfd, 0xfd, 0xfd]);
    m.writeRaw(a + 8, new Uint8Array([1, 2, 3, 4]), S.Init);
    expect(() => h.free(a, 'delete')).toThrow(/HEAP CORRUPTION DETECTED: after Normal block/);
    const b = h.malloc(8, 'new');
    h.free(b, 'delete');
    expect(Array.from(m.readRaw(b, 8))).toEqual(Array(8).fill(0xdd));
    expect(h.malloc(8, 'new')).toBe(b);
  });
});

describe('macOS heap', () => {
  it('reuses the most recently freed block', () => {
    const { h } = mk(MacHeap, MACOS);
    const a = h.malloc(16, 'malloc'); const b = h.malloc(16, 'malloc');
    expect(b).toBe(a + 16);
    h.free(a, 'free');
    expect(h.malloc(16, 'malloc')).toBe(a);
    expect(() => { h.free(b, 'free'); h.free(b, 'free'); }).toThrow(Fault);
  });
});
