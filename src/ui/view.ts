// A plain-data snapshot of the machine at one moment: exactly what the panels draw.
import type { Diag, TypeNode } from '../engine/trace';
import { S } from '../engine/trace';
import { decode, type Value } from './decode';
import { isUserLine, type Replay, type Access } from './replay';

export interface VarView {
  id: number;
  name: string;
  kind: 'local' | 'param' | 'global' | 'static' | 'temp' | 'member';
  value: Value;
}
export interface FrameView {
  id: number;
  name: string;
  args: string;
  base: number;
  ret: number;
  retLabel: string;
  /** line the call was made from (0 if the caller is library code) */
  callLine: number;
  vars: VarView[];
}
export interface BlockView {
  id: number;
  addr: number;
  size: number;
  usable: number;
  chunk: number;
  how: string;
  line: number;
  state: 'live' | 'freed';
  value: Value;
  /** true if the program never freed it and nothing points at it any more is decided by the leak report, not here */
}
export interface Target { kind: 'var' | 'block'; id: number; offset: number; label: string }

export interface View {
  step: number;
  stepCount: number;
  line: number;
  atEnd: boolean;
  frames: FrameView[];
  globals: VarView[];
  heap: BlockView[];
  stdout: string;
  diags: Diag[];
  access: Access[];
  brk: number;
  /** resolve an address to the variable or heap block that contains it */
  locate(addr: number): Target | null;
}

function rawBytesType(size: number): TypeNode {
  return { name: `byte[${size}]`, size, kind: 'array', count: size, elem: { name: 'unsigned char', size: 1, kind: 'scalar' } };
}

export function buildView(rp: Replay, showLib: boolean): View {
  const types = rp.result.types;
  const frames: FrameView[] = rp.userFrames(showLib).map((f) => ({
    id: f.id, name: f.name, args: f.args, base: f.base, ret: f.ret, retLabel: f.retLabel, callLine: f.line,
    vars: rp.varsOfFrame(f.id).map((v) => ({ id: v.id, name: v.name, kind: v.kind, value: decode(types[v.id] ?? rawBytesType(v.size), v.a, rp, v.name) })),
  }));
  const globals: VarView[] = rp.userGlobals().map((v) => ({ id: v.id, name: v.name, kind: v.kind, value: decode(types[v.id] ?? rawBytesType(v.size), v.a, rp, v.name) }));

  const mk = (a: ReturnType<Replay['liveHeap']>[number], state: 'live' | 'freed'): BlockView => {
    const t = types[a.id] ?? rawBytesType(Math.max(1, a.size));
    return { id: a.id, addr: a.a, size: a.size, usable: a.usable, chunk: a.chunk, how: a.how, line: a.line, state, value: decode(t, a.a, rp, a.type ?? t.name) };
  };
  const heap: BlockView[] = [...rp.liveHeap().map((a) => mk(a, 'live')), ...rp.freedHeap().map((a) => mk(a, 'freed'))].sort((x, y) => x.addr - y.addr);
  // library-internal blocks (iostream buffers etc.) are real allocations too; keep them but they carry their origin
  const ranges: Array<{ lo: number; hi: number; t: Target }> = [];
  for (const f of frames) for (const v of f.vars) ranges.push({ lo: v.value.addr, hi: v.value.addr + Math.max(1, v.value.size), t: { kind: 'var', id: v.id, offset: 0, label: v.name } });
  for (const v of globals) ranges.push({ lo: v.value.addr, hi: v.value.addr + Math.max(1, v.value.size), t: { kind: 'var', id: v.id, offset: 0, label: v.name } });
  for (const b of heap) if (b.state === 'live') ranges.push({ lo: b.addr, hi: b.addr + Math.max(1, b.usable), t: { kind: 'block', id: b.id, offset: 0, label: b.value.type } });
  const locate = (addr: number): Target | null => {
    let best: (typeof ranges)[number] | null = null;
    for (const r of ranges) if (addr >= r.lo && addr < r.hi && (!best || r.hi - r.lo < best.hi - best.lo)) best = r;
    return best ? { ...best.t, offset: addr - best.lo } : null;
  };

  const k = rp.stepAt();
  return {
    step: k,
    stepCount: rp.steps.length,
    line: rp.line,
    atEnd: rp.pos >= rp.events.length,
    frames, globals, heap, stdout: rp.stdout, diags: rp.diags, access: rp.recentAccess(), brk: rp.brk, locate,
  };
}

export const STATE_CLASS: Record<number, string> = {
  [S.Unalloc]: 'st-unalloc', [S.Uninit]: 'st-uninit', [S.Init]: 'st-init', [S.Pad]: 'st-pad', [S.Freed]: 'st-freed', [S.Meta]: 'st-meta', [S.Dead]: 'st-dead',
};
export { isUserLine };
