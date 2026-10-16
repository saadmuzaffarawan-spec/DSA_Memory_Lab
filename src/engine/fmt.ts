// Number and printf formatting with C library semantics (per platform where they differ).
import type { Interp } from './interp';
import type { V } from './env';
import type { Platform } from './platform';

export function fmtExp(x: number, prec: number, upper: boolean): string {
  let s = x.toExponential(Math.min(100, prec));
  // JS gives e+5, C wants e+05
  s = s.replace(/e([+-])(\d)$/, 'e$10$2');
  return upper ? s.toUpperCase() : s;
}

export function fmtFixed(x: number, prec: number): string {
  if (Math.abs(x) >= 1e21) {
    // toFixed switches to exponent notation; expand via BigInt
    const big = BigInt(Math.round(x));
    return big.toString() + (prec > 0 ? '.' + '0'.repeat(prec) : '');
  }
  return x.toFixed(Math.min(100, prec));
}

export function fmtG(x: number, prec: number, alt: boolean, upper: boolean): string {
  const P = prec === 0 ? 1 : prec;
  if (x === 0) {
    const z = Object.is(x, -0) ? '-0' : '0';
    return alt ? z + '.' + '0'.repeat(P - 1) : z;
  }
  const e = x.toExponential(P - 1);
  const X = parseInt(e.slice(e.indexOf('e') + 1), 10);
  let s: string;
  if (P > X && X >= -4) {
    s = fmtFixed(x, P - 1 - X);
    if (!alt && s.includes('.')) s = s.replace(/\.?0+$/, '');
  } else {
    s = fmtExp(x, P - 1, upper);
    if (!alt) s = s.replace(/\.?0+e/i, upper ? 'E' : 'e');
  }
  return s;
}

export function nonFinite(x: number, P: Platform, upper: boolean): string | null {
  if (Number.isFinite(x)) return null;
  let s: string;
  if (Number.isNaN(x)) s = P.id === 'windows' ? '-nan(ind)' : P.id === 'linux' ? '-nan' : 'nan';
  else s = x < 0 ? '-inf' : 'inf';
  return upper ? s.toUpperCase() : s;
}

export function pointerText(P: Platform, a: bigint, forPrintf: boolean): string {
  if (P.id === 'windows') return a.toString(16).toUpperCase().padStart(16, '0');
  if (a === 0n) return forPrintf ? (P.id === 'linux' ? '(nil)' : '0x0') : (P.id === 'linux' ? '0' : '0x0');
  return '0x' + a.toString(16);
}

interface Spec { flags: string; width: number | null; prec: number | null; len: string; conv: string }

function pad(s: string, sp: Spec, width: number, numeric: boolean): string {
  if (s.length >= width) return s;
  if (sp.flags.includes('-')) return s + ' '.repeat(width - s.length);
  if (numeric && sp.flags.includes('0') && !(sp.prec !== null && 'diuxXo'.includes(sp.conv))) {
    const m = /^([+\- ]?(?:0[xX])?)(.*)$/.exec(s)!;
    return m[1] + '0'.repeat(width - s.length) + m[2];
  }
  return ' '.repeat(width - s.length) + s;
}

export function formatPrintf(I: Interp, fmt: string, args: V[], what = 'printf'): string {
  const P = I.plat;
  let out = '';
  let ai = 0;
  const next = (): V | null => (ai < args.length ? I.rv(args[ai++]) : null);
  const mismatch = (conv: string, got: string) => {
    I.diag('ub-other', 'warn', `${what}: format '%${conv}' does not match its argument`, `The format string asks for ${conv === 's' ? 'a C string' : 'a different type'} but the argument is ${got}. In C++ this is undefined behaviour — the function reads the wrong bytes/register.`);
  };
  for (let i = 0; i < fmt.length; i++) {
    const ch = fmt[i];
    if (ch !== '%') { out += ch; continue; }
    i++;
    if (fmt[i] === '%') { out += '%'; continue; }
    const sp: Spec = { flags: '', width: null, prec: null, len: '', conv: '' };
    while ('-+ #0'.includes(fmt[i]) && i < fmt.length) sp.flags += fmt[i++];
    if (fmt[i] === '*') {
      const w = next();
      let wv = w && w.k === 'i' ? Number(BigInt.asIntN(32, w.v)) : 0;
      if (wv < 0) { sp.flags += '-'; wv = -wv; }
      sp.width = wv; i++;
    } else {
      let w = '';
      while (fmt[i] >= '0' && fmt[i] <= '9') w += fmt[i++];
      if (w) sp.width = parseInt(w, 10);
    }
    if (fmt[i] === '.') {
      i++;
      if (fmt[i] === '*') { const p = next(); const pv = p && p.k === 'i' ? Number(BigInt.asIntN(32, p.v)) : 0; sp.prec = pv < 0 ? null : pv; i++; } else {
        let p = '';
        while (fmt[i] >= '0' && fmt[i] <= '9') p += fmt[i++];
        sp.prec = p ? parseInt(p, 10) : 0;
      }
    }
    while ('hlLzjtqI'.includes(fmt[i]) && i < fmt.length) {
      // Windows-style I64 / I32
      if (fmt[i] === 'I' && fmt[i + 1] === '6' && fmt[i + 2] === '4') { sp.len = 'll'; i += 3; continue; }
      if (fmt[i] === 'I' && fmt[i + 1] === '3' && fmt[i + 2] === '2') { sp.len = ''; i += 3; continue; }
      sp.len += fmt[i++];
    }
    sp.conv = fmt[i] ?? '';
    const conv = sp.conv;
    const width = sp.width ?? 0;
    if (conv === '') { out += '%'; break; }
    const arg = 'diuxXocsfFeEgGpaAn'.includes(conv) ? next() : null;
    if (arg === null && 'diuxXocsfFeEgGpaA'.includes(conv)) {
      I.diag('ub-other', 'error', `${what}: not enough arguments for the format string`, `The format has a '%${conv}' conversion but no argument was passed for it. printf then reads whatever happens to be in the next argument register or stack slot (undefined behaviour).`);
      out += pad(conv === 's' ? '(null)' : '0', sp, width, true);
      continue;
    }
    switch (conv) {
      case 'd': case 'i': case 'u': case 'x': case 'X': case 'o': {
        if (arg!.k === 'f') mismatch(conv, 'a floating-point value');
        let v = arg!.k === 'i' ? arg!.v : BigInt(Math.trunc((arg as any).v));
        const bits = sp.len === 'hh' ? 8 : sp.len === 'h' ? 16 : sp.len === 'l' ? (P.longBytes === 8 ? 64 : 32) : sp.len === '' ? 32 : 64;
        const signedConv = conv === 'd' || conv === 'i';
        v = signedConv ? BigInt.asIntN(bits, v) : BigInt.asUintN(bits, v);
        let digits = (v < 0n ? -v : v).toString(conv === 'x' || conv === 'X' ? 16 : conv === 'o' ? 8 : 10);
        if (conv === 'X') digits = digits.toUpperCase();
        if (sp.prec !== null) digits = digits.padStart(sp.prec, '0');
        if (sp.prec === 0 && v === 0n) digits = '';
        let prefix = '';
        if (signedConv) prefix = v < 0n ? '-' : sp.flags.includes('+') ? '+' : sp.flags.includes(' ') ? ' ' : '';
        if (sp.flags.includes('#') && v !== 0n) prefix = conv === 'x' ? '0x' : conv === 'X' ? '0X' : '';
        if (sp.flags.includes('#') && conv === 'o' && !digits.startsWith('0')) digits = '0' + digits;
        out += pad(prefix + digits, sp, width, true);
        break;
      }
      case 'c': {
        const c = arg!.k === 'i' ? Number(BigInt.asUintN(8, arg!.v)) : 0;
        out += pad(String.fromCharCode(c), sp, width, false);
        break;
      }
      case 's': {
        if (arg!.k !== 'i' || arg!.t.k !== 'ptr') { mismatch('s', arg!.k === 'f' ? 'a floating-point value' : 'an integer, not a char*'); out += pad('(null)', sp, width, false); break; }
        let s: string;
        if (arg!.v === 0n) s = '(null)';
        else {
          s = I.mem.readCString(Number(arg!.v));
        }
        if (sp.prec !== null) s = s.slice(0, sp.prec);
        out += pad(s, sp, width, false);
        break;
      }
      case 'p': {
        const a = arg!.k === 'i' ? BigInt.asUintN(64, arg!.v) : 0n;
        out += pad(pointerText(P, a, true), sp, width, false);
        break;
      }
      case 'f': case 'F': case 'e': case 'E': case 'g': case 'G': case 'a': case 'A': {
        if (arg!.k === 'i') { mismatch(conv, 'an integer'); out += pad('0.000000', sp, width, true); break; }
        const x = (arg as any).v as number;
        const upper = conv === 'E' || conv === 'G' || conv === 'F';
        const nf = nonFinite(x, P, upper);
        let body: string;
        if (nf !== null) body = nf;
        else {
          const pr = sp.prec ?? 6;
          const ax = Math.abs(x);
          if (conv === 'f' || conv === 'F') body = fmtFixed(ax, pr);
          else if (conv === 'e' || conv === 'E') body = fmtExp(ax, pr, upper);
          else if (conv === 'g' || conv === 'G') body = fmtG(ax, sp.prec ?? 6, sp.flags.includes('#'), upper);
          else body = ax.toString(16);
          if (sp.flags.includes('#') && !body.includes('.') && (conv === 'f' || conv === 'F')) body += '.';
        }
        const neg = nf !== null ? false : x < 0 || Object.is(x, -0);
        const sign = neg ? '-' : sp.flags.includes('+') ? '+' : sp.flags.includes(' ') ? ' ' : '';
        out += pad(sign + body, sp, width, nf === null);
        break;
      }
      case 'n': break;
      default:
        out += '%' + sp.flags + (sp.width ?? '') + conv;
    }
  }
  return out;
}
