// The "C library" of the simulated machine: functions that have no C++ body in the prelude.
// A native receives the raw argument values (not yet converted to the declared parameter types) and the object it was called on.
import { Fault } from './memory';
import type { Interp } from './interp';
import type { NativeFn, V } from './env';
import { callFnValue, invokeFn } from './call';
import { formatPrintf, fmtExp, fmtFixed, fmtG, nonFinite, pointerText } from './fmt';
import { S } from './trace';
import { sizeOf } from './layout';
import { throwStd } from './expr';
import { arrOf, type Type } from './types';

type NT = NativeFn;

const addrOf = (I: Interp, v: V): number => Number(BigInt.asUintN(64, I.toBig(I.rv(v))));
const intOf = (I: Interp, v: V): number => Number(I.toBig(I.rv(v)));
const bigOf = (I: Interp, v: V): bigint => I.toBig(I.rv(v));
const numOf = (I: Interp, v: V): number => I.toNumber(I.rv(v));

function isCharPtr(t: Type): boolean {
  return t.k === 'ptr' && t.to.k === 'int' && t.to.bytes === 1 && t.to.nm.includes('char');
}

/** call a function value or a function pointer with arguments */
export function callPtr(I: Interp, f: V, args: V[]): V {
  if (f.k === 'fn') return callFnValue(I, f, args);
  const x = I.rv(f);
  if (x.k === 'i') {
    const fn = I.fnByAddr.get(Number(x.v));
    if (!fn) throw new Fault('segv', `${I.plat.faultName} — call through an invalid function pointer 0x${x.v.toString(16)}`, Number(x.v), I.plat.id === 'windows' ? 0xC0000005 : 139);
    return invokeFn(I, fn, undefined, args, undefined);
  }
  I.cerr('this value is not callable');
}

// ---- random numbers --------------------------------------------------------------------------------------------------------------
class GlibcRand {
  r: number[] = [];
  idx = 0;
  seed(s: number) {
    if (s === 0) s = 1;
    const r: number[] = new Array(34);
    r[0] = s | 0;
    for (let i = 1; i < 31; i++) {
      const hi = Math.trunc(r[i - 1] / 127773), lo = r[i - 1] % 127773;
      let w = 16807 * lo - 2836 * hi;
      if (w < 0) w += 2147483647;
      r[i] = w;
    }
    for (let i = 31; i < 34; i++) r[i] = r[i - 31];
    this.r = r;
    for (let i = 34; i < 344; i++) this.r[i] = (this.r[i - 31] + this.r[i - 3]) >>> 0;
  }
  next(): number {
    const n = this.r.length;
    const o = (this.r[n - 31] + this.r[n - 3]) >>> 0;
    this.r.push(o);
    if (this.r.length > 4096) this.r.splice(0, this.r.length - 64);
    return o >>> 1;
  }
}

const state = new WeakMap<Interp, { g: GlibcRand; seed: number }>();
function rnd(I: Interp) {
  let s = state.get(I);
  if (!s) { s = { g: new GlibcRand(), seed: 1 }; s.g.seed(1); state.set(I, s); }
  return s;
}

function randNext(I: Interp): number {
  const s = rnd(I);
  if (I.plat.id === 'windows') {
    s.seed = (Math.imul(s.seed, 214013) + 2531011) >>> 0;
    return (s.seed >>> 16) & 0x7fff;
  }
  if (I.plat.id === 'macos') {
    // minimal standard generator (Park–Miller), as used by BSD rand()
    s.seed = Number((BigInt(s.seed) * 16807n) % 2147483647n);
    return s.seed;
  }
  return s.g.next();
}

// ---- helpers for streams ---------------------------------------------------------------------------------------------------------------
export const FLAG = { hex: 1, oct: 2, fixed: 4, scientific: 8, showpos: 16, boolalpha: 32, left: 64, uppercase: 128, showbase: 256, internal: 512 };

function sgetInt(I: Interp, a: number, bytes = 4): number { return Number(I.mem.loadInt(a, bytes, true, 'stream state')); }
function sputInt(I: Interp, a: number, v: number, bytes = 4) { I.mem.storeInt(a, bytes, BigInt(v), 'stream state'); }

/** offsets of the fields inside the prelude's std::ostream */
const OS = { flags: 0, prec: 4, width: 8, fill: 12, fd: 16 };
const IS = { state: 20, gcount: 24 };

function formatForStream(I: Interp, os: number, arg: V): string {
  const x = I.rv(arg);
  const flags = sgetInt(I, os + OS.flags);
  const prec = sgetInt(I, os + OS.prec);
  const P = I.plat;
  if (x.k === 'f') {
    const nf = nonFinite(x.v, P, !!(flags & FLAG.uppercase));
    if (nf) return nf;
    const sign = x.v < 0 || Object.is(x.v, -0) ? '-' : flags & FLAG.showpos ? '+' : '';
    const ax = Math.abs(x.v);
    let body: string;
    if (flags & FLAG.fixed && flags & FLAG.scientific) body = ax.toString(16);
    else if (flags & FLAG.fixed) body = fmtFixed(ax, prec);
    else if (flags & FLAG.scientific) body = fmtExp(ax, prec, !!(flags & FLAG.uppercase));
    else body = fmtG(ax, prec, !!(flags & 0x400), !!(flags & FLAG.uppercase));
    return sign + body;
  }
  if (x.k !== 'i') return '?';
  const t = x.t;
  if (t.k === 'bool') {
    if (flags & FLAG.boolalpha) return x.v ? 'true' : 'false';
    return x.v ? '1' : '0';
  }
  if (t.k === 'ptr') {
    if (isCharPtr(t)) return x.v === 0n ? '' : I.cstr(Number(x.v), 'string');
    return pointerText(P, x.v, false);
  }
  if (t.k === 'nullptr') return pointerText(P, 0n, false);
  if (t.k === 'int' && t.bytes === 1 && t.nm.includes('char')) return String.fromCharCode(Number(BigInt.asUintN(8, x.v)));
  if (t.k === 'int' && (t.nm === 'char16_t' || t.nm === 'char32_t' || t.nm === 'wchar_t')) return String.fromCodePoint(Number(x.v));
  let v = x.v;
  const signed = t.k === 'int' ? t.signed : t.k === 'enum' ? true : false;
  let digits: string;
  let prefix = '';
  if (flags & FLAG.hex) {
    const bits = t.k === 'int' ? t.bytes * 8 : 32;
    const u = BigInt.asUintN(bits, v);
    digits = u.toString(16);
    if (flags & FLAG.uppercase) digits = digits.toUpperCase();
    if (flags & FLAG.showbase && u !== 0n) prefix = flags & FLAG.uppercase ? '0X' : '0x';
  } else if (flags & FLAG.oct) {
    const bits = t.k === 'int' ? t.bytes * 8 : 32;
    const u = BigInt.asUintN(bits, v);
    digits = u.toString(8);
    if (flags & FLAG.showbase && u !== 0n) prefix = '0';
  } else {
    if (!signed) v = BigInt.asUintN(t.k === 'int' ? t.bytes * 8 : 32, v);
    const neg = v < 0n;
    digits = (neg ? -v : v).toString();
    prefix = neg ? '-' : flags & FLAG.showpos ? '+' : '';
  }
  return prefix + digits;
}

function streamWrite(I: Interp, os: number, s: string, numeric: boolean) {
  const width = sgetInt(I, os + OS.width);
  const flags = sgetInt(I, os + OS.flags);
  const fill = String.fromCharCode(Number(I.mem.loadInt(os + OS.fill, 1, false, 'stream state')));
  let out = s;
  if (width > 0) {
    const len = Array.from(s).length;
    if (len < width) {
      const padn = width - len;
      if (flags & FLAG.left) out = s + fill.repeat(padn);
      else if (flags & FLAG.internal && numeric) {
        const m = /^([+-]?(?:0[xX])?)(.*)$/.exec(s)!;
        out = m[1] + fill.repeat(padn) + m[2];
      } else out = fill.repeat(padn) + s;
    }
    sputInt(I, os + OS.width, 0);
  }
  const fd = sgetInt(I, os + OS.fd);
  if (fd >= 100) { const ss = I.sstreams.get(fd); if (ss) ss.text += out; return; }
  I.print(out, fd === 2);
}

// ---- cin parsing -----------------------------------------------------------------------------------------------------------------------
function peekc(I: Interp): number { return I.stdinPos < I.stdin.length ? I.stdin.charCodeAt(I.stdinPos) : -1; }
function skipWs(I: Interp) { while (I.stdinPos < I.stdin.length && /\s/.test(I.stdin[I.stdinPos])) I.stdinPos++; }
function setState(I: Interp, is: number, bits: number) { sputInt(I, is + IS.state, sgetInt(I, is + IS.state) | bits); }

function readToken(I: Interp): string {
  skipWs(I);
  const start = I.stdinPos;
  while (I.stdinPos < I.stdin.length && !/\s/.test(I.stdin[I.stdinPos])) I.stdinPos++;
  return I.stdin.slice(start, I.stdinPos);
}

function extractInto(I: Interp, is: number, target: V): void {
  if (target.k !== 'l') I.cerr("operator>> needs a variable on the right-hand side");
  const t = target.t;
  if (sgetInt(I, is + IS.state) & 6) return;
  skipWs(I);
  if (peekc(I) < 0) { setState(I, is, 3); return; }
  if (t.k === 'int' && t.bytes === 1 && t.nm.includes('char')) {
    const c = I.stdin.charCodeAt(I.stdinPos++);
    I.mem.storeInt(target.a, 1, BigInt(c), 'variable');
    return;
  }
  if (t.k === 'int' || t.k === 'enum') {
    const rest = I.stdin.slice(I.stdinPos);
    const m = /^[+-]?\d+/.exec(rest);
    if (!m) { setState(I, is, 2); return; }
    I.stdinPos += m[0].length;
    const bytes = t.k === 'int' ? t.bytes : 4;
    const signed = t.k === 'int' ? t.signed : true;
    let v = BigInt(m[0]);
    const lo = signed ? -(1n << BigInt(bytes * 8 - 1)) : 0n;
    const hi = signed ? (1n << BigInt(bytes * 8 - 1)) - 1n : (1n << BigInt(bytes * 8)) - 1n;
    if (v < lo || v > hi) { v = v < lo ? lo : hi; setState(I, is, 2); }
    I.mem.storeInt(target.a, bytes, v, 'variable');
    if (I.stdinPos >= I.stdin.length) setState(I, is, 1);
    return;
  }
  if (t.k === 'bool') {
    const tok = readToken(I);
    I.mem.storeInt(target.a, 1, tok === '1' ? 1n : 0n, 'variable');
    if (tok !== '0' && tok !== '1') setState(I, is, 2);
    if (I.stdinPos >= I.stdin.length) setState(I, is, 1);
    return;
  }
  if (t.k === 'float') {
    const rest = I.stdin.slice(I.stdinPos);
    const m = /^[+-]?(?:\d+\.?\d*(?:[eE][+-]?\d+)?|\.\d+(?:[eE][+-]?\d+)?|inf|nan)/i.exec(rest);
    if (!m) { setState(I, is, 2); return; }
    I.stdinPos += m[0].length;
    I.store(t, target.a, I.mkFloat(t, parseFloat(m[0])), 'variable');
    if (I.stdinPos >= I.stdin.length) setState(I, is, 1);
    return;
  }
  if (t.k === 'arr' && t.of.k === 'int' && t.of.bytes === 1) {
    const tok = readToken(I);
    const bytes = new TextEncoder().encode(tok);
    const cap = t.n ?? bytes.length + 1;
    const out = new Uint8Array(bytes.length + 1);
    out.set(bytes);
    if (out.length > cap) I.diag('heap-overflow', 'error', 'cin >> into a char array that is too small', `The input "${tok}" needs ${out.length} bytes (with the terminating NUL) but the array holds only ${cap}. The extra bytes overwrite whatever follows the array.`, target.a, out.length);
    I.mem.write(target.a, out, 'char array');
    if (I.stdinPos >= I.stdin.length) setState(I, is, 1);
    return;
  }
  I.cerr(`no operator>> for type '${t.k}'`);
}

function throwBadAlloc(I: Interp): never {
  return throwStd(I, 'bad_alloc', 'std::bad_alloc');
}

// ---- registration ----------------------------------------------------------------------------------------------------------------
export function registerNatives(I: Interp) {
  const T = I.nativeTable;
  const reg = (name: string, f: NT) => T.set(name, f);
  const ret = {
    int: (n: number | bigint) => I.mkInt(I.T.int, BigInt(n)),
    sz: (n: number | bigint) => I.mkInt(I.T.sizeT, BigInt(n)),
    d: (x: number) => I.mkFloat(I.T.double, x),
    ptr: (a: number) => I.mkPtr(I.T.void, a),
    cptr: (a: number) => I.mkPtr(I.T.char, a),
    void: () => I.voidV(),
  };

  // ---- stdio ----
  reg('printf', (I2, a) => {
    const fmt = I2.cstr(addrOf(I2, a[0]), 'format string');
    const s = formatPrintf(I2, fmt, a.slice(1));
    I2.print(s);
    return ret.int(new TextEncoder().encode(s).length);
  });
  reg('fprintf', (I2, a) => {
    const stream = addrOf(I2, a[0]);
    const fmt = I2.cstr(addrOf(I2, a[1]), 'format string');
    const s = formatPrintf(I2, fmt, a.slice(2), 'fprintf');
    I2.print(s, stream !== 0 && Number(I2.mem.loadInt(stream, 4, true, 'FILE')) === 2);
    return ret.int(s.length);
  });
  const writeBuf = (I2: Interp, dst: number, cap: number | null, s: string, what: string): number => {
    const bytes = new TextEncoder().encode(s);
    const n = cap === null ? bytes.length : Math.min(bytes.length, Math.max(0, cap - 1));
    const out = new Uint8Array(cap === 0 ? 0 : n + 1);
    out.set(bytes.subarray(0, n));
    if (out.length) I2.mem.write(dst, out, what);
    return bytes.length;
  };
  reg('sprintf', (I2, a) => ret.int(writeBuf(I2, addrOf(I2, a[0]), null, formatPrintf(I2, I2.cstr(addrOf(I2, a[1]), 'format string'), a.slice(2), 'sprintf'), 'destination buffer')));
  reg('snprintf', (I2, a) => ret.int(writeBuf(I2, addrOf(I2, a[0]), intOf(I2, a[1]), formatPrintf(I2, I2.cstr(addrOf(I2, a[2]), 'format string'), a.slice(3), 'snprintf'), 'destination buffer')));
  reg('puts', (I2, a) => { I2.print(I2.cstr(addrOf(I2, a[0])) + '\n'); return ret.int(1); });
  reg('putchar', (I2, a) => { I2.print(String.fromCharCode(intOf(I2, a[0]) & 0xff)); return a[0]; });
  reg('fflush', () => ret.int(0));
  reg('getchar', (I2) => { if (I2.stdinPos >= I2.stdin.length) return ret.int(-1); return ret.int(I2.stdin.charCodeAt(I2.stdinPos++)); });
  reg('scanf', (I2, a) => {
    const fmt = I2.cstr(addrOf(I2, a[0]), 'format string');
    let n = 0, ai = 1;
    for (let i = 0; i < fmt.length; i++) {
      if (fmt[i] === '%') {
        i++;
        let len = '';
        while ('hlLzjt'.includes(fmt[i])) len += fmt[i++];
        const c = fmt[i];
        const dst = ai < a.length ? addrOf(I2, a[ai++]) : 0;
        if (c === 'c') { if (I2.stdinPos >= I2.stdin.length) return ret.int(n === 0 ? -1 : n); I2.mem.storeInt(dst, 1, BigInt(I2.stdin.charCodeAt(I2.stdinPos++)), 'char'); n++; continue; }
        skipWs(I2);
        if (I2.stdinPos >= I2.stdin.length) return ret.int(n === 0 ? -1 : n);
        const rest = I2.stdin.slice(I2.stdinPos);
        if (c === 'd' || c === 'i' || c === 'u') {
          const m = /^[+-]?\d+/.exec(rest); if (!m) return ret.int(n);
          I2.stdinPos += m[0].length;
          const bytes = len === 'll' || (len === 'l' && I2.plat.longBytes === 8) || len === 'z' ? 8 : len === 'h' ? 2 : len === 'hh' ? 1 : 4;
          I2.mem.storeInt(dst, bytes, BigInt(m[0]), 'variable'); n++;
        } else if (c === 'x' || c === 'X') {
          const m = /^(0[xX])?[0-9a-fA-F]+/.exec(rest); if (!m) return ret.int(n);
          I2.stdinPos += m[0].length; I2.mem.storeInt(dst, 4, BigInt(m[0].startsWith('0') && /^0[xX]/.test(m[0]) ? m[0] : '0x' + m[0]), 'variable'); n++;
        } else if (c === 'f' || c === 'e' || c === 'g' || c === 'lf') {
          const m = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?/.exec(rest); if (!m) return ret.int(n);
          I2.stdinPos += m[0].length;
          if (len === 'l') I2.mem.storeFloat(dst, 8, parseFloat(m[0]), 'variable'); else I2.mem.storeFloat(dst, 4, parseFloat(m[0]), 'variable');
          n++;
        } else if (c === 's') {
          const tok = readToken(I2);
          const bytes = new TextEncoder().encode(tok);
          const out = new Uint8Array(bytes.length + 1); out.set(bytes);
          I2.mem.write(dst, out, 'buffer'); n++;
        }
      } else if (/\s/.test(fmt[i])) skipWs(I2);
    }
    return ret.int(n);
  });

  // ---- operator new / delete and exception message strings ----
  reg('operator new', (I2, a) => { const p = I2.heap.malloc(intOf(I2, a[0]), 'operator new'); if (!p) return throwBadAlloc(I2); return ret.ptr(p); });
  reg('operator new[]', (I2, a) => { const p = I2.heap.malloc(intOf(I2, a[0]), 'operator new[]'); if (!p) return throwBadAlloc(I2); return ret.ptr(p); });
  reg('operator delete', (I2, a) => { const p = addrOf(I2, a[0]); if (p) I2.heap.free(p, 'operator delete'); return ret.void(); });
  reg('operator delete[]', (I2, a) => { const p = addrOf(I2, a[0]); if (p) I2.heap.free(p, 'operator delete[]'); return ret.void(); });
  reg('std::__exc_dup', (I2, a) => {
    const src = addrOf(I2, a[0]);
    if (!src) return ret.cptr(0);
    const s = I2.cstr(src);
    const bytes = new TextEncoder().encode(s + '\0');
    const p = I2.heap.malloc(bytes.length, 'exception string');
    I2.mem.write(p, bytes, 'exception text');
    return ret.cptr(p);
  });
  reg('std::__exc_free', (I2, a) => { const p = addrOf(I2, a[0]); if (p) I2.heap.free(p, 'exception string'); return ret.void(); });

  // ---- stdlib ----
  reg('malloc', (I2, a) => ret.ptr(I2.heap.malloc(intOf(I2, a[0]), 'malloc')));
  reg('calloc', (I2, a) => ret.ptr(I2.heap.calloc(intOf(I2, a[0]), intOf(I2, a[1]))));
  reg('realloc', (I2, a) => ret.ptr(I2.heap.realloc(addrOf(I2, a[0]), intOf(I2, a[1]))));
  reg('free', (I2, a) => { I2.heap.free(addrOf(I2, a[0]), 'free'); return ret.void(); });
  reg('abs', (I2, a) => { const x = I2.rv(a[0]); return x.k === 'f' ? I2.mkFloat(x.t, Math.abs(x.v)) : I2.mkInt(I2.T.int, bigOf(I2, x) < 0n ? -bigOf(I2, x) : bigOf(I2, x)); });
  reg('labs', (I2, a) => I2.mkInt(I2.T.long, bigOf(I2, a[0]) < 0n ? -bigOf(I2, a[0]) : bigOf(I2, a[0])));
  reg('llabs', (I2, a) => I2.mkInt(I2.T.llong, bigOf(I2, a[0]) < 0n ? -bigOf(I2, a[0]) : bigOf(I2, a[0])));
  reg('atoi', (I2, a) => { const m = /^\s*[+-]?\d+/.exec(I2.cstr(addrOf(I2, a[0]))); return ret.int(m ? BigInt.asIntN(32, BigInt(m[0].trim())) : 0n); });
  reg('atol', (I2, a) => { const m = /^\s*[+-]?\d+/.exec(I2.cstr(addrOf(I2, a[0]))); return I2.mkInt(I2.T.long, m ? BigInt(m[0].trim()) : 0n); });
  reg('atoll', (I2, a) => { const m = /^\s*[+-]?\d+/.exec(I2.cstr(addrOf(I2, a[0]))); return I2.mkInt(I2.T.llong, m ? BigInt(m[0].trim()) : 0n); });
  reg('atof', (I2, a) => ret.d(parseFloat(I2.cstr(addrOf(I2, a[0]))) || 0));
  reg('rand', (I2) => ret.int(randNext(I2)));
  reg('srand', (I2, a) => { const s = rnd(I2); const v = Number(BigInt.asUintN(32, bigOf(I2, a[0]))); s.seed = v; s.g.seed(v); return ret.void(); });
  reg('exit', (I2, a) => { throw new Fault('exit', 'exit', undefined, intOf(I2, a[0]) & 0xff); });
  reg('_Exit', (I2, a) => { throw new Fault('exit', 'exit', undefined, intOf(I2, a[0]) & 0xff); });
  reg('abort', (I2) => { throw new Fault('abort', I2.plat.id === 'windows' ? 'abort() has been called' : 'Aborted (core dumped)', undefined, 134); });
  reg('atexit', (I2, a) => { const f = I2.fnByAddr.get(addrOf(I2, a[0])); if (f) I2.atExit.push(f); return ret.int(0); });
  reg('getenv', () => ret.cptr(0));
  reg('time', (I2, a) => {
    const t = BigInt(Math.floor(Date.now() / 1000));
    const p = a.length ? addrOf(I2, a[0]) : 0;
    if (p) I2.mem.storeInt(p, 8, t, 'time_t');
    return I2.mkInt(I2.T.long, t);
  });
  reg('clock', (I2) => I2.mkInt(I2.T.long, BigInt(Math.floor(I2.steps / 4))));
  reg('qsort', (I2, a) => {
    const base = addrOf(I2, a[0]), n = intOf(I2, a[1]), size = intOf(I2, a[2]);
    const cmp = I2.rv(a[3]);
    if (n < 2) return ret.void();
    const elemT: Type = I2.T.char;
    void elemT;
    const idx = Array.from({ length: n }, (_, i) => i);
    const mergeSort = (arr: number[]): number[] => {
      if (arr.length <= 1) return arr;
      const mid = arr.length >> 1;
      const l = mergeSort(arr.slice(0, mid)), r = mergeSort(arr.slice(mid));
      const out: number[] = [];
      let i = 0, j = 0;
      while (i < l.length && j < r.length) {
        const c = Number(I2.toBig(callPtr(I2, cmp, [ret.ptr(base + l[i] * size), ret.ptr(base + r[j] * size)])));
        if (c <= 0) out.push(l[i++]); else out.push(r[j++]);
      }
      while (i < l.length) out.push(l[i++]);
      while (j < r.length) out.push(r[j++]);
      return out;
    };
    const order = mergeSort(idx);
    const copy = I2.mem.read(base, n * size, 'array');
    const res = new Uint8Array(n * size);
    order.forEach((src, dst) => res.set(copy.subarray(src * size, (src + 1) * size), dst * size));
    I2.mem.write(base, res, 'array');
    return ret.void();
  });

  // ---- string.h ----
  reg('strlen', (I2, a) => {
    const p = addrOf(I2, a[0]);
    let n = 0;
    while (I2.mem.readRaw(p + n, 1)[0] !== 0) n++;
    I2.mem.read(p, n + 1, 'string');
    return ret.sz(n);
  });
  reg('memset', (I2, a) => { const d = addrOf(I2, a[0]), n = intOf(I2, a[2]); if (n > 0) I2.mem.write(d, new Uint8Array(n).fill(intOf(I2, a[1]) & 0xff), 'memset target'); return a[0]; });
  reg('memcpy', (I2, a) => { const n = intOf(I2, a[2]); const d = addrOf(I2, a[0]), s = addrOf(I2, a[1]); if (n > 0 && s < d + n && d < s + n) I2.diag('ub-other', 'warn', 'memcpy with overlapping regions', 'The source and destination overlap, which is undefined for memcpy — use memmove.', d, n); I2.mem.copy(d, s, n); return a[0]; });
  reg('memmove', (I2, a) => { const n = intOf(I2, a[2]); I2.mem.copy(addrOf(I2, a[0]), addrOf(I2, a[1]), n); return a[0]; });
  reg('memcmp', (I2, a) => {
    const n = intOf(I2, a[2]);
    const x = I2.mem.read(addrOf(I2, a[0]), n, 'bytes'), y = I2.mem.read(addrOf(I2, a[1]), n, 'bytes');
    for (let i = 0; i < n; i++) if (x[i] !== y[i]) return ret.int(x[i] - y[i]);
    return ret.int(0);
  });
  const cstrBytes = (I2: Interp, p: number): Uint8Array => {
    let n = 0;
    while (I2.mem.readRaw(p + n, 1)[0] !== 0) n++;
    return I2.mem.read(p, n + 1, 'string');
  };
  reg('strcpy', (I2, a) => { const d = addrOf(I2, a[0]); const s = cstrBytes(I2, addrOf(I2, a[1])); I2.mem.write(d, s, 'strcpy destination'); return a[0]; });
  reg('strncpy', (I2, a) => {
    const d = addrOf(I2, a[0]), n = intOf(I2, a[2]);
    const s = cstrBytes(I2, addrOf(I2, a[1]));
    const out = new Uint8Array(n); out.set(s.subarray(0, Math.min(s.length, n)));
    if (n > 0) I2.mem.write(d, out, 'strncpy destination');
    return a[0];
  });
  reg('strcat', (I2, a) => {
    const d = addrOf(I2, a[0]);
    const dl = cstrBytes(I2, d).length - 1;
    const s = cstrBytes(I2, addrOf(I2, a[1]));
    I2.mem.write(d + dl, s, 'strcat destination');
    return a[0];
  });
  reg('strncat', (I2, a) => {
    const d = addrOf(I2, a[0]), n = intOf(I2, a[2]);
    const dl = cstrBytes(I2, d).length - 1;
    const s = cstrBytes(I2, addrOf(I2, a[1]));
    const take = Math.min(n, s.length - 1);
    const out = new Uint8Array(take + 1); out.set(s.subarray(0, take));
    I2.mem.write(d + dl, out, 'strncat destination');
    return a[0];
  });
  const cmpStr = (x: Uint8Array, y: Uint8Array, lim = Infinity) => {
    for (let i = 0; i < Math.min(lim, Math.max(x.length, y.length)); i++) {
      const p = x[i] ?? 0, q = y[i] ?? 0;
      if (p !== q) return p - q;
      if (p === 0) return 0;
    }
    return 0;
  };
  reg('strcmp', (I2, a) => ret.int(cmpStr(cstrBytes(I2, addrOf(I2, a[0])), cstrBytes(I2, addrOf(I2, a[1])))));
  reg('strncmp', (I2, a) => ret.int(cmpStr(cstrBytes(I2, addrOf(I2, a[0])), cstrBytes(I2, addrOf(I2, a[1])), intOf(I2, a[2]))));
  reg('strchr', (I2, a) => {
    const p = addrOf(I2, a[0]); const c = intOf(I2, a[1]) & 0xff; const s = cstrBytes(I2, p);
    for (let i = 0; i < s.length; i++) if (s[i] === c) return ret.cptr(p + i);
    return ret.cptr(0);
  });
  reg('strrchr', (I2, a) => {
    const p = addrOf(I2, a[0]); const c = intOf(I2, a[1]) & 0xff; const s = cstrBytes(I2, p);
    for (let i = s.length - 1; i >= 0; i--) if (s[i] === c) return ret.cptr(p + i);
    return ret.cptr(0);
  });
  reg('strstr', (I2, a) => {
    const p = addrOf(I2, a[0]);
    const h = I2.cstr(p), n = I2.cstr(addrOf(I2, a[1]));
    const i = h.indexOf(n);
    return ret.cptr(i < 0 ? 0 : p + new TextEncoder().encode(h.slice(0, i)).length);
  });
  reg('strdup', (I2, a) => {
    const s = cstrBytes(I2, addrOf(I2, a[0]));
    const p = I2.heap.malloc(s.length, 'strdup');
    I2.mem.write(p, s, 'copy');
    return ret.cptr(p);
  });

  // ---- ctype ----
  const ct = (name: string, f: (c: number) => boolean) => reg(name, (I2, a) => ret.int(f(intOf(I2, a[0])) ? 1 : 0));
  ct('isdigit', (c) => c >= 48 && c <= 57);
  ct('isalpha', (c) => (c >= 65 && c <= 90) || (c >= 97 && c <= 122));
  ct('isalnum', (c) => (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122));
  ct('isspace', (c) => c === 32 || (c >= 9 && c <= 13));
  ct('isupper', (c) => c >= 65 && c <= 90);
  ct('islower', (c) => c >= 97 && c <= 122);
  ct('ispunct', (c) => c > 32 && c < 127 && !((c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122)));
  ct('isprint', (c) => c >= 32 && c < 127);
  ct('isxdigit', (c) => (c >= 48 && c <= 57) || (c >= 65 && c <= 70) || (c >= 97 && c <= 102));
  reg('toupper', (I2, a) => { const c = intOf(I2, a[0]); return ret.int(c >= 97 && c <= 122 ? c - 32 : c); });
  reg('tolower', (I2, a) => { const c = intOf(I2, a[0]); return ret.int(c >= 65 && c <= 90 ? c + 32 : c); });

  // ---- math ----
  const m1 = (name: string, f: (x: number) => number) => {
    reg(name, (I2, a) => { const x = I2.rv(a[0]); const r = f(numOf(I2, x)); return x.k === 'f' && x.t.k === 'float' && x.t.bytes === 4 && name.endsWith('f') ? I2.mkFloat(I2.T.float, r) : ret.d(r); });
    reg(name + 'f', (I2, a) => I2.mkFloat(I2.T.float, f(numOf(I2, a[0]))));
  };
  for (const [n, f] of Object.entries({ sqrt: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos, atan: Math.atan, exp: Math.exp, log: Math.log, log10: Math.log10, log2: Math.log2, floor: Math.floor, ceil: Math.ceil, trunc: Math.trunc, cbrt: Math.cbrt, sinh: Math.sinh, cosh: Math.cosh, tanh: Math.tanh, fabs: Math.abs, expm1: Math.expm1, log1p: Math.log1p })) m1(n, f);
  const roundHalfAway = (x: number) => (x < 0 ? -Math.round(-x) : Math.round(x));
  m1('round', roundHalfAway);
  reg('pow', (I2, a) => ret.d(Math.pow(numOf(I2, a[0]), numOf(I2, a[1]))));
  reg('powf', (I2, a) => I2.mkFloat(I2.T.float, Math.pow(numOf(I2, a[0]), numOf(I2, a[1]))));
  reg('atan2', (I2, a) => ret.d(Math.atan2(numOf(I2, a[0]), numOf(I2, a[1]))));
  reg('hypot', (I2, a) => ret.d(Math.hypot(numOf(I2, a[0]), numOf(I2, a[1]))));
  reg('fmod', (I2, a) => ret.d(numOf(I2, a[0]) % numOf(I2, a[1])));
  reg('fmax', (I2, a) => ret.d(Math.max(numOf(I2, a[0]), numOf(I2, a[1]))));
  reg('fmin', (I2, a) => ret.d(Math.min(numOf(I2, a[0]), numOf(I2, a[1]))));
  reg('lround', (I2, a) => I2.mkInt(I2.T.long, BigInt(roundHalfAway(numOf(I2, a[0])))));
  reg('llround', (I2, a) => I2.mkInt(I2.T.llong, BigInt(roundHalfAway(numOf(I2, a[0])))));
  reg('isnan', (I2, a) => ret.int(Number.isNaN(numOf(I2, a[0])) ? 1 : 0));
  reg('isinf', (I2, a) => ret.int(Math.abs(numOf(I2, a[0])) === Infinity ? 1 : 0));
  reg('isfinite', (I2, a) => ret.int(Number.isFinite(numOf(I2, a[0])) ? 1 : 0));

  // ---- assert / terminate ----
  reg('__assert_fail', (I2, a) => {
    const expr = I2.cstr(addrOf(I2, a[0])), file = I2.cstr(addrOf(I2, a[1])), line = intOf(I2, a[2]);
    const msg = I2.plat.id === 'windows'
      ? `Assertion failed: ${expr}, file ${file}, line ${line}`
      : `a.out: ${file}:${line}: int main(): Assertion \`${expr}' failed.`;
    I2.print(msg + '\n', true);
    throw new Fault('assert', I2.plat.id === 'windows' ? 'abort() has been called (assertion failed)' : 'Aborted (core dumped)', undefined, 134);
  });
  reg('std::__debug_assert', (I2, a) => {
    const what = I2.cstr(addrOf(I2, a[0]));
    I2.print(`Debug Assertion Failed!\n\nProgram: ...\\Project.exe\nFile: C:\\Program Files\\Microsoft Visual Studio\\VC\\Tools\\MSVC\\include\\xstring\n\nExpression: ${what}\n`, true);
    throw new Fault('assert', 'abort() has been called (debug assertion failed)', undefined, 3);
  });
  // string -> number conversions used by std::stoi & friends: (text, size_t* consumed, base, int* err)  err: 1 = no digits, 2 = out of range
  const parseInteger = (I2: Interp, a: V[], unsigned: boolean): V => {
    const s = I2.cstr(addrOf(I2, a[0]));
    const idxp = addrOf(I2, a[1]);
    let base = intOf(I2, a[2]);
    const errp = addrOf(I2, a[3]);
    let i = 0;
    while (i < s.length && /\s/.test(s[i])) i++;
    let neg = false;
    if (s[i] === '+' || s[i] === '-') { neg = s[i] === '-'; i++; }
    if ((base === 0 || base === 16) && s[i] === '0' && (s[i + 1] === 'x' || s[i + 1] === 'X') && /[0-9a-fA-F]/.test(s[i + 2] ?? '')) { i += 2; base = 16; }
    else if (base === 0 && s[i] === '0') base = 8;
    else if (base === 0) base = 10;
    const digits = '0123456789abcdefghijklmnopqrstuvwxyz'.slice(0, base);
    const start = i;
    let v = 0n;
    while (i < s.length && digits.includes(s[i].toLowerCase())) { v = v * BigInt(base) + BigInt(digits.indexOf(s[i].toLowerCase())); i++; }
    let err = 0;
    if (i === start) { err = 1; i = 0; }
    if (neg) v = -v;
    const lo = unsigned ? 0n : -(1n << 63n), hi = unsigned ? (1n << 64n) - 1n : (1n << 63n) - 1n;
    if (!err && (v < lo || v > hi) && !(unsigned && neg)) { err = 2; v = v < lo ? lo : hi; }
    if (idxp) I2.mem.storeInt(idxp, 8, BigInt(i), 'consumed count');
    I2.mem.storeInt(errp, 4, BigInt(err), 'error code');
    return I2.mkInt(unsigned ? I2.T.ullong : I2.T.llong, BigInt.asIntN(64, v));
  };
  reg('std::__strtoll', (I2, a) => parseInteger(I2, a, false));
  reg('std::__strtoull', (I2, a) => parseInteger(I2, a, true));
  reg('std::__strtod', (I2, a) => {
    const s = I2.cstr(addrOf(I2, a[0]));
    const idxp = addrOf(I2, a[1]);
    const errp = addrOf(I2, a[2]);
    const m = /^\s*[+-]?(?:inf(?:inity)?|nan|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|0[xX][0-9a-fA-F]+)/i.exec(s);
    let err = 0, v = 0, used = 0;
    if (!m) err = 1;
    else {
      used = m[0].length;
      const t = m[0].trim().toLowerCase();
      v = /inf/.test(t) ? (t.startsWith('-') ? -Infinity : Infinity) : /nan/.test(t) ? NaN : /0x/.test(t) ? Number(t.replace('+', '')) : parseFloat(t);
      if (!Number.isFinite(v) && !/inf|nan/.test(t)) err = 2;
    }
    if (idxp) I2.mem.storeInt(idxp, 8, BigInt(used), 'consumed count');
    I2.mem.storeInt(errp, 4, BigInt(err), 'error code');
    return ret.d(v);
  });
  reg('std::terminate', (I2) => { throw new Fault('abort', 'terminate called without an active exception', undefined, 134); });

  // ---- iostream: output ----
  const osSelf = (I2: Interp, self: V | undefined): number => { if (!self || self.k !== 'l') I2.cerr('stream function called without an object'); return self.a; };
  reg('std::ostream::__put', (I2, a, self) => {
    const os = osSelf(I2, self);
    const x = I2.rv(a[0]);
    const numeric = !(x.k === 'i' && (x.t.k === 'ptr' || (x.t.k === 'int' && x.t.bytes === 1 && x.t.nm.includes('char'))));
    streamWrite(I2, os, formatForStream(I2, os, x), numeric);
    return self!;
  });
  reg('std::ostream::write', (I2, a, self) => {
    const os = osSelf(I2, self);
    const n = intOf(I2, a[1]);
    const bytes = n > 0 ? I2.mem.read(addrOf(I2, a[0]), n, 'buffer') : new Uint8Array(0);
    streamWrite(I2, os, new TextDecoder().decode(bytes), false);
    return self!;
  });
  reg('std::ostream::put', (I2, a, self) => { streamWrite(I2, osSelf(I2, self), String.fromCharCode(intOf(I2, a[0]) & 0xff), false); return self!; });
  T.set('std::ostream::operator<<', T.get('std::ostream::__put')!);
  reg('std::ostream::flush', (I2, _a, self) => self ?? I2.voidV());
  reg('std::ostream::__setflags', (I2, a, self) => { const os = osSelf(I2, self); const f = sgetInt(I2, os + OS.flags); sputInt(I2, os + OS.flags, (f & ~intOf(I2, a[1])) | intOf(I2, a[0])); return ret.void(); });

  // ---- iostream: input ----
  reg('std::istream::__extract', (I2, a, self) => { const is = osSelf(I2, self); extractInto(I2, is, a[0]); return self!; });
  reg('std::istream::__extractLine', (I2, a, self) => {
    // a[0] = pointer to a std::string-like sink is handled in the prelude; this reads one line into a char buffer
    const is = osSelf(I2, self);
    if (I2.stdinPos >= I2.stdin.length) { setState(I2, is, 3); return ret.int(0); }
    const delim = a.length ? String.fromCharCode(intOf(I2, a[0]) & 0xff) : '\n';
    let end = I2.stdin.indexOf(delim, I2.stdinPos);
    let line: string;
    if (end < 0) { line = I2.stdin.slice(I2.stdinPos); I2.stdinPos = I2.stdin.length; } else { line = I2.stdin.slice(I2.stdinPos, end); I2.stdinPos = end + 1; }
    if (delim === '\n' && line.endsWith('\r')) line = line.slice(0, -1);
    I2.lastLine = line;
    return ret.int(1);
  });
  reg('std::istream::__token', (I2, _a, self) => {
    const is = osSelf(I2, self);
    if (sgetInt(I2, is + IS.state) & 6) return ret.int(0);
    skipWs(I2);
    if (peekc(I2) < 0) { setState(I2, is, 3); return ret.int(0); }
    I2.lastLine = readToken(I2);
    if (I2.stdinPos >= I2.stdin.length) setState(I2, is, 1);
    return ret.int(1);
  });
  reg('std::istream::get', (I2, _a, self) => {
    const is = osSelf(I2, self);
    if (I2.stdinPos >= I2.stdin.length) { setState(I2, is, 3); return ret.int(-1); }
    return ret.int(I2.stdin.charCodeAt(I2.stdinPos++));
  });
  reg('std::istream::peek', (I2) => ret.int(peekc(I2)));
  reg('std::istream::ignore', (I2, a) => {
    const n = a.length ? intOf(I2, a[0]) : 1;
    const delim = a.length > 1 ? intOf(I2, a[1]) : -1;
    for (let i = 0; i < n && I2.stdinPos < I2.stdin.length; i++) { const c = I2.stdin.charCodeAt(I2.stdinPos++); if (c === delim) break; }
    return ret.void();
  });
  reg('std::istream::__atEnd', (I2) => ret.int(I2.stdinPos >= I2.stdin.length ? 1 : 0));
  reg('std::__lastInput', (I2) => {
    // returns the text captured by the last __extractLine/__token as a pointer to a scratch buffer in the C library page
    const bytes = new TextEncoder().encode(I2.lastLine + '\0');
    const buf = I2.scratchBuffer(bytes.length);
    I2.mem.writeRaw(buf, bytes, S.Init);
    return ret.cptr(buf);
  });
  reg('std::__lastInputLen', (I2) => ret.sz(new TextEncoder().encode(I2.lastLine).length));

  // ---- typing of library allocations: __tag(p, n) says "this heap block holds n objects of p's pointee type" ----
  reg('std::__tag', (I2, a) => {
    const p = I2.rv(a[0]);
    if (p.k !== 'i' || p.t.k !== 'ptr') return ret.void();
    const addr = Number(p.v);
    const n = intOf(I2, a[1]);
    const rec = I2.heap.live.get(addr);
    const to = p.t.to;
    if (!rec || to.k === 'void' || n < 1) return ret.void();
    I2.typeInfo[rec.id] = I2.typeNodeOf(n === 1 ? to : arrOf(to, n));
    return ret.void();
  });

  // ---- in-memory streams: istringstream / ostringstream / stringstream share one text buffer per id ----
  reg('std::__ss_new', (I2) => { const id = I2.nextSid++; I2.sstreams.set(id, { text: '', pos: 0 }); return ret.int(id); });
  reg('std::__ss_set', (I2, a) => { const id = intOf(I2, a[0]); I2.sstreams.set(id, { text: I2.cstr(addrOf(I2, a[1])), pos: 0 }); return ret.void(); });
  reg('std::__ss_text', (I2, a) => { I2.lastLine = I2.sstreams.get(intOf(I2, a[0]))?.text ?? ''; return ret.void(); });
  for (const k of ['__extract', '__extractLine', '__token', 'get', 'peek', 'ignore', '__atEnd']) {
    const name = 'std::istream::' + k;
    const f = T.get(name);
    if (!f) continue;
    T.set(name, (I2, a, self, dest) => {
      const fd = self && self.k === 'l' ? sgetInt(I2, self.a + OS.fd) : 0;
      const ss = fd >= 100 ? I2.sstreams.get(fd) : undefined;
      if (!ss) return f(I2, a, self, dest);
      const saved = [I2.stdin, I2.stdinPos] as const;
      I2.stdin = ss.text; I2.stdinPos = ss.pos;
      try { return f(I2, a, self, dest); } finally { ss.pos = I2.stdinPos; I2.stdin = saved[0]; I2.stdinPos = saved[1]; }
    });
  }
  void sizeOf;
}
