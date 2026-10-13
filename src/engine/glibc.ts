// A faithful model of glibc 2.39 malloc (ptmalloc2, single thread, main arena, brk heap) running on the
// simulated memory. Chunk headers, tcache, fastbins, bins and the top chunk all live *in* simulated memory,
// exactly where glibc keeps them, so students can look at (and break) them.
// Verified against the real allocator by tests/oracle/glibc.test.ts.
import { Heap } from './heap';
import type { Memory } from './memory';
import type { Platform } from './platform';
import { S } from './trace';

const SZ = 8;
const MINSIZE = 32;
const ALIGN = 16;
const MAX_FAST = 128; // global_max_fast (default 64 * SIZE_SZ / 4)
const TCACHE_BINS = 64;
const TCACHE_COUNT = 7;
const MIN_LARGE = 1024;
const PAGE = 4096;
const TOP_PAD = 128 * 1024;
const TRIM_THRESHOLD = 128 * 1024;
const FASTBIN_CONSOLIDATION_THRESHOLD = 65536;
const PREV_INUSE = 1;
const TCACHE_KEY = 0x5f3c1a9d7e24b681n; // real glibc draws this at random for every process

// main_arena layout (glibc 2.39, x86-64)
const A_FLAGS = 0x04;
const A_HAVE_FAST = 0x08;
const A_FASTBINS = 0x10; // mfastbinptr fastbinsY[10]
const A_TOP = 0x60;
const A_LAST_REM = 0x68;
const A_BINS = 0x70; // mchunkptr bins[254]

const alignUp = (x: number, a: number) => Math.ceil(x / a) * a;

export class Glibc extends Heap {
  private arena: number;
  private base: number;
  private inited = false;
  private systemMem = 0;
  private mallocCalls = 0;

  constructor(mem: Memory, plat: Platform, idGen: () => number) {
    super(mem, plat, idGen);
    this.arena = plat.libc.arena;
    this.base = plat.heap.base;
    this.initArena();
  }

  describe() { return 'glibc 2.39 malloc (ptmalloc2): tcache → fastbins → small/large bins → top chunk'; }
  headerBytes() { return 16; }

  // ---- raw field access -------------------------------------------------------------------------
  private m(): Memory { return this.mem; }
  private rd = (a: number) => this.mem.rd64(a);
  private wr = (a: number, v: number | bigint) => this.mem.wr64(a, v, S.Meta);
  private sizeField = (c: number) => this.rd(c + 8);
  private chunkSize = (c: number) => this.sizeField(c) - (this.sizeField(c) % 8);
  private prevInuse = (c: number) => (this.sizeField(c) & PREV_INUSE) !== 0;
  private prevSize = (c: number) => this.rd(c);
  private fd = (c: number) => this.rd(c + 16);
  private bk = (c: number) => this.rd(c + 24);
  private setFd = (c: number, v: number) => this.wr(c + 16, v);
  private setBk = (c: number, v: number) => this.wr(c + 24, v);
  private fdn = (c: number) => this.rd(c + 32);
  private bkn = (c: number) => this.rd(c + 40);
  private setFdn = (c: number, v: number) => this.wr(c + 32, v);
  private setBkn = (c: number, v: number) => this.wr(c + 40, v);
  private setHead = (c: number, v: number) => this.wr(c + 8, v);
  private setHeadSize = (c: number, sz: number) => this.wr(c + 8, (this.sizeField(c) & 7) | sz);
  private setFoot = (c: number, s: number) => this.wr(c + s, s);
  private inuseAt = (c: number, s: number) => (this.sizeField(c + s) & PREV_INUSE) !== 0;
  private setInuseAt = (c: number, s: number) => this.wr(c + s + 8, this.sizeField(c + s) | PREV_INUSE);
  private clearInuseAt = (c: number, s: number) => this.wr(c + s + 8, this.sizeField(c + s) & ~PREV_INUSE);

  private get top() { return this.rd(this.arena + A_TOP); }
  private set top(v: number) { this.wr(this.arena + A_TOP, v); }
  private get lastRemainder() { return this.rd(this.arena + A_LAST_REM); }
  private set lastRemainder(v: number) { this.wr(this.arena + A_LAST_REM, v); }
  private binAt = (i: number) => this.arena + A_BINS - 16 + (i - 1) * 16;
  private unsorted = () => this.binAt(1);
  private fastHead = (idx: number) => this.arena + A_FASTBINS + idx * 8;
  private haveFast = () => this.mem.rd32(this.arena + A_HAVE_FAST) !== 0;
  private setHaveFast = (v: boolean) => this.mem.wr32(this.arena + A_HAVE_FAST, v ? 1 : 0, S.Meta);

  private protect = (pos: number, ptr: number) => Number((BigInt(pos) >> 12n) ^ BigInt(ptr));
  private reveal = (pos: number, stored: number) => this.protect(pos, stored);

  private inSmall = (sz: number) => sz < MIN_LARGE;
  private smallIdx = (sz: number) => sz >> 4;
  private largeIdx(sz: number) {
    if ((sz >> 6) <= 48) return 48 + (sz >> 6);
    if ((sz >> 9) <= 20) return 91 + (sz >> 9);
    if ((sz >> 12) <= 10) return 110 + (sz >> 12);
    if ((sz >> 15) <= 4) return 119 + (sz >> 15);
    if ((sz >> 18) <= 2) return 124 + (sz >> 18);
    return 126;
  }
  private binIdx = (sz: number) => (this.inSmall(sz) ? this.smallIdx(sz) : this.largeIdx(sz));
  private fastIdx = (sz: number) => (sz >> 4) - 2;
  private tcIdx = (csize: number) => Math.floor((csize - MINSIZE + ALIGN - 1) / ALIGN);
  private req2size(req: number) { return req + SZ + (ALIGN - 1) < MINSIZE ? MINSIZE : (req + SZ + ALIGN - 1) & ~(ALIGN - 1); }

  // ---- shadow-state helpers -----------------------------------------------------------------------
  private stInUse(c: number, req: number) {
    const s = this.chunkSize(c);
    const user = c + 16;
    this.mem.setState(c + 8, 8, S.Meta);
    this.mem.setState(user, req, S.Uninit);
    const end = c + s + 8;
    if (end > user + req) this.mem.setState(user + req, end - (user + req), S.Pad);
  }
  private stFreeSmall(c: number) {
    const s = this.chunkSize(c);
    this.mem.setState(c + 8, 8, S.Meta);
    this.mem.setState(c + 16, 16, S.Meta);
    if (s + 8 > 32) this.mem.setState(c + 32, s + 8 - 32 + 0, S.Freed);
  }
  private stFreeBin(c: number) {
    const s = this.chunkSize(c);
    const meta = this.inSmall(s) ? 16 : 32;
    this.mem.setState(c + 8, 8, S.Meta);
    this.mem.setState(c + 16, Math.min(meta, s - 8), S.Meta);
    if (s > 16 + meta) this.mem.setState(c + 16 + meta, s - 16 - meta, S.Freed);
    this.mem.setState(c + s, 8, S.Meta); // prev_size "foot" of the next chunk
  }

  // ---- initialisation -----------------------------------------------------------------------------
  private initArena() {
    const a = this.arena;
    this.mem.wr32(a + A_FLAGS, 1, S.Meta); // flags: NONCONTIGUOUS_BIT clear, FASTCHUNKS_BIT set (no fast chunks yet)
    for (let i = 1; i <= 127; i++) { const b = this.binAt(i); this.wr(b + 16, b); this.wr(b + 24, b); }
    this.wr(a + A_TOP, this.unsorted());
  }

  private ensureInit() {
    if (this.inited) return;
    this.inited = true;
    // the first malloc maps the heap (brk) and allocates the per-thread tcache structure as an ordinary chunk
    const first = 0x290 + TOP_PAD + MINSIZE;
    const sz = alignUp(first, PAGE);
    this.mem.growHeap(sz);
    this.systemMem = sz;
    const t = this.base;
    this.wr(t + 8, 0x291);
    this.mem.setState(t + 8, 8, S.Meta);
    this.mem.setState(t + 16, 0x280, S.Meta);
    const top = t + 0x290;
    this.top = top;
    this.setHead(top, (sz - 0x290) | PREV_INUSE);
  }

  private tcacheCountAddr = (i: number) => this.base + 0x10 + 2 * i;
  private tcacheEntryAddr = (i: number) => this.base + 0x90 + 8 * i;
  private tcCount = (i: number) => this.mem.rd16(this.tcacheCountAddr(i));

  // ---- tcache -------------------------------------------------------------------------------------
  private tcachePut(c: number, idx: number) {
    const e = c + 16;
    this.mem.wr64(e + 8, TCACHE_KEY, S.Meta);
    this.wr(e, this.protect(e, this.rd(this.tcacheEntryAddr(idx))));
    this.wr(this.tcacheEntryAddr(idx), e);
    this.mem.wr16(this.tcacheCountAddr(idx), this.tcCount(idx) + 1, S.Meta);
    this.stFreeSmall(c);
  }

  private tcacheGet(idx: number): number {
    const e = this.rd(this.tcacheEntryAddr(idx));
    if (e % 16 !== 0) this.die('malloc(): unaligned tcache chunk detected');
    this.wr(this.tcacheEntryAddr(idx), this.reveal(e, this.rd(e)));
    this.mem.wr16(this.tcacheCountAddr(idx), this.tcCount(idx) - 1, S.Meta);
    this.mem.wr64(e + 8, 0n, S.Meta);
    return e;
  }

  // ---- malloc -----------------------------------------------------------------------------------------
  malloc(req: number, how: string): number {
    if (req < 0 || req > 0x7fffffffffff) return 0;
    this.ensureInit();
    this.mallocCalls++;
    const nb = this.req2size(req);
    const idx = this.tcIdx(nb);
    let user: number;
    if (idx < TCACHE_BINS && this.tcCount(idx) > 0) {
      const e = this.tcacheGet(idx);
      user = e;
      this.stInUse(e - 16, req);
    } else {
      user = this.intMalloc(req, nb);
      if (!user) return 0;
    }
    this.record(user, req, how);
    return user;
  }

  /** glibc 2.39's calloc goes straight to _int_malloc: it never takes a chunk out of the tcache */
  override calloc(n: number, sz: number, how = 'calloc'): number {
    const total = n * sz;
    if (!Number.isFinite(total) || total > 0x7fffffffffff) return 0;
    this.ensureInit();
    const user = this.intMalloc(total, this.req2size(total));
    if (!user) return 0;
    this.mem.fill(user, total, 0, S.Init);
    this.record(user, total, how);
    return user;
  }

  /** _int_malloc: returns the user pointer (states already set) or 0 */
  private intMalloc(req: number, nb: number): number {
    let idx = this.binIdx(nb);
    const unsorted = this.unsorted();
    const tcIdx = this.tcIdx(nb);
    const tcacheOk = tcIdx < TCACHE_BINS;

    // --- fastbin
    if (nb <= MAX_FAST) {
      const fidx = this.fastIdx(nb);
      const fb = this.fastHead(fidx);
      const victim = this.rd(fb);
      if (victim !== 0) {
        if (victim % 16 !== 0) this.die('malloc(): unaligned fastbin chunk detected 2');
        this.wr(fb, this.reveal(victim + 16, this.rd(victim + 16)));
        if (this.fastIdx(this.chunkSize(victim)) !== fidx) this.die('malloc(): memory corruption (fast)');
        if (tcacheOk) {
          let tv: number;
          while (this.tcCount(tcIdx) < TCACHE_COUNT && (tv = this.rd(fb)) !== 0) {
            if (tv % 16 !== 0) this.die('malloc(): unaligned fastbin chunk detected 3');
            this.wr(fb, this.reveal(tv + 16, this.rd(tv + 16)));
            this.tcachePut(tv, tcIdx);
          }
        }
        this.stInUse(victim, req);
        return victim + 16;
      }
    }

    // --- smallbin
    if (this.inSmall(nb)) {
      const bin = this.binAt(idx);
      const victim = this.bk(bin);
      if (victim !== bin) {
        const bck = this.bk(victim);
        if (this.fd(bck) !== victim) this.die('malloc(): smallbin double linked list corrupted');
        this.setInuseAt(victim, nb);
        this.setBk(bin, bck);
        this.setFd(bck, bin);
        if (tcacheOk) {
          let tv: number;
          while (this.tcCount(tcIdx) < TCACHE_COUNT && (tv = this.bk(bin)) !== bin) {
            const b2 = this.bk(tv);
            this.setInuseAt(tv, nb);
            this.setBk(bin, b2);
            this.setFd(b2, bin);
            this.tcachePut(tv, tcIdx);
          }
        }
        this.stInUse(victim, req);
        return victim + 16;
      }
    } else {
      idx = this.largeIdx(nb);
      if (this.haveFast()) this.consolidate();
    }

    let returnCached = false;
    for (let guard = 0; guard < 100; guard++) {
      // --- unsorted
      let iters = 0;
      let victim: number;
      while ((victim = this.bk(unsorted)) !== unsorted) {
        const bck = this.bk(victim);
        let size = this.chunkSize(victim);
        const sf = this.sizeField(victim);
        if (sf <= 16 || size > this.systemMem) this.die('malloc(): invalid size (unsorted)');
        const nextSf = this.sizeField(victim + size);
        if (this.chunkSize(victim + size) > this.systemMem || nextSf <= 16) this.die('malloc(): invalid next size (unsorted)');
        if ((nextSf & PREV_INUSE) !== 0) this.die('malloc(): invalid next->prev_inuse (unsorted)');
        if (this.prevSize(victim + size) !== size) this.die('malloc(): mismatching next->prev_size (unsorted)');
        if (this.fd(bck) !== victim || this.fd(victim) !== unsorted) this.die('malloc(): unsorted double linked list corrupted');

        // last-remainder shortcut for small requests
        if (this.inSmall(nb) && bck === unsorted && victim === this.lastRemainder && size > nb + MINSIZE) {
          const rem = victim + nb;
          const remSize = size - nb;
          this.setBk(unsorted, rem); this.setFd(unsorted, rem);
          this.lastRemainder = rem;
          this.setBk(rem, unsorted); this.setFd(rem, unsorted);
          if (!this.inSmall(remSize)) { this.setFdn(rem, 0); this.setBkn(rem, 0); }
          this.setHead(victim, nb | PREV_INUSE);
          this.setHead(rem, remSize | PREV_INUSE);
          this.setFoot(rem, remSize);
          this.stInUse(victim, req);
          this.stFreeBin(rem);
          return victim + 16;
        }

        // remove from unsorted
        this.setBk(unsorted, bck);
        this.setFd(bck, unsorted);

        if (size === nb) {
          this.setInuseAt(victim, size);
          if (tcacheOk && this.tcCount(tcIdx) < TCACHE_COUNT) {
            this.tcachePut(victim, tcIdx);
            returnCached = true;
            continue;
          }
          this.stInUse(victim, req);
          return victim + 16;
        }

        // place in its bin
        let vidx: number;
        let b: number;
        let f: number;
        if (this.inSmall(size)) {
          vidx = this.smallIdx(size);
          b = this.binAt(vidx);
          f = this.fd(b);
        } else {
          vidx = this.largeIdx(size);
          b = this.binAt(vidx);
          f = this.fd(b);
          if (f !== b) {
            const sz = size | PREV_INUSE;
            if (sz < this.sizeField(this.bk(b))) {
              f = b;
              b = this.bk(b);
              this.setFdn(victim, this.fd(f));
              this.setBkn(victim, this.bkn(this.fd(f)));
              this.setBkn(this.fd(f), victim);
              this.setFdn(this.bkn(victim), victim);
            } else {
              while (sz < this.sizeField(f)) f = this.fdn(f);
              if (sz === this.sizeField(f)) f = this.fd(f);
              else {
                this.setFdn(victim, f);
                this.setBkn(victim, this.bkn(f));
                if (this.fdn(this.bkn(f)) !== f) this.die('malloc(): largebin double linked list corrupted (nextsize)');
                this.setBkn(f, victim);
                this.setFdn(this.bkn(victim), victim);
              }
              b = this.bk(f);
              if (this.fd(b) !== f) this.die('malloc(): largebin double linked list corrupted (bk)');
            }
          } else {
            this.setFdn(victim, victim);
            this.setBkn(victim, victim);
          }
        }
        this.setBk(victim, b);
        this.setFd(victim, f);
        this.setBk(f, victim);
        this.setFd(b, victim);
        this.stFreeBin(victim);
        if (++iters >= 10000) break;
      }
      if (returnCached) {
        const e = this.tcacheGet(tcIdx);
        this.stInUse(e - 16, req);
        return e;
      }

      // --- large request: best fit inside its own bin
      if (!this.inSmall(nb)) {
        const bin = this.binAt(idx);
        const first = this.fd(bin);
        if (first !== bin && this.sizeField(first) >= nb) {
          let v = this.bkn(first);
          let size: number;
          while ((size = this.chunkSize(v)) < nb) v = this.bkn(v);
          if (v !== this.bk(bin) && this.sizeField(v) === this.sizeField(this.fd(v))) v = this.fd(v);
          size = this.chunkSize(v);
          const remSize = size - nb;
          this.unlink(v);
          if (remSize < MINSIZE) this.setInuseAt(v, size);
          else {
            const rem = v + nb;
            const fwd = this.fd(unsorted);
            if (this.bk(fwd) !== unsorted) this.die('malloc(): corrupted unsorted chunks');
            this.setBk(rem, unsorted); this.setFd(rem, fwd);
            this.setFd(unsorted, rem); this.setBk(fwd, rem);
            if (!this.inSmall(remSize)) { this.setFdn(rem, 0); this.setBkn(rem, 0); }
            this.setHead(v, nb | PREV_INUSE);
            this.setHead(rem, remSize | PREV_INUSE);
            this.setFoot(rem, remSize);
            this.stFreeBin(rem);
          }
          this.stInUse(v, req);
          return v + 16;
        }
      }

      // --- next larger non-empty bin
      let found = 0;
      for (let i = idx + 1; i < 127; i++) {
        const bin = this.binAt(i);
        if (this.bk(bin) !== bin) { found = i; break; }
      }
      if (found) {
        const bin = this.binAt(found);
        const v = this.bk(bin);
        const size = this.chunkSize(v);
        const remSize = size - nb;
        this.unlink(v);
        if (remSize < MINSIZE) this.setInuseAt(v, size);
        else {
          const rem = v + nb;
          const fwd = this.fd(unsorted);
          if (this.bk(fwd) !== unsorted) this.die('malloc(): corrupted unsorted chunks 2');
          this.setBk(rem, unsorted); this.setFd(rem, fwd);
          this.setFd(unsorted, rem); this.setBk(fwd, rem);
          if (this.inSmall(nb)) this.lastRemainder = rem;
          if (!this.inSmall(remSize)) { this.setFdn(rem, 0); this.setBkn(rem, 0); }
          this.setHead(v, nb | PREV_INUSE);
          this.setHead(rem, remSize | PREV_INUSE);
          this.setFoot(rem, remSize);
          this.stFreeBin(rem);
        }
        this.stInUse(v, req);
        return v + 16;
      }

      // --- top
      const topc = this.top;
      const tsize = this.chunkSize(topc);
      if (tsize > this.systemMem) this.die('malloc(): corrupted top size');
      if (tsize >= nb + MINSIZE) {
        const rem = topc + nb;
        this.top = rem;
        this.setHead(topc, nb | PREV_INUSE);
        this.setHead(rem, (tsize - nb) | PREV_INUSE);
        this.mem.setState(rem + 8, 8, S.Meta);
        this.stInUse(topc, req);
        return topc + 16;
      } else if (this.haveFast()) {
        this.consolidate();
        idx = this.inSmall(nb) ? this.smallIdx(nb) : this.largeIdx(nb);
      } else {
        if (!this.sysmalloc(nb)) return 0;
      }
    }
    return 0;
  }

  /** extend the heap (brk) so the top chunk can satisfy nb */
  private sysmalloc(nb: number): boolean {
    const oldTop = this.top;
    const oldSize = this.chunkSize(oldTop);
    let size = nb + TOP_PAD + MINSIZE - oldSize;
    size = alignUp(size, PAGE);
    if (!this.mem.growHeap(size)) {
      // try the smallest extension that works
      const need = alignUp(nb + MINSIZE - oldSize, PAGE);
      if (need <= 0 || !this.mem.growHeap(need)) return false;
      size = need;
    }
    this.systemMem += size;
    this.setHead(oldTop, (oldSize + size) | PREV_INUSE);
    return true;
  }

  // ---- unlink & consolidate -----------------------------------------------------------------------------
  private unlink(p: number) {
    const size = this.chunkSize(p);
    if (size !== this.prevSize(p + size)) this.die('corrupted size vs. prev_size');
    const fd = this.fd(p);
    const bk = this.bk(p);
    if (this.bk(fd) !== p || this.fd(bk) !== p) this.die('corrupted double-linked list');
    this.setBk(fd, bk);
    this.setFd(bk, fd);
    if (!this.inSmall(this.sizeField(p)) && this.fdn(p) !== 0) {
      if (this.bkn(this.fdn(p)) !== p || this.fdn(this.bkn(p)) !== p) this.die('corrupted double-linked list (not small)');
      if (this.fdn(fd) === 0) {
        if (this.fdn(p) === p) { this.setFdn(fd, fd); this.setBkn(fd, fd); }
        else {
          this.setFdn(fd, this.fdn(p)); this.setBkn(fd, this.bkn(p));
          this.setBkn(this.fdn(p), fd); this.setFdn(this.bkn(p), fd);
        }
      } else {
        this.setBkn(this.fdn(p), this.bkn(p));
        this.setFdn(this.bkn(p), this.fdn(p));
      }
    }
  }

  private consolidate() {
    this.setHaveFast(false);
    const unsorted = this.unsorted();
    for (let i = 0; i < 10; i++) {
      const fb = this.fastHead(i);
      let p = this.rd(fb);
      if (p === 0) continue;
      this.wr(fb, 0);
      while (p !== 0) {
        if (p % 16 !== 0) this.die('malloc_consolidate(): unaligned fastbin chunk detected');
        const nextp = this.reveal(p + 16, this.rd(p + 16));
        let size = this.chunkSize(p);
        const nextchunk = p + size;
        const nextsize = this.chunkSize(nextchunk);
        let c = p;
        if (!this.prevInuse(c)) {
          const ps = this.prevSize(c);
          size += ps;
          c -= ps;
          if (this.chunkSize(c) !== ps) this.die('corrupted size vs. prev_size in fastbins');
          this.unlink(c);
        }
        if (nextchunk !== this.top) {
          const nextinuse = this.inuseAt(nextchunk, nextsize);
          if (!nextinuse) { size += nextsize; this.unlink(nextchunk); }
          else this.clearInuseAt(nextchunk, 0);
          const firstUnsorted = this.fd(unsorted);
          this.setFd(unsorted, c);
          this.setBk(firstUnsorted, c);
          if (!this.inSmall(size)) { this.setFdn(c, 0); this.setBkn(c, 0); }
          this.setHead(c, size | PREV_INUSE);
          this.setBk(c, unsorted);
          this.setFd(c, firstUnsorted);
          this.setFoot(c, size);
          this.stFreeBin(c);
        } else {
          const old = this.top;
          size += nextsize;
          this.setHead(c, size | PREV_INUSE);
          this.top = c;
          this.mem.setState(c + 16, old + 16 - (c + 16), S.Unalloc);
        }
        p = nextp;
      }
    }
  }

  // ---- free -----------------------------------------------------------------------------------------------
  free(user: number, how: string) {
    if (user === 0) return;
    const rec = this.live.get(user);
    const c = user - 16;
    if (!this.inited) this.die('free(): invalid pointer');
    // glibc validates only what it can see in memory: a wrong pointer is detected by luck, not by bookkeeping
    const size = this.chunkSize(c);
    if (user % 16 !== 0 || user > 0xffffffffffff) this.die('free(): invalid pointer');
    if (size < MINSIZE || size % 16 !== 0) this.die('free(): invalid size');
    if (rec) this.release(user, how);
    this.intFree(c, size);
  }

  private intFree(c: number, size: number) {
    const idx = this.tcIdx(size);
    if (idx < TCACHE_BINS) {
      const e = c + 16;
      if (this.mem.rd64b(e + 8) === TCACHE_KEY) {
        let tmp = this.rd(this.tcacheEntryAddr(idx));
        let cnt = 0;
        while (tmp !== 0) {
          if (cnt >= TCACHE_COUNT) this.die('free(): too many chunks detected in tcache');
          if (tmp % 16 !== 0) this.die('free(): unaligned chunk detected in tcache 2');
          if (tmp === e) this.die('free(): double free detected in tcache 2');
          tmp = this.reveal(tmp, this.rd(tmp));
          cnt++;
        }
      }
      if (this.tcCount(idx) < TCACHE_COUNT) { this.tcachePut(c, idx); return; }
    }

    if (size <= MAX_FAST) {
      const next = c + size;
      if (this.sizeField(next) <= 16 || this.chunkSize(next) >= this.systemMem) this.die('free(): invalid next size (fast)');
      this.setHaveFast(true);
      const fidx = this.fastIdx(size);
      const fb = this.fastHead(fidx);
      const old = this.rd(fb);
      if (old === c) this.die('double free or corruption (fasttop)');
      this.wr(c + 16, this.protect(c + 16, old));
      this.wr(fb, c);
      if (old !== 0 && this.fastIdx(this.chunkSize(old)) !== fidx) this.die('invalid fastbin entry (free)');
      this.stFreeSmall(c);
      return;
    }

    let p = c;
    let sz = size;
    const nextchunk = p + sz;
    if (p === this.top) this.die('double free or corruption (top)');
    const topc = this.top;
    if (nextchunk >= topc + this.chunkSize(topc)) this.die('double free or corruption (out)');
    if (!this.prevInuse(nextchunk)) this.die('double free or corruption (!prev)');
    const nextsize = this.chunkSize(nextchunk);
    if (this.sizeField(nextchunk) <= 16 || nextsize >= this.systemMem) this.die('free(): invalid next size (normal)');
    if (!this.prevInuse(p)) {
      const ps = this.prevSize(p);
      sz += ps;
      p -= ps;
      if (this.chunkSize(p) !== ps) this.die('corrupted size vs. prev_size while consolidating');
      this.unlink(p);
    }
    if (nextchunk !== this.top) {
      const nextinuse = this.inuseAt(nextchunk, nextsize);
      if (!nextinuse) { this.unlink(nextchunk); sz += nextsize; }
      else this.clearInuseAt(nextchunk, 0);
      const unsorted = this.unsorted();
      const fwd = this.fd(unsorted);
      if (this.bk(fwd) !== unsorted) this.die('free(): corrupted unsorted chunks');
      this.setFd(p, fwd);
      this.setBk(p, unsorted);
      if (!this.inSmall(sz)) { this.setFdn(p, 0); this.setBkn(p, 0); }
      this.setFd(unsorted, p);
      this.setBk(fwd, p);
      this.setHead(p, sz | PREV_INUSE);
      this.setFoot(p, sz);
      this.stFreeBin(p);
    } else {
      const old = this.top;
      sz += nextsize;
      this.setHead(p, sz | PREV_INUSE);
      this.top = p;
      this.mem.setState(p + 16, old + 16 - (p + 16), S.Unalloc);
      this.mem.setState(p + 8, 8, S.Meta);
    }
    if (sz >= FASTBIN_CONSOLIDATION_THRESHOLD) {
      if (this.haveFast()) this.consolidate();
      const topsz = this.chunkSize(this.top);
      if (topsz >= TRIM_THRESHOLD) this.systrim();
    }
  }

  private systrim() {
    const topc = this.top;
    const topSize = this.chunkSize(topc);
    const area = topSize - MINSIZE - 1;
    if (area <= TOP_PAD) return;
    const extra = Math.floor((area - TOP_PAD) / PAGE) * PAGE;
    if (extra === 0) return;
    this.mem.shrinkHeap(extra);
    this.systemMem -= extra;
    this.setHead(topc, (topSize - extra) | PREV_INUSE);
  }

  // ---- realloc / usable ------------------------------------------------------------------------------------------
  usable(user: number): number {
    if (!this.inited || user === 0) return 0;
    return this.chunkSize(user - 16) - 8;
  }

  /** mirrors glibc's _int_realloc step by step (expand into top, expand into a free neighbour, or move) */
  override realloc(user: number, req: number, how = 'realloc'): number {
    if (user === 0) return this.malloc(req, how);
    if (req === 0) { this.free(user, how); return 0; }
    this.ensureInit();
    const rec = this.live.get(user);
    const oldp = user - 16;
    const oldSize = this.chunkSize(oldp);
    if (user % 16 !== 0 || oldSize < MINSIZE) this.die('realloc(): invalid pointer');
    const nb = this.req2size(req);
    const oldReq = rec ? rec.req : oldSize - 8;
    const next = oldp + oldSize;
    const nextSize = this.chunkSize(next);
    let newp = oldp;
    let newSize = oldSize;
    const finish = (p: number, size: number): number => {
      const rem = size - nb;
      if (rem < MINSIZE) {
        this.setHeadSize(p, size);
        this.setInuseAt(p, size);
      } else {
        const r = p + nb;
        this.setHeadSize(p, nb);
        this.setHead(r, rem | PREV_INUSE);
        this.setInuseAt(r, rem);
        this.mem.setState(r + 8, 8, S.Meta);
        this.intFree(r, rem);
      }
      return p;
    };
    const keep = (p: number) => {
      // same block, new size: keep the bytes that already hold data, mark the rest
      const u = p + 16;
      const cs = this.chunkSize(p);
      const keepLen = Math.min(oldReq, req);
      this.mem.setState(p + 8, 8, S.Meta);
      if (req > keepLen) this.mem.setState(u + keepLen, req - keepLen, S.Uninit);
      if (cs + p + 8 - 0 > u + req) this.mem.setState(u + req, p + cs + 8 - (u + req), S.Pad);
      if (rec) { this.live.delete(user); this.mem.emit({ t: 'free', id: rec.id, how, line: this.mem.line }); }
      this.record(u, req, how);
      return u;
    };
    if (oldSize >= nb) { finish(oldp, oldSize); return keep(oldp); }
    const topc = this.top;
    if (next === topc && oldSize + nextSize >= nb + MINSIZE) {
      const total = oldSize + nextSize;
      this.setHeadSize(oldp, nb);
      const nt = oldp + nb;
      this.top = nt;
      this.setHead(nt, (total - nb) | PREV_INUSE);
      this.mem.setState(nt + 8, 8, S.Meta);
      return keep(oldp);
    }
    if (next !== topc && !this.inuseAt(next, nextSize) && oldSize + nextSize >= nb) {
      this.unlink(next);
      finish(oldp, oldSize + nextSize);
      return keep(oldp);
    }
    const np = this.intMalloc(req, nb);
    if (!np) return 0;
    const nc = np - 16;
    if (nc === next) {
      // the new chunk is the neighbour (carved from the top): glue it onto the old block instead of copying
      newSize = this.chunkSize(nc) + oldSize;
      newp = oldp;
      this.mem.setState(user + oldReq, np + req - (user + oldReq), S.Uninit);
      finish(newp, newSize);
      return keep(newp);
    }
    this.mem.copy(np, user, Math.min(oldReq, req), false);
    this.record(np, req, how);
    this.free(user, how);
    return np;
  }

  // ---- introspection for the UI / allocator lab ------------------------------------------------------------------
  freeLists() {
    const out: Array<{ name: string; chunks: Array<{ user: number; size: number }> }> = [];
    if (!this.inited) return out;
    for (let i = 0; i < TCACHE_BINS; i++) {
      if (this.tcCount(i) === 0) continue;
      const chunks: Array<{ user: number; size: number }> = [];
      let e = this.rd(this.tcacheEntryAddr(i));
      let n = 0;
      while (e !== 0 && n++ < 8) { chunks.push({ user: e, size: this.chunkSize(e - 16) }); e = this.reveal(e, this.rd(e)); }
      out.push({ name: `tcache[${i}] (${i * 16 + 32} B chunks)`, chunks });
    }
    for (let i = 0; i < 10; i++) {
      let p = this.rd(this.fastHead(i));
      if (p === 0) continue;
      const chunks: Array<{ user: number; size: number }> = [];
      let n = 0;
      while (p !== 0 && n++ < 64) { chunks.push({ user: p + 16, size: this.chunkSize(p) }); p = this.reveal(p + 16, this.rd(p + 16)); }
      out.push({ name: `fastbin[${i}] (${(i + 2) * 16} B)`, chunks });
    }
    for (let i = 1; i < 127; i++) {
      const bin = this.binAt(i);
      let p = this.fd(bin);
      if (p === bin) continue;
      const chunks: Array<{ user: number; size: number }> = [];
      let n = 0;
      while (p !== bin && n++ < 256) { chunks.push({ user: p + 16, size: this.chunkSize(p) }); p = this.fd(p); }
      out.push({ name: i === 1 ? 'unsorted bin' : i < 64 ? `smallbin[${i}] (${i * 16} B)` : `largebin[${i}]`, chunks });
    }
    return out;
  }

  /** consistency check used by the tests: returns a description of the first broken invariant */
  audit(): string | null {
    if (!this.inited) return null;
    const binned = new Set<number>();
    for (let i = 1; i < 127; i++) {
      const bin = this.binAt(i);
      let p = this.fd(bin);
      let n = 0;
      while (p !== bin && n++ < 5000) { binned.add(p); p = this.fd(p); }
    }
    let c = this.base + 0x290;
    const top = this.top;
    let prevFree = false;
    let guard = 0;
    while (c < top && guard++ < 100000) {
      const size = this.chunkSize(c);
      if (size < MINSIZE) return `chunk 0x${(c - this.base).toString(16)} has size ${size}`;
      const next = c + size;
      const nextPrev = (this.sizeField(next) & PREV_INUSE) !== 0;
      const isFree = !nextPrev;
      if (isFree && !binned.has(c)) return `chunk +0x${(c - this.base).toString(16)} size 0x${size.toString(16)} looks free (next.prev_inuse=0) but is in no bin`;
      if (!isFree && binned.has(c)) return `chunk +0x${(c - this.base).toString(16)} size 0x${size.toString(16)} is in a bin but next.prev_inuse=1`;
      if (isFree && prevFree) return `adjacent free chunks at +0x${(c - this.base).toString(16)}`;
      if (isFree && this.prevSize(next) !== size) return `chunk +0x${(c - this.base).toString(16)} foot mismatch`;
      prevFree = isFree;
      c = next;
    }
    if (c !== top) return `chunk walk did not land on top (${c.toString(16)} vs ${top.toString(16)})`;
    return null;
  }

  /** for tests: chunk address + size of the top chunk */
  topInfo() { return { addr: this.top, size: this.chunkSize(this.top) }; }
}
