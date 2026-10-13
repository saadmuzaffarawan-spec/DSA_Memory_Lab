// C++ lexer. Produces tokens with line/column and a "beginning of line" flag for the preprocessor.

export class CompileError extends Error {
  constructor(message: string, public line = 0, public col = 0) {
    super(message);
    this.name = 'CompileError';
  }
}

export type TokKind = 'id' | 'num' | 'fnum' | 'str' | 'chr' | 'op' | 'eof';

export interface Token {
  k: TokKind;
  s: string; // spelling (identifiers/operators) or decoded contents (strings)
  line: number;
  col: number;
  /** first token on its source line (preprocessor directives start with '#' at bol) */
  bol: boolean;
  /** preceded by whitespace (needed for function-like macro / stringification fidelity) */
  sp: boolean;
  /** numbers: value; chars: code point */
  big?: bigint;
  flt?: number;
  /** suffix for numbers (u, l, ul, ll, ull, f ...) */
  suf?: string;
  /** string/char prefix: '', 'L', 'u8', 'u', 'U' */
  pre?: string;
  /** original spelling of numbers/strings for stringification */
  raw?: string;
  /** macro names that must not be expanded again in this token (hide set) */
  hide?: Set<string>;
  /** line in the original file even after macro expansion */
  origLine?: number;
}

const OPS3 = ['<<=', '>>=', '<=>', '...', '->*'];
const OPS2 = ['::', '->', '++', '--', '<<', '>>', '<=', '>=', '==', '!=', '&&', '||', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '.*', '##'];
const OPS1 = '{}[]()<>;:,.?+-*/%&|^~!=#';

const isIdStart = (c: string) => /[A-Za-z_$]/.test(c);
const isIdChar = (c: string) => /[A-Za-z0-9_$]/.test(c);
const isDigit = (c: string) => c >= '0' && c <= '9';

export function lex(src: string): Token[] {
  const toks: Token[] = [];
  let i = 0;
  let line = 1;
  let col = 1;
  let bol = true;
  let sp = false;
  const n = src.length;

  const adv = (k = 1) => {
    for (let j = 0; j < k; j++) {
      if (src[i] === '\n') { line++; col = 1; } else col++;
      i++;
    }
  };
  const push = (t: Omit<Token, 'bol' | 'sp'>) => {
    toks.push({ ...t, bol, sp });
    bol = false;
    sp = false;
  };

  const readEscape = (): number => {
    // at backslash
    adv();
    const c = src[i];
    const simple: Record<string, number> = { n: 10, t: 9, r: 13, a: 7, b: 8, f: 12, v: 11, '0': 0, '\\': 92, "'": 39, '"': 34, '?': 63 };
    if (c === 'x') {
      adv();
      let h = '';
      while (i < n && /[0-9a-fA-F]/.test(src[i])) { h += src[i]; adv(); }
      return parseInt(h || '0', 16);
    }
    if (c >= '0' && c <= '7') {
      let o = '';
      while (o.length < 3 && i < n && src[i] >= '0' && src[i] <= '7') { o += src[i]; adv(); }
      return parseInt(o, 8);
    }
    if (c === 'u' || c === 'U') {
      const len = c === 'u' ? 4 : 8;
      adv();
      let h = '';
      while (h.length < len && i < n && /[0-9a-fA-F]/.test(src[i])) { h += src[i]; adv(); }
      return parseInt(h, 16);
    }
    if (c in simple) { adv(); return simple[c]; }
    adv();
    return c.charCodeAt(0);
  };

  while (i < n) {
    const c = src[i];
    if (c === '\n') { bol = true; sp = true; adv(); continue; }
    if (c === ' ' || c === '\t' || c === '\r' || c === '\f' || c === '\v') { sp = true; adv(); continue; }
    if (c === '\\' && (src[i + 1] === '\n' || (src[i + 1] === '\r' && src[i + 2] === '\n'))) { adv(src[i + 1] === '\r' ? 3 : 2); sp = true; continue; }
    if (c === '/' && src[i + 1] === '/') { while (i < n && src[i] !== '\n') { if (src[i] === '\\' && src[i + 1] === '\n') adv(2); else adv(); } sp = true; continue; }
    if (c === '/' && src[i + 1] === '*') {
      const l0 = line, c0 = col;
      adv(2);
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) adv();
      if (i >= n) throw new CompileError('unterminated /* comment', l0, c0);
      adv(2);
      sp = true;
      continue;
    }
    const l0 = line, c0 = col;

    // string / char literals (with optional prefix, raw strings)
    const prefMatch = /^(u8|u|U|L)?(R)?(["'])/.exec(src.slice(i, i + 5));
    if (prefMatch && (prefMatch[0].length > 1 || c === '"' || c === "'")) {
      const pre = prefMatch[1] ?? '';
      const raw = !!prefMatch[2];
      const quote = prefMatch[3];
      if (!(raw && quote === "'")) {
        adv(prefMatch[0].length);
        if (raw) {
          let delim = '';
          while (i < n && src[i] !== '(') { delim += src[i]; adv(); }
          adv();
          const endSeq = ')' + delim + '"';
          let s = '';
          while (i < n && !src.startsWith(endSeq, i)) { s += src[i]; adv(); }
          if (i >= n) throw new CompileError('unterminated raw string literal', l0, c0);
          adv(endSeq.length);
          push({ k: 'str', s, line: l0, col: c0, pre, raw: 'R"' + delim + '(' + s + ')' + delim + '"' });
          continue;
        }
        let s = '';
        const codes: number[] = [];
        while (i < n && src[i] !== quote) {
          if (src[i] === '\n') throw new CompileError(`missing terminating ${quote} character`, l0, c0);
          if (src[i] === '\\') { const cc = readEscape(); codes.push(cc); s += String.fromCodePoint(cc); }
          else { const cp = src.codePointAt(i)!; codes.push(cp); s += String.fromCodePoint(cp); adv(cp > 0xffff ? 2 : 1); }
        }
        if (i >= n) throw new CompileError(`missing terminating ${quote} character`, l0, c0);
        adv();
        if (quote === '"') push({ k: 'str', s, line: l0, col: c0, pre, raw: JSON.stringify(s) });
        else {
          if (codes.length === 0) throw new CompileError('empty character constant', l0, c0);
          // multi-char constants: value built like GCC (big-endian packing)
          let v = 0n;
          for (const cc of codes) v = (v << 8n) | BigInt(cc & 0xff);
          push({ k: 'chr', s, line: l0, col: c0, pre, big: codes.length === 1 ? BigInt(codes[0]) : v });
        }
        continue;
      }
    }

    if (isIdStart(c)) {
      let s = '';
      while (i < n && isIdChar(src[i])) { s += src[i]; adv(); }
      push({ k: 'id', s, line: l0, col: c0 });
      continue;
    }

    if (isDigit(c) || (c === '.' && isDigit(src[i + 1] ?? ''))) {
      let s = '';
      let isFloat = false;
      const hex = c === '0' && (src[i + 1] === 'x' || src[i + 1] === 'X');
      const bin = c === '0' && (src[i + 1] === 'b' || src[i + 1] === 'B');
      if (hex || bin) { s += src[i] + src[i + 1]; adv(2); }
      while (i < n) {
        const d = src[i];
        if (d === "'" && i + 1 < n && /[0-9a-fA-F]/.test(src[i + 1])) { adv(); continue; } // digit separator
        if (hex ? /[0-9a-fA-F]/.test(d) : bin ? /[01]/.test(d) : isDigit(d)) { s += d; adv(); continue; }
        if (!hex && !bin && d === '.') { isFloat = true; s += d; adv(); continue; }
        if (!hex && !bin && (d === 'e' || d === 'E')) {
          isFloat = true; s += d; adv();
          if (src[i] === '+' || src[i] === '-') { s += src[i]; adv(); }
          continue;
        }
        if (hex && (d === 'p' || d === 'P')) {
          isFloat = true; s += d; adv();
          if (src[i] === '+' || src[i] === '-') { s += src[i]; adv(); }
          continue;
        }
        if (hex && d === '.') { isFloat = true; s += d; adv(); continue; }
        break;
      }
      let suf = '';
      while (i < n && /[uUlLfF]/.test(src[i])) { suf += src[i]; adv(); }
      suf = suf.toLowerCase();
      if (isFloat || (!hex && !bin && (suf === 'f') && false)) {
        let v: number;
        if (hex) {
          const m = /^0[xX]([0-9a-fA-F]*)\.?([0-9a-fA-F]*)[pP]([+-]?\d+)$/.exec(s);
          if (!m) throw new CompileError('invalid hexadecimal floating constant', l0, c0);
          v = (parseInt(m[1] || '0', 16) + (m[2] ? parseInt(m[2], 16) / Math.pow(16, m[2].length) : 0)) * Math.pow(2, Number(m[3]));
        } else v = parseFloat(s);
        push({ k: 'fnum', s, line: l0, col: c0, flt: v, suf, raw: s + suf });
      } else {
        let big: bigint;
        try {
          if (hex || bin) big = BigInt(s);
          else if (s.length > 1 && s[0] === '0') big = BigInt('0o' + s.slice(1));
          else big = BigInt(s);
        } catch { throw new CompileError(`invalid integer constant '${s}'`, l0, c0); }
        if (suf === 'f') { push({ k: 'fnum', s, line: l0, col: c0, flt: Number(big), suf, raw: s + suf }); }
        else push({ k: 'num', s, line: l0, col: c0, big, suf, raw: s + suf });
      }
      continue;
    }

    const three = src.substr(i, 3);
    if (OPS3.includes(three)) { push({ k: 'op', s: three, line: l0, col: c0 }); adv(3); continue; }
    const two = src.substr(i, 2);
    if (OPS2.includes(two)) { push({ k: 'op', s: two, line: l0, col: c0 }); adv(2); continue; }
    if (OPS1.includes(c)) { push({ k: 'op', s: c, line: l0, col: c0 }); adv(); continue; }
    throw new CompileError(`stray '${c}' in program`, l0, c0);
  }
  toks.push({ k: 'eof', s: '', line, col, bol: true, sp: true });
  return toks;
}
