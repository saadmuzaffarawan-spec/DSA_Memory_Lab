// Expression evaluation.
import type * as A from './ast';
import { Fault } from './memory';
import { CompileError } from './lexer';
import type { Interp } from './interp';
import type { Fn, FuncTemplate, Scope, TArgVal, V } from './env';
import { CxxThrow, newScope } from './env';
import {
  arrOf, clsType, constOf, intInfo, isFloat, isInt, isScalar, ptrTo, refTo, sameType, stripCv, stripRef, typeStr, withCv, type ClassInfo, type FieldInfo, type Type,
} from './types';
import { alignOf, sizeOf } from './layout';
import { arithBinary, commonType, convertScalar, promote } from './arith';
import {
  baseOffsetOf, evalTArgs, findMember, isAuto, isBaseOf, lookupQName, lookupUnqualified, resolveTypeExpr, type LookupResult, type MemberHit,
} from './typeres';
import {
  callFnValue, callOperator, callValue, construct, convertTo, destroyObj, dynamicObject, hasNontrivialDtor, initFromBraces, initFromExpr, isDerivedPtrConv, materialize, newTempObj, upcastAddr,
  valueInit, findConversionFn, invokeFn, releaseTemps, probeConstruct,
} from './call';
import { makeLambdaClass } from './decls';
import { evalTrait } from './traits';

type Id = Extract<A.Expr, { k: 'id' }>;

// ---- small helpers ------------------------------------------------------------------------------------------------
export const isClassT = (t: Type): t is Extract<Type, { k: 'cls' }> => t.k === 'cls';

export function lvalueOf(I: Interp, v: V, what = 'this expression'): Extract<V, { k: 'l' }> {
  if (v.k !== 'l') I.cerr(`${what} must be an lvalue (something with an address)`);
  return v;
}

export function pointeeSize(I: Interp, t: Type): number {
  if (t.k === 'void') return 1;
  if (t.k === 'fn') return 1;
  return sizeOf(t);
}

/** run `f` without touching memory (sizeof, decltype, return-type deduction) */
export function unevaluated<T>(I: Interp, f: () => T): T {
  I.uneval++;
  const tmp = I.tmpStack.length;
  try { return f(); } finally { I.uneval--; I.tmpStack.length = tmp; }
}

export function typeOfExpr(I: Interp, e: A.Expr, scope: Scope): V {
  const saved = I.scope;
  I.scope = scope;
  try { return unevaluated(I, () => evalExpr(I, e)); } finally { I.scope = saved; }
}

export function evalConstInt(I: Interp, e: A.Expr, scope: Scope): { v: bigint; t: Type } {
  const saved = I.scope;
  I.scope = scope;
  try {
    return I.mem.withSilence(() => {
      const r = I.rv(evalExpr(I, e));
      if (r.k === 'i') return { v: r.v, t: r.t };
      if (r.k === 'f') return { v: BigInt(Math.trunc(r.v)), t: I.T.int };
      I.cerr('a constant expression was expected');
    });
  } finally { I.scope = saved; }
}

// ---- literals -----------------------------------------------------------------------------------------------------
function numLit(I: Interp, e: Extract<A.Expr, { k: 'num' }>): V {
  const T = I.T;
  const raw = e.raw.toLowerCase();
  const decimal = !/^0([xb]|[0-7])/.test(raw) || raw === '0';
  const suf = e.suf.toLowerCase();
  const u = suf.includes('u');
  const ll = suf.includes('ll');
  const l = !ll && suf.includes('l');
  const all = decimal
    ? (u ? (ll ? [T.ullong] : l ? [T.ulong, T.ullong] : [T.uint, T.ulong, T.ullong]) : ll ? [T.llong] : l ? [T.long, T.llong] : [T.int, T.long, T.llong])
    : (u ? (ll ? [T.ullong] : l ? [T.ulong, T.ullong] : [T.uint, T.ulong, T.ullong])
      : ll ? [T.llong, T.ullong] : l ? [T.long, T.ulong, T.llong, T.ullong] : [T.int, T.uint, T.long, T.ulong, T.llong, T.ullong]);
  for (const t of all) {
    const { bytes, signed } = intInfo(t);
    const max = signed ? (1n << BigInt(bytes * 8 - 1)) - 1n : (1n << BigInt(bytes * 8)) - 1n;
    if (e.v <= max) return { k: 'i', t, v: e.v };
  }
  return { k: 'i', t: T.ullong, v: BigInt.asUintN(64, e.v) };
}

function charLit(I: Interp, e: Extract<A.Expr, { k: 'chr' }>): V {
  const T = I.T;
  const t = e.pre === 'L' ? T.wchar : e.pre === 'u' ? T.char16 : e.pre === 'U' ? T.char32 : T.char;
  return I.mkInt(t, e.v);
}

function strLit(I: Interp, e: Extract<A.Expr, { k: 'str' }>): V {
  const T = I.T;
  const bytesPer = e.pre === 'L' ? I.plat.wcharBytes : e.pre === 'u' ? 2 : e.pre === 'U' ? 4 : 1;
  const et = e.pre === 'L' ? T.wchar : e.pre === 'u' ? T.char16 : e.pre === 'U' ? T.char32 : T.char;
  const n = bytesPer === 1 ? new TextEncoder().encode(e.s).length : Array.from(e.s).length;
  const a = I.uneval ? 0 : I.stringLiteral(e.s, bytesPer);
  return { k: 'l', t: arrOf(constOf(et), n + 1), a };
}

// ---- main dispatcher -----------------------------------------------------------------------------------------------
export function evalExpr(I: Interp, e: A.Expr): V {
  I.tick();
  switch (e.k) {
    case 'num': return numLit(I, e);
    case 'fnum': {
      const t = e.suf.toLowerCase() === 'f' ? I.T.float : e.suf.toLowerCase() === 'l' ? I.T.ldouble : I.T.double;
      return I.mkFloat(t, e.v);
    }
    case 'chr': return charLit(I, e);
    case 'str': return strLit(I, e);
    case 'bool': return I.mkBool(e.v);
    case 'nullptr': return { k: 'i', t: I.T.nullptr, v: 0n };
    case 'this': {
      const th = I.frame.thisV;
      if (!th || th.k !== 'l') I.cerr("'this' cannot be used outside a non-static member function", e.pos);
      return I.mkPtr(th.t, th.a);
    }
    case 'id': return evalId(I, e);
    case 'un': return evalUnary(I, e);
    case 'post': return evalPostfix(I, e);
    case 'bin': return evalBinary(I, e);
    case 'assign': return evalAssign(I, e);
    case 'cond': return evalCond(I, e);
    case 'call': return evalCall(I, e);
    case 'index': return evalIndex(I, e);
    case 'member': return evalMember(I, e);
    case 'cast': return evalCast(I, e);
    case 'fcast': return evalFcast(I, e);
    case 'sizeof-t': {
      const t = resolveTypeExpr(I, e.t, I.scope);
      return I.mkInt(I.T.sizeT, BigInt(sizeOfChecked(I, t)));
    }
    case 'sizeof-e': {
      const v = typeOfExpr(I, e.e, I.scope);
      const t = v.k === 'l' ? v.t : v.k === 'i' || v.k === 'f' ? v.t : I.cerr('sizeof needs an expression with a type');
      return I.mkInt(I.T.sizeT, BigInt(sizeOfChecked(I, t)));
    }
    case 'alignof': return I.mkInt(I.T.sizeT, BigInt(alignOf(resolveTypeExpr(I, e.t, I.scope))));
    case 'sizeof-pack': {
      const r = lookupUnqualified(I, e.name, I.scope);
      const ent = r?.ents[0];
      if (!ent || ent.k !== 'pack') I.cerr(`'${e.name}' is not a parameter pack`);
      return I.mkInt(I.T.sizeT, BigInt(ent.items.length));
    }
    case 'new': return evalNew(I, e);
    case 'delete': return evalDelete(I, e);
    case 'lambda': return evalLambda(I, e);
    case 'init': return { k: 'init', items: [], node: e };
    case 'throw': if (I.uneval) { I.canThrow = true; return I.voidV(); } return evalThrow(I, e);
    case 'noexcept': return I.mkBool(!probeCanThrow(I, e.e));
    case 'trait': return I.mkBool(evalTrait(I, e.name, e.types.map((t) => resolveTypeExpr(I, t, I.scope))));
    case 'fold': return evalFold(I, e);
    case 'expand': I.cerr('a pack expansion can only appear in an argument list, braced list or fold expression', e.pos);
    case 'type': return { k: 'type', t: resolveTypeExpr(I, e.t, I.scope) };
    case 'typeid': I.cerr('typeid is not supported by this simulator', e.pos);
  }
}

function sizeOfChecked(I: Interp, t: Type): number {
  if (t.k === 'cls') I.completeClass(t.c);
  if (t.k === 'cls' && !t.c.defined) I.cerr(`invalid application of 'sizeof' to incomplete type '${t.c.name}'`);
  if (t.k === 'arr' && t.n === null) I.cerr("invalid application of 'sizeof' to an array of unknown bound");
  if (t.k === 'ref') return sizeOf(t.to);
  return sizeOf(t);
}

// ---- identifiers ------------------------------------------------------------------------------------------------------
export function thisFor(I: Interp, cls: ClassInfo): Extract<V, { k: 'l' }> | null {
  for (let i = I.frames.length - 1; i >= 0; i--) {
    const f = I.frames[i];
    const th = f.thisV;
    if (!th || th.k !== 'l' || th.t.k !== 'cls') continue;
    const c = th.t.c;
    if (c === cls) return th;
    if (isBaseOf(cls, c)) {
      const off = baseOffsetOf(I, c, cls) ?? 0;
      return { k: 'l', t: withCv(clsType(cls), th.t), a: th.a + off };
    }
    // lambda closure: reach the enclosing object through the captured `this`
    const fld = c.x.fieldMap?.get('this') as FieldInfo | undefined;
    if (fld && c.x.lambda) {
      const p = I.load(fld.type, th.a + (fld.offset ?? 0));
      if (p.k === 'i' && p.t.k === 'ptr' && p.t.to.k === 'cls') {
        const pc = p.t.to.c;
        const base = { k: 'l', t: p.t.to, a: Number(p.v) } as Extract<V, { k: 'l' }>;
        if (pc === cls) return base;
        if (isBaseOf(cls, pc)) return { k: 'l', t: withCv(clsType(cls), p.t.to), a: base.a + (baseOffsetOf(I, pc, cls) ?? 0) };
      }
    }
    if (f.fn && !f.fn.lambda) break;
  }
  return null;
}

function varLv(I: Interp, t: Type, addr: number): V {
  if (t.k === 'ref') return I.uneval ? { k: 'l', t: t.to, a: 0 } : I.load(t, addr);
  return { k: 'l', t, a: addr };
}

export function fieldLv(I: Interp, objAddr: number, f: FieldInfo, objT: Type): V {
  const off = f.offset ?? 0;
  let t = f.type;
  if (objT.const && !f.mutable && t.k !== 'ref') t = constOf(t);
  if (f.bits !== undefined && f.bits > 0 && f.type.k !== 'ref') {
    const unit = f.bitUnit ?? sizeOf(f.type);
    const bt = f.type;
    const signed = bt.k === 'int' ? bt.signed : bt.k === 'enum' ? intInfo(bt).signed : false;
    return { k: 'l', t, a: objAddr + off, bf: { bit: f.bitOffset ?? 0, width: f.bits, signed, unit } };
  }
  if (t.k === 'ref') return varLv(I, t, objAddr + off);
  return { k: 'l', t, a: objAddr + off };
}

function memberHitToV(I: Interp, r: LookupResult, e: Id, hit: MemberHit): V {
  const cls = r.scope.cls!;
  const last = e.q.parts[e.q.parts.length - 1];
  if (hit.field) {
    const th = thisFor(I, cls);
    if (!th) I.cerr(`invalid use of non-static data member '${hit.field.name}' (there is no object: add an object or make it static)`, e.pos);
    return fieldLv(I, th.a + hit.baseOffset, hit.field, th.t);
  }
  const ent = hit.ents[0];
  switch (ent.k) {
    case 'var': return varLv(I, ent.type, ent.addr);
    case 'fns': {
      const th = thisFor(I, cls);
      const self: V | undefined = th ? { k: 'l', t: th.t.k === 'cls' ? withCv(clsType(hit.owner), th.t) : th.t, a: th.a + hit.baseOffset } : undefined;
      return {
        k: 'fn', name: last.id, cands: ent.fns, tmpls: ent.ftempls, self, ctxCls: cls,
        targs: last.targs ? evalTArgs(I, last.targs, I.scope) : undefined, qualified: e.q.parts.length > 1,
      };
    }
    case 'enumc': return { k: 'i', t: ent.type, v: ent.value };
    case 'tval': return { k: 'i', t: ent.type, v: ent.value };
    case 'type': return { k: 'type', t: ent.type };
    case 'ctempl': return { k: 'tmpl', ent: ent.t };
    default: I.cerr(`'${last.id}' cannot be used here`, e.pos);
  }
}

export function evalId(I: Interp, e: Id): V {
  const q = e.q;
  const name = q.parts.map((p) => p.id).join('::');
  const r = lookupQName(I, q, I.scope);
  if (!r) {
    I.cerr(`'${name}' was not declared in this scope`, e.pos);
  }
  if (r.hit) return memberHitToV(I, r, e, r.hit);
  const last = q.parts[q.parts.length - 1];
  const ent = r.ents[0];
  switch (ent.k) {
    case 'var': {
      return varLv(I, ent.type, ent.addr);
    }
    case 'fns': {
      // overloads from using-directives and the plain scope chain are merged by the lookup
      return {
        k: 'fn', name: last.id, cands: ent.fns, tmpls: ent.ftempls,
        targs: last.targs ? evalTArgs(I, last.targs, I.scope) : undefined, qualified: q.parts.length > 1 || !!q.global,
      };
    }
    case 'enumc': return { k: 'i', t: ent.type, v: ent.value };
    case 'tval': return { k: 'i', t: ent.type, v: ent.value };
    case 'type': return { k: 'type', t: ent.type };
    case 'ctempl': return { k: 'tmpl', ent: ent.t };
    case 'vtempl': {
      if (!last.targs) I.cerr(`'${name}' is a variable template and needs template arguments`, e.pos);
      const v = I.instantiateVarTemplate(ent, evalTArgs(I, last.targs, I.scope));
      return varLv(I, v.type, v.addr);
    }
    case 'ns': I.cerr(`'${name}' is a namespace, not a value`, e.pos);
    case 'pack': {
      const idx = I.packIdx.get(last.id);
      if (idx === undefined) I.cerr(`parameter pack '${last.id}' must be expanded with '...'`, e.pos);
      if (ent.vals) return ent.vals[idx];
      const item = ent.items[idx];
      if (item.k === 'val') return { k: 'i', t: item.t, v: item.v };
      if (item.k === 'type') return { k: 'type', t: item.t };
      I.cerr(`'${last.id}' is a template pack and cannot be used as a value`, e.pos);
    }
    case 'bind': return bindingLv(I, ent);
    case 'cap': I.cerr('internal: capture entity');
  }
}

function bindingLv(I: Interp, ent: Extract<import('./env').Ent, { k: 'bind' }>): V {
  const src = ent.source;
  if (src.k !== 'l') I.cerr('structured binding source must be an object');
  const t = src.t;
  if (t.k === 'arr') {
    const es = sizeOf(t.of);
    return { k: 'l', t: t.of, a: src.a + ent.index * es };
  }
  if (t.k === 'cls') {
    const fields = collectBindingFields(I, t.c);
    const f = fields[ent.index];
    if (!f) I.cerr('too few members for this structured binding');
    return fieldLv(I, src.a + f.base, f.f, t);
  }
  I.cerr('this type cannot be used in a structured binding');
}

export function collectBindingFields(I: Interp, c: ClassInfo): Array<{ f: FieldInfo; base: number }> {
  I.completeClass(c);
  const out: Array<{ f: FieldInfo; base: number }> = [];
  for (const b of c.bases) { for (const x of collectBindingFields(I, b.cls)) out.push({ f: x.f, base: x.base + (b.offset ?? 0) }); }
  for (const f of c.fields) if (!f.isStatic) out.push({ f, base: 0 });
  return out;
}

// ---- unary ---------------------------------------------------------------------------------------------------------------
function unarySign(I: Interp, op: string, v: V): V {
  const x = I.rv(v);
  if (x.k === 'f') {
    if (op === '-') return I.mkFloat(x.t, -x.v);
    if (op === '+') return x;
    if (op === '!') return I.mkBool(x.v === 0);
    I.cerr(`invalid operand to unary '${op}'`);
  }
  if (x.k !== 'i') I.cerr(`invalid operand to unary '${op}'`);
  if (op === '!') return I.mkBool(x.v === 0n);
  if (x.t.k === 'ptr' || x.t.k === 'nullptr') I.cerr(`invalid operand of type '${typeStr(x.t)}' to unary '${op}'`);
  const pt = promote(I, x.t);
  const { signed, bytes } = intInfo(pt);
  if (op === '+') return I.mkInt(pt, x.v);
  if (op === '~') return I.mkInt(pt, ~x.v);
  if (op === '-') {
    if (signed && x.v === -(1n << BigInt(bytes * 8 - 1))) I.diag('signed-overflow', 'error', 'Signed integer overflow', `-(${x.v}) does not fit in ${typeStr(pt)}; the result wraps back to the same value.`);
    return I.mkInt(pt, -x.v);
  }
  I.cerr(`unsupported unary operator ${op}`);
}

export function addrOf(I: Interp, v: V, e?: A.Expr): V {
  if (v.k === 'fn') {
    const fns = v.cands.length === 1 ? v.cands : v.cands.filter((f) => !f.isDeleted);
    if (fns.length === 0 && v.tmpls && v.tmpls.length === 1 && v.targs) {
      const f = callFnValue.instantiateByTargs(I, v);
      return I.mkPtr(callFnValue.fnType(I, f), f.addr);
    }
    if (fns.length !== 1) I.cerr(`cannot take the address of the overloaded function '${v.name}' without a target type`);
    const f = fns[0];
    return I.mkPtr(callFnValue.fnType(I, f), f.addr);
  }
  if (v.k !== 'l' || v.tmp) I.cerr("lvalue required as unary '&' operand", e?.pos);
  if (v.bf) I.cerr("cannot take the address of a bit-field");
  if (v.t.k === 'fn') return I.mkPtr(v.t, v.a);
  return I.mkPtr(v.t, v.a);
}

function evalUnary(I: Interp, e: Extract<A.Expr, { k: 'un' }>): V {
  const op = e.op;
  if (op === '&') {
    // &Class::member (pointer to member) is not supported; &func and &obj are
    return addrOf(I, evalExpr(I, e.e), e);
  }
  const v = evalExpr(I, e.e);
  if (op === '*') return deref(I, v, e);
  if (op === '++' || op === '--') return incDec(I, v, op, true, e);
  // overloaded operator?
  if (v.k === 'l' && v.t.k === 'cls') {
    const r = callOperator(I, 'operator' + op, [v]);
    if (r) return r;
    const sc = classToScalar(I, v);
    return unarySign(I, op, sc);
  }
  return unarySign(I, op, v);
}

export function deref(I: Interp, v: V, e?: A.Expr): V {
  if (v.k === 'l' && v.t.k === 'cls') {
    const r = callOperator(I, 'operator*', [v]);
    if (r) return r;
  }
  const p = I.rv(v);
  if (p.k !== 'i' || p.t.k !== 'ptr') {
    if (p.k === 'i' && p.t.k === 'nullptr') I.cerr('invalid type argument of unary * (nullptr)', e?.pos);
    I.cerr(`invalid type argument of unary '*' (have '${p.k === 'i' || p.k === 'f' ? typeStr(p.t) : p.k}')`, e?.pos);
  }
  const to = p.t.to;
  if (to.k === 'void') I.cerr("'void*' is not a pointer-to-object type: cast it to a typed pointer before dereferencing", e?.pos);
  return { k: 'l', t: to, a: Number(p.v) };
}

export function storeLv(I: Interp, lv: Extract<V, { k: 'l' }>, val: V) {
  if (lv.t.const && !I.allowConstWrite) I.cerr(`assignment of read-only ${lv.t.k === 'cls' ? 'object' : 'variable or member'} (it is declared const)`);
  if (I.uneval) return;
  if (lv.bf) {
    const x = I.rv(convertScalar(I, val, lv.t));
    if (x.k !== 'i') I.cerr('bit-field needs an integer');
    I.storeBits(lv, x.v);
    return;
  }
  I.store(lv.t, lv.a, convertScalar(I, val, lv.t));
}

function incDec(I: Interp, v: V, op: '++' | '--', prefix: boolean, e: A.Expr): V {
  if (v.k === 'l' && v.t.k === 'cls') {
    const r = prefix ? callOperator(I, 'operator' + op, [v]) : callOperator(I, 'operator' + op, [v, I.mkInt(I.T.int, 0n)]);
    if (!r) I.cerr(`no match for 'operator${op}' for type '${v.t.c.name}'`, e.pos);
    return r;
  }
  const lv = lvalueOf(I, v, `the operand of '${op}'`);
  const cur = I.rv(lv);
  if (cur.k === 'void') I.cerr('invalid operand');
  let nv: V;
  const delta = op === '++' ? 1n : -1n;
  if (cur.k === 'f') nv = I.mkFloat(cur.t, cur.v + Number(delta));
  else if (cur.k === 'i' && cur.t.k === 'ptr') nv = ptrAdd(I, cur, delta);
  else if (cur.k === 'i' && cur.t.k === 'bool') nv = I.mkBool(op === '++' ? true : cur.v === 0n);
  else if (cur.k === 'i') {
    const t = cur.t;
    const { signed, bytes } = intInfo(t);
    const raw = cur.v + delta;
    if (signed && BigInt.asIntN(bytes * 8, raw) !== raw) I.diag('signed-overflow', 'error', 'Signed integer overflow', `${cur.v} ${op === '++' ? '+ 1' : '- 1'} does not fit in ${typeStr(t)}. In C++ this is undefined behaviour; the CPU wraps around.`);
    nv = I.mkInt(t, raw);
  } else I.cerr('invalid operand');
  storeLv(I, lv, nv);
  return prefix ? lv : cur;
}

function evalPostfix(I: Interp, e: Extract<A.Expr, { k: 'post' }>): V {
  const v = evalExpr(I, e.e);
  return incDec(I, v, e.op, false, e);
}

// ---- pointers ----------------------------------------------------------------------------------------------------------------
export function ptrAdd(I: Interp, p: Extract<V, { k: 'i' }>, n: bigint): V {
  if (p.t.k !== 'ptr') I.cerr('pointer arithmetic needs a pointer');
  const sz = pointeeSize(I, p.t.to);
  return { k: 'i', t: p.t, v: BigInt.asUintN(64, p.v + n * BigInt(sz)) };
}

function isPtrV(v: V): v is Extract<V, { k: 'i' }> { return v.k === 'i' && v.t.k === 'ptr'; }

// ---- binary ---------------------------------------------------------------------------------------------------------------------
function evalBinary(I: Interp, e: Extract<A.Expr, { k: 'bin' }>): V {
  const op = e.op;
  if (op === '&&' || op === '||') {
    const l = evalExpr(I, e.l);
    if (l.k === 'l' && l.t.k === 'cls') {
      const r2 = callOperator(I, 'operator' + op, [l, evalExpr(I, e.r)]);
      if (r2) return r2;
    }
    const lt = condValue(I, l);
    if (op === '&&' ? !lt : lt) return I.mkBool(lt);
    return I.mkBool(condValue(I, evalExpr(I, e.r)));
  }
  if (op === ',') {
    evalExpr(I, e.l);
    return evalExpr(I, e.r);
  }
  const l = evalExpr(I, e.l);
  const r = evalExpr(I, e.r);
  return binaryValues(I, op, l, r, e);
}

export function classToScalar(I: Interp, v: V): V {
  if (v.k !== 'l' || v.t.k !== 'cls') return v;
  const conv = findConversionFn(I, v, null, true);
  if (!conv) I.cerr(`'${v.t.c.name}' cannot be used as a number or truth value: it has no conversion operator`);
  return invokeFn(I, conv, v, [], undefined);
}

export function condValue(I: Interp, v: V): boolean {
  if (v.k === 'l' && v.t.k === 'cls') {
    const conv = findConversionFn(I, v, I.T.bool, true);
    if (!conv) I.cerr(`cannot convert '${v.t.c.name}' to bool: add an operator bool`);
    return I.isTrue(invokeFn(I, conv, v, [], undefined));
  }
  if (I.uneval) return true;
  return I.isTrue(v);
}

export function binaryValues(I: Interp, op: string, l0: V, r0: V, e?: A.Expr): V {
  // user-defined operators for class operands
  const lc = l0.k === 'l' && l0.t.k === 'cls';
  const rc = r0.k === 'l' && r0.t.k === 'cls';
  if (lc || rc) {
    const res = callOperator(I, 'operator' + op, [l0, r0]);
    if (res) return res;
    if (op === '!=' ) {
      const eq = callOperator(I, 'operator==', [l0, r0]);
      if (eq) return I.mkBool(!I.isTrue(eq));
    }
    if (lc && !rc || rc && !lc || lc && rc) {
      // built-in operator applied to the result of a conversion operator
      const l1 = lc ? classToScalar(I, l0) : l0;
      const r1 = rc ? classToScalar(I, r0) : r0;
      return binaryValues(I, op, l1, r1, e);
    }
  }
  const l = I.rv(l0), r = I.rv(r0);
  if (l.k === 'void' || r.k === 'void') I.cerr('a void value cannot be used in an expression', e?.pos);
  if ((l.k !== 'i' && l.k !== 'f') || (r.k !== 'i' && r.k !== 'f')) I.cerr(`invalid operands to binary '${op}'`, e?.pos);
  const lp = l.k === 'i' && (l.t.k === 'ptr' || l.t.k === 'nullptr');
  const rp = r.k === 'i' && (r.t.k === 'ptr' || r.t.k === 'nullptr');
  if (lp || rp) return pointerBinary(I, op, l, r, lp, rp, e);
  if (l.t.k === 'enum' && l.t.e.scoped && (r.t.k !== 'enum' || r.t.e !== l.t.e)) I.cerr(`invalid operands to binary '${op}': a scoped enum does not convert to int implicitly`, e?.pos);
  if (r.t.k === 'enum' && r.t.e.scoped && (l.t.k !== 'enum' || l.t.e !== r.t.e)) I.cerr(`invalid operands to binary '${op}': a scoped enum does not convert to int implicitly`, e?.pos);
  if (l.t.k === 'enum' && l.t.e.scoped && !['==', '!=', '<', '>', '<=', '>='].includes(op)) I.cerr(`no match for 'operator${op}' on a scoped enum (cast to int first)`, e?.pos);
  if (I.uneval && (op === '/' || op === '%')) {
    const ct = commonType(I, l.t, r.t);
    return ct.k === 'float' ? I.mkFloat(ct, 1) : I.mkInt(ct, 1n);
  }
  return arithBinary(I, op, l, r);
}

function pointerBinary(I: Interp, op: string, l: Extract<V, { k: 'i' | 'f' }>, r: Extract<V, { k: 'i' | 'f' }>, lp: boolean, rp: boolean, e?: A.Expr): V {
  if (l.k !== 'i' || r.k !== 'i') I.cerr(`invalid operands to binary '${op}'`, e?.pos);
  const cmp = ['==', '!=', '<', '>', '<=', '>='].includes(op);
  if (cmp) {
    if (lp && rp) {
      const a = l.v, b = r.v;
      switch (op) {
        case '==': return I.mkBool(a === b); case '!=': return I.mkBool(a !== b);
        case '<': return I.mkBool(a < b); case '>': return I.mkBool(a > b);
        case '<=': return I.mkBool(a <= b); default: return I.mkBool(a >= b);
      }
    }
    // pointer vs integer: only a null constant is allowed
    const other = lp ? r : l;
    if (other.v !== 0n) I.cerr(`ISO C++ forbids comparison between pointer and integer`, e?.pos);
    const pv = lp ? l.v : r.v;
    if (op === '==') return I.mkBool(pv === 0n);
    if (op === '!=') return I.mkBool(pv !== 0n);
    I.cerr('invalid pointer comparison', e?.pos);
  }
  if (op === '+' && lp && !rp && l.t.k === 'ptr') return ptrAdd(I, l, r.v);
  if (op === '+' && rp && !lp && r.t.k === 'ptr') return ptrAdd(I, r, l.v);
  if (op === '-' && lp && !rp && l.t.k === 'ptr') return ptrAdd(I, l, -r.v);
  if (op === '-' && lp && rp && l.t.k === 'ptr' && r.t.k === 'ptr') {
    const sz = BigInt(pointeeSize(I, l.t.to));
    if (!sameType(stripCv(l.t.to), stripCv(r.t.to))) I.cerr('subtracting pointers to different types', e?.pos);
    return I.mkInt(I.T.ptrdiffT, BigInt.asIntN(64, l.v - r.v) / sz);
  }
  I.cerr(`invalid operands to binary '${op}' (pointer arithmetic supports +, - and comparisons)`, e?.pos);
}

// ---- assignment -----------------------------------------------------------------------------------------------------------------
function evalAssign(I: Interp, e: Extract<A.Expr, { k: 'assign' }>): V {
  // C++17: the right operand is evaluated before the left one
  const r = evalExpr(I, e.r);
  const l = evalExpr(I, e.l);
  return assignValues(I, e.op, l, r, e);
}

export function assignValues(I: Interp, op: string, l: V, r: V, e?: A.Expr): V {
  const lv = lvalueOf(I, l, 'the left side of an assignment');
  if (lv.t.k === 'cls') {
    const res = callOperator(I, 'operator' + op, [lv, r], undefined, true);
    if (res) return lv;
    if (op !== '=') I.cerr(`no match for 'operator${op}' on '${lv.t.c.name}'`, e?.pos);
    I.cerr(`no matching assignment operator for '${lv.t.c.name}' from this value`, e?.pos);
  }
  if (lv.t.k === 'arr') I.cerr('invalid array assignment: arrays cannot be assigned, copy element by element or use std::array', e?.pos);
  if (op === '=') {
    let val = r;
    if (lv.t.k === 'ref') I.cerr('internal: reference lvalue');
    if (val.k === 'init') {
      const items = val.node.k === 'init' ? val.node.items : [];
      if (items.length === 0) val = lv.t.k === 'float' ? I.mkFloat(lv.t, 0) : I.mkInt(lv.t.k === 'ptr' || lv.t.k === 'nullptr' ? I.T.ulong : lv.t, 0n);
      else if (items.length === 1) val = evalExpr(I, items[0]);
      else I.cerr('scalar object initialised with several values');
    }
    const cv = convertTo(I, val, stripCv(lv.t) as Type, e);
    storeLv(I, lv, cv);
    return lv;
  }
  const bop = op.slice(0, -1);
  const cur = I.rv(lv);
  const res = binaryValues(I, bop, cur, r, e);
  // compound assignment converts the result back to the left type without narrowing complaints
  if (res.k === 'i' && res.t.k === 'ptr') storeLv(I, lv, res);
  else storeLv(I, lv, convertScalar(I, res, stripCv(lv.t) as Type));
  return lv;
}

// ---- conditional -------------------------------------------------------------------------------------------------------------------
function evalCond(I: Interp, e: Extract<A.Expr, { k: 'cond' }>, dest?: number): V {
  const c = condValue(I, evalExpr(I, e.c));
  const chosen = c ? e.a : e.b;
  const other = c ? e.b : e.a;
  const v = I.uneval ? evalExpr(I, chosen) : dest !== undefined ? evalExprInto(I, chosen, dest, I.destT) : evalExpr(I, chosen);
  if (v.k === 'l' && v.t.k !== 'cls' && v.t.k !== 'arr' && v.t.k !== 'fn' && !v.tmp) {
    // both operands lvalues of the same type: the result is an lvalue too (so  &(c ? a : b)  and  (c ? a : b) = 1  work)
    let o2: V | null = null;
    try { o2 = unevaluated(I, () => evalExpr(I, other)); } catch { o2 = null; }
    if (o2 && o2.k === 'l' && !o2.tmp && sameType(stripCv(o2.t), stripCv(v.t), true)) return v;
  }
  const x = v.k === 'l' && v.t.k !== 'cls' && v.t.k !== 'arr' && v.t.k !== 'fn' ? I.rv(v) : v;
  if (x.k === 'i' || x.k === 'f') {
    // convert to the common type of both branches
    let ot: V | null = null;
    try { ot = unevaluated(I, () => evalExpr(I, other)); } catch { ot = null; }
    if (ot) {
      const o = ot.k === 'l' && ot.t.k !== 'cls' && ot.t.k !== 'arr' && ot.t.k !== 'fn' ? I.uneval ? ({ k: 'i', t: ot.t, v: 0n } as V) : unevaluated(I, () => I.rv(ot!)) : ot;
      if ((o.k === 'i' || o.k === 'f') && x.t.k !== 'ptr' && x.t.k !== 'nullptr' && o.t.k !== 'ptr' && o.t.k !== 'nullptr') {
        const ct = commonType(I, x.t, o.t);
        if (!sameType(ct, x.t, true)) return convertScalar(I, x, ct);
      }
    }
    return x;
  }
  return v;
}

// ---- index -----------------------------------------------------------------------------------------------------------------------------
function evalIndex(I: Interp, e: Extract<A.Expr, { k: 'index' }>): V {
  const base = evalExpr(I, e.e);
  const idx = evalExpr(I, e.i);
  return indexValue(I, base, idx, e);
}

export function indexValue(I: Interp, base: V, idx: V, e?: A.Expr): V {
  if (base.k === 'l' && base.t.k === 'cls') {
    const r = callOperator(I, 'operator[]', [base, idx]);
    if (r) return r;
    I.cerr(`no match for 'operator[]' on '${base.t.c.name}'`, e?.pos);
  }
  const iv = I.rv(idx);
  if (iv.k !== 'i' && iv.k !== 'f') I.cerr('array subscript is not an integer', e?.pos);
  if (iv.k === 'f') I.cerr('array subscript is not an integer', e?.pos);
  if (base.k === 'l' && base.t.k === 'arr') {
    const at = base.t;
    const es = sizeOf(at.of);
    const n = iv.v;
    if (at.n !== null && (n < 0n || n >= BigInt(at.n)) && !I.uneval) {
      I.diag('out-of-bounds', 'error', 'Array index out of bounds', `Index ${n} is outside the array of ${at.n} element${at.n === 1 ? '' : 's'} (valid indices are 0 to ${at.n - 1}). C++ does not check this: the access silently touches the neighbouring memory.`, base.a + Number(n) * es, es);
    }
    return { k: 'l', t: constLike(at.of, at), a: base.a + Number(n) * es };
  }
  const p = I.rv(base);
  if (p.k === 'i' && p.t.k !== 'ptr' && iv.k === 'i') {
    // i[p]
    const q = I.rv(idx);
    if (q.k === 'i' && q.t.k === 'ptr') return indexValue(I, idx, base, e);
  }
  if (p.k !== 'i' || p.t.k !== 'ptr') I.cerr('subscripted value is neither an array nor a pointer', e?.pos);
  const sz = pointeeSize(I, p.t.to);
  return { k: 'l', t: p.t.to, a: Number(BigInt.asUintN(64, p.v + iv.v * BigInt(sz))) };
}

function constLike(elem: Type, arr: Type): Type { return arr.const && !elem.const ? constOf(elem) : elem; }

// ---- member access ---------------------------------------------------------------------------------------------------------------------
function objectOf(I: Interp, e: Extract<A.Expr, { k: 'member' }>): Extract<V, { k: 'l' }> {
  const base = evalExpr(I, e.e);
  if (e.arrow) {
    if (base.k === 'l' && base.t.k === 'cls') {
      const r = callOperator(I, 'operator->', [base]);
      if (r) return objectOfPtr(I, r, e);
    }
    return objectOfPtr(I, base, e);
  }
  if (base.k !== 'l') I.cerr(`request for member '${e.name.parts[e.name.parts.length - 1].id}' in something that is not an object`, e.pos);
  return base;
}

function objectOfPtr(I: Interp, v: V, e: Extract<A.Expr, { k: 'member' }>): Extract<V, { k: 'l' }> {
  const p = I.rv(v);
  if (p.k !== 'i' || p.t.k !== 'ptr') {
    if (p.k === 'l' && p.t.k === 'cls') {
      const r = callOperator(I, 'operator->', [p]);
      if (r) return objectOfPtr(I, r, e);
    }
    I.cerr(`base operand of '->' is not a pointer (use '.' for objects)`, e.pos);
  }
  if (p.t.to.k !== 'cls') I.cerr(`request for member '${e.name.parts[e.name.parts.length - 1].id}' in non-class type '${typeStr(p.t.to)}'`, e.pos);
  return { k: 'l', t: p.t.to, a: Number(p.v) };
}

function evalMember(I: Interp, e: Extract<A.Expr, { k: 'member' }>): V {
  const obj = objectOf(I, e);
  return memberOfObject(I, obj, e);
}

export function memberOfObject(I: Interp, obj: Extract<V, { k: 'l' }>, e: Extract<A.Expr, { k: 'member' }>): V {
  if (obj.t.k !== 'cls') I.cerr(`request for member '${e.name.parts[e.name.parts.length - 1].id}' in non-class type '${typeStr(obj.t)}'`, e.pos);
  const parts = e.name.parts;
  const last = parts[parts.length - 1];
  let cls = obj.t.c;
  let baseAddr = obj.a;
  let ctxT: Type = obj.t;
  // obj.Base::member
  if (parts.length > 1) {
    const qual: A.QName = { ...e.name, parts: parts.slice(0, -1) };
    const r = lookupQName(I, qual, I.scope);
    const te = r?.ents.find((x) => x.k === 'type');
    if (!te || te.k !== 'type' || te.type.k !== 'cls') I.cerr(`'${parts.slice(0, -1).map((p) => p.id).join('::')}' is not a class`, e.pos);
    const bc = te.type.c;
    const off = baseOffsetOf(I, cls, bc);
    if (off === null) I.cerr(`'${bc.name}' is not a base of '${cls.name}'`, e.pos);
    baseAddr = obj.a + off;
    cls = bc;
    ctxT = withCv(clsType(bc), obj.t);
  }
  const hit = findMember(I, cls, last.id);
  if (!hit) {
    I.cerr(`'${cls.name}' has no member named '${last.id}'`, e.pos);
  }
  checkAccess(I, hit, cls, last.id, e.pos);
  if (hit.field) {
    if (hit.field.offset === undefined && !hit.field.isStatic) I.layoutOf(hit.owner); // offsets are assigned lazily, on first layout
    // virtual-base members are located through the dynamic type
    let a = baseAddr + hit.baseOffset;
    if (hit.viaVirtual && !I.uneval) {
      const dyn = dynamicObject(I, cls, baseAddr);
      if (dyn) {
        const off = baseOffsetOf(I, dyn.cls, hit.owner);
        if (off !== null) a = dyn.addr + off;
      }
    }
    return fieldLv(I, a, hit.field, ctxT);
  }
  const ent = hit.ents[0];
  switch (ent.k) {
    case 'var': return varLv(I, ent.type, ent.addr);
    case 'fns': {
      let a = baseAddr + hit.baseOffset;
      if (hit.viaVirtual && !I.uneval) {
        const dyn = dynamicObject(I, cls, baseAddr);
        if (dyn) { const off = baseOffsetOf(I, dyn.cls, hit.owner); if (off !== null) a = dyn.addr + off; }
      }
      const self: V = { k: 'l', t: withCv(clsType(hit.owner), ctxT), a };
      return {
        k: 'fn', name: last.id, cands: ent.fns, tmpls: ent.ftempls, self, ctxCls: cls,
        targs: last.targs ? evalTArgs(I, last.targs, I.scope) : undefined, qualified: parts.length > 1,
      };
    }
    case 'enumc': return { k: 'i', t: ent.type, v: ent.value };
    case 'type': return { k: 'type', t: ent.type };
    default: I.cerr(`cannot use member '${last.id}' here`, e.pos);
  }
}

/** private / protected enforcement (classic compile-time error students meet) */
export function checkAccess(I: Interp, hit: MemberHit, via: ClassInfo, name: string, pos?: A.Pos) {
  let access: A.Access | undefined = hit.field?.access;
  if (!hit.field) {
    const ent = hit.ents[0];
    if (ent.k === 'fns') {
      // overload sets share access in practice; check the first
      const f = ent.fns[0];
      if (f) access = f.access;
    } else if (ent.k === 'var') access = (ent as any).access;
  }
  if (!access || access === 'public') return;
  if (I.uneval && !I.strictAccess) return;
  const cur = currentClass(I);
  const owner = hit.owner;
  const allowed = (c: ClassInfo | null): boolean => {
    if (!c) return false;
    if (c === owner) return true;
    if (c.x.friends && (c.x.friends as Set<unknown>).has(owner)) return false;
    if (owner.x.friends && (owner.x.friends as Set<unknown>).has(c)) return true;
    if (access === 'protected' && isBaseOf(owner, c)) return true;
    // nested classes are members and see their enclosing class's private names
    if (c.x.outer && allowed(c.x.outer)) return true;
    return false;
  };
  if (allowed(cur)) return;
  const fn = I.frame.fn;
  if (fn && owner.x.friendFns && (owner.x.friendFns as Set<string>).has(fn.name)) return;
  void via;
  I.cerr(`'${name}' is ${access} within this context (declared in '${owner.name}')`, pos);
}

export function currentClass(I: Interp): ClassInfo | null {
  for (let i = I.frames.length - 1; i >= 0; i--) {
    const f = I.frames[i];
    if (f.fn) {
      if (f.fn.cls) return f.fn.cls.x.lambda ? lambdaOuter(f.fn.cls) : f.fn.cls;
      return f.fn.friendOf ?? null;
    }
  }
  return null;
}
function lambdaOuter(c: ClassInfo): ClassInfo | null { return (c.x.lambdaOuterCls as ClassInfo) ?? null; }

// ---- calls ---------------------------------------------------------------------------------------------------------------------------------
export function evalArgs(I: Interp, args: A.Expr[]): V[] {
  const has = args.some((a) => a.k === 'expand');
  const slots: V[][] = new Array(args.length);
  const order = args.map((_, i) => i);
  if (I.plat.id === 'linux' && args.length > 1) order.reverse(); // GCC evaluates call arguments right to left
  for (const i of order) {
    const a = args[i];
    if (a.k === 'expand') slots[i] = expandPack(I, a.e);
    else slots[i] = [evalExpr(I, a)];
  }
  void has;
  return slots.flat();
}

export function packNames(I: Interp, e: A.Expr, out: Set<string> = new Set()): Set<string> {
  const typeNames = (te: A.TypeExpr) => {
    switch (te.k) {
      case 'base': {
        const b = te.spec.base;
        if (b.k === 'name') {
          if (b.q.parts.length === 1) {
            const r = lookupUnqualified(I, b.q.parts[0].id, I.scope);
            if (r && r.ents[0] && r.ents[0].k === 'pack') out.add(b.q.parts[0].id);
          }
          for (const part of b.q.parts) for (const ta of part.targs ?? []) { if (ta.k === 'type' || ta.k === 'pack') typeNames(ta.t); }
        }
        break;
      }
      case 'ptr': case 'ref': typeNames(te.to); break;
      case 'arr': typeNames(te.of); break;
      case 'pack': typeNames(te.of); break;
      default: break;
    }
  };
  const visit = (x: A.Expr | undefined | null) => {
    if (!x) return;
    switch (x.k) {
      case 'id': {
        if (x.q.parts.length === 1) {
          const r = lookupUnqualified(I, x.q.parts[0].id, I.scope);
          if (r && r.ents[0] && r.ents[0].k === 'pack') out.add(x.q.parts[0].id);
        }
        // packs used inside explicit template arguments:  std::forward<A>(args)...
        for (const part of x.q.parts) for (const ta of part.targs ?? []) {
          if (ta.k === 'type' || ta.k === 'pack') typeNames(ta.t);
          else visit(ta.e);
        }
        break;
      }
      case 'un': case 'post': visit(x.e); break;
      case 'bin': case 'assign': visit(x.l); visit(x.r); break;
      case 'cond': visit(x.c); visit(x.a); visit(x.b); break;
      case 'call': visit(x.f); x.args.forEach(visit); break;
      case 'index': visit(x.e); visit(x.i); break;
      case 'member': visit(x.e); break;
      case 'cast': visit(x.e); break;
      case 'fcast': x.args.forEach(visit); break;
      case 'init': x.items.forEach(visit); break;
      case 'new': x.args?.forEach(visit); break;
      case 'expand': visit(x.e); break;
      case 'fold': visit(x.pack); break;
      case 'throw': visit(x.e); break;
      case 'delete': visit(x.e); break;
      default: break;
    }
  };
  visit(e);
  return out;
}

export function expandPack(I: Interp, e: A.Expr): V[] {
  const names = [...packNames(I, e)];
  if (names.length === 0) I.cerr('expansion pattern contains no parameter packs');
  const lens = names.map((n) => {
    const ent = lookupUnqualified(I, n, I.scope)!.ents[0];
    return ent.k === 'pack' ? ent.items.length : 0;
  });
  const n = lens[0];
  const out: V[] = [];
  const saved = new Map(I.packIdx);
  try {
    for (let i = 0; i < n; i++) {
      for (const nm of names) I.packIdx.set(nm, i);
      out.push(evalExpr(I, e));
    }
  } finally {
    I.packIdx = saved;
  }
  return out;
}

function evalFold(I: Interp, e: Extract<A.Expr, { k: 'fold' }>): V {
  const vals = expandPack(I, e.pack);
  const op = e.op;
  const combine = (a: V, b: V): V => {
    if (op === '&&') return I.mkBool(condValue(I, a) && condValue(I, b));
    if (op === '||') return I.mkBool(condValue(I, a) || condValue(I, b));
    if (op === ',') return b;
    if (op.endsWith('=') && !['==', '!=', '<=', '>='].includes(op)) return assignValues(I, op, a, b, e);
    return binaryValues(I, op, a, b, e);
  };
  let items = vals;
  if (e.init) {
    const iv = evalExpr(I, e.init);
    items = e.left ? [iv, ...vals] : [...vals, iv];
  }
  if (items.length === 0) {
    if (op === '&&') return I.mkBool(true);
    if (op === '||') return I.mkBool(false);
    if (op === ',') return I.voidV();
    I.cerr(`a fold over an empty pack with operator '${op}' needs an initial value`);
  }
  if (e.left) { let acc = items[0]; for (let i = 1; i < items.length; i++) acc = combine(acc, items[i]); return acc; }
  let acc = items[items.length - 1];
  for (let i = items.length - 2; i >= 0; i--) acc = combine(items[i], acc);
  return acc;
}

export function evalCall(I: Interp, e: Extract<A.Expr, { k: 'call' }>, dest?: number): V {
  const f = e.f;
  let callee: V;
  if (f.k === 'member') {
    const last = f.name.parts[f.name.parts.length - 1];
    if (last.id.startsWith('~')) {
      // explicit destructor call  p->~T();
      const obj = objectOfAny(I, f);
      if (obj.t.k === 'cls' && !I.uneval) destroyObj(I, obj.t, obj.a, true);
      return I.voidV();
    }
    const base = evalExpr(I, f.e);
    if (!f.arrow && base.k !== 'l') {
      // member call on a pseudo-object (e.g. scalar pseudo destructor)
      I.cerr(`request for member '${last.id}' in non-class value`, f.pos);
    }
    let obj: Extract<V, { k: 'l' }>;
    if (f.arrow) obj = objectOfPtrFromV(I, base, f);
    else obj = base as Extract<V, { k: 'l' }>;
    if (obj.t.k !== 'cls') {
      if (last.id.startsWith('~')) return I.voidV();
      I.cerr(`request for member '${last.id}' in non-class type '${typeStr(obj.t)}'`, f.pos);
    }
    callee = memberOfObject(I, obj, f);
  } else if (f.k === 'id') {
    callee = evalId(I, f);
  } else {
    callee = evalExpr(I, f);
  }
  const args = evalArgs(I, e.args);
  return callValue(I, callee, args, dest, e);
}

function objectOfAny(I: Interp, f: Extract<A.Expr, { k: 'member' }>): Extract<V, { k: 'l' }> {
  const base = evalExpr(I, f.e);
  return f.arrow ? objectOfPtrFromV(I, base, f) : (base as Extract<V, { k: 'l' }>);
}
function objectOfPtrFromV(I: Interp, v: V, f: Extract<A.Expr, { k: 'member' }>): Extract<V, { k: 'l' }> {
  if (v.k === 'l' && v.t.k === 'cls') {
    const r = callOperator(I, 'operator->', [v]);
    if (r) return objectOfPtrFromV(I, r, f);
  }
  const p = I.rv(v);
  if (p.k !== 'i' || p.t.k !== 'ptr') I.cerr("base operand of '->' is not a pointer", f.pos);
  return { k: 'l', t: p.t.to, a: Number(p.v) };
}

// ---- casts -------------------------------------------------------------------------------------------------------------------------------------
function evalCast(I: Interp, e: Extract<A.Expr, { k: 'cast' }>): V {
  const to = resolveTypeExpr(I, e.t, I.scope);
  const v = evalExpr(I, e.e);
  return castValue(I, e.kind, to, v, e);
}

export function castValue(I: Interp, kind: 'c' | 'static' | 'reinterpret' | 'const' | 'dynamic', to: Type, v: V, e?: A.Expr): V {
  if (to.k === 'ref') {
    // cast to a reference type: produces an lvalue / xvalue of the target
    if (kind === 'dynamic') return dynamicCastRef(I, to, v, e);
    if (v.k === 'l') {
      const target = to.to;
      if (target.k === 'cls' && v.t.k === 'cls' && v.t.c !== target.c && isBaseOf(target.c, v.t.c)) {
        return { k: 'l', t: target, a: upcastAddr(I, v.t.c, target.c, v.a), xv: to.rv };
      }
      if (target.k === 'cls' && v.t.k === 'cls' && v.t.c !== target.c && isBaseOf(v.t.c, target.c)) {
        const off = baseOffsetOf(I, target.c, v.t.c) ?? 0;
        return { k: 'l', t: target, a: v.a - off, xv: to.rv };
      }
      return { k: 'l', t: target, a: v.a, xv: to.rv, tmp: v.tmp };
    }
    const m = materialize(I, v, to.to);
    return { ...(m as Extract<V, { k: 'l' }>), xv: to.rv };
  }
  if (to.k === 'void') { if (!I.uneval) I.rv(v); return I.voidV(); }
  if (kind === 'dynamic') return dynamicCastPtr(I, to, v, e);
  if (to.k === 'cls') {
    // functional-style conversion to a class: construct a temporary
    const a = newTempObj(I, to);
    if (!I.uneval) construct(I, to, a, [v]);
    return { k: 'l', t: to, a, tmp: true };
  }
  const x = v.k === 'l' && (v.t.k === 'cls') ? classToScalar(I, v) : I.rv(v);
  if (x.k === 'void') I.cerr('cannot cast a void value');
  if (x.k === 'init' || x.k === 'fn' || x.k === 'type' || x.k === 'tmpl') {
    if (x.k === 'fn') return castValue(I, kind, to, addrOf(I, x, e), e);
    I.cerr('invalid cast');
  }
  if (x.k === 'l') I.cerr('invalid cast');
  const src = x.t;
  // pointer conversions
  if (to.k === 'ptr') {
    if (x.k === 'f') I.cerr('invalid cast from floating point to pointer');
    if (src.k === 'ptr' || src.k === 'nullptr') {
      if (src.k === 'nullptr') return { k: 'i', t: to, v: 0n };
      if (kind === 'const') return { k: 'i', t: to, v: x.v };
      // static / c-style: base <-> derived adjustments
      const sc = stripCv(src.to), tc = stripCv(to.to);
      if (sc.k === 'cls' && tc.k === 'cls' && sc.c !== tc.c && kind !== 'reinterpret') {
        if (isBaseOf(tc.c, sc.c)) return x.v === 0n ? { k: 'i', t: to, v: 0n } : { k: 'i', t: to, v: BigInt(upcastAddrDyn(I, sc.c, tc.c, Number(x.v))) };
        if (isBaseOf(sc.c, tc.c)) {
          if (x.v === 0n) return { k: 'i', t: to, v: 0n };
          const off = baseOffsetOf(I, tc.c, sc.c) ?? 0;
          return { k: 'i', t: to, v: x.v - BigInt(off) };
        }
      }
      if (kind === 'static' && sc.k !== 'void' && tc.k !== 'void' && sc.k !== 'cls' && tc.k !== 'cls' && !sameType(sc, tc, true) && !(sc.k === 'int' && tc.k === 'int' && sc.bytes === tc.bytes)) {
        I.cerr(`invalid 'static_cast' from type '${typeStr(src)}' to type '${typeStr(to)}' (use reinterpret_cast to reinterpret the bytes)`, e?.pos);
      }
      if (kind === 'static' && sc.k === 'cls' !== (tc.k === 'cls') && sc.k !== 'void' && tc.k !== 'void') {
        I.cerr(`invalid 'static_cast' from type '${typeStr(src)}' to type '${typeStr(to)}'`, e?.pos);
      }
      return { k: 'i', t: to, v: x.v };
    }
    if (src.k === 'int' || src.k === 'enum' || src.k === 'bool') {
      if (kind === 'static') I.cerr(`invalid 'static_cast' from type '${typeStr(src)}' to type '${typeStr(to)}'`, e?.pos);
      if (kind === 'const') I.cerr("invalid 'const_cast': only pointers and references can change cv-qualification", e?.pos);
      return { k: 'i', t: to, v: BigInt.asUintN(64, x.v) };
    }
    I.cerr(`invalid cast to '${typeStr(to)}'`, e?.pos);
  }
  if (src.k === 'ptr' || src.k === 'nullptr') {
    if (to.k === 'bool') return I.mkBool(x.k === 'i' && x.v !== 0n);
    if (to.k === 'int' && x.k === 'i') {
      if (kind === 'static') I.cerr(`invalid 'static_cast' from type '${typeStr(src)}' to type '${typeStr(to)}'`, e?.pos);
      if (to.bytes < 8) I.diag('ub-other', 'warn', 'Pointer truncated', `Casting a 64-bit pointer to a ${to.bytes * 8}-bit integer throws away the upper bits.`);
      return I.mkInt(to, x.v);
    }
    I.cerr(`invalid cast from '${typeStr(src)}' to '${typeStr(to)}'`, e?.pos);
  }
  if (kind === 'reinterpret' && (to.k === 'int' || to.k === 'float') && src.k === 'int' && to.k === 'int') return convertScalar(I, x, to);
  if (kind === 'reinterpret') I.cerr(`invalid 'reinterpret_cast' from '${typeStr(src)}' to '${typeStr(to)}' (it only converts between pointers and integers)`, e?.pos);
  if (kind === 'const') I.cerr("invalid 'const_cast': only pointers and references can change cv-qualification", e?.pos);
  if (to.k === 'enum' && x.k === 'i') return I.mkInt(to, x.v);
  if (to.k === 'enum' && x.k === 'f') return I.mkInt(to, BigInt(Math.trunc(x.v)));
  return convertScalar(I, x, to);
}

function upcastAddrDyn(I: Interp, from: ClassInfo, to: ClassInfo, addr: number): number {
  return upcastAddr(I, from, to, addr);
}

function dynamicCastPtr(I: Interp, to: Type, v: V, e?: A.Expr): V {
  if (to.k !== 'ptr' || to.to.k !== 'cls') I.cerr('dynamic_cast needs a pointer or reference to a class', e?.pos);
  const p = I.rv(v);
  if (p.k !== 'i' || p.t.k !== 'ptr' || p.t.to.k !== 'cls') I.cerr('dynamic_cast operand must be a pointer to a polymorphic class', e?.pos);
  if (p.v === 0n) return { k: 'i', t: to, v: 0n };
  const r = dynamicTarget(I, p.t.to.c, to.to.c, Number(p.v), e);
  return { k: 'i', t: to, v: BigInt(r ?? 0) };
}

function dynamicCastRef(I: Interp, to: Extract<Type, { k: 'ref' }>, v: V, e?: A.Expr): V {
  if (to.to.k !== 'cls') I.cerr('dynamic_cast needs a reference to a class', e?.pos);
  const lv = lvalueOf(I, v);
  if (lv.t.k !== 'cls') I.cerr('dynamic_cast operand must be a polymorphic class object', e?.pos);
  const r = dynamicTarget(I, lv.t.c, to.to.c, lv.a, e);
  if (r === null) throwStd(I, 'bad_cast', 'std::bad_cast');
  return { k: 'l', t: to.to, a: r!, xv: to.rv };
}

function dynamicTarget(I: Interp, srcCls: ClassInfo, target: ClassInfo, addr: number, e?: A.Expr): number | null {
  I.completeClass(srcCls);
  const L = I.layoutOf(srcCls);
  if (L.vptrOffset === null && !isPolymorphicAny(srcCls)) I.cerr(`'${srcCls.name}' is not polymorphic: dynamic_cast needs at least one virtual function`, e?.pos);
  const dyn = dynamicObject(I, srcCls, addr);
  if (!dyn) return null;
  if (dyn.cls === target) return dyn.addr;
  const off = baseOffsetOf(I, dyn.cls, target);
  if (off === null) return null;
  return dyn.addr + off;
}
function isPolymorphicAny(c: ClassInfo): boolean { return c.declaresVirtual || c.bases.some((b) => isPolymorphicAny(b.cls)); }

/** noexcept(expr): evaluated without side effects; true unless the expression calls a function that may throw or contains a throw */
function probeCanThrow(I: Interp, x: A.Expr): boolean {
  const saved = I.canThrow;
  I.canThrow = false;
  try { unevaluated(I, () => evalExpr(I, x)); } catch (err) { if (err instanceof CompileError) throw err; I.canThrow = true; }
  const r = I.canThrow;
  I.canThrow = saved;
  return r;
}

export function throwStd(I: Interp, cls: string, display: string): never {
  const r = lookupQName(I, { parts: [{ id: 'std' }, { id: cls }], pos: { line: 0, col: 0 } }, I.global);
  const ent = r?.ents.find((x) => x.k === 'type');
  if (!ent || ent.k !== 'type') throw new Fault('uncaught', `terminate called after throwing an instance of '${display}'`, undefined, 134);
  const t = ent.type;
  const addr = I.allocException(t);
  construct(I, t, addr, []);
  throw new CxxThrow(t, addr);
}

function evalFcast(I: Interp, e: Extract<A.Expr, { k: 'fcast' }>): V {
  let to = resolveTypeExpr(I, e.t, I.scope);
  return construct_value(I, to, e);
}

function construct_value(I: Interp, to0: Type, e: Extract<A.Expr, { k: 'fcast' }>, dest?: number): V {
  let to = to0;
  // class template argument deduction:  vector v = vector(…)   /  Stack(5)
  if ((to as any).ctad) to = I.deduceCtad((to as any).ctad, e.args.map((a) => evalExpr(I, a)));
  if (to.k === 'cls') {
    if (I.uneval) { if (!e.brace) probeConstruct(I, to, evalArgs(I, e.args)); return { k: 'l', t: to, a: 0, tmp: true }; }
    const a = dest ?? newTempObj(I, to);
    if (e.brace) initFromBraces(I, to, a, { k: 'init', items: e.args, pos: e.pos });
    else {
      const args = evalArgs(I, e.args);
      construct(I, to, a, args);
    }
    return { k: 'l', t: to, a, tmp: true };
  }
  if (to.k === 'void') return I.voidV();
  // scalar: T() is zero, T(x) is a conversion
  if (e.args.length === 0) {
    if (to.k === 'float') return I.mkFloat(to, 0);
    if (to.k === 'ptr' || to.k === 'nullptr') return { k: 'i', t: to, v: 0n };
    if (to.k === 'arr') I.cerr('cannot construct an array this way');
    return I.mkInt(to, 0n);
  }
  if (e.args.length > 1) I.cerr(`too many initialisers for '${typeStr(to)}'`, e.pos);
  const v = evalExpr(I, e.args[0]);
  return castValue(I, 'c', to, v, e);
}

export function evalExprInto(I: Interp, e: A.Expr, dest: number, destT?: Type): V {
  // copy elision: prvalues of class type are constructed straight into `dest` — but only when they have the destination's type
  const saved = I.destT;
  I.destT = destT;
  try {
    if (e.k === 'call') return evalCall(I, e, dest);
    if (e.k === 'fcast') {
      const to = resolveTypeExpr(I, e.t, I.scope);
      if (to.k === 'cls' && (!destT || (destT.k === 'cls' && destT.c === to.c))) return construct_value(I, to, e, dest);
    }
    if (e.k === 'cond') return evalCond(I, e, dest);
    return evalExpr(I, e);
  } finally { I.destT = saved; }
}

// ---- new / delete -------------------------------------------------------------------------------------------------------------------------------
function evalNew(I: Interp, e: Extract<A.Expr, { k: 'new' }>): V {
  const elem = resolveTypeExpr(I, e.t, I.scope);
  if (I.uneval) { I.canThrow = true; return I.mkPtr(elem, 0); }
  // placement new  new (p) T(args)
  let nothrowTag = false;
  if (e.place.length) {
    const first = evalExpr(I, e.place[0]);
    if (first.k === 'l' && first.t.k === 'cls' && first.t.c.name === 'nothrow_t') { nothrowTag = true; }
  }
  if (e.place.length && !nothrowTag) {
    const place = I.rv(evalExpr(I, e.place[0]));
    if (place.k !== 'i') I.cerr('placement new needs an address');
    if (e.place.length === 1 && place.t.k === 'ptr') {
      const addr = Number(place.v);
      if (e.arr) I.cerr('array placement new is not supported');
      initNewObject(I, elem, addr, e);
      return I.mkPtr(elem, addr);
    }
  }
  const nothrow = nothrowTag;
  if (e.arr) {
    const nv = I.rv(evalExpr(I, e.arr));
    if (nv.k !== 'i' && nv.k !== 'f') I.cerr('array size must be a number');
    const n = Number(nv.k === 'i' ? nv.v : Math.trunc(nv.v));
    if (n < 0) throwStd(I, 'bad_array_new_length', 'std::bad_array_new_length');
    const esz = sizeOf(elem);
    const cookie = elem.k === 'cls' && hasNontrivialDtor(I, elem) ? 8 : 0;
    const total = n * esz + cookie;
    const raw = userNew(I, elem, total, true, nothrow);
    if (raw === 0) return I.mkPtr(elem, 0);
    if (cookie) I.mem.storeInt(raw, 8, BigInt(n), 'array cookie');
    const first = raw + cookie;
    const rec = I.heap.live.get(raw);
    if (rec) I.typeInfo[rec.id] = I.typeNodeOf(arrOf(elem, n));
    // construct elements
    if (elem.k === 'cls' && !(e.brace && e.args)) {
      const args = e.args;
      for (let i = 0; i < n; i++) {
        if (args && args.length === 0 || !args) construct(I, elem, first + i * esz, [], e.args ? 'value' : 'default');
        else construct(I, elem, first + i * esz, evalArgs(I, args));
      }
    } else if (e.args && e.args.length === 0) {
      for (let i = 0; i < n; i++) valueInit(I, elem, first + i * esz);
    }
    if (e.brace && e.args) {
      // new int[3]{1,2,3}
      const items = e.args;
      for (let i = 0; i < n; i++) {
        if (i < items.length) initFromExpr(I, elem, first + i * esz, items[i]);
        else valueInit(I, elem, first + i * esz);
      }
    }
    return I.mkPtr(elem, first);
  }
  const sz = sizeOf(elem);
  const raw = userNew(I, elem, sz, false, nothrow);
  if (raw === 0) return I.mkPtr(elem, 0);
  const rec = I.heap.live.get(raw);
  if (rec) I.typeInfo[rec.id] = I.typeNodeOf(elem);
  initNewObject(I, elem, raw, e);
  return I.mkPtr(elem, raw);
}

function initNewObject(I: Interp, t: Type, addr: number, e: Extract<A.Expr, { k: 'new' }>) {
  if (t.k === 'cls') {
    if (e.brace && e.args) initFromBraces(I, t, addr, { k: 'init', items: e.args, pos: e.pos });
    else if (e.args === null) construct(I, t, addr, [], 'default');
    else construct(I, t, addr, evalArgs(I, e.args), 'direct');
  } else if (e.args !== null) {
    const vals = evalArgs(I, e.args);
    if (vals.length === 0) valueInit(I, t, addr);
    else {
      const cv = convertTo(I, vals[0], t, e);
      I.store(t, addr, cv);
    }
  }
}

function userNew(I: Interp, elem: Type, total: number, array: boolean, nothrow: boolean): number {
  // class-specific operator new
  if (elem.k === 'cls') {
    const hit = findMember(I, elem.c, array ? 'operator new[]' : 'operator new');
    if (hit && !hit.field && hit.ents[0]?.k === 'fns') {
      const f = hit.ents[0].fns[0];
      const r = callFnValue(I, { k: 'fn', name: f.name, cands: hit.ents[0].fns, qualified: true }, [I.mkInt(I.T.sizeT, BigInt(total))], undefined);
      const p = I.rv(r);
      if (p.k === 'i') return Number(p.v);
    }
  }
  const user = I.userGlobalNew(array);
  if (user) {
    const r = callFnValue(I, user, [I.mkInt(I.T.sizeT, BigInt(total))], undefined);
    const p = I.rv(r);
    if (p.k === 'i') return Number(p.v);
  }
  const how = array ? 'operator new[]' : 'operator new';
  const p = I.heap.malloc(total, how);
  if (p === 0) {
    if (nothrow) return 0;
    throwStd(I, 'bad_alloc', 'std::bad_alloc');
  }
  return p;
}

function evalDelete(I: Interp, e: Extract<A.Expr, { k: 'delete' }>): V {
  const pv = I.rv(evalExpr(I, e.e));
  if (I.uneval) return I.voidV();
  if (pv.k !== 'i' || (pv.t.k !== 'ptr' && pv.t.k !== 'nullptr')) {
    I.cerr('type needed to delete is not a pointer', e.pos);
  }
  if (pv.v === 0n) return I.voidV();
  const p = Number(pv.v);
  const pt = pv.t.k === 'ptr' ? pv.t.to : I.T.void;
  const rec = I.heap.live.get(p) ?? I.heap.live.get(p - 8);
  if (e.arr) {
    // delete[]: destroy elements in reverse order, then free the block (cookie included)
    let raw = p;
    if (pt.k === 'cls' && hasNontrivialDtor(I, pt)) {
      raw = p - 8;
      const n = Number(I.mem.loadInt(raw, 8, false, 'array cookie'));
      const esz = sizeOf(pt);
      for (let i = n - 1; i >= 0; i--) destroyObj(I, pt, p + i * esz, false);
    }
    const r = I.heap.live.get(raw);
    if (r && r.how.includes('new') && !r.how.includes('[]')) {
      I.diag('mismatched-free', 'error', 'Mismatched new/delete', 'This block was allocated with new but released with delete[]. Always pair new with delete and new[] with delete[].', p);
    }
    userDelete(I, pt, raw, true);
    return I.voidV();
  }
  // plain delete: run the destructor (virtual if the class has a virtual destructor), then free
  let target = p;
  if (pt.k === 'cls') {
    const dyn = isPolymorphic(pt.c) ? dynamicObject(I, pt.c, p) : null;
    if (dyn) { destroyObj(I, clsType(dyn.cls), dyn.addr, false); target = dyn.addr; }
    else destroyObj(I, pt, p, false);
    if (pt.k === 'cls' && hasNontrivialDtor(I, pt)) {
      const r2 = I.heap.live.get(p - 8);
      if (r2 && r2.how.includes('[]')) {
        I.diag('mismatched-free', 'error', 'Mismatched new[]/delete', 'This block was allocated with new[] (it has an element-count cookie in front of it) but released with delete. Use delete[] for arrays.', p);
        target = p;
      }
    }
  } else if (rec && rec.how.includes('[]')) {
    I.diag('mismatched-free', 'error', 'Mismatched new[]/delete', 'This block was allocated with new[] but released with delete. Use delete[] for arrays.', p);
  }
  userDelete(I, pt, target, false);
  return I.voidV();
}

export function isPolymorphic(c: ClassInfo): boolean { return c.declaresVirtual || c.bases.some((b) => isPolymorphic(b.cls)); }

function userDelete(I: Interp, pt: Type, p: number, array: boolean) {
  if (pt.k === 'cls') {
    const hit = findMember(I, pt.c, array ? 'operator delete[]' : 'operator delete');
    if (hit && !hit.field && hit.ents[0]?.k === 'fns') {
      callFnValue(I, { k: 'fn', name: 'operator delete', cands: hit.ents[0].fns, qualified: true }, [I.mkPtr(I.T.void, p)], undefined);
      return;
    }
  }
  const user = I.userGlobalDelete(array);
  if (user) { callFnValue(I, user, [I.mkPtr(I.T.void, p)], undefined); return; }
  I.heap.free(p, array ? 'operator delete[]' : 'operator delete');
}

// ---- lambda --------------------------------------------------------------------------------------------------------------------------------------------
function evalLambda(I: Interp, e: Extract<A.Expr, { k: 'lambda' }>, dest?: number): V {
  const cls = makeLambdaClass(I, e, I.scope);
  const t = clsType(cls);
  if (I.uneval) return { k: 'l', t, a: 0, tmp: true };
  const a = dest ?? newTempObj(I, t);
  const caps = cls.x.lambda.captures as Array<{ name: string; byRef: boolean; field: string; type: Type; isThis?: boolean; init?: A.Expr; src?: V }>;
  for (const c of caps) {
    const f = cls.x.fieldMap.get(c.field) as FieldInfo;
    const at = a + (f.offset ?? 0);
    if (c.isThis) {
      const th = thisFor(I, cls.x.lambdaOuterCls) ?? I.frame.thisV;
      if (!th || th.k !== 'l') I.cerr("cannot capture 'this' outside a member function");
      I.store(f.type, at, I.mkPtr(th.t, th.a));
      continue;
    }
    if (c.init) {
      const v = evalExpr(I, c.init);
      if (c.byRef) { const lv = lvalueOf(I, v); I.store(f.type, at, { k: 'l', t: lv.t, a: lv.a }); }
      else initFromValueTyped(I, f.type, at, v);
      continue;
    }
    const r = lookupUnqualified(I, c.name, I.scope);
    if (!r) I.cerr(`'${c.name}' was not declared in this scope`);
    const v = r.hit ? memberHitToV(I, r, { k: 'id', q: { parts: [{ id: c.name }], pos: e.pos }, pos: e.pos }, r.hit) : evalId(I, { k: 'id', q: { parts: [{ id: c.name }], pos: e.pos }, pos: e.pos });
    if (c.byRef) {
      const lv = lvalueOf(I, v);
      I.store(f.type, at, { k: 'l', t: lv.t, a: lv.a });
    } else initFromValueTyped(I, f.type, at, v);
  }
  return { k: 'l', t, a, tmp: true };
}

function initFromValueTyped(I: Interp, t: Type, at: number, v: V) {
  if (t.k === 'cls') construct(I, t, at, [v]);
  else if (t.k === 'arr') {
    const lv = lvalueOf(I, v);
    I.mem.copy(at, lv.a, sizeOf(t));
  } else I.store(t, at, convertTo(I, v, t));
}

export function evalLambdaInto(I: Interp, e: Extract<A.Expr, { k: 'lambda' }>, dest: number): V { return evalLambda(I, e, dest); }

// ---- throw -----------------------------------------------------------------------------------------------------------------------------------------------
function evalThrow(I: Interp, e: Extract<A.Expr, { k: 'throw' }>): V {
  if (I.uneval) return I.voidV();
  if (!e.e) {
    const cur = I.handling[I.handling.length - 1];
    if (!cur) throw new Fault('uncaught', I.plat.id === 'windows' ? 'abort() has been called (rethrow with no active exception)' : "terminate called without an active exception", undefined, 134);
    throw new CxxThrow(cur.type, cur.addr);
  }
  const v = evalExpr(I, e.e);
  let t: Type;
  if (v.k === 'l') {
    t = v.t.k === 'arr' ? ptrTo(v.t.of) : v.t.k === 'fn' ? ptrTo(v.t) : stripCv(v.t);
  } else if (v.k === 'i' || v.k === 'f') t = stripCv(v.t);
  else I.cerr('cannot throw this value');
  const addr = I.allocException(t);
  if (t.k === 'cls') construct(I, t, addr, [v]);
  else I.store(t, addr, v.k === 'l' && (v.t.k === 'arr' || v.t.k === 'fn') ? I.rv(v) : convertScalar(I, v, t));
  throw new CxxThrow(t, addr);
}

export { newScope, releaseTemps, isDerivedPtrConv, isFloat, isInt, isScalar, refTo, withCv };
export type { Fn, FuncTemplate, TArgVal };
