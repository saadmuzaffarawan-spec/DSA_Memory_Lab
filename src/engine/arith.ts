// Scalar conversions and arithmetic with C++ semantics (promotions, usual arithmetic conversions, UB diagnostics).
import { Fault } from './memory';
import type { Interp } from './interp';
import type { V } from './env';
import { intInfo, isFloat, isInt, stripCv, type Type } from './types';

const rankOf = (t: Type): number => {
  if (t.k === 'bool') return 0;
  if (t.k !== 'int') return 0;
  return t.bytes * 10 + (t.nm === 'long long' || t.nm === 'unsigned long long' ? 2 : t.nm === 'long' || t.nm === 'unsigned long' ? 1 : 0);
};

/** integral promotion */
export function promote(I: Interp, t: Type): Type {
  t = stripCv(t);
  if (t.k === 'bool') return I.T.int;
  if (t.k === 'enum') return promote(I, t.e.underlying.k === 'int' && t.e.underlying.bytes < 4 ? I.T.int : t.e.underlying);
  if (t.k === 'int') {
    if (t.bytes < 4) return I.T.int;
    return t;
  }
  return t;
}

/** usual arithmetic conversions: the common type of two arithmetic operands */
export function commonType(I: Interp, a: Type, b: Type): Type {
  a = stripCv(a); b = stripCv(b);
  if (isFloat(a) || isFloat(b)) {
    const rf = (t: Type) => (t.k === 'float' ? (t.nm === 'long double' ? 3 : t.bytes === 8 ? 2 : 1) : 0);
    return rf(a) >= rf(b) ? a : b;
  }
  const pa = promote(I, a) as Type;
  const pb = promote(I, b) as Type;
  if (pa.k !== 'int' || pb.k !== 'int') return pa;
  if (pa.nm === pb.nm) return pa;
  if (pa.signed === pb.signed) return rankOf(pa) >= rankOf(pb) ? pa : pb;
  const [u, s] = pa.signed ? [pb, pa] : [pa, pb];
  if (rankOf(u) >= rankOf(s)) return u;
  if (s.bytes > u.bytes) return s;
  // signed type of equal width cannot hold all unsigned values: use the unsigned version of the signed type
  return unsignedOf(I, s);
}

export function unsignedOf(I: Interp, t: Type): Type {
  if (t.k !== 'int') return t;
  const T = I.T;
  switch (t.nm) {
    case 'char': case 'signed char': return T.uchar;
    case 'short': return T.ushort;
    case 'int': return T.uint;
    case 'long': return T.ulong;
    case 'long long': return T.ullong;
    default: return t;
  }
}

/** convert a value to the scalar type `to` (assignment/initialisation/cast conversions) */
export function convertScalar(I: Interp, v: V, to: Type): V {
  const x = I.rv(v);
  const dest = stripCv(to);
  if (x.k === 'void') I.cerr('a void value cannot be used here');
  switch (dest.k) {
    case 'bool': {
      if (x.k === 'f') return I.mkBool(x.v !== 0);
      if (x.k === 'i') return I.mkBool(x.v !== 0n);
      break;
    }
    case 'int': case 'enum': {
      if (x.k === 'f') {
        const { bytes, signed } = intInfo(dest);
        let n = Math.trunc(x.v);
        if (!Number.isFinite(n)) n = signed ? -(2 ** (bytes * 8 - 1)) : 0;
        const lo = signed ? -(2 ** (bytes * 8 - 1)) : 0;
        const hi = signed ? 2 ** (bytes * 8 - 1) - 1 : 2 ** (bytes * 8) - 1;
        if (n < lo || n > hi) {
          I.diag('ub-other', 'warn', 'Float to integer conversion out of range', `The value ${x.v} does not fit in ${dest.k === 'int' ? dest.nm : 'the enum'}; the result is undefined behaviour (x86 typically yields the "integer indefinite" value).`);
          return I.mkInt(dest, signed ? BigInt(lo) : BigInt.asUintN(bytes * 8, BigInt(Math.trunc(n))));
        }
        return I.mkInt(dest, BigInt(n));
      }
      if (x.k === 'i') return I.mkInt(dest, x.v);
      break;
    }
    case 'float': {
      if (x.k === 'f') return I.mkFloat(dest, x.v);
      if (x.k === 'i') return I.mkFloat(dest, Number(x.v));
      break;
    }
    case 'ptr': case 'nullptr': {
      if (x.k === 'i') return { k: 'i', t: dest, v: BigInt.asUintN(64, x.v) };
      break;
    }
  }
  I.cerr(`cannot convert this value to '${dest.k === 'int' || dest.k === 'float' ? dest.nm : dest.k}'`);
}

const isZeroConst = (v: V) => v.k === 'i' && v.v === 0n;
export { isZeroConst };

/** binary arithmetic / comparison on two scalar rvalues (not pointers) */
export function arithBinary(I: Interp, op: string, a: V, b: V): V {
  const x = I.rv(a), y = I.rv(b);
  if ((x.k !== 'i' && x.k !== 'f') || (y.k !== 'i' && y.k !== 'f')) I.cerr(`invalid operands to binary '${op}'`);
  const xt = (x as any).t as Type, yt = (y as any).t as Type;
  if (op === '<<' || op === '>>') return shiftOp(I, op, x as any, y as any);
  const ct = commonType(I, xt, yt);
  if (ct.k === 'float') {
    const p = I.toNumber(x), q = I.toNumber(y);
    switch (op) {
      case '+': return I.mkFloat(ct, p + q);
      case '-': return I.mkFloat(ct, p - q);
      case '*': return I.mkFloat(ct, p * q);
      case '/': return I.mkFloat(ct, p / q);
      case '<': return I.mkBool(p < q);
      case '>': return I.mkBool(p > q);
      case '<=': return I.mkBool(p <= q);
      case '>=': return I.mkBool(p >= q);
      case '==': return I.mkBool(p === q);
      case '!=': return I.mkBool(p !== q);
      case '%': case '&': case '|': case '^': I.cerr(`invalid operands of types '${(xt as any).nm}' and '${(yt as any).nm}' to binary 'operator${op}'`);
    }
    I.cerr(`unsupported operator ${op}`);
  }
  const p = convertScalar(I, x, ct) as { v: bigint };
  const q = convertScalar(I, y, ct) as { v: bigint };
  const t = ct as Extract<Type, { k: 'int' }>;
  const { signed, bytes } = intInfo(t);
  const wrap = (r: bigint, name: string) => {
    const w = BigInt.asIntN(bytes * 8, r);
    if (signed && w !== r) {
      I.diag('signed-overflow', 'error', 'Signed integer overflow', `${p.v} ${op} ${q.v} does not fit in ${t.nm} (${bytes * 8} bits). In C++ this is undefined behaviour; the CPU wraps around to ${w}.`);
    }
    void name;
    return signed ? w : BigInt.asUintN(bytes * 8, r);
  };
  switch (op) {
    case '+': return I.mkInt(t, signed ? wrap(p.v + q.v, '+') : p.v + q.v);
    case '-': return I.mkInt(t, signed ? wrap(p.v - q.v, '-') : p.v - q.v);
    case '*': return I.mkInt(t, signed ? wrap(p.v * q.v, '*') : p.v * q.v);
    case '/': case '%': {
      if (q.v === 0n) {
        throw new Fault('div-zero', I.plat.id === 'windows' ? 'Integer division by zero (0xC0000094)' : 'Floating point exception (SIGFPE): integer division by zero', undefined, I.plat.id === 'windows' ? 0xC0000094 : 136);
      }
      if (signed && q.v === -1n && p.v === -(1n << BigInt(bytes * 8 - 1))) {
        throw new Fault('div-zero', I.plat.id === 'windows' ? 'Integer overflow (0xC0000095): INT_MIN / -1' : 'Floating point exception (SIGFPE): INT_MIN / -1 overflows', undefined, I.plat.id === 'windows' ? 0xC0000095 : 136);
      }
      return I.mkInt(t, op === '/' ? p.v / q.v : p.v % q.v);
    }
    case '&': return I.mkInt(t, p.v & q.v);
    case '|': return I.mkInt(t, p.v | q.v);
    case '^': return I.mkInt(t, p.v ^ q.v);
    case '<': return I.mkBool(p.v < q.v);
    case '>': return I.mkBool(p.v > q.v);
    case '<=': return I.mkBool(p.v <= q.v);
    case '>=': return I.mkBool(p.v >= q.v);
    case '==': return I.mkBool(p.v === q.v);
    case '!=': return I.mkBool(p.v !== q.v);
  }
  I.cerr(`unsupported operator ${op}`);
}

function shiftOp(I: Interp, op: string, x: Extract<V, { k: 'i' | 'f' }>, y: Extract<V, { k: 'i' | 'f' }>): V {
  if (x.k !== 'i' || y.k !== 'i') I.cerr(`invalid operands to binary '${op}'`);
  const lt = promote(I, x.t) as Extract<Type, { k: 'int' }>;
  const { bytes, signed } = intInfo(lt);
  const bits = bytes * 8;
  let n = y.v;
  const lv = BigInt.asIntN(bits, x.v);
  if (n < 0n || n >= BigInt(bits)) {
    I.diag('shift-ub', 'error', 'Shift count out of range', `Shifting a ${bits}-bit ${lt.nm} by ${n} is undefined behaviour (the count must be between 0 and ${bits - 1}). x86 masks the count to ${bits - 1 === 31 ? 5 : 6} bits.`);
    n = n & BigInt(bits - 1);
  }
  if (op === '<<') {
    if (signed && lv < 0n) I.diag('shift-ub', 'warn', 'Left shift of a negative value', `Left-shifting the negative value ${lv} is undefined behaviour before C++20.`);
    return I.mkInt(lt, (signed ? lv : BigInt.asUintN(bits, x.v)) << n);
  }
  return I.mkInt(lt, (signed ? lv : BigInt.asUintN(bits, x.v)) >> n);
}

export { isInt, isFloat };
