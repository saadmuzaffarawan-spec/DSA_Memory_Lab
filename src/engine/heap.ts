// Common heap bookkeeping shared by every allocator model.
import { Fault, type Memory } from './memory';
import type { Platform } from './platform';

export interface HeapRec {
  id: number;
  user: number;
  req: number;
  how: string;
  line: number;
}

export interface HeapStats {
  live: number;
  liveBytes: number;
  totalAllocs: number;
  totalFrees: number;
}

export abstract class Heap {
  /** live allocations keyed by the pointer the program holds */
  live = new Map<number, HeapRec>();
  freed = new Map<number, HeapRec>();
  totalAllocs = 0;
  totalFrees = 0;
  nextId = 1;
  constructor(public mem: Memory, public plat: Platform, public idGen: () => number) {}

  /** returns the user pointer, or 0 when the request cannot be satisfied */
  abstract malloc(req: number, how: string): number;
  abstract free(p: number, how: string): void;
  abstract usable(p: number): number;
  /** short human description of the allocator for the UI */
  abstract describe(): string;
  /** chunk/header bytes in front of the user pointer for this allocator (for drawing) */
  abstract headerBytes(): number;
  /** snapshot used by the allocator lab: free lists by name */
  abstract freeLists(): Array<{ name: string; chunks: Array<{ user: number; size: number }> }>;

  realloc(user: number, req: number, how = 'realloc'): number {
    if (user === 0) return this.malloc(req, how);
    if (req === 0) { this.free(user, how); return 0; }
    const rec = this.live.get(user);
    const np = this.malloc(req, how);
    if (!np) return 0;
    if (rec) { this.mem.copy(np, user, Math.min(rec.req, req), false); this.free(user, how); }
    return np;
  }

  calloc(n: number, sz: number, how = 'calloc'): number {
    const total = n * sz;
    if (!Number.isFinite(total) || total > 0x7fffffff) return 0;
    const p = this.malloc(total, how);
    if (p) { this.mem.fill(p, total, 0, 2 /* Init */); }
    return p;
  }

  protected record(user: number, req: number, how: string) {
    const rec: HeapRec = { id: this.idGen(), user, req, how, line: this.mem.line };
    this.live.set(user, rec);
    this.freed.delete(user);
    this.totalAllocs++;
    this.mem.emit({ t: 'alloc', id: rec.id, a: user, size: req, usable: this.usable(user), chunk: user - this.headerBytes(), how, line: this.mem.line });
    return rec;
  }

  protected release(user: number, how: string): HeapRec | undefined {
    const rec = this.live.get(user);
    if (rec) {
      this.live.delete(user);
      this.freed.set(user, rec);
      this.totalFrees++;
      this.mem.emit({ t: 'free', id: rec.id, how, line: this.mem.line });
    }
    return rec;
  }

  stats(): HeapStats {
    let b = 0;
    for (const r of this.live.values()) b += r.req;
    return { live: this.live.size, liveBytes: b, totalAllocs: this.totalAllocs, totalFrees: this.totalFrees };
  }

  /** allocator-detected fatal error (abort / heap corruption) */
  protected die(msg: string, kind: 'abort' | 'assert' = 'abort'): never {
    throw new Fault(kind, msg, undefined, 134);
  }
}
