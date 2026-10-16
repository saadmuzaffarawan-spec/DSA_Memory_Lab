// Replay: turns the engine's event list into a machine you can scrub through, forwards and backwards.
// Every state change in the trace carries enough information to be undone (writes keep the old bytes), so seeking is cheap.
import type { Ev, RunResult, TypeNode, Diag } from '../engine/trace';
import { S } from '../engine/trace';

export const LIB_LINE = 1_000_000;
export const isUserLine = (n: number) => n > 0 && n < LIB_LINE;

const PAGE = 4096;

interface Page { b: Uint8Array; s: Uint8Array }

export type VarEv = Extract<Ev, { t: 'var' }>;
export type AllocEv = Extract<Ev, { t: 'alloc' }>;
export type PushEv = Extract<Ev, { t: 'push' }>;

export interface Step {
  /** index into events of the 'line' event */
  idx: number;
  line: number;
  /** number of user-visible frames on the stack at this step (main = 1) */
  depth: number;
}

export interface Access { a: number; l: number; kind: 'r' | 'w' }

/** a function name that belongs to the runtime library rather than to the student's code */
export function isLibName(name: string): boolean {
  return /^(std::|__|operator new|operator delete|_?_?gnu|::)/.test(name) || name.startsWith('std::');
}

export class Replay {
  readonly events: Ev[];
  readonly result: RunResult;
  readonly steps: Step[] = [];
  readonly varById = new Map<number, VarEv>();
  readonly frameById = new Map<number, PushEv>();
  readonly allocById = new Map<number, AllocEv>();
  /** event index at which each stdout chunk was produced, and the cumulative text before it */
  private outIdx: number[] = [];
  private outText: string[] = [];
  private diagIdx: number[] = [];

  pos = 0; // number of events applied
  private pages = new Map<number, Page>();
  /** open frames, outermost first (the root frame has id 1 and is never pushed) */
  readonly frames: number[] = [];
  readonly liveVars = new Set<number>();
  readonly liveAllocs = new Set<number>();
  readonly freedAllocs = new Set<number>();
  /** set of address ranges ever touched, for the memory map */
  brk = 0;
  line = 0;

  constructor(result: RunResult) {
    this.result = result;
    this.events = result.events;
    this.index();
  }

  private index() {
    const ev = this.events;
    let depth = 0;
    const libStack: boolean[] = [];
    let lastUserLine = 0;
    for (let i = 0; i < ev.length; i++) {
      const e = ev[i];
      switch (e.t) {
        case 'var': this.varById.set(e.id, e); break;
        case 'push': {
          this.frameById.set(e.id, e);
          const lib = isLibName(e.name);
          libStack.push(lib);
          if (!lib) depth++;
          break;
        }
        case 'pop': {
          const lib = libStack.pop();
          if (lib === false) depth--;
          break;
        }
        case 'alloc': this.allocById.set(e.id, e); break;
        case 'out': { this.outIdx.push(i); this.outText.push(e.s); break; }
        case 'diag': this.diagIdx.push(i); break;
        case 'line':
          if (isUserLine(e.line) && !libStack.some((x) => x)) {
            // collapse repeated stops on one line within the same frame depth (loops stay visible, `for(;;)` headers fire each time)
            this.steps.push({ idx: i, line: e.line, depth: Math.max(1, depth) });
            lastUserLine = e.line;
          }
          break;
      }
    }
    void lastUserLine;
  }

  // ---- memory ----------------------------------------------------------------------------------------------------------
  private page(n: number, create: boolean): Page | undefined {
    let p = this.pages.get(n);
    if (!p && create) { p = { b: new Uint8Array(PAGE), s: new Uint8Array(PAGE) }; this.pages.set(n, p); }
    return p;
  }

  private put(a: number, bytes: Uint8Array, states: Uint8Array) {
    let i = 0;
    while (i < bytes.length) {
      const pn = Math.floor((a + i) / PAGE);
      const off = (a + i) - pn * PAGE;
      const n = Math.min(PAGE - off, bytes.length - i);
      const pg = this.page(pn, true)!;
      pg.b.set(bytes.subarray(i, i + n), off);
      pg.s.set(states.subarray(i, i + n), off);
      i += n;
    }
  }

  byte(a: number): number { const p = this.pages.get(Math.floor(a / PAGE)); return p ? p.b[a - Math.floor(a / PAGE) * PAGE] : 0; }
  state(a: number): number { const p = this.pages.get(Math.floor(a / PAGE)); return p ? p.s[a - Math.floor(a / PAGE) * PAGE] : S.Unalloc; }

  read(a: number, n: number): Uint8Array {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = this.byte(a + i);
    return out;
  }
  states(a: number, n: number): Uint8Array {
    const out = new Uint8Array(n);
    for (let i = 0; i < n; i++) out[i] = this.state(a + i);
    return out;
  }

  // ---- stepping ----------------------------------------------------------------------------------------------------------
  private apply(e: Ev) {
    switch (e.t) {
      case 'w': this.put(e.a, e.n, e.ns); break;
      case 'push': this.frames.push(e.id); break;
      case 'pop': this.frames.pop(); break;
      case 'var': this.liveVars.add(e.id); break;
      case 'unvar': this.liveVars.delete(e.id); break;
      case 'alloc': this.liveAllocs.add(e.id); this.freedAllocs.delete(e.id); break;
      case 'free': this.liveAllocs.delete(e.id); this.freedAllocs.add(e.id); break;
      case 'brk': this.brk = e.to; break;
      case 'line': this.line = e.line; break;
    }
  }
  private undo(e: Ev, i: number) {
    switch (e.t) {
      case 'w': this.put(e.a, e.o, e.os); break;
      case 'push': this.frames.pop(); break;
      case 'pop': { const id = this.popAt.get(i); if (id !== undefined) this.frames.push(id); break; }
      case 'var': this.liveVars.delete(e.id); break;
      case 'unvar': this.liveVars.add(e.id); break;
      case 'alloc': this.liveAllocs.delete(e.id); break;
      case 'free': this.liveAllocs.add(e.id); this.freedAllocs.delete(e.id); break;
      case 'brk': this.brk = e.from; break;
      case 'line': { this.line = this.lineBefore(i); break; }
    }
  }
  /** event index of each 'pop' -> the frame it closed */
  private popAt = new Map<number, number>();
  private lineBefore(i: number): number {
    for (let j = i - 1; j >= 0; j--) { const e = this.events[j]; if (e.t === 'line') return e.line; }
    return 0;
  }

  /** move to "n events applied" */
  seek(n: number) {
    n = Math.max(0, Math.min(this.events.length, n));
    if (this.popAt.size === 0 && this.hasPops) this.buildPops();
    while (this.pos < n) this.apply(this.events[this.pos++]);
    while (this.pos > n) { this.pos--; this.undo(this.events[this.pos], this.pos); }
  }
  private hasPops = true;
  private buildPops() {
    const stack: number[] = [];
    this.events.forEach((e, i) => {
      if (e.t === 'push') stack.push(e.id);
      else if (e.t === 'pop') { const id = stack.pop(); if (id !== undefined) this.popAt.set(i, id); }
    });
    if (this.popAt.size === 0) this.hasPops = false;
  }

  /** go to the state at step k (the moment just before that line runs); k = steps.length means "after the last line" */
  seekStep(k: number) {
    if (k >= this.steps.length) this.seek(this.events.length);
    else this.seek(this.steps[Math.max(0, k)].idx + 1);
  }

  /** index of the step whose line event is the last one at or before the current position */
  stepAt(): number {
    let lo = 0, hi = this.steps.length - 1, ans = -1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (this.steps[mid].idx < this.pos) { ans = mid; lo = mid + 1; } else hi = mid - 1;
    }
    return ans;
  }

  // ---- derived views -----------------------------------------------------------------------------------------------------
  get stdout(): string {
    let s = '';
    for (let k = 0; k < this.outIdx.length && this.outIdx[k] < this.pos; k++) s += this.outText[k];
    return s;
  }
  get diags(): Diag[] {
    const out: Diag[] = [];
    for (const i of this.diagIdx) if (i < this.pos) { const e = this.events[i]; if (e.t === 'diag') out.push(e.d); }
    return out;
  }

  /** frames the student cares about, innermost first */
  userFrames(showLib: boolean): PushEv[] {
    const out: PushEv[] = [];
    for (let i = this.frames.length - 1; i >= 0; i--) {
      const f = this.frameById.get(this.frames[i])!;
      if (showLib || !isLibName(f.name)) out.push(f);
    }
    return out;
  }
  varsOfFrame(frameId: number, showTemps = false): VarEv[] {
    const out: VarEv[] = [];
    for (const id of this.liveVars) {
      const v = this.varById.get(id)!;
      if (v.frame !== frameId) continue;
      if (!showTemps && (v.kind === 'temp' || v.kind === 'member')) continue;
      out.push(v);
    }
    return out;
  }
  userGlobals(): VarEv[] {
    const out: VarEv[] = [];
    for (const id of this.liveVars) {
      const v = this.varById.get(id)!;
      if ((v.kind === 'global' || v.kind === 'static') && isUserLine(v.line)) out.push(v);
    }
    return out;
  }
  typeOf(id: number): TypeNode | undefined { return this.result.types[id]; }

  liveHeap(): AllocEv[] {
    return [...this.liveAllocs].map((id) => this.allocById.get(id)!).sort((a, b) => a.a - b.a);
  }
  freedHeap(): AllocEv[] {
    return [...this.freedAllocs].map((id) => this.allocById.get(id)!).sort((a, b) => a.a - b.a);
  }

  /** memory the current step just touched (events since the previous line event) */
  recentAccess(): Access[] {
    const out: Access[] = [];
    for (let i = this.pos - 1; i >= 0; i--) {
      const e = this.events[i];
      if (e.t === 'line' && isUserLine(e.line)) break;
      if (e.t === 'w') out.push({ a: e.a, l: e.n.length, kind: 'w' });
      else if (e.t === 'r') out.push({ a: e.a, l: e.l, kind: 'r' });
      if (out.length > 64) break;
    }
    return out;
  }
}
