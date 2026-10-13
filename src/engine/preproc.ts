// A small but real C preprocessor: #include (of known headers), #define (object/function-like, # and ##),
// #undef, #if/#ifdef/#ifndef/#elif/#else/#endif with constant expressions, #pragma pack/once, #error, #line.
import { CompileError, lex, type Token } from './lexer';

interface Macro {
  name: string;
  params: string[] | null; // null = object-like
  variadic: boolean;
  body: Token[];
}

export interface PreprocResult {
  tokens: Token[];
  includes: string[];
}

const KNOWN_HEADERS = new Set([
  'iostream', 'istream', 'ostream', 'iomanip', 'sstream', 'fstream', 'string', 'string_view', 'vector', 'array', 'list', 'forward_list', 'deque', 'stack', 'queue',
  'map', 'set', 'unordered_map', 'unordered_set', 'algorithm', 'numeric', 'functional', 'utility', 'tuple', 'memory', 'optional', 'variant', 'any',
  'cstdio', 'cstdlib', 'cstring', 'cmath', 'cctype', 'cassert', 'climits', 'cfloat', 'cstdint', 'cstddef', 'ctime', 'cstdarg', 'new', 'limits', 'typeinfo',
  'exception', 'stdexcept', 'iterator', 'type_traits', 'initializer_list', 'chrono', 'random', 'bitset', 'complex', 'cwchar', 'cerrno', 'locale', 'atomic', 'thread', 'mutex',
  'stdio.h', 'stdlib.h', 'string.h', 'math.h', 'ctype.h', 'assert.h', 'limits.h', 'float.h', 'stdint.h', 'stddef.h', 'time.h', 'stdarg.h', 'errno.h', 'bits/stdc++.h',
  'malloc.h', 'stdbool.h', 'iso646.h', 'inttypes.h', 'cinttypes', 'windows.h', 'conio.h', 'unistd.h', 'sys/types.h', 'typeindex', 'ranges', 'span', 'numbers', 'concepts', 'compare',
]);

const cloneTok = (t: Token, over: Partial<Token> = {}): Token => ({ ...t, ...over });

export function preprocess(source: string, predefined: Record<string, string> = {}, fileName = 'main.cpp'): PreprocResult {
  const macros = new Map<string, Macro>();
  const includes: string[] = [];

  const defineFromText = (name: string, text: string) => {
    const body = lex(text).filter((t) => t.k !== 'eof');
    macros.set(name, { name, params: null, variadic: false, body });
  };
  for (const [k, v] of Object.entries(predefined)) defineFromText(k, v);
  defineFromText('__cplusplus', predefined.__cplusplus ?? '201703L');
  defineFromText('__FILE__', JSON.stringify(fileName));

  const raw = lex(source);
  const out: Token[] = [];
  // conditional stack
  interface Cond { active: boolean; taken: boolean; parentActive: boolean; sawElse: boolean }
  const conds: Cond[] = [];
  const active = () => conds.every((c) => c.active);

  let i = 0;
  const lineTokens = (): Token[] => {
    // tokens on the same logical line as raw[i] (after '#')
    const ln = raw[i].line;
    const res: Token[] = [];
    while (raw[i].k !== 'eof' && (raw[i].line === ln || (!raw[i].bol && false))) { res.push(raw[i]); i++; if (raw[i].bol) break; }
    return res;
  };

  // ---- macro expansion ---------------------------------------------------------------------------
  const expand = (input: Token[], depth = 0): Token[] => {
    if (depth > 60) throw new CompileError('macro expansion too deep (is a macro defined in terms of itself?)', input[0]?.line ?? 0);
    const res: Token[] = [];
    for (let p = 0; p < input.length; p++) {
      const t = input[p];
      if (t.k !== 'id') { res.push(t); continue; }
      if (t.s === '__LINE__') { res.push({ ...t, k: 'num', s: String(t.origLine ?? t.line), big: BigInt(t.origLine ?? t.line), suf: '', raw: String(t.origLine ?? t.line) }); continue; }
      const m = macros.get(t.s);
      if (!m || t.hide?.has(t.s)) { res.push(t); continue; }
      if (m.params === null) {
        const hide = new Set([...(t.hide ?? []), m.name]);
        const body = m.body.map((b, bi) => cloneTok(b, { line: t.line, col: t.col, origLine: t.origLine ?? t.line, hide: new Set([...(b.hide ?? []), ...hide]), sp: bi === 0 ? t.sp : b.sp }));
        res.push(...expand(body, depth + 1));
        continue;
      }
      // function-like: need '('
      let q = p + 1;
      if (!(input[q] && input[q].k === 'op' && input[q].s === '(')) { res.push(t); continue; }
      q++;
      const args: Token[][] = [[]];
      let level = 1;
      while (q < input.length) {
        const a = input[q];
        if (a.k === 'op' && a.s === '(') level++;
        else if (a.k === 'op' && a.s === ')') { level--; if (level === 0) break; }
        if (a.k === 'op' && a.s === ',' && level === 1 && !(m.variadic && args.length > m.params.length - 1 + 0 && false)) {
          if (m.variadic && args.length >= m.params.length) { args[args.length - 1].push(a); q++; continue; }
          args.push([]); q++; continue;
        }
        args[args.length - 1].push(a);
        q++;
      }
      if (level !== 0) throw new CompileError(`unterminated argument list invoking macro "${m.name}"`, t.line, t.col);
      const nparams = m.params.length;
      if (nparams === 0 && args.length === 1 && args[0].length === 0) args.pop();
      if (!m.variadic && args.length !== nparams) throw new CompileError(`macro "${m.name}" requires ${nparams} argument(s), but ${args.length} given`, t.line, t.col);
      if (m.variadic && args.length < nparams - 1) throw new CompileError(`macro "${m.name}" requires at least ${nparams - 1} argument(s)`, t.line, t.col);
      if (m.variadic && args.length < nparams) args.push([]);
      const hide = new Set([...(t.hide ?? []), m.name]);
      const sub: Token[] = [];
      const paramIndex = (s: string) => (s === '__VA_ARGS__' && m.variadic ? nparams - 1 : m.params!.indexOf(s));
      for (let b = 0; b < m.body.length; b++) {
        const bt = m.body[b];
        // # param  (stringify)
        if (bt.k === 'op' && bt.s === '#' && m.body[b + 1]?.k === 'id' && paramIndex(m.body[b + 1].s) >= 0) {
          const arg = args[paramIndex(m.body[b + 1].s)] ?? [];
          const text = arg.map((x, xi) => (xi > 0 && x.sp ? ' ' : '') + (x.raw ?? x.s)).join('');
          sub.push({ k: 'str', s: text, line: t.line, col: t.col, bol: false, sp: bt.sp, pre: '', raw: JSON.stringify(text) });
          b++;
          continue;
        }
        // a ## b
        if (m.body[b + 1]?.k === 'op' && m.body[b + 1].s === '##' && b + 2 < m.body.length) {
          const left = bt.k === 'id' && paramIndex(bt.s) >= 0 ? args[paramIndex(bt.s)] ?? [] : [bt];
          const rt = m.body[b + 2];
          const right = rt.k === 'id' && paramIndex(rt.s) >= 0 ? args[paramIndex(rt.s)] ?? [] : [rt];
          const l = left.slice(), r = right.slice();
          if (l.length && r.length) {
            const joined = lex((l[l.length - 1].raw ?? l[l.length - 1].s) + (r[0].raw ?? r[0].s)).filter((x) => x.k !== 'eof');
            sub.push(...l.slice(0, -1), ...joined.map((x) => cloneTok(x, { line: t.line, col: t.col, bol: false })), ...r.slice(1));
          } else sub.push(...l, ...r);
          b += 2;
          // continue chain a ## b ## c
          while (m.body[b + 1]?.k === 'op' && m.body[b + 1].s === '##' && b + 2 < m.body.length) {
            const nt = m.body[b + 2];
            const nr = nt.k === 'id' && paramIndex(nt.s) >= 0 ? args[paramIndex(nt.s)] ?? [] : [nt];
            const last = sub.pop()!;
            if (nr.length) {
              const joined = lex((last.raw ?? last.s) + (nr[0].raw ?? nr[0].s)).filter((x) => x.k !== 'eof');
              sub.push(...joined.map((x) => cloneTok(x, { line: t.line, col: t.col, bol: false })), ...nr.slice(1));
            } else sub.push(last);
            b += 2;
          }
          continue;
        }
        if (bt.k === 'id' && paramIndex(bt.s) >= 0) {
          const arg = expand(args[paramIndex(bt.s)] ?? [], depth + 1);
          sub.push(...arg.map((x, xi) => cloneTok(x, { sp: xi === 0 ? bt.sp : x.sp })));
          continue;
        }
        sub.push(cloneTok(bt, { line: t.line, col: t.col, origLine: t.origLine ?? t.line }));
      }
      const hidden = sub.map((x) => cloneTok(x, { hide: new Set([...(x.hide ?? []), ...hide]) }));
      res.push(...expand(hidden, depth + 1));
      p = q;
    }
    return res;
  };

  // ---- #if expressions ---------------------------------------------------------------------------
  const evalCond = (toks: Token[], line: number): bigint => {
    // replace defined X / defined(X)
    const pre: Token[] = [];
    for (let p = 0; p < toks.length; p++) {
      const t = toks[p];
      if (t.k === 'id' && t.s === 'defined') {
        let name: string;
        if (toks[p + 1]?.s === '(') { name = toks[p + 2]?.s; p += 3; } else { name = toks[p + 1]?.s; p += 1; }
        pre.push({ ...t, k: 'num', s: macros.has(name) ? '1' : '0', big: macros.has(name) ? 1n : 0n, suf: '' });
      } else if (t.k === 'id' && t.s === '__has_include') {
        let q = p + 1; if (toks[q]?.s === '(') { let lvl = 0; do { if (toks[q].s === '(') lvl++; if (toks[q].s === ')') lvl--; q++; } while (q < toks.length && lvl > 0); }
        p = q - 1; pre.push({ ...t, k: 'num', s: '1', big: 1n, suf: '' });
      } else pre.push(t);
    }
    const ex = expand(pre).map((t) => (t.k === 'id' ? ({ ...t, k: 'num', s: '0', big: 0n, suf: '' } as Token) : t));
    let pos = 0;
    const peek = () => ex[pos];
    const eat = (s?: string) => { const t = ex[pos]; if (s !== undefined && t?.s !== s) throw new CompileError(`#if: expected '${s}'`, line); pos++; return t; };
    const prim = (): bigint => {
      const t = peek();
      if (!t) throw new CompileError('#if with no expression', line);
      if (t.k === 'num') { pos++; return t.big!; }
      if (t.k === 'chr') { pos++; return t.big!; }
      if (t.k === 'op' && t.s === '(') { pos++; const v = cond(); eat(')'); return v; }
      if (t.k === 'op' && t.s === '!') { pos++; return prim() === 0n ? 1n : 0n; }
      if (t.k === 'op' && t.s === '-') { pos++; return -prim(); }
      if (t.k === 'op' && t.s === '+') { pos++; return prim(); }
      if (t.k === 'op' && t.s === '~') { pos++; return ~prim(); }
      throw new CompileError(`#if: unexpected '${t.s}'`, line);
    };
    const binop = (lvl: number): bigint => {
      const levels: string[][] = [['||'], ['&&'], ['|'], ['^'], ['&'], ['==', '!='], ['<', '>', '<=', '>='], ['<<', '>>'], ['+', '-'], ['*', '/', '%']];
      if (lvl >= levels.length) return prim();
      let l = binop(lvl + 1);
      while (peek() && peek().k === 'op' && levels[lvl].includes(peek().s)) {
        const op = eat().s;
        const r = binop(lvl + 1);
        switch (op) {
          case '||': l = l !== 0n || r !== 0n ? 1n : 0n; break;
          case '&&': l = l !== 0n && r !== 0n ? 1n : 0n; break;
          case '|': l |= r; break; case '^': l ^= r; break; case '&': l &= r; break;
          case '==': l = l === r ? 1n : 0n; break; case '!=': l = l !== r ? 1n : 0n; break;
          case '<': l = l < r ? 1n : 0n; break; case '>': l = l > r ? 1n : 0n; break;
          case '<=': l = l <= r ? 1n : 0n; break; case '>=': l = l >= r ? 1n : 0n; break;
          case '<<': l <<= r; break; case '>>': l >>= r; break;
          case '+': l += r; break; case '-': l -= r; break; case '*': l *= r; break;
          case '/': if (r === 0n) throw new CompileError('division by zero in #if', line); l /= r; break;
          case '%': if (r === 0n) throw new CompileError('division by zero in #if', line); l %= r; break;
        }
      }
      return l;
    };
    const cond = (): bigint => {
      const c = binop(0);
      if (peek()?.s === '?') { eat('?'); const a = cond(); eat(':'); const b = cond(); return c !== 0n ? a : b; }
      return c;
    };
    const v = cond();
    if (pos < ex.length) throw new CompileError(`#if: extra tokens at end of expression`, line);
    return v;
  };

  // ---- main loop ----------------------------------------------------------------------------------
  const pendingLine: Token[] = [];
  const flush = () => {
    if (pendingLine.length === 0) return;
    out.push(...expand(pendingLine.splice(0)));
  };

  while (raw[i].k !== 'eof') {
    const t = raw[i];
    if (t.k === 'op' && t.s === '#' && t.bol) {
      flush();
      i++;
      const ln = t.line;
      const toks: Token[] = [];
      while (raw[i].k !== 'eof' && !raw[i].bol) { toks.push(raw[i]); i++; }
      if (toks.length === 0) continue; // null directive
      const dir = toks[0].s;
      const rest = toks.slice(1);
      const act = active();
      switch (dir) {
        case 'if': {
          const parentActive = act;
          const v = parentActive ? evalCond(rest, ln) !== 0n : false;
          conds.push({ active: v, taken: v, parentActive, sawElse: false });
          break;
        }
        case 'ifdef': case 'ifndef': {
          const defd = macros.has(rest[0]?.s ?? '');
          const v = dir === 'ifdef' ? defd : !defd;
          conds.push({ active: act ? v : false, taken: v, parentActive: act, sawElse: false });
          break;
        }
        case 'elif': {
          const c = conds[conds.length - 1];
          if (!c) throw new CompileError('#elif without #if', ln);
          if (c.taken || !c.parentActive) c.active = false;
          else { const v = evalCond(rest, ln) !== 0n; c.active = v; c.taken = v; }
          break;
        }
        case 'else': {
          const c = conds[conds.length - 1];
          if (!c) throw new CompileError('#else without #if', ln);
          if (c.sawElse) throw new CompileError('#else after #else', ln);
          c.sawElse = true;
          c.active = c.parentActive && !c.taken;
          c.taken = true;
          break;
        }
        case 'endif':
          if (!conds.pop()) throw new CompileError('#endif without #if', ln);
          break;
        case 'define': {
          if (!act) break;
          const nameTok = rest[0];
          if (!nameTok || nameTok.k !== 'id') throw new CompileError('macro name missing in #define', ln);
          let params: string[] | null = null;
          let variadic = false;
          let bodyStart = 1;
          if (rest[1]?.k === 'op' && rest[1].s === '(' && !rest[1].sp) {
            params = [];
            let q = 2;
            while (q < rest.length && rest[q].s !== ')') {
              if (rest[q].s === '...') { variadic = true; params.push('__VA_ARGS__'); q++; continue; }
              if (rest[q].k === 'id') {
                params.push(rest[q].s);
                if (rest[q + 1]?.s === '...') { variadic = true; q++; }
              }
              q++;
            }
            bodyStart = q + 1;
          }
          macros.set(nameTok.s, { name: nameTok.s, params, variadic, body: rest.slice(bodyStart) });
          break;
        }
        case 'undef': if (act) macros.delete(rest[0]?.s ?? ''); break;
        case 'include': {
          if (!act) break;
          let name = '';
          if (rest[0]?.k === 'str') name = rest[0].s;
          else if (rest[0]?.s === '<') name = rest.slice(1, rest.findIndex((x) => x.s === '>')).map((x) => x.s).join('');
          else {
            const ex = expand(rest);
            if (ex[0]?.k === 'str') name = ex[0].s;
            else if (ex[0]?.s === '<') name = ex.slice(1, ex.findIndex((x) => x.s === '>')).map((x) => x.s).join('');
          }
          if (!name) throw new CompileError('#include expects "FILENAME" or <FILENAME>', ln);
          if (!KNOWN_HEADERS.has(name)) {
            const quoted = rest[0]?.k === 'str';
            throw new CompileError(quoted ? `${name}: No such file or directory — Stackyard runs one source file; put everything in the editor` : `${name}: No such file or directory (this simulator only knows the standard headers)`, ln);
          }
          includes.push(name);
          break;
        }
        case 'pragma': {
          if (!act) break;
          // keep '#pragma pack(...)' as a marker token sequence for the parser
          if (rest[0]?.s === 'pack') {
            out.push({ k: 'op', s: '#pragma_pack', line: ln, col: 1, bol: true, sp: true });
            for (const x of rest.slice(1)) out.push(x);
            out.push({ k: 'op', s: '#pragma_end', line: ln, col: 1, bol: false, sp: false });
          }
          break;
        }
        case 'error': if (act) throw new CompileError('#error ' + rest.map((x) => x.raw ?? x.s).join(' '), ln); break;
        case 'warning': case 'line': break;
        default:
          if (act) throw new CompileError(`invalid preprocessing directive #${dir}`, ln);
      }
      continue;
    }
    if (!active()) { i++; continue; }
    pendingLine.push(t);
    i++;
    // expand once per ~line to bound the lookahead needed for function-like macros
    if (raw[i].bol && pendingLine.length > 0) {
      // function-like macro invocations can span lines; keep accumulating while parens are unbalanced
      let lvl = 0;
      for (const x of pendingLine) { if (x.k === 'op' && x.s === '(') lvl++; else if (x.k === 'op' && x.s === ')') lvl--; }
      const lastIsFnMacro = (() => { const l = pendingLine[pendingLine.length - 1]; const m = l?.k === 'id' ? macros.get(l.s) : undefined; return !!m && m.params !== null; })();
      if (lvl <= 0 && !lastIsFnMacro && !(raw[i].k === 'op' && raw[i].s === '(')) flush();
    }
  }
  flush();
  if (conds.length) throw new CompileError('unterminated #if', raw[raw.length - 1].line);
  out.push({ k: 'eof', s: '', line: raw[raw.length - 1].line, col: 1, bol: true, sp: true });
  return { tokens: out, includes };
}
