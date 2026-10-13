// Allocator models for Windows (UCRT debug heap on top of the NT heap) and macOS (libmalloc tiny/small zones).
// These follow the documented behaviour of each system but, unlike the glibc model, are NOT verified byte-for-byte
// against the real thing (see docs/LIMITS.md). The UI labels them "approximate".
import { Fault } from './memory';
import { Heap } from './heap';
import type { Memory } from './memory';
import type { Platform } from './platform';
import { S } from './trace';

const alignUp = (x: number, a: number) => Math.ceil(x / a) * a;

// ---------------------------------------------------------------------------------------------------------
// Windows: _CrtMemBlockHeader (0x30) + data + 4 guard bytes, inside an NT heap block (0x10 byte entry header).
// ---------------------------------------------------------------------------------------------------------
const CRT_HDR = 0x30;
const NO_MANS = 4;
const NT_HDR = 0x10;
const CLEAN = 0xcd; // fresh heap memory
const DEAD = 0xdd; // freed heap memory
const NO_MANS_LAND = 0xfd; // guard bytes

export class WinDebugHeap extends Heap {
  private bump: number;
  private head = 0; // most recently allocated block header (the CRT keeps a doubly linked list of all blocks)
  private reqNo = 87;
  private freeBy = new Map<number, number[]>(); // NT block size -> LIFO of block addresses
  private heapKey = 0x6b3c91a05f2e8d47n;
  private sizes = new Map<number, number>(); // user -> NT block size

  constructor(mem: Memory, plat: Platform, idGen: () => number) {
    super(mem, plat, idGen);
    this.bump = plat.heap.base + 0x750;
    mem.growHeap(0x10000);
  }

  describe() { return 'Windows Debug CRT heap (_malloc_dbg) on the NT heap: 0x30-byte block header, 0xFD guards, 0xCD/0xDD fills'; }
  headerBytes() { return CRT_HDR; }
  usable(p: number) { return this.live.get(p)?.req ?? 0; }

  private ensureMapped(end: number) {
    const need = end - this.plat.heap.base;
    while (this.mem.heap.mapped < need) if (!this.mem.growHeap(0x10000)) return false;
    return true;
  }

  malloc(req: number, how: string): number {
    if (req < 0 || req > 0x7fffffff) return 0;
    const dbg = this.plat.debug;
    const hdr = dbg ? CRT_HDR : 0;
    const guard = dbg ? NO_MANS : 0;
    const ntSize = alignUp(hdr + req + guard, 16) + (dbg ? 0 : 0);
    const blockSize = Math.max(16, ntSize);
    const stack = this.freeBy.get(blockSize);
    let block: number;
    if (stack && stack.length) block = stack.pop()!;
    else {
      block = this.bump + NT_HDR;
      if (!this.ensureMapped(block + blockSize + NT_HDR)) return 0;
      this.bump = block + blockSize;
      // NT heap entry header (encoded with a per-heap key, so it looks random)
      const enc = (BigInt(blockSize >> 4) | (BigInt(block >> 4 & 0xff) << 16n)) ^ this.heapKey;
      this.mem.wr64(block - NT_HDR, enc, S.Meta);
      this.mem.wr64(block - NT_HDR + 8, 0x0100n, S.Meta);
    }
    const user = block + hdr;
    this.sizes.set(user, blockSize);
    const m = this.mem;
    if (dbg) {
      const rn = ++this.reqNo;
      m.wr64(block, 0, S.Meta); // next (older block)
      m.wr64(block + 8, 0, S.Meta); // prev
      if (this.head) {
        m.wr64(block, this.head, S.Meta);
        m.wr64(this.head + 8, block, S.Meta);
      }
      this.head = block;
      m.wr64(block + 0x10, 0, S.Meta); // file name (null unless _CRTDBG_MAP_ALLOC)
      m.wr32(block + 0x18, 0, S.Meta); // line number
      m.wr32(block + 0x1c, 1, S.Meta); // _NORMAL_BLOCK
      m.wr64(block + 0x20, req, S.Meta); // data size
      m.wr32(block + 0x28, rn, S.Meta); // request number
      m.fill(block + 0x2c, 4, NO_MANS_LAND, S.Meta);
      if (req > 0) m.fill(user, req, CLEAN, S.Uninit);
      m.fill(user + req, NO_MANS, NO_MANS_LAND, S.Meta);
      const slack = block + blockSize - (user + req + NO_MANS);
      if (slack > 0) m.setState(user + req + NO_MANS, slack, S.Pad);
    } else {
      if (req > 0) m.setState(user, req, S.Uninit);
      const slack = blockSize - req;
      if (slack > 0) m.setState(user + req, slack, S.Pad);
    }
    this.record(user, req, how);
    return user;
  }

  private checkGuards(user: number, req: number) {
    const m = this.mem;
    const before = m.readRaw(user - NO_MANS, NO_MANS);
    const after = m.readRaw(user + req, NO_MANS);
    const bad = (b: Uint8Array) => b.some((x) => x !== NO_MANS_LAND);
    const rec = this.live.get(user);
    const rn = m.rd32(user - CRT_HDR + 0x28);
    const hex = '0x' + user.toString(16).toUpperCase().padStart(16, '0');
    if (bad(after)) {
      throw new Fault('assert', `HEAP CORRUPTION DETECTED: after Normal block (#${rn}) at ${hex}.\nCRT detected that the application wrote to memory after end of heap buffer.`, user, 3);
    }
    if (bad(before)) {
      throw new Fault('assert', `HEAP CORRUPTION DETECTED: before Normal block (#${rn}) at ${hex}.\nCRT detected that the application wrote to memory before start of heap buffer.`, user, 3);
    }
    void rec;
  }

  free(user: number, how: string) {
    if (user === 0) return;
    const m = this.mem;
    const rec = this.live.get(user);
    if (!rec) {
      if (this.freed.has(user)) throw new Fault('abort', 'Critical error detected c0000374\nHEAP CORRUPTION: the block at 0x' + user.toString(16) + ' was already freed (double free).', user, 0xc0000374);
      const seg = m.seg(user);
      if (!seg || seg.name !== 'heap') throw new Fault('assert', 'Debug Assertion Failed!\n\nExpression: _CrtIsValidHeapPointer(block)\n\n(free() was called with a pointer that does not point into the heap)', user, 3);
      throw new Fault('abort', 'Critical error detected c0000374\nHEAP CORRUPTION: 0x' + user.toString(16) + ' is not the start of an allocated block.', user, 0xc0000374);
    }
    const dbg = this.plat.debug;
    const blockSize = this.sizes.get(user)!;
    const block = user - (dbg ? CRT_HDR : 0);
    if (dbg) {
      this.checkGuards(user, rec.req);
      // unlink from the CRT's list of live blocks
      const next = m.rd64(block);
      const prev = m.rd64(block + 8);
      if (prev) m.wr64(prev, next, S.Meta);
      if (next) m.wr64(next + 8, prev, S.Meta);
      if (this.head === block) this.head = next;
      m.wr32(block + 0x1c, 0, S.Meta); // _FREE_BLOCK
      if (rec.req > 0) m.fill(user, rec.req, DEAD, S.Freed);
    } else {
      m.setState(user, blockSize, S.Freed);
    }
    this.release(user, how);
    const st = this.freeBy.get(blockSize) ?? [];
    st.push(block);
    this.freeBy.set(blockSize, st);
  }

  override realloc(user: number, req: number, how = 'realloc'): number {
    if (user === 0) return this.malloc(req, how);
    if (req === 0) { this.free(user, how); return 0; }
    const rec = this.live.get(user);
    const np = this.malloc(req, how);
    if (!np) return 0;
    if (rec) {
      this.mem.copy(np, user, Math.min(rec.req, req), false);
      this.free(user, how);
    }
    return np;
  }

  freeLists() {
    const out: Array<{ name: string; chunks: Array<{ user: number; size: number }> }> = [];
    for (const [sz, st] of [...this.freeBy.entries()].sort((a, b) => a[0] - b[0])) {
      if (st.length) out.push({ name: `free blocks of ${sz} bytes (most recent first)`, chunks: [...st].reverse().map((b) => ({ user: b + (this.plat.debug ? CRT_HDR : 0), size: sz })) });
    }
    return out;
  }
}

// ---------------------------------------------------------------------------------------------------------
// macOS: libmalloc "tiny" (16-byte quantum, up to 1008 bytes) and "small" (512-byte quantum) zones. No headers.
// ---------------------------------------------------------------------------------------------------------
export class MacHeap extends Heap {
  private bump: number;
  private lastFree: { user: number; q: number } | null = null;
  private lists = new Map<number, number[]>();
  private quant = new Map<number, number>(); // user -> block size

  constructor(mem: Memory, plat: Platform, idGen: () => number) {
    super(mem, plat, idGen);
    this.bump = plat.heap.base + 0x1000;
    mem.growHeap(0x20000);
  }

  describe() { return 'macOS libmalloc: tiny zone (16-byte blocks, no headers) and small zone (512-byte blocks); most recently freed block is reused first'; }
  headerBytes() { return 0; }
  usable(p: number) { return this.quant.get(p) ?? this.live.get(p)?.req ?? 0; }

  private blockFor(req: number) {
    if (req <= 1008) return Math.max(16, alignUp(req, 16));
    if (req < 127 * 1024) return alignUp(req, 512);
    return alignUp(req, 4096);
  }

  malloc(req: number, how: string): number {
    if (req < 0 || req > 0x7fffffff) return 0;
    const bs = this.blockFor(req);
    let user = 0;
    if (this.lastFree && this.lastFree.q === bs) { user = this.lastFree.user; this.lastFree = null; }
    else {
      const l = this.lists.get(bs);
      if (l && l.length) user = l.pop()!;
    }
    if (!user) {
      user = this.bump;
      const need = user + bs - this.plat.heap.base;
      while (this.mem.heap.mapped < need) if (!this.mem.growHeap(0x20000)) return 0;
      this.bump = user + bs;
    }
    this.quant.set(user, bs);
    this.mem.setState(user, req, S.Uninit);
    if (bs > req) this.mem.setState(user + req, bs - req, S.Pad);
    this.record(user, req, how);
    return user;
  }

  free(user: number, how: string) {
    if (user === 0) return;
    const rec = this.live.get(user);
    const hex = '0x' + user.toString(16);
    if (!rec) {
      if (this.freed.has(user)) throw new Fault('abort', `malloc: Double free of object ${hex}\nmalloc: *** set a breakpoint in malloc_error_break to debug`, user, 134);
      throw new Fault('abort', `malloc: *** error for object ${hex}: pointer being freed was not allocated\nmalloc: *** set a breakpoint in malloc_error_break to debug`, user, 134);
    }
    const bs = this.quant.get(user)!;
    this.release(user, how);
    this.mem.setState(user, bs, S.Freed);
    // the previously "last freed" block moves onto its size list; its first 16 bytes hold a link + checksum
    if (this.lastFree) {
      const lf = this.lastFree;
      const l = this.lists.get(lf.q) ?? [];
      const prevHead = l.length ? l[l.length - 1] : 0;
      this.mem.wr64(lf.user, prevHead, S.Meta);
      this.mem.wr64(lf.user + 8, (BigInt(prevHead) ^ 0xa3b1c2d3e4f50617n) & 0xffffffffffffffffn, S.Meta);
      l.push(lf.user);
      this.lists.set(lf.q, l);
    }
    this.lastFree = { user, q: bs };
  }

  freeLists() {
    const out: Array<{ name: string; chunks: Array<{ user: number; size: number }> }> = [];
    if (this.lastFree) out.push({ name: 'last freed block (reused first)', chunks: [{ user: this.lastFree.user, size: this.lastFree.q }] });
    for (const [sz, l] of [...this.lists.entries()].sort((a, b) => a[0] - b[0])) {
      if (l.length) out.push({ name: `free list, ${sz}-byte blocks`, chunks: [...l].reverse().map((u) => ({ user: u, size: sz })) });
    }
    return out;
  }
}
