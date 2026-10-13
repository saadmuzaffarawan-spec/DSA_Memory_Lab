// Simulated process memory: segments + one shadow byte per byte + an invertible journal.
import type { Platform } from './platform';
import { S, type Diag, type DiagCode, type Ev } from './trace';

export type FaultKind = 'segv' | 'stack-overflow' | 'abort' | 'div-zero' | 'uncaught' | 'oom' | 'assert' | 'limit' | 'exit';

/** A fatal stop of the simulated program (what the OS or the C runtime would do). */
export class Fault extends Error {
  constructor(public kind: FaultKind, message: string, public addr?: number, public code = 1) {
    super(message);
    this.name = 'Fault';
  }
}

export type SegName = 'text' | 'rodata' | 'data' | 'bss' | 'heap' | 'stack' | 'sys' | 'libc';

export interface Segment {
  name: SegName;
  base: number;
  size: number;
  /** bytes that are currently mapped (the heap grows like brk; everything else is fully mapped) */
  mapped: number;
  writable: boolean;
  bytes: Uint8Array;
  shadow: Uint8Array;
}

export interface AccessInfo { seg: Segment; off: number }

export class Memory {
  segs: Segment[] = [];
  heap!: Segment;
  stack!: Segment;
  events: Ev[] = [];
  eventLimit = 600_000;
  truncated = false;
  line = 0;
  diagCount = new Map<string, number>();
  diags: Diag[] = [];
  /** when > 0, writes are applied but not journalled (used while loading the program image) */
  private silent = 0;
  private last: Segment;

  constructor(public plat: Platform) {
    const mk = (name: SegName, base: number, size: number, writable: boolean, mapped = size): Segment => {
      const s: Segment = { name, base, size, mapped, writable, bytes: new Uint8Array(size), shadow: new Uint8Array(size) };
      this.segs.push(s);
      return s;
    };
    const im = plat.image;
    mk('text', im.text, im.textSize, false);
    mk('rodata', im.rodata, im.rodataSize, false);
    mk('data', im.data, im.dataSize, true);
    mk('bss', im.bss, im.bssSize, true);
    this.heap = mk('heap', plat.heap.base, plat.heap.size, true, 0);
    this.stack = mk('stack', plat.stack.top - plat.stack.size, plat.stack.size, true);
    mk('sys', plat.sys.base, plat.sys.size, false);
    mk('libc', plat.libc.base, plat.libc.size, true);
    this.last = this.stack;
  }

  // ---- segment lookup -------------------------------------------------------------------------
  seg(a: number): Segment | null {
    const l = this.last;
    if (a >= l.base && a < l.base + l.size) return l;
    for (const s of this.segs) if (a >= s.base && a < s.base + s.size) { this.last = s; return s; }
    return null;
  }

  segName(a: number): string {
    const s = this.seg(a);
    return s ? s.name : 'unmapped';
  }

  /** map `n` more bytes of heap (like brk) */
  growHeap(n: number): boolean {
    if (this.heap.mapped + n > this.heap.size) return false;
    this.emit({ t: 'brk', from: this.heap.mapped, to: this.heap.mapped + n });
    this.heap.mapped += n;
    return true;
  }

  /** give memory back to the OS (brk shrink): the pages are zeroed when they are mapped again */
  shrinkHeap(n: number) {
    const to = this.heap.mapped - n;
    this.fill(this.heap.base + to, n, 0, S.Unalloc);
    this.emit({ t: 'brk', from: this.heap.mapped, to });
    this.heap.mapped = to;
  }

  // ---- 64-bit helpers for allocators (no diagnostics) ----------------------------------------------
  rd64(a: number): number { return Number(this.rd64b(a)); }
  rd64b(a: number): bigint {
    const { seg, off } = this.locate(a, 8, false);
    return new DataView(seg.bytes.buffer, seg.bytes.byteOffset + off, 8).getBigUint64(0, true);
  }
  rd16(a: number): number {
    const { seg, off } = this.locate(a, 2, false);
    return new DataView(seg.bytes.buffer, seg.bytes.byteOffset + off, 2).getUint16(0, true);
  }
  rd32(a: number): number {
    const { seg, off } = this.locate(a, 4, false);
    return new DataView(seg.bytes.buffer, seg.bytes.byteOffset + off, 4).getUint32(0, true);
  }
  wr64(a: number, v: number | bigint, st: number = S.Meta) {
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, BigInt.asUintN(64, BigInt(v)), true);
    this.writeRaw(a, b, st);
  }
  wr32(a: number, v: number, st: number = S.Meta) {
    const b = new Uint8Array(4);
    new DataView(b.buffer).setUint32(0, v >>> 0, true);
    this.writeRaw(a, b, st);
  }
  wr16(a: number, v: number, st: number = S.Meta) {
    const b = new Uint8Array(2);
    new DataView(b.buffer).setUint16(0, v & 0xffff, true);
    this.writeRaw(a, b, st);
  }

  private locate(a: number, len: number, write: boolean): AccessInfo {
    const s = this.seg(a);
    if (!s) this.segv(a, write);
    const off = a - s!.base;
    const limit = s!.name === 'heap' ? s!.mapped : s!.size;
    if (off + len > limit) {
      // runs off the end of the mapping
      if (s!.name === 'stack' && a + len > this.stack.base + this.stack.size) this.segv(a + len, write);
      this.segv(a + Math.max(0, limit - off), write);
    }
    if (write && !s!.writable) throw new Fault('segv', this.plat.faultName + ` — write to read-only ${s!.name} segment at 0x${a.toString(16)}`, a, 139);
    return { seg: s!, off };
  }

  private segv(a: number, write: boolean): never {
    const st = this.stack;
    // just below the stack mapping => the stack ran out (recursion that never ends)
    if (a < st.base && a >= st.base - 0x100000) {
      const win = this.plat.id === 'windows';
      throw new Fault('stack-overflow', win ? 'Stack overflow (0xC00000FD)' : this.plat.faultName + ' — stack overflow (the 8 MB stack is exhausted)', a, win ? 0xC00000FD : 139);
    }
    const what = a < 0x10000 ? 'null pointer dereference' : 'address is not mapped';
    throw new Fault('segv', `${this.plat.faultName} — ${write ? 'write to' : 'read from'} 0x${a.toString(16)} (${what})`, a, this.plat.id === 'windows' ? 0xC0000005 : 139);
  }

  // ---- journal ---------------------------------------------------------------------------------
  emit(e: Ev) {
    if (this.silent) return;
    if (this.events.length >= this.eventLimit) {
      if (!this.truncated) { this.truncated = true; }
      throw new Fault('limit', `Trace limit reached (${this.eventLimit.toLocaleString()} events). The program was stopped so the visualiser stays responsive.`, undefined, 0);
    }
    this.events.push(e);
  }

  withSilence<T>(f: () => T): T {
    this.silent++;
    try { return f(); } finally { this.silent--; }
  }

  diag(code: DiagCode, severity: Diag['severity'], title: string, body: string, addr?: number, len?: number, dedupe = true) {
    const key = code + ':' + (addr ?? '') + ':' + this.line;
    if (dedupe) {
      const n = this.diagCount.get(key) ?? 0;
      this.diagCount.set(key, n + 1);
      if (n > 0) return;
    }
    const d: Diag = { code, severity, title, body, addr, len, line: this.line };
    this.diags.push(d);
    if (this.diags.length < 500) this.emit({ t: 'diag', d });
  }

  // ---- raw access (no diagnostics) ----------------------------------------------------------------
  readRaw(a: number, len: number): Uint8Array {
    const { seg, off } = this.locate(a, len, false);
    return seg.bytes.subarray(off, off + len);
  }

  stateAt(a: number): number {
    const s = this.seg(a);
    if (!s) return S.Unalloc;
    return s.shadow[a - s.base];
  }

  /** write bytes and shadow (journalled). `st` may be a single state or a per-byte array */
  writeRaw(a: number, src: Uint8Array, st: number | Uint8Array) {
    const len = src.length;
    if (len === 0) return;
    const { seg, off } = this.locate(a, len, true);
    this.put(seg, off, src, st);
  }

  /** same as writeRaw but ignores the read-only flag (used to load the program image) */
  loadImage(a: number, src: Uint8Array, st: number) {
    const s = this.seg(a);
    if (!s) throw new Error('loadImage: unmapped');
    this.put(s, a - s.base, src, st);
  }

  private put(seg: Segment, off: number, src: Uint8Array, st: number | Uint8Array) {
    const len = src.length;
    if (!this.silent) {
      const o = seg.bytes.slice(off, off + len);
      const os = seg.shadow.slice(off, off + len);
      const n = src.slice();
      const ns = typeof st === 'number' ? new Uint8Array(len).fill(st) : st.slice();
      this.emit({ t: 'w', a: seg.base + off, o, n, os, ns });
      seg.bytes.set(n, off);
      seg.shadow.set(ns, off);
    } else {
      seg.bytes.set(src, off);
      if (typeof st === 'number') seg.shadow.fill(st, off, off + len);
      else seg.shadow.set(st, off);
    }
  }

  /** set only the shadow state (journalled), keeping the bytes */
  setState(a: number, len: number, st: number) {
    if (len <= 0) return;
    const { seg, off } = this.locate(a, len, false);
    let same = true;
    for (let i = 0; i < len; i++) if (seg.shadow[off + i] !== st) { same = false; break; }
    if (same) return;
    this.put(seg, off, seg.bytes.slice(off, off + len), st);
  }

  /** fill with a byte pattern (journalled) */
  fill(a: number, len: number, byte: number, st: number | null = null) {
    if (len <= 0) return;
    const { seg, off } = this.locate(a, len, true);
    const src = new Uint8Array(len).fill(byte);
    this.put(seg, off, src, st === null ? seg.shadow.slice(off, off + len) : st);
  }

  // ---- typed access used by the interpreter (with diagnostics) --------------------------------------
  /** read `len` bytes as the program would; flags uninitialised / freed / dead memory */
  read(a: number, len: number, what = 'value'): Uint8Array {
    const { seg, off } = this.locate(a, len, false);
    this.checkRead(seg, off, len, a, what);
    this.emit({ t: 'r', a, l: len });
    return seg.bytes.slice(off, off + len);
  }

  private checkRead(seg: Segment, off: number, len: number, a: number, what: string) {
    let st = -1;
    for (let i = 0; i < len; i++) {
      const s = seg.shadow[off + i];
      if (s === S.Init || s === S.Pad) continue;
      st = s; break;
    }
    if (st < 0) return;
    const hex = '0x' + a.toString(16);
    switch (st) {
      case S.Uninit:
        this.diag('uninit-read', 'warn', 'Reading uninitialised memory', `The ${what} at ${hex} was never assigned. You are seeing whatever bytes happened to be there${this.plat.debug && seg.name === 'stack' ? ' (the Debug build pre-filled it with 0xCC)' : ''}.`, a, len);
        break;
      case S.Freed:
        this.diag('use-after-free', 'error', 'Use after free', `The ${what} at ${hex} was freed. The memory may already belong to someone else or hold allocator bookkeeping.`, a, len);
        break;
      case S.Dead:
        this.diag('dangling-stack', 'error', 'Dangling stack pointer', `The ${what} at ${hex} lived in a stack frame (or scope) that has ended. The bytes are still there but will be overwritten by the next call.`, a, len);
        break;
      case S.Meta:
        this.diag('write-metadata', 'warn', 'Reading allocator metadata', `The bytes at ${hex} belong to the memory allocator (a chunk header or free-list link), not to your data.`, a, len);
        break;
      default:
        if (seg.name === 'heap') this.diag('heap-overflow', 'error', 'Out-of-bounds heap read', `${hex} is inside the heap but outside every live allocation.`, a, len);
        else this.diag('out-of-bounds', 'warn', 'Reading memory that is not part of any object', `${hex} is mapped (so the CPU allows it) but it is not part of any variable.`, a, len);
    }
  }

  /** write as the program would: bytes become Init when they belong to a live object */
  write(a: number, src: Uint8Array, what = 'value') {
    const len = src.length;
    const { seg, off } = this.locate(a, len, true);
    const ns = new Uint8Array(len);
    let bad = -1;
    for (let i = 0; i < len; i++) {
      const s = seg.shadow[off + i];
      if (s === S.Uninit || s === S.Init) ns[i] = S.Init;
      else { ns[i] = s === S.Pad ? S.Pad : s; if (bad < 0 && s !== S.Pad) bad = s; }
    }
    if (bad >= 0) this.badWrite(seg, bad, a, len, what);
    this.put(seg, off, src, ns);
  }

  private badWrite(seg: Segment, st: number, a: number, len: number, what: string) {
    const hex = '0x' + a.toString(16);
    switch (st) {
      case S.Freed: this.diag('use-after-free', 'error', 'Write after free', `Writing the ${what} at ${hex} into freed memory corrupts whatever the allocator puts there next.`, a, len); break;
      case S.Dead: this.diag('dangling-stack', 'error', 'Write through a dangling stack pointer', `The ${what} at ${hex} was written into a stack slot that is no longer in use.`, a, len); break;
      case S.Meta: this.diag('write-metadata', 'error', 'Overwrote allocator metadata', `The write at ${hex} landed on the allocator's bookkeeping. The next malloc or free is likely to crash or misbehave.`, a, len); break;
      default:
        if (seg.name === 'heap') this.diag('heap-overflow', 'error', 'Heap buffer overflow', `The write at ${hex} is past the end of its allocation. Nothing stopped the CPU: it silently damaged neighbouring memory.`, a, len);
        else this.diag('stack-overflow-write', 'error', 'Out-of-bounds write', `The write at ${hex} is not inside any object. It may have damaged a neighbouring variable, a saved register or the return address.`, a, len);
    }
  }

  /** copy bytes and per-byte states (memcpy / struct copy / vector relocation) */
  copy(dst: number, src: number, len: number, checkSrc = true) {
    if (len <= 0) return;
    const s = this.locate(src, len, false);
    if (checkSrc) this.checkRead(s.seg, s.off, len, src, 'source bytes');
    this.emit({ t: 'r', a: src, l: len });
    const bytes = s.seg.bytes.slice(s.off, s.off + len);
    const states = s.seg.shadow.slice(s.off, s.off + len);
    const d = this.locate(dst, len, true);
    const ns = new Uint8Array(len);
    let bad = -1;
    for (let i = 0; i < len; i++) {
      const cur = d.seg.shadow[d.off + i];
      if (cur === S.Uninit || cur === S.Init || cur === S.Pad) ns[i] = states[i] === S.Pad ? S.Pad : states[i] === S.Uninit ? S.Uninit : cur === S.Pad && states[i] === S.Init ? S.Pad : S.Init;
      else { ns[i] = cur; if (bad < 0) bad = cur; }
    }
    if (bad >= 0) this.badWrite(d.seg, bad, dst, len, 'copied bytes');
    this.put(d.seg, d.off, bytes, ns);
  }

  // ---- integers / floats ----------------------------------------------------------------------------
  loadInt(a: number, bytes: number, signed: boolean, what?: string): bigint {
    const b = this.read(a, bytes, what);
    let v = 0n;
    for (let i = bytes - 1; i >= 0; i--) v = (v << 8n) | BigInt(b[i]);
    if (signed) { const sh = BigInt(bytes * 8); if (v >> (sh - 1n)) v -= 1n << sh; }
    return v;
  }

  storeInt(a: number, bytes: number, v: bigint, what?: string) {
    const b = new Uint8Array(bytes);
    let x = BigInt.asUintN(bytes * 8, v);
    for (let i = 0; i < bytes; i++) { b[i] = Number(x & 0xffn); x >>= 8n; }
    this.write(a, b, what);
  }

  loadFloat(a: number, bytes: number, what?: string): number {
    const b = this.read(a, bytes, what);
    return decodeFloat(b, bytes);
  }

  storeFloat(a: number, bytes: number, v: number, what?: string) {
    this.write(a, encodeFloat(v, bytes), what);
  }

  /** NUL-terminated string (no diagnostics on the terminator search beyond the first bad byte) */
  readCString(a: number, max = 1 << 16): string {
    let s = '';
    for (let i = 0; i < max; i++) {
      const c = this.readRaw(a + i, 1)[0];
      if (c === 0) break;
      s += String.fromCharCode(c);
    }
    return s;
  }
}

const f32 = new Float32Array(1);
const f64 = new Float64Array(1);
const u8_32 = new Uint8Array(f32.buffer);
const u8_64 = new Uint8Array(f64.buffer);

export function encodeFloat(v: number, bytes: number): Uint8Array {
  if (bytes === 4) { f32[0] = v; return u8_32.slice(); }
  if (bytes === 8) { f64[0] = v; return u8_64.slice(); }
  // long double: x87 80-bit extended in 16 bytes (Linux/macOS)
  return encodeX87(v);
}

export function decodeFloat(b: Uint8Array, bytes: number): number {
  if (bytes === 4) { u8_32.set(b.subarray(0, 4)); return f32[0]; }
  if (bytes === 8) { u8_64.set(b.subarray(0, 8)); return f64[0]; }
  return decodeX87(b);
}

function encodeX87(v: number): Uint8Array {
  const out = new Uint8Array(16);
  if (v === 0) { if (Object.is(v, -0)) out[9] = 0x80; return out; }
  if (!Number.isFinite(v)) {
    out[7] = 0x80; out[8] = 0xff; out[9] = Number.isNaN(v) ? 0x7f : v < 0 ? 0xff : 0x7f;
    if (Number.isNaN(v)) out[6] = 0xc0;
    return out;
  }
  f64[0] = Math.abs(v);
  const hi = (u8_64[7] << 4) | (u8_64[6] >> 4);
  let exp = hi & 0x7ff;
  let mant = 0n;
  for (let i = 6; i >= 0; i--) mant = (mant << 8n) | BigInt(i === 6 ? u8_64[i] & 0x0f : u8_64[i]);
  mant |= 1n << 52n;
  if (exp === 0) { // subnormal double -> normalise
    let m = mant & ((1n << 52n) - 1n); let e = 1;
    while (!(m & (1n << 52n))) { m <<= 1n; e--; }
    mant = m; exp = e;
  }
  const e80 = exp - 1023 + 16383;
  const m64 = mant << 11n; // 53 -> 64 bits with explicit integer bit
  let x = m64;
  for (let i = 0; i < 8; i++) { out[i] = Number(x & 0xffn); x >>= 8n; }
  const se = e80 | (v < 0 ? 0x8000 : 0);
  out[8] = se & 0xff; out[9] = se >> 8;
  return out;
}

function decodeX87(b: Uint8Array): number {
  let m = 0n;
  for (let i = 7; i >= 0; i--) m = (m << 8n) | BigInt(b[i]);
  const se = b[8] | (b[9] << 8);
  const neg = se & 0x8000;
  const e = se & 0x7fff;
  if (e === 0 && m === 0n) return neg ? -0 : 0;
  if (e === 0x7fff) return (m << 1n) === 0n ? (neg ? -Infinity : Infinity) : NaN;
  const val = Number(m) * Math.pow(2, e - 16383 - 63);
  return neg ? -val : val;
}

/** hex helper for messages */
export const hex = (n: number | bigint) => '0x' + n.toString(16);
