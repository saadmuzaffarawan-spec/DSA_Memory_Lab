// Function calls: overload resolution, argument binding, stack frames, construction and destruction of objects,
// virtual dispatch, implicit conversions.
import type * as A from './ast';
import { Fault } from './memory';
import { S } from './trace';
import type { Interp } from './interp';
import type { Fn, Frame, FuncTemplate, Scope, Sig, TArgVal, V } from './env';
import { CxxThrow, newScope } from './env';
import {
  arrOf, clsType, constOf, intInfo, isFloat, isInt, ptrTo, sameType, stripCv, stripRef, typeStr, withCv, prettyType, type ClassInfo, type FieldInfo, type Type,
} from './types';
import { alignOf, sizeOf } from './layout';
import { convertScalar, promote } from './arith';
import {
  adjustParam, baseOffsetOf, evalTArgs, findMember, isAuto, isBaseOf, lookupUnqualified, resolveTypeExpr, targKey, tryResolveType, typeKey,
} from './typeres';
import { bindingScope, bindingsKey, deduceFunction, type Bindings } from './templ';
import { evalExpr, evalExprInto, lvalueOf, storeLv, thisFor, unevaluated, isPolymorphic, condValue, throwStd } from './expr';
import { execBody, inferReturnType } from './stmt';
import { makeFn } from './decls';

// =====================================================================================================================
// signatures
// =====================================================================================================================
export function getSig(I: Interp, fn: Fn): Sig {
  if (fn.sig) return fn.sig;
  const d = fn.decl;
  if (!d) I.cerr(`internal: function '${fn.qual}' has no signature`);
  const saved = I.scope;
  try {
    I.scope = fn.scope;
    const params: Type[] = [];
    const names: (string | undefined)[] = [];
    const defaults: (A.Expr | undefined)[] = [];
    for (const p of d.params) {
      const te = p.type.k === 'pack' ? p.type.of : p.type;
      if (p.pack || p.type.k === 'pack') {
        const nm = firstPackName(I, te, fn);
        const ent = nm ? fn.bindings?.get(nm) : undefined;
        const items = ent && ent.k === 'pack' ? ent.items : [];
        fn.packInfo = { name: p.name ?? '', start: params.length, count: items.length };
        items.forEach((it, i) => {
          const b = new Map<string, TArgVal>([[nm!, it]]);
          const sc = bindingScope(I, fn.scope, b);
          params.push(adjustParam(resolveTypeExpr(I, te, sc)));
          names.push(p.name ? `${p.name}#${i}` : undefined);
          defaults.push(undefined);
        });
        continue;
      }
      params.push(adjustParam(resolveTypeExpr(I, te, fn.scope)));
      names.push(p.name);
      defaults.push(p.def);
    }
    let ret: Type;
    if (d.isCtor || d.isDtor) ret = I.T.void;
    else if (d.isConv) ret = resolveTypeExpr(I, d.convType!, fn.scope);
    else if (!d.ret) ret = AUTO_T;
    else if (d.trailingRet) {
      const ps = newScope('func', fn.scope);
      params.forEach((t, i) => { const nm = names[i]; if (nm) ps.names.set(nm, [{ k: 'var', name: nm, type: t, addr: 0 }]); });
      ret = resolveTypeExpr(I, d.ret, ps);
    } else ret = resolveTypeExpr(I, d.ret, fn.scope);
    fn.sig = { ret, params, variadic: d.variadic, paramNames: names, defaults };
    return fn.sig;
  } finally { I.scope = saved; }
}

const AUTO_T: Type = { k: 'void', auto: true } as any;

function firstPackName(I: Interp, te: A.TypeExpr, fn: Fn): string | null {
  let found: string | null = null;
  const visit = (t: A.TypeExpr) => {
    if (found) return;
    switch (t.k) {
      case 'base': {
        const b = t.spec.base;
        if (b.k === 'name') {
          for (const p of b.q.parts) {
            if (fn.bindings?.get(p.id)?.k === 'pack') { found = p.id; return; }
            p.targs?.forEach((a) => { if (a.k !== 'expr') visit(a.t); });
          }
        }
        break;
      }
      case 'ptr': case 'ref': visit(t.to); break;
      case 'arr': visit(t.of); break;
      case 'pack': visit(t.of); break;
      case 'fn': visit(t.ret); t.params.forEach((p) => visit(p.type)); break;
    }
  };
  visit(te);
  return found;
}

export function fnType(I: Interp, f: Fn): Type {
  const s = ensureRet(I, f);
  return { k: 'fn', ret: s.ret, params: s.params, variadic: s.variadic };
}

export function ensureRet(I: Interp, f: Fn): Sig {
  const s = getSig(I, f);
  if (isAuto(s.ret) && f.decl?.body) {
    if (f.deducing) I.cerr(`use of '${f.qual}' before its return type 'auto' is deduced`);
    f.deducing = true;
    try { s.ret = inferReturnType(I, f, s); } finally { f.deducing = false; }
  }
  return s;
}

export function fnAddr(I: Interp, f: Fn): number {
  if (!f.addr) { f.addr = I.newFnAddr(); I.fnByAddr.set(f.addr, f); }
  return f.addr;
}

// =====================================================================================================================
// default values (used while evaluating without running)
// =====================================================================================================================
export function defaultV(I: Interp, t: Type): V {
  switch (t.k) {
    case 'void': return I.voidV();
    case 'float': return I.mkFloat(t, 0);
    case 'ref': return { k: 'l', t: t.to, a: 0, xv: t.rv };
    case 'cls': case 'arr': return { k: 'l', t, a: 0, tmp: true };
    case 'ptr': case 'nullptr': return { k: 'i', t, v: 0n };
    case 'fn': return { k: 'l', t, a: 0 };
    default: return { k: 'i', t, v: 0n };
  }
}

// =====================================================================================================================
// conversions
// =====================================================================================================================
const isRvalue = (v: V) => v.k !== 'l' || !!v.tmp || !!v.xv;

export function valueType(v: V): Type | null {
  switch (v.k) {
    case 'i': case 'f': case 'l': return v.t;
    default: return null;
  }
}

/** conversion rank: 0 exact, 1 qualification/binding adjustment, 2 promotion, 3 conversion, 4 user-defined, 5 ellipsis, null = impossible */
export function rankConv(I: Interp, arg: V, P: Type): number | null {
  if (P.k === 'ref') {
    const target = P.to;
    if (arg.k === 'init') return target.k === 'cls' || target.k === 'arr' ? 4 : null;
    if (arg.k === 'l' && !isRvalue(arg)) {
      // lvalue
      if (P.rv) return null;
      const at = arg.t;
      if (sameType(at, target, true)) {
        if (!target.const && at.const) return null;
        if (!target.volatile && at.volatile) return null;
        return (target.const && !at.const) || (target.volatile && !at.volatile) ? 1 : 0;
      }
      if (at.k === 'cls' && target.k === 'cls' && isBaseOf(target.c, at.c)) {
        if (!target.const && at.const) return null;
        return 3;
      }
      if (target.const) {
        const r = rankConv(I, arg, stripCv(target));
        return r === null ? null : Math.max(r, 3);
      }
      return null;
    }
    // rvalue (prvalue / xvalue / temporary)
    const at = valueType(arg);
    if (arg.k === 'fn') return target.k === 'fn' ? 0 : null;
    if (!at) return null;
    if (!P.rv && !target.const) return null;
    if (sameType(at, target, true)) {
      if (!target.const && at.const) return null;
      if (P.rv) return 0;
      return 1;
    }
    if (at.k === 'cls' && target.k === 'cls' && isBaseOf(target.c, at.c)) return 3;
    const r = rankConv(I, arg, stripCv(target));
    return r === null ? null : Math.max(r, 3);
  }
  // by value
  if (arg.k === 'init') {
    if (P.k === 'cls') return 4;
    if (P.k === 'arr') return 3;
    return P.k === 'ptr' ? null : (arg.node.k === 'init' && arg.node.items.length <= 1 ? 3 : null);
  }
  if (arg.k === 'fn') {
    if (P.k === 'ptr' && P.to.k === 'fn') {
      const ft = P.to;
      if (arg.tmpls?.length) return 1;
      return arg.cands.some((f) => { const sg = getSig(I, f); return sg.params.length === ft.params.length && sg.params.every((p, i) => sameType(p, ft.params[i], true)); }) ? 1 : null;
    }
    if (P.k === 'bool') return 3;
    return null;
  }
  if (arg.k === 'void' || arg.k === 'type' || arg.k === 'tmpl') return null;
  let at: Type = arg.t;
  const P0 = stripCv(P);
  if (at.k === 'arr') at = ptrTo(at.of);
  else if (at.k === 'fn') at = ptrTo(at);
  const A0 = stripCv(at);
  if (P0.k === 'cls') {
    if (A0.k === 'cls') {
      if (A0.c === P0.c) return 0;
      if (isBaseOf(P0.c, A0.c)) return 3;
    }
    // converting constructor or conversion operator
    return userConvertible(I, arg, P0) ? 4 : null;
  }
  if (A0.k === 'cls') {
    // class -> scalar via conversion operator
    return findConversionFn(I, arg, P0) ? 4 : null;
  }
  if (sameType(P0, A0, true)) return at.const !== P.const && P0.k === 'ptr' ? 0 : 0;
  if (P0.k === 'ptr') {
    if (A0.k === 'nullptr') return 3;
    if (A0.k === 'int' && arg.k === 'i' && arg.v === 0n && I.isNullConstant(arg)) return 3;
    if (A0.k === 'ptr') {
      const pt = P0.to, qt = A0.to;
      if (sameType(stripCv(pt), stripCv(qt), true)) {
        // adding const is a qualification conversion; removing it is an error
        if (!pt.const && qt.const) return null;
        return pt.const !== qt.const ? 1 : 0;
      }
      if (pt.k === 'void') return pt.const || !qt.const ? 3 : null;
      if (pt.k === 'cls' && qt.k === 'cls' && isBaseOf(pt.c, qt.c)) return !pt.const && qt.const ? null : 3;
      if (pt.k === 'fn' && qt.k === 'fn') return sameType(pt, qt) ? 0 : null;
    }
    return null;
  }
  if (P0.k === 'bool') {
    if (A0.k === 'ptr' || A0.k === 'nullptr') return 3;
    if (A0.k === 'int' || A0.k === 'float' || A0.k === 'enum') return 3;
    return null;
  }
  if (P0.k === 'int' || P0.k === 'enum') {
    if (P0.k === 'enum') return null; // no implicit int -> enum
    if (A0.k === 'enum') return A0.e.scoped ? null : (sameType(promote(I, A0), P0, true) ? 2 : 3);
    if (A0.k === 'bool') return sameType(P0, I.T.int, true) ? 2 : 3;
    if (A0.k === 'int') {
      const p = promote(I, A0);
      return sameType(p, P0, true) ? 2 : 3;
    }
    if (A0.k === 'float') return 3;
    return null;
  }
  if (P0.k === 'float') {
    if (A0.k === 'float') return P0.bytes > A0.bytes && A0.bytes === 4 ? 2 : 3;
    if (A0.k === 'int' || A0.k === 'bool' || A0.k === 'enum') return 3;
    return null;
  }
  if (P0.k === 'nullptr') return A0.k === 'nullptr' ? 0 : null;
  return null;
}

function userConvertible(I: Interp, arg: V, P: Extract<Type, { k: 'cls' }>): boolean {
  I.completeClass(P.c);
  for (const c of P.c.x.ctors as Fn[]) {
    if (c.isExplicit || c.isDeleted) continue;
    const s = getSig(I, c);
    if (s.params.length >= 1 && (s.params.length === 1 || s.defaults.slice(1).every((d) => d))) {
      if (c.special === 'copy' || c.special === 'move') continue;
      const p0 = s.params[0];
      const p0b = p0.k === 'ref' ? p0.to : p0;
      if (p0b.k === 'cls' && p0b.c === P.c) continue;
      const r = rankConv(I, arg, p0);
      if (r !== null && r <= 3) return true;
    }
  }
  return !!findConversionFn(I, arg, P);
}

/** a conversion operator of the argument's class that yields `target` (or any scalar when target is null) */
export function findConversionFn(I: Interp, arg: V, target: Type | null, explicitOk = false): Fn | null {
  const t = valueType(arg);
  if (!t || t.k !== 'cls') return null;
  I.completeClass(t.c);
  const all: Fn[] = [];
  const collect = (c: ClassInfo) => { I.completeClass(c); for (const f of (c.x.convs as Fn[])) all.push(f); c.bases.forEach((b) => collect(b.cls)); };
  collect(t.c);
  let best: Fn | null = null;
  for (const f of all) {
    if (f.isDeleted) continue;
    if (f.isExplicit && !explicitOk) continue;
    const s = getSig(I, f);
    const r = s.ret;
    if (target === null) { if (isInt(r) || isFloat(r) || r.k === 'ptr') { best = best ?? f; } continue; }
    const rb = stripCv(r.k === 'ref' ? r.to : r);
    const tb = stripCv(target);
    if (sameType(rb, tb, true)) return f;
    if (tb.k === 'bool' && (isInt(rb) || isFloat(rb) || rb.k === 'ptr')) { best = best ?? f; continue; }
    if ((isInt(tb) || isFloat(tb)) && (isInt(rb) || isFloat(rb))) { best = best ?? f; continue; }
    if (tb.k === 'ptr' && rb.k === 'ptr') { best = best ?? f; continue; }
    if (tb.k === 'cls' && rb.k === 'cls' && isBaseOf(tb.c, rb.c)) { best = best ?? f; continue; }
  }
  return best;
}

/** implicit conversion of a value to the (non-reference) type `to`. Class targets are constructed in a temporary. */
export function convertTo(I: Interp, v: V, to: Type, e?: A.Expr | { pos?: A.Pos }): V {
  if (to.k === 'ref') return bindRef(I, v, to, e);
  if (to.k === 'cls') {
    if (v.k === 'l' && v.t.k === 'cls' && v.t.c === to.c && v.tmp) return v; // prvalue already of the right type
    const a = newTempObj(I, to);
    if (!I.uneval) construct(I, to, a, [v]);
    return { k: 'l', t: to, a, tmp: true };
  }
  if (v.k === 'init') {
    const items = v.node.k === 'init' ? v.node.items : [];
    if (to.k === 'arr') I.cerr('cannot convert a braced list to an array here');
    if (items.length === 0) return to.k === 'float' ? I.mkFloat(to, 0) : to.k === 'ptr' ? { k: 'i', t: to, v: 0n } : I.mkInt(to, 0n);
    if (items.length === 1) return convertTo(I, evalExpr(I, items[0]), to, e);
    I.cerr('too many initialisers for a scalar', e && 'pos' in e ? e.pos : undefined);
  }
  if (v.k === 'fn') {
    if (to.k === 'ptr' && to.to.k === 'fn') return pickFnForTarget(I, v, to.to);
    if (to.k === 'bool') return I.mkBool(true);
    I.cerr('cannot convert a function name to this type');
  }
  if (v.k === 'l' && v.t.k === 'cls') {
    const conv = findConversionFn(I, v, to);
    if (!conv) I.cerr(`cannot convert '${v.t.c.name}' to '${typeStr(to)}': no suitable conversion operator`, e && 'pos' in e ? e.pos : undefined);
    const r = invokeFn(I, conv, v, [], undefined);
    return convertTo(I, r, to, e);
  }
  const x = I.rv(v);
  if (x.k === 'void') I.cerr('a void value cannot be converted', e && 'pos' in e ? e.pos : undefined);
  if (x.k === 'l' || x.k === 'fn' || x.k === 'type' || x.k === 'tmpl' || x.k === 'init') I.cerr('invalid conversion');
  const T0 = stripCv(to);
  if (T0.k === 'ptr') {
    if (x.k === 'f') I.cerr(`invalid conversion from '${typeStr(x.t)}' to '${typeStr(to)}'`);
    if (x.t.k === 'ptr') return convertPtr(I, x, T0, e);
    if (x.t.k === 'nullptr') return { k: 'i', t: T0, v: 0n };
    if (x.v === 0n) return { k: 'i', t: T0, v: 0n };
    I.cerr(`invalid conversion from '${typeStr(x.t)}' to '${typeStr(to)}' (use a cast if you really mean it)`, e && 'pos' in e ? e.pos : undefined);
  }
  if (x.k === 'i' && (x.t.k === 'ptr') && T0.k !== 'bool') {
    I.cerr(`invalid conversion from '${typeStr(x.t)}' to '${typeStr(to)}'`, e && 'pos' in e ? e.pos : undefined);
  }
  if (T0.k === 'enum' && x.k === 'i' && !(x.t.k === 'enum' && x.t.e === T0.e)) I.cerr(`invalid conversion from '${typeStr(x.t)}' to '${typeStr(to)}' (an enum needs an explicit cast)`, e && 'pos' in e ? e.pos : undefined);
  if (T0.k === 'int' && x.t.k === 'enum' && x.t.e.scoped) I.cerr(`cannot convert scoped enum '${typeStr(x.t)}' to '${typeStr(to)}' implicitly`, e && 'pos' in e ? e.pos : undefined);
  return convertScalar(I, x, T0);
}

function convertPtr(I: Interp, x: Extract<V, { k: 'i' }>, T0: Extract<Type, { k: 'ptr' }>, e?: A.Expr | { pos?: A.Pos }): V {
  const src = (x.t as Extract<Type, { k: 'ptr' }>).to;
  const dst = T0.to;
  if (x.v === 0n) return { k: 'i', t: T0, v: 0n };
  if (src.k === 'cls' && dst.k === 'cls' && src.c !== dst.c && isBaseOf(dst.c, src.c)) {
    return { k: 'i', t: T0, v: BigInt(upcastAddr(I, src.c, dst.c, Number(x.v))) };
  }
  if (dst.k !== 'void' && src.k !== 'void' && !sameType(stripCv(dst), stripCv(src), true) && !(dst.k === 'fn' || src.k === 'fn')) {
    if (!(src.k === 'cls' && dst.k === 'cls')) I.cerr(`invalid conversion from '${typeStr(x.t)}' to '${typeStr(T0)}'`, e && 'pos' in e ? e.pos : undefined);
    I.cerr(`invalid conversion from '${typeStr(x.t)}' to '${typeStr(T0)}'`, e && 'pos' in e ? e.pos : undefined);
  }
  if (src.k !== 'void' && dst.k !== 'void' && !dst.const && src.const && sameType(stripCv(dst), stripCv(src), true)) {
    I.cerr(`invalid conversion from '${typeStr(x.t)}' to '${typeStr(T0)}' (discards const)`, e && 'pos' in e ? e.pos : undefined);
  }
  return { k: 'i', t: T0, v: x.v };
}

export function isDerivedPtrConv(from: Type, to: Type): boolean {
  return from.k === 'ptr' && to.k === 'ptr' && from.to.k === 'cls' && to.to.k === 'cls' && from.to.c !== to.to.c && isBaseOf(to.to.c, from.to.c);
}

/** convert an address of a `from` object to the address of its `to` base subobject (dynamic when virtual bases are involved) */
export function upcastAddr(I: Interp, from: ClassInfo, to: ClassInfo, addr: number): number {
  if (from === to) return addr;
  const off = baseOffsetOf(I, from, to);
  if (off === null) I.cerr(`'${to.name}' is not a base of '${from.name}'`);
  if (hasVirtualPath(from, to) && !I.uneval) {
    const dyn = dynamicObject(I, from, addr);
    if (dyn) {
      const o2 = baseOffsetOf(I, dyn.cls, to);
      if (o2 !== null) return dyn.addr + o2;
    }
  }
  return addr + off;
}

function hasVirtualPath(from: ClassInfo, to: ClassInfo): boolean {
  for (const b of from.bases) {
    if (b.virtual && (b.cls === to || isBaseOf(to, b.cls))) return true;
    if (isBaseOf(to, b.cls) && hasVirtualPath(b.cls, to)) return true;
  }
  return false;
}

function pickFnForTarget(I: Interp, v: Extract<V, { k: 'fn' }>, ft: Extract<Type, { k: 'fn' }>): V {
  for (const f of v.cands) {
    const s = getSig(I, f);
    if (s.params.length === ft.params.length && s.params.every((p, i) => sameType(p, ft.params[i], true))) return I.mkPtr(fnType(I, f), fnAddr(I, f));
  }
  if (v.tmpls) {
    for (const t of v.tmpls) {
      const f = tryInstantiateForType(I, t, v.targs ?? [], ft);
      if (f) return I.mkPtr(fnType(I, f), fnAddr(I, f));
    }
  }
  if (v.cands.length === 1) return I.mkPtr(fnType(I, v.cands[0]), fnAddr(I, v.cands[0]));
  I.cerr(`no overload of '${v.name}' matches the target function type`);
}

function tryInstantiateForType(I: Interp, t: FuncTemplate, targs: TArgVal[], ft: Extract<Type, { k: 'fn' }>): Fn | null {
  const b = deduceFunction(I, t.decl, t.scope, targs, ft.params.map((p) => ({ t: p, lv: false })));
  if (!b) return null;
  return instantiateFunctionTemplate(I, t, b);
}

export function instantiateByTargs(I: Interp, v: Extract<V, { k: 'fn' }>): Fn {
  const t = v.tmpls![0];
  const b = deduceFunction(I, t.decl, t.scope, v.targs ?? [], []);
  if (!b) I.cerr(`cannot take the address of '${v.name}': template arguments cannot be deduced`);
  return instantiateFunctionTemplate(I, t, b);
}

/** bind a reference of type `rt` to the value */
export function bindRef(I: Interp, v: V, rt: Extract<Type, { k: 'ref' }>, e?: A.Expr | { pos?: A.Pos }): V {
  const target = rt.to;
  const pos = e && 'pos' in e ? e.pos : undefined;
  if (v.k === 'init') {
    const a = newTempObj(I, target);
    if (!I.uneval) initFromBracesV(I, target, a, v);
    return { k: 'l', t: target, a, tmp: true };
  }
  if (v.k === 'fn' && target.k === 'fn') {
    const p = pickFnForTarget(I, v, target);
    return { k: 'l', t: target, a: Number((p as any).v) };
  }
  if (v.k === 'l' && !isRvalue(v)) {
    if (rt.rv) I.cerr('cannot bind an rvalue reference to an lvalue (use std::move)', pos);
    if (v.bf) I.cerr('cannot bind a reference to a bit-field', pos);
    if (sameType(v.t, target, true)) {
      if (v.t.const && !target.const) I.cerr(`binding reference of type '${typeStr(rt)}' to '${typeStr(v.t)}' discards the const qualifier`, pos);
      return { k: 'l', t: target, a: v.a };
    }
    if (v.t.k === 'cls' && target.k === 'cls' && isBaseOf(target.c, v.t.c)) {
      if (v.t.const && !target.const) I.cerr(`binding reference of type '${typeStr(rt)}' to '${typeStr(v.t)}' discards the const qualifier`, pos);
      return { k: 'l', t: target, a: upcastAddr(I, v.t.c, target.c, v.a) };
    }
    if (!target.const) I.cerr(`cannot bind non-const lvalue reference of type '${typeStr(rt)}' to a value of type '${typeStr(v.t)}'`, pos);
    // const T& bound to a convertible lvalue: converted temporary
    const c = convertTo(I, v, stripCv(target), e);
    return materialize(I, c, target);
  }
  // rvalue
  if (!rt.rv && !target.const) I.cerr(`cannot bind non-const lvalue reference of type '${typeStr(rt)}' to an rvalue`, pos);
  if (v.k === 'l' && v.t.k === 'cls' && target.k === 'cls') {
    if (v.t.c === target.c) return { k: 'l', t: target, a: v.a, tmp: v.tmp, xv: true };
    if (isBaseOf(target.c, v.t.c)) return { k: 'l', t: target, a: upcastAddr(I, v.t.c, target.c, v.a), tmp: v.tmp, xv: true };
  }
  if (v.k === 'l' && sameType(v.t, target, true)) return { k: 'l', t: target, a: v.a, tmp: v.tmp, xv: true };
  const c = convertTo(I, v, stripCv(target), e);
  return materialize(I, c, target);
}

/** give an rvalue an address (a temporary) */
export function materialize(I: Interp, v: V, asType?: Type): V {
  if (v.k === 'l') return asType ? { ...v, t: asType.k === 'ref' ? asType.to : v.t } : v;
  if (v.k === 'i' || v.k === 'f') {
    const t = asType && asType.k !== 'ref' ? stripCv(asType) : v.t;
    const a = newTempObj(I, t);
    if (!I.uneval) I.store(t, a, v);
    return { k: 'l', t: asType ?? v.t, a, tmp: true };
  }
  I.cerr('cannot create a temporary from this value');
}

function initFromBracesV(I: Interp, t: Type, addr: number, v: Extract<V, { k: 'init' }>) {
  if (v.node.k === 'init') initFromBraces(I, t, addr, v.node);
}

// =====================================================================================================================
// temporaries
// =====================================================================================================================
export function newTempObj(I: Interp, t: Type): number {
  if (I.uneval) return 0;
  const size = Math.max(1, sizeOf(t));
  const a = I.stackAlloc(size, Math.max(1, alignOf(t)));
  prepareStorage(I, t, a);
  const needs = t.k === 'cls' && hasNontrivialDtor(I, t);
  I.tmpStack.push({ type: t, addr: a, owner: I.frame.id, built: false, needs, cursor: I.frame.cursor + 0 });
  if (t.k === 'cls') I.emitTemp(t, a);
  return a;
}

export function markBuilt(I: Interp, addr: number) {
  for (let i = I.tmpStack.length - 1; i >= 0 && i >= I.tmpStack.length - 16; i--) {
    if (I.tmpStack[i].addr === addr) { I.tmpStack[i].built = true; return; }
  }
}

export interface TempMark { n: number; cursor: number }
export function tempMark(I: Interp): TempMark { return { n: I.tmpStack.length, cursor: I.frame.cursor }; }

/** end of a full-expression: destroy the temporaries created since `m`, newest first */
export function releaseTemps(I: Interp, m: TempMark, keepCursor = false) {
  if (I.uneval) return;
  while (I.tmpStack.length > m.n) {
    const t = I.tmpStack.pop()!;
    if (t.needs && t.built) destroyObj(I, t.type, t.addr, false);
    if (t.type.k === 'cls') I.emitTempEnd(t.addr);
  }
  if (!keepCursor && I.frame.cursor < m.cursor) {
    I.releaseStack(m.cursor);
  }
}

/** remove a temporary from the full-expression list (lifetime extension); returns it */
export function adoptTemp(I: Interp, addr: number): { type: Type; addr: number } | null {
  for (let i = I.tmpStack.length - 1; i >= 0; i--) {
    if (I.tmpStack[i].addr === addr) { const t = I.tmpStack[i]; I.tmpStack.splice(i, 1); return t; }
  }
  return null;
}

/** mark memory of a freshly allocated object: uninitialised bytes with padding marked */
export function prepareStorage(I: Interp, t: Type, addr: number) {
  if (I.uneval) return;
  const size = sizeOf(t);
  if (size <= 0) return;
  if (I.plat.debug && I.mem.seg(addr)?.name === 'stack') I.mem.setState(addr, size, S.Uninit);
  else I.mem.setState(addr, size, S.Uninit);
  markPadding(I, t, addr);
}

function markPadding(I: Interp, t: Type, addr: number) {
  if (t.k === 'arr') {
    if (t.of.k === 'cls' || t.of.k === 'arr') {
      const es = sizeOf(t.of);
      if (!hasPadding(t.of)) return;
      for (let i = 0; i < (t.n ?? 0); i++) markPadding(I, t.of, addr + i * es);
    }
    return;
  }
  if (t.k !== 'cls') return;
  const L = I.layoutOf(t.c);
  for (const [off, len] of L.padding) I.mem.setState(addr + off, len, S.Pad);
}

function hasPadding(t: Type): boolean {
  if (t.k === 'arr') return hasPadding(t.of);
  if (t.k !== 'cls') return false;
  return !!t.c.layout && t.c.layout.padding.length > 0;
}

// =====================================================================================================================
// overload resolution
// =====================================================================================================================
interface Viable { fn: Fn; ranks: number[]; selfRank: number; isTmpl: boolean; spec: number }

function argDesc(I: Interp, a: V): string {
  switch (a.k) {
    case 'i': case 'f': return typeStr(a.t);
    case 'l': return typeStr(a.t) + (a.tmp || a.xv ? '' : '');
    case 'init': return '{...}';
    case 'fn': return 'overloaded function';
    default: return a.k;
  }
}

function selfRankFor(I: Interp, f: Fn, self: V | undefined): number | null {
  if (!f.cls || f.isStatic || f.isCtor) return 0;
  if (!self || self.k !== 'l') return 0; // checked at invocation
  if (self.t.const && !f.isConst) return null;
  if (!self.t.const && f.isConst) return 1;
  return 0;
}

export function pickOverload(
  I: Interp, cands: Fn[], tmpls: FuncTemplate[], args: V[], opts: { self?: V; targs?: TArgVal[]; name: string; what?: string },
): Fn {
  const viable: Viable[] = [];
  const tried: string[] = [];
  const consider = (f: Fn, isTmpl: boolean, spec = 0) => {
    if (f.isDeleted && false) return;
    const s = getSig(I, f);
    const n = args.length;
    const np = s.params.length;
    const minArgs = s.defaults.reduce((c, d, i) => (d ? c : i + 1), 0);
    const reqMin = (() => { let r = 0; for (let i = 0; i < np; i++) if (!s.defaults[i]) r = i + 1; return r; })();
    void minArgs;
    if (n < reqMin || (n > np && !s.variadic)) { tried.push(describeFn(I, f, `expects ${reqMin === np ? np : `${reqMin} to ${np}`} argument${np === 1 ? '' : 's'}, got ${n}`)); return; }
    const sr = selfRankFor(I, f, opts.self);
    if (sr === null) { tried.push(describeFn(I, f, `the object is const but '${f.name}' is not a const member function`)); return; }
    const ranks: number[] = [];
    for (let i = 0; i < n; i++) {
      if (i >= np) { ranks.push(5); continue; }
      const P = s.params[i];
      const r = I.uneval && args[i].k === 'l' && (args[i] as any).a === 0 && false ? 0 : rankConv(I, args[i], P);
      if (r === null) { tried.push(describeFn(I, f, `argument ${i + 1}: cannot convert '${argDesc(I, args[i])}' to '${typeStr(P)}'`)); return; }
      ranks.push(r);
    }
    viable.push({ fn: f, ranks, selfRank: sr, isTmpl, spec });
  };
  const seen = new Set<Fn>();
  for (const f of cands) { if (seen.has(f)) continue; seen.add(f); consider(f, false); }
  for (const t of tmpls) {
    try {
      const inst = tryTemplate(I, t, args, opts);
      if (inst) { if (!seen.has(inst)) { seen.add(inst); consider(inst, true, templSpecificity(t)); } }
      else tried.push(`  template '${t.name}': template argument deduction failed`);
    } catch (e: any) {
      if (e && e.name === 'CompileError') { tried.push(`  template '${t.name}': substitution failed (${e.message})`); continue; }
      throw e;
    }
  }
  if (viable.length === 0) {
    const sig = `${opts.name}(${args.map((a) => argDesc(I, a)).join(', ')})`;
    I.cerr(`no matching function for call to '${sig}'${tried.length ? '\n  candidates:\n' + tried.slice(0, 6).join('\n') : ''}`);
  }
  let best = viable[0];
  const better = (a: Viable, b: Viable): boolean => {
    // true when a is strictly better than b
    let anyBetter = false;
    const n = Math.max(a.ranks.length, b.ranks.length);
    if (a.selfRank !== b.selfRank) { if (a.selfRank > b.selfRank) return false; anyBetter = true; }
    for (let i = 0; i < n; i++) {
      const x = a.ranks[i] ?? 0, y = b.ranks[i] ?? 0;
      if (x > y) return false;
      if (x < y) anyBetter = true;
    }
    if (anyBetter) return true;
    if (!a.isTmpl && b.isTmpl) return true;
    if (a.isTmpl && b.isTmpl && a.spec > b.spec) return true;
    // a function whose defaults were not needed beats one that needed them
    return false;
  };
  const winners: Viable[] = [viable[0]];
  for (let i = 1; i < viable.length; i++) {
    const v = viable[i];
    if (winners.every((w) => better(v, w))) { winners.length = 0; winners.push(v); }
    else if (!winners.some((w) => better(w, v))) winners.push(v);
  }
  if (winners.length > 1) {
    // prefer the candidate that takes fewer parameters (exact arity)
    const exact = winners.filter((w) => getSig(I, w.fn).params.length === args.length);
    if (exact.length === 1) return exact[0].fn;
    const sig = `${opts.name}(${args.map((a) => argDesc(I, a)).join(', ')})`;
    I.cerr(`call of overloaded '${sig}' is ambiguous\n  candidates:\n${winners.map((w) => '  ' + describeFn(I, w.fn, '')).join('\n')}`);
  }
  best = winners[0];
  return best.fn;
}

function templSpecificity(t: FuncTemplate): number {
  // fewer fully generic parameters => more specialised
  let generic = 0;
  if (t.decl.params.some((p) => p.pack || p.type.k === 'pack')) generic += 50;
  const names = new Set((t.decl.tparams ?? []).map((p) => p.name));
  for (const p of t.decl.params) {
    let te = p.type;
    while (te.k === 'ref' || te.k === 'ptr') te = te.to;
    if (te.k === 'base' && te.spec.base.k === 'name' && te.spec.base.q.parts.length === 1 && names.has(te.spec.base.q.parts[0].id)) generic++;
  }
  return 100 - generic;
}

function describeFn(I: Interp, f: Fn, why: string): string {
  let sig = f.qual;
  try { const s = getSig(I, f); sig = `${f.qual}(${s.params.map((p) => typeStr(p)).join(', ')})`; } catch { /* ignore */ }
  return `  ${sig}${why ? ': ' + why : ''}`;
}

function tryTemplate(I: Interp, t: FuncTemplate, args: V[], opts: { self?: V; targs?: TArgVal[] }): Fn | null {
  const dargs = args.map((a) => {
    if (a.k === 'l') return { t: a.t, lv: !isRvalue(a) };
    if (a.k === 'i' || a.k === 'f') return { t: a.t, lv: false };
    if (a.k === 'fn' && a.cands.length === 1) return { t: fnType(I, a.cands[0]), lv: true };
    return { t: I.T.int, lv: false, skip: true } as any;
  });
  const b = deduceFunction(I, t.decl, t.scope, opts.targs ?? [], dargs, t.outerBindings);
  if (!b) return null;
  return instantiateFunctionTemplate(I, t, b);
}

export function instantiateFunctionTemplate(I: Interp, t: FuncTemplate, b: Bindings): Fn {
  const key = bindingsKey(t.decl.tparams ?? [], b);
  const old = t.instances.get(key);
  if (old) return old;
  const spec = t.specs.get(key);
  if (spec) return spec;
  const sc = bindingScope(I, t.scope, new Map([...(t.outerBindings ?? []), ...b]), t.name);
  const f = makeFn(I, t.decl, sc, t.cls, { bindings: new Map(b), tmpl: t, access: t.decl.access });
  f.key = key;
  t.instances.set(key, f);
  // check the signature now so that substitution failures surface during overload resolution
  getSig(I, f);
  return f;
}

// ADL: functions with the given name in the namespaces of the arguments' class types
export function adlCandidates(I: Interp, name: string, args: V[]): { fns: Fn[]; tmpls: FuncTemplate[] } {
  const fns: Fn[] = [], tmpls: FuncTemplate[] = [];
  const scopes = new Set<Scope>();
  const addClass = (c: ClassInfo, depth = 0) => {
    const ds = c.x.declScope as Scope | undefined;
    for (let s: Scope | null | undefined = ds; s; s = s.parent) { if (s.kind === 'ns' || s.kind === 'global') { scopes.add(s); break; } }
    if (depth < 3) for (const b of c.bases) addClass(b.cls, depth + 1);
    // template arguments' namespaces
    const ta = c.x.tmplArgs as TArgVal[] | undefined;
    if (ta && depth < 2) for (const a of ta) if (a.k === 'type') addType(a.t, depth + 1);
  };
  const addType = (t: Type, depth = 0) => {
    if (t.k === 'cls') addClass(t.c, depth);
    else if (t.k === 'ref' || t.k === 'ptr') addType(t.to, depth);
    else if (t.k === 'enum') { /* enums: namespace unknown, global */ scopes.add(I.global); }
  };
  for (const a of args) { const t = valueType(a); if (t) addType(t); }
  for (const s of scopes) {
    const ents = s.names.get(name);
    if (!ents) continue;
    for (const e of ents) if (e.k === 'fns') { fns.push(...e.fns); tmpls.push(...e.ftempls); }
    for (const u of s.usings) {
      const ents2 = u.names.get(name);
      if (ents2) for (const e of ents2) if (e.k === 'fns') { fns.push(...e.fns); tmpls.push(...e.ftempls); }
    }
  }
  return { fns, tmpls };
}

// =====================================================================================================================
// calling a function value
// =====================================================================================================================
export function callFnValue(I: Interp, fv: Extract<V, { k: 'fn' }>, args: V[], dest?: number): V {
  let cands = fv.cands;
  let tmpls = fv.tmpls ?? [];
  if (!fv.qualified && !fv.self) {
    const adl = adlCandidates(I, fv.name, args);
    if (adl.fns.length || adl.tmpls.length) {
      cands = [...new Set([...cands, ...adl.fns])];
      tmpls = [...new Set([...tmpls, ...adl.tmpls])];
    }
  }
  const fn = pickOverload(I, cands, tmpls, args, { self: fv.self, targs: fv.targs, name: fv.name });
  let self = fv.self;
  if (fn.cls && !fn.isStatic && !self) {
    // unqualified call of a member from inside another member (implicit this) is handled by name lookup; reaching here is an error
    I.cerr(`cannot call member function '${fn.qual}' without an object`);
  }
  if (fn.isStatic) self = undefined;
  return invokeFn(I, fn, self, args, dest, { virt: !fv.qualified });
}
// property helpers used by expr.ts
callFnValue.fnType = fnType;
callFnValue.instantiateByTargs = instantiateByTargs;

export function callValue(I: Interp, callee: V, args: V[], dest: number | undefined, e?: A.Expr): V {
  switch (callee.k) {
    case 'fn': return callFnValue(I, callee, args, dest);
    case 'type': {
      // T(args): functional-style construction of a temporary
      const t = callee.t;
      if (t.k === 'cls') {
        if (I.uneval) return { k: 'l', t, a: 0, tmp: true };
        const a = dest ?? newTempObj(I, t);
        construct(I, t, a, args);
        return { k: 'l', t, a, tmp: true };
      }
      if (args.length === 0) return t.k === 'float' ? I.mkFloat(t, 0) : t.k === 'ptr' ? { k: 'i', t, v: 0n } : I.mkInt(t, 0n);
      return convertTo(I, args[0], t, e);
    }
    case 'tmpl': {
      // class template argument deduction  Stack(5)
      const t = I.deduceCtad(callee.ent, args);
      return callValue(I, { k: 'type', t }, args, dest, e);
    }
    case 'l': {
      if (callee.t.k === 'cls') {
        const r = callOperatorOn(I, callee, 'operator()', args, dest);
        if (!r) I.cerr(`'${callee.t.c.name}' is not callable: it has no operator()`, e?.pos);
        return r;
      }
      if (callee.t.k === 'fn') return callIndirect(I, callee.a, callee.t, args, dest, e);
      break;
    }
    default: break;
  }
  const p = I.rv(callee);
  if (p.k === 'i' && p.t.k === 'ptr' && p.t.to.k === 'fn') return callIndirect(I, Number(p.v), p.t.to, args, dest, e);
  I.cerr('called object is not a function or function pointer', e?.pos);
}

function callIndirect(I: Interp, addr: number, ft: Extract<Type, { k: 'fn' }>, args: V[], dest: number | undefined, e?: A.Expr): V {
  if (I.uneval) return defaultV(I, ft.ret);
  const f = I.fnByAddr.get(addr);
  if (!f) {
    throw new Fault('segv', `${I.plat.faultName} — call through an invalid function pointer 0x${addr.toString(16)}${addr === 0 ? ' (null)' : ''}`, addr, I.plat.id === 'windows' ? 0xC0000005 : 139);
  }
  void e;
  return callFnValue(I, { k: 'fn', name: f.name, cands: [f], qualified: true }, args, dest);
}

// ---- operators ---------------------------------------------------------------------------------------------------
export function callOperatorOn(I: Interp, obj: Extract<V, { k: 'l' }>, name: string, args: V[], dest?: number): V | null {
  if (obj.t.k !== 'cls') return null;
  const hit = findMember(I, obj.t.c, name);
  if (!hit || hit.field || !hit.ents.length) return null;
  const ents = hit.ents.filter((x) => x.k === 'fns');
  if (!ents.length) return null;
  const fns = ents.flatMap((x) => (x.k === 'fns' ? x.fns : []));
  const tm = ents.flatMap((x) => (x.k === 'fns' ? x.ftempls : []));
  const self: V = { k: 'l', t: withCv(clsType(hit.owner), obj.t), a: obj.a + hit.baseOffset, tmp: obj.tmp, xv: obj.xv };
  return callFnValue(I, { k: 'fn', name, cands: fns, tmpls: tm, self, ctxCls: obj.t.c }, args, dest);
}

/** try a user-defined operator; null when none applies. For assignment the first operand is the target. */
export function callOperator(I: Interp, name: string, operands: V[], dest?: number, assignment = false): V | null {
  const first = operands[0];
  const isCls = (v: V) => v.k === 'l' && v.t.k === 'cls';
  // member operator
  if (isCls(first)) {
    const hit = findMember(I, (first as any).t.c, name);
    if (hit && !hit.field && hit.ents[0]?.k === 'fns') {
      try {
        return callOperatorOn(I, first as Extract<V, { k: 'l' }>, name, operands.slice(1), dest);
      } catch (err: any) {
        // fall through to non-member candidates when no member viable
        if (!(err && err.name === 'CompileError' && /no matching function/.test(err.message))) throw err;
        const free = freeOperator(I, name, operands, dest);
        if (free) return free;
        throw err;
      }
    }
  }
  const free = freeOperator(I, name, operands, dest);
  if (free) return free;
  if (assignment && isCls(first)) return implicitAssign(I, first as Extract<V, { k: 'l' }>, operands[1]);
  return null;
}

function freeOperator(I: Interp, name: string, operands: V[], dest?: number): V | null {
  const fns: Fn[] = [], tmpls: FuncTemplate[] = [];
  const r = lookupUnqualified(I, name, I.scope);
  if (r) for (const e of r.ents) if (e.k === 'fns') { fns.push(...e.fns); tmpls.push(...e.ftempls); }
  const adl = adlCandidates(I, name, operands);
  fns.push(...adl.fns); tmpls.push(...adl.tmpls);
  if (!fns.length && !tmpls.length) return null;
  try {
    return callFnValue(I, { k: 'fn', name, cands: [...new Set(fns)], tmpls: [...new Set(tmpls)], qualified: true }, operands, dest);
  } catch (e: any) {
    if (e && e.name === 'CompileError' && /no matching function/.test(e.message)) return null;
    throw e;
  }
}

function implicitAssign(I: Interp, lhs: Extract<V, { k: 'l' }>, rhs: V): V | null {
  const c = (lhs.t as Extract<Type, { k: 'cls' }>).c;
  I.completeClass(c);
  const asg = (c.x.assigns as Fn[]);
  if (!asg.length) return null;
  const fv: V = { k: 'fn', name: 'operator=', cands: asg, self: lhs, qualified: true };
  return callFnValue(I, fv, [rhs]);
}

// =====================================================================================================================
// virtual dispatch
// =====================================================================================================================
export function dynamicObject(I: Interp, staticCls: ClassInfo, addr: number): { cls: ClassInfo; addr: number } | null {
  I.completeClass(staticCls);
  if (!isPolymorphic(staticCls)) return null;
  const L = I.layoutOf(staticCls);
  const vo = L.vptrOffset;
  if (vo === null) return null;
  const vp = I.mem.rd64(addr + vo);
  const info = I.vtables.get(vp);
  if (!info) {
    throw new Fault('segv', `${I.plat.faultName} — virtual call through an invalid vtable pointer 0x${vp.toString(16)}: the object was never constructed, or it has been destroyed/overwritten`, vp, I.plat.id === 'windows' ? 0xC0000005 : 139);
  }
  I.emit({ t: 'r', a: addr + vo, l: 8 });
  return { cls: info.cls, addr: addr + vo - info.offset - (info.vptrOffsetInSub ?? 0) };
}

export function rootDecl(f: Fn): Fn {
  let r = f;
  while (r.overrides) r = r.overrides;
  return r;
}

export function sameSignature(I: Interp, a: Fn, b: Fn): boolean {
  if (a.name !== b.name) return false;
  if (a.isDtor || b.isDtor) return a.isDtor && b.isDtor;
  if (a.isConst !== b.isConst) return false;
  const sa = getSig(I, a), sb = getSig(I, b);
  if (sa.params.length !== sb.params.length) return false;
  return sa.params.every((p, i) => sameType(stripCv(p), stripCv(sb.params[i]), true));
}

export function finalOverrider(I: Interp, c: ClassInfo, root: Fn): Fn {
  const cache: Map<Fn, Fn> = (c.x.fo ??= new Map());
  const hit = cache.get(root);
  if (hit) return hit;
  I.completeClass(c);
  let result: Fn | null = null;
  for (const m of c.x.methods as Fn[]) {
    if (m.isVirtual && !m.isStatic && m !== root && sameSignature(I, m, root)) { result = m; break; }
  }
  if (!result) {
    if (root.cls === c) result = root;
    else {
      let best: Fn | null = null;
      for (const b of c.bases) {
        if (!(b.cls === root.cls || isBaseOf(root.cls!, b.cls))) continue;
        const r = finalOverrider(I, b.cls, root);
        if (!best) best = r;
        else if (r !== root && (best === root || (r.cls && best.cls && isBaseOf(best.cls, r.cls)))) best = r;
      }
      result = best ?? root;
    }
  }
  cache.set(root, result);
  return result;
}

function virtualTarget(I: Interp, fn: Fn, self: Extract<V, { k: 'l' }>): { fn: Fn; self: Extract<V, { k: 'l' }> } {
  if (self.t.k !== 'cls') return { fn, self };
  const root = rootDecl(fn);
  const dyn = dynamicObject(I, self.t.c, self.a);
  if (!dyn) return { fn, self };
  const target = fn.isDtor ? finalDtor(I, dyn.cls) : finalOverrider(I, dyn.cls, root);
  if (target === fn && dyn.cls === self.t.c) return { fn, self };
  const off = baseOffsetOf(I, dyn.cls, target.cls!) ?? 0;
  return { fn: target, self: { k: 'l', t: withCv(clsType(target.cls!), self.t), a: dyn.addr + off } };
}

function finalDtor(I: Interp, c: ClassInfo): Fn {
  I.completeClass(c);
  return c.x.dtor as Fn;
}

// =====================================================================================================================
// invoking a function
// =====================================================================================================================
interface Bound { t: Type; kind: 'ref' | 'obj' | 'val' | 'raw'; addr: number; v?: V }

export function invokeFn(I: Interp, fn0: Fn, self0: V | undefined, args: V[], dest: number | undefined, opts: { virt?: boolean } = {}): V {
  let fn = fn0;
  let self = self0 && self0.k === 'l' ? self0 : undefined;
  if (fn.isDeleted) I.cerr(`use of deleted function '${fn.qual}'`);
  if (opts.virt && fn.isVirtual && self && !I.uneval) {
    const t = virtualTarget(I, fn, self);
    fn = t.fn; self = t.self;
  }
  if (fn.native) {
    const s = getSig(I, fn);
    if (I.uneval) return defaultV(I, s.ret);
    return fn.native(I, args, self, dest);
  }
  const sig = ensureRet(I, fn);
  if (I.uneval) return defaultV(I, sig.ret);
  if (!fn.decl?.body && !fn.special && !(fn.decl && fn.decl.defaulted)) {
    I.cerr(`undefined reference to '${fn.qual}${fn.decl && !fn.isDtor ? '(' + sig.params.map((p) => typeStr(p)).join(', ') + ')' : ''}' (the function is declared but never defined, so the linker fails)`);
  }
  // evaluate defaults and bind arguments in the caller's context
  const bound = bindArguments(I, fn, sig, args);
  const retT = sig.ret;
  let retAddr: number | undefined;
  if (retT.k === 'cls') {
    retAddr = dest ?? newTempObj(I, retT);
  }
  return runFrame(I, fn, sig, self, bound, retAddr, args);
}

function bindArguments(I: Interp, fn: Fn, sig: Sig, args: V[]): Bound[] {
  const out: Bound[] = [];
  const np = sig.params.length;
  for (let i = 0; i < Math.max(np, args.length); i++) {
    if (i >= np) {
      // variadic extra: default argument promotions
      const x = args[i];
      out.push({ t: I.T.int, kind: 'raw', addr: 0, v: promoteVariadic(I, x) });
      continue;
    }
    const P = sig.params[i];
    let a: V | undefined = args[i];
    if (!a) {
      const d = sig.defaults[i];
      if (!d) I.cerr(`too few arguments to '${fn.qual}'`);
      const saved = I.scope;
      I.scope = fn.defaultScope ?? fn.scope;
      try { a = d.k === 'init' ? ({ k: 'init', items: [], node: d } as V) : evalExpr(I, d); } finally { I.scope = saved; }
    }
    out.push(bindOne(I, P, a));
  }
  return out;
}

function promoteVariadic(I: Interp, v: V): V {
  const x = I.rv(v);
  if (x.k === 'f') return x.t.k === 'float' && x.t.bytes === 4 ? I.mkFloat(I.T.double, x.v) : x;
  if (x.k === 'i' && x.t.k !== 'ptr' && x.t.k !== 'nullptr') {
    const p = promote(I, x.t);
    return convertScalar(I, x, p);
  }
  return x;
}

function bindOne(I: Interp, P: Type, a: V): Bound {
  if (P.k === 'ref') {
    const r = bindRef(I, a, P) as Extract<V, { k: 'l' }>;
    return { t: P, kind: 'ref', addr: r.a, v: r };
  }
  if (P.k === 'cls') {
    if (a.k === 'l' && a.t.k === 'cls' && a.t.c === P.c && a.tmp) return { t: P, kind: 'obj', addr: a.a }; // elided: the prvalue is the parameter
    const c = convertTo(I, a, P) as Extract<V, { k: 'l' }>;
    return { t: P, kind: 'obj', addr: c.a };
  }
  const v = convertTo(I, a, P);
  return { t: P, kind: 'val', addr: 0, v };
}

// ---- frames ----------------------------------------------------------------------------------------------------------
const alignDown = (n: number, a: number) => Math.floor(n / a) * a;
const alignUp = (n: number, a: number) => Math.ceil(n / a) * a;

function runFrame(I: Interp, fn: Fn, sig: Sig, self: Extract<V, { k: 'l' }> | undefined, bound: Bound[], retAddr: number | undefined, args: V[]): V {
  void args;
  if (I.frames.length >= I.maxDepth) {
    const win = I.plat.id === 'windows';
    throw new Fault('stack-overflow', win ? 'Stack overflow (0xC00000FD): too many nested calls' : `${I.plat.faultName} — stack overflow: the call stack is exhausted`, undefined, win ? 0xC00000FD : 139);
  }
  const caller = I.frame;
  const plan = getPlan(I, fn);
  const frame = enterFrame(I, fn, sig, self, bound, plan, retAddr);
  const savedScope = I.scope;
  const savedPack = I.packIdx;
  const fscope = newScope('func', fn.scope, fn.qual);
  fscope.fn = fn;
  fscope.locals = [];
  frame.scope = fscope;
  I.scope = fscope;
  I.packIdx = new Map();
  I.frames.push(frame);
  let result: V = I.voidV();
  try {
    declareParams(I, fn, sig, self, bound, frame, fscope);
    I.emit({ t: 'push', id: frame.id, name: fn.qual, base: frame.cfa, ret: frame.retValue, retLabel: caller.fn ? caller.fn.qual + '+0x' + (frame.retValue - fnAddr(I, caller.fn)).toString(16) : I.plat.sys.mainReturnLabel, line: I.curLine, args: argsString(I, fn, sig, bound) });
    frame.line = fn.decl?.pos.line ?? 0;
    result = execBody(I, fn, frame, retAddr);
  } finally {
    // the frame is gone whether the function returned or unwound
    I.frames.pop();
    popFrame(I, frame, fscope);
    I.scope = savedScope;
    I.packIdx = savedPack;
  }
  return result;
}

function argsString(I: Interp, fn: Fn, sig: Sig, bound: Bound[]): string {
  const parts: string[] = [];
  bound.forEach((b, i) => {
    const nm = sig.paramNames[i];
    let val = '';
    if (b.kind === 'val' && b.v) val = fmtScalar(I, b.v);
    else if (b.kind === 'raw' && b.v) val = fmtScalar(I, b.v);
    else if (b.kind === 'ref') val = '&' + '0x' + b.addr.toString(16);
    else val = '{…}';
    parts.push(nm && !nm.includes('#') ? `${nm}=${val}` : val);
  });
  return parts.join(', ');
}

export function fmtScalar(I: Interp, v: V): string {
  if (v.k === 'f') return String(v.v);
  if (v.k === 'i') {
    if (v.t.k === 'ptr') return v.v === 0n ? 'nullptr' : '0x' + v.v.toString(16);
    if (v.t.k === 'bool') return v.v ? 'true' : 'false';
    if (v.t.k === 'int' && v.t.bytes === 1 && v.t.nm.includes('char') && v.v >= 32n && v.v < 127n) return `'${String.fromCharCode(Number(v.v))}'`;
    return v.v.toString();
  }
  return '?';
}

// ---- frame plan -----------------------------------------------------------------------------------------------------------
interface PlanEntry { node: A.Declarator; type: Type; size: number; align: number }
interface Plan { entries: PlanEntry[] }

function getPlan(I: Interp, fn: Fn): Plan {
  if (fn.plan) return fn.plan as unknown as Plan;
  const plan: Plan = { entries: [] };
  fn.plan = plan as any;
  const body = fn.decl?.body;
  if (!body) return plan;
  const decls: A.Declarator[] = [];
  const specs = new Map<A.Declarator, A.TSpec>();
  scanDecls(body, decls, specs);
  const savedScope = I.scope;
  I.scope = fn.scope;
  try {
    for (const d of decls) {
      const spec = specs.get(d)!;
      try {
        const te: A.TypeExpr = d.type;
        // auto and friends are placed lazily
        const t = resolveWithSpec(I, spec, te);
        if (!t || isAuto(t) || (t.k === 'arr' && t.n === null)) continue;
        if (t.k === 'void') continue;
        const sz = t.k === 'ref' ? 8 : sizeOf(t);
        plan.entries.push({ node: d, type: t, size: sz, align: t.k === 'ref' ? 8 : alignOf(t) });
      } catch (e: any) {
        if (e && (e.name === 'CompileError' || e instanceof Fault)) continue;
        throw e;
      }
    }
  } finally { I.scope = savedScope; }
  return plan;
}

function resolveWithSpec(I: Interp, spec: A.TSpec, te: A.TypeExpr): Type | null {
  // the declarator's type expression already embeds the base specifier
  void spec;
  return resolveTypeExpr(I, te, I.scope);
}

function scanDecls(s: A.Stmt | undefined, out: A.Declarator[], specs: Map<A.Declarator, A.TSpec>) {
  if (!s) return;
  switch (s.k) {
    case 'block': s.body.forEach((x) => scanDecls(x, out, specs)); break;
    case 'var':
      if (s.storage === 'static' || s.storage === 'extern') break;
      for (const d of s.decls) { out.push(d); specs.set(d, s.spec); }
      break;
    case 'if': scanDecls(s.init, out, specs); if (s.c && (s.c as any).k === 'var') scanDecls(s.c as A.Stmt, out, specs); scanDecls(s.then, out, specs); scanDecls(s.else, out, specs); break;
    case 'while': if ((s.c as any).k === 'var') scanDecls(s.c as A.Stmt, out, specs); scanDecls(s.body, out, specs); break;
    case 'do': scanDecls(s.body, out, specs); break;
    case 'for': scanDecls(s.init, out, specs); if (s.c && (s.c as any).k === 'var') scanDecls(s.c as A.Stmt, out, specs); scanDecls(s.body, out, specs); break;
    case 'rfor': scanDecls(s.init, out, specs); if (s.decl.k === 'var') scanDecls(s.decl, out, specs); scanDecls(s.body, out, specs); break;
    case 'switch': scanDecls(s.init, out, specs); scanDecls(s.body, out, specs); break;
    case 'label': scanDecls(s.stmt, out, specs); break;
    case 'try': scanDecls(s.body, out, specs); s.catches.forEach((c) => scanDecls(c.body, out, specs)); break;
    default: break;
  }
}

function enterFrame(I: Interp, fn: Fn, sig: Sig, self: Extract<V, { k: 'l' }> | undefined, bound: Bound[], plan: Plan, retAddr: number | undefined): Frame {
  const P = I.plat;
  const caller = I.frame;
  const win = P.id === 'windows';
  const nslots = bound.length + (self ? 1 : 0);
  let cfa: number;
  if (win) cfa = alignDown(caller.cursor - (32 + 8 * Math.max(0, nslots - 4)), 16);
  else cfa = alignDown(caller.cursor - 8 * Math.max(0, nslots - 6), 16);
  const frame = {
    id: I.newId(), fn, thisV: self ? { ...self } : null, cfa, low: cfa, cursor: cfa, upCursor: 0, upLimit: 0, slotMap: new Map(), retSlot: retAddr,
    line: 0, tmpMark: I.tmpStack.length, depth: I.frames.length, nrvo: null, nrvoAddr: 0, retType: sig.ret, varsIds: [], scope: I.global, catches: 0,
    rbp: 0, retValue: 0, minCursor: cfa, planned: 0, paramSlots: [] as number[],
  } as Frame;
  const retVal = caller.fn ? fnAddr(I, caller.fn) + 0x10 + (I.curLine & 0xf) : P.sys.mainReturn;
  frame.retValue = retVal;
  if (!win) {
    I.mem.wr64(cfa - 8, retVal, S.Meta);
    I.mem.wr64(cfa - 16, caller.rbp || 0, S.Meta);
    frame.rbp = cfa - 16;
    let cur = frame.rbp;
    for (const e of plan.entries) {
      cur = alignDown(cur - e.size, e.align);
      frame.slotMap.set(e.node, cur);
    }
    frame.planned = cur;
    // parameters are spilled below the locals
    let pc = cur;
    const psz: number[] = [];
    if (self) psz.push(8);
    bound.forEach((b) => psz.push(b.kind === 'obj' || b.kind === 'ref' ? 8 : paramSize(I, b)));
    frame.paramSlots = psz.map((s) => { pc = alignDown(pc - s, Math.min(8, Math.max(1, s))); return pc; });
    const sp = alignDown(pc, 16);
    frame.cursor = sp;
    frame.minCursor = sp;
    frame.low = sp;
    I.mem.setState(sp, cfa - 16 - sp, S.Uninit);
    if (frame.rbp - sp > 0) { /* locals region now uninitialised */ }
    // saved registers: ret address + rbp
    I.mem.setState(cfa - 8, 8, S.Meta);
    I.mem.setState(cfa - 16, 8, S.Meta);
  } else {
    I.mem.wr64(cfa - 8, retVal, S.Meta);
    I.mem.wr64(cfa - 16, caller.rbp || 0, S.Meta);
    I.mem.wr64(cfa - 24, 0, S.Meta);
    // locals ascend from rbp+4 with MSVC's /RTC guard padding
    let off = 4;
    let prevEnd = 0;
    let first = true;
    const rel: number[] = [];
    for (const e of plan.entries) {
      const a = Math.max(e.align, 4);
      off = first ? alignUp(4, a) : alignUp(prevEnd + 28, a);
      first = false;
      rel.push(off);
      prevEnd = off + e.size;
    }
    const extent = first ? 0 : prevEnd;
    const rsp = alignDown(cfa - 56 - extent, 16);
    const rbp = rsp + 32;
    frame.rbp = rbp;
    plan.entries.forEach((e, i) => frame.slotMap.set(e.node, rbp + rel[i]));
    const n = cfa - 24 - rsp;
    I.mem.fill(rsp, n, 0xcc, S.Uninit);
    frame.cursor = rsp;
    frame.minCursor = rsp;
    frame.low = rsp;
    frame.paramSlots = [];
    for (let i = 0; i < nslots; i++) frame.paramSlots.push(cfa + 8 * i);
    frame.planned = rsp;
  }
  return frame;
}

function paramSize(I: Interp, b: Bound): number {
  const t = b.t;
  if (t.k === 'ref' || t.k === 'cls') return 8;
  return Math.max(1, sizeOf(t.k === 'arr' ? ptrTo(t.of) : t));
}

function declareParams(I: Interp, fn: Fn, sig: Sig, self: Extract<V, { k: 'l' }> | undefined, bound: Bound[], frame: Frame, scope: Scope) {
  let slot = 0;
  const win = I.plat.id === 'windows';
  const slotAddr = () => frame.paramSlots[slot++];
  if (self) {
    const a = slotAddr();
    I.mem.writeRaw(a, encPtr(self.a), S.Init);
    const th = self.t;
    I.emitVar('this', ptrTo(th), a, 'param');
    scope.locals!.push({ name: 'this', type: ptrTo(th), addr: a, id: frame.varsIds[frame.varsIds.length - 1], dtor: false, constructed: true });
  }
  void win;
  const packName = fn.packInfo?.name;
  const packVals: V[] = [];
  bound.forEach((b, i) => {
    const a = slotAddr();
    const nm = sig.paramNames[i];
    const P = i < sig.params.length ? sig.params[i] : b.t;
    let varAddr = a;
    let type: Type = P;
    if (b.kind === 'ref') {
      I.mem.writeRaw(a, encPtr(b.addr), S.Init);
      type = P;
    } else if (b.kind === 'obj') {
      // class by value: the object lives in the caller's temporary area; this slot holds the hidden reference
      I.mem.writeRaw(a, encPtr(b.addr), S.Meta);
      varAddr = b.addr;
      type = P;
    } else if (b.kind === 'val' || b.kind === 'raw') {
      const t = b.kind === 'raw' ? ((b.v && (b.v.k === 'i' || b.v.k === 'f')) ? b.v.t : I.T.int) : P;
      I.mem.setState(a, Math.max(1, sizeOf(t)), S.Uninit);
      I.store(t, a, b.v!);
      type = t;
    }
    const isPack = fn.packInfo && i >= fn.packInfo.start && i < fn.packInfo.start + fn.packInfo.count;
    const label = nm ?? '';
    if (label && !isPack) {
      scope.names.set(label, [{ k: 'var', name: label, type, addr: varAddr }]);
    }
    if (isPack) {
      packVals.push(type.k === 'ref' ? I.load(type, varAddr) : { k: 'l', t: type, a: varAddr });
    }
    if (label || b.kind === 'raw') {
      I.emitVar(label || `arg${i + 1}`, type.k === 'ref' ? type : type, varAddr, 'param');
      scope.locals!.push({ name: label, type, addr: varAddr, id: frame.varsIds[frame.varsIds.length - 1], dtor: false, constructed: true });
    }
  });
  if (fn.packInfo && packName) {
    const bind = fn.bindings?.get(firstBindingPack(fn)) as any;
    scope.names.set(packName, [{ k: 'pack', items: bind && bind.k === 'pack' ? bind.items : [], vals: packVals }]);
  }
}

function firstBindingPack(fn: Fn): string {
  if (!fn.bindings) return '';
  for (const [k, v] of fn.bindings) if (v.k === 'pack' && fn.packInfo && fn.packInfo.count === v.items.length) return k;
  return '';
}

function encPtr(a: number): Uint8Array {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(a), true);
  return b;
}

function popFrame(I: Interp, frame: Frame, scope: Scope) {
  // destroy parameters' scope locals bookkeeping (objects themselves belong to the caller's temporaries)
  I.endScope(scope, false);
  const lo = Math.min(frame.minCursor, frame.cursor);
  const hi = frame.cfa;
  if (!I.fatalPending) {
    I.mem.setState(lo, hi - lo, S.Dead);
    I.mem.setState(hi - 8, 8, S.Dead);
  }
  I.emit({ t: 'pop', id: frame.id });
}

// =====================================================================================================================
// construction
// =====================================================================================================================
export function hasNontrivialDtor(I: Interp, t: Type): boolean {
  if (t.k === 'arr') return hasNontrivialDtor(I, t.of);
  if (t.k !== 'cls') return false;
  I.completeClass(t.c);
  return !!t.c.x.nontrivialDtor;
}

export function valueInit(I: Interp, t: Type, addr: number) {
  if (I.uneval) return;
  if (t.k === 'cls') { construct(I, t, addr, [], 'value'); return; }
  if (t.k === 'arr') { const es = sizeOf(t.of); for (let i = 0; i < (t.n ?? 0); i++) valueInit(I, t.of, addr + i * es); return; }
  if (t.k === 'float') { I.store(t, addr, I.mkFloat(t, 0)); return; }
  if (t.k === 'ptr' || t.k === 'nullptr') { I.store(t, addr, { k: 'i', t, v: 0n }); return; }
  I.store(t, addr, I.mkInt(t, 0n));
}

export type CtorMode = 'direct' | 'default' | 'value' | 'list';

/** construct an object of type `t` at `addr` from constructor arguments */
export function construct(I: Interp, t: Type, addr: number, args: V[], mode: CtorMode = 'direct', mostDerived = true): void {
  if (I.uneval) return;
  if (t.k === 'arr') {
    const es = sizeOf(t.of);
    const n = t.n ?? 0;
    if (args.length === 0) for (let i = 0; i < n; i++) construct(I, t.of, addr + i * es, [], mode);
    else for (let i = 0; i < n; i++) construct(I, t.of, addr + i * es, [args[Math.min(i, args.length - 1)]], mode);
    return;
  }
  if (t.k !== 'cls') {
    // scalar "constructor": initialise from a single value
    if (args.length === 0) {
      if (mode === 'value') valueInit(I, t, addr);
      return;
    }
    const cv = convertTo(I, args[0], stripCv(t));
    I.store(t, addr, cv);
    return;
  }
  const c = t.c;
  I.completeClass(c);
  if (!c.defined) I.cerr(`invalid use of incomplete type '${c.name}'`);
  if (c.x.abstract && mostDerived) {
    const pure = (c.x.pureList as string[]).join("', '");
    I.cerr(`cannot create an object of abstract class '${c.name}' (pure virtual function${(c.x.pureList as string[]).length > 1 ? 's' : ''} '${pure}' not overridden)`);
  }
  const ctors = c.x.ctors as Fn[];
  // aggregates are initialised member-wise
  if (c.x.aggregate && args.length > 0 && !ctors.some((f) => f.userProvided)) {
    const only = args.length === 1 && args[0].k === 'l' && args[0].t.k === 'cls' && args[0].t.c === c;
    if (!only && args.length >= 1) {
      aggregateFromValues(I, t, addr, args);
      markBuilt(I, addr);
      return;
    }
  }
  if (args.length === 0 && (mode === 'default' || mode === 'value')) {
    const def = ctors.find((f) => f.special === 'ctor0' || (!f.special && getSig(I, f).params.every((_, i) => getSig(I, f).defaults[i])));
    if (mode === 'value' && (!def || !def.userProvided)) zeroFill(I, t, addr);
    if (def && !def.isDeleted) {
      if (def.special === 'ctor0' && c.x.trivialDefault) { markBuilt(I, addr); return; }
      runCtor(I, def, addr, [], mostDerived);
      markBuilt(I, addr);
      return;
    }
    if (!def) I.cerr(`no default constructor for '${c.name}' (declare one, or give arguments)`);
  }
  const fn = pickOverload(I, ctors, c.x.ctorTemplates as FuncTemplate[], args, { name: c.name, self: undefined });
  if (fn.isDeleted) I.cerr(`use of deleted function '${fn.qual}'`);
  // trivially copyable copies are plain memcpy
  if ((fn.special === 'copy' || fn.special === 'move') && c.x.trivialCopy && args.length === 1) {
    const src = args[0];
    if (src.k === 'l' && src.t.k === 'cls') {
      const srcAddr = src.t.c === c ? src.a : upcastAddr(I, src.t.c, c, src.a);
      I.mem.copy(addr, srcAddr, sizeOf(t), false);
      markBuilt(I, addr);
      return;
    }
  }
  runCtor(I, fn, addr, args, mostDerived);
  markBuilt(I, addr);
}

function zeroFill(I: Interp, t: Type, addr: number) {
  const n = sizeOf(t);
  I.mem.setState(addr, n, S.Uninit);
  I.mem.write(addr, new Uint8Array(n), 'zero-initialisation');
  if (t.k === 'cls') {
    const L = I.layoutOf(t.c);
    for (const [off, len] of L.padding) I.mem.setState(addr + off, len, S.Pad);
  }
}

function runCtor(I: Interp, fn: Fn, addr: number, args: V[], mostDerived: boolean) {
  const c = fn.cls!;
  const self: V = { k: 'l', t: clsType(c), a: addr };
  const sig = ensureRet(I, fn);
  const bound = bindArguments(I, fn, sig, args);
  const prev = I.ctorMostDerived;
  I.ctorMostDerived = mostDerived;
  try {
    runFrame(I, fn, sig, self as Extract<V, { k: 'l' }>, bound, undefined, args);
  } finally { I.ctorMostDerived = prev; }
}

function aggregateFromValues(I: Interp, t: Extract<Type, { k: 'cls' }>, addr: number, args: V[]) {
  const c = t.c;
  zeroFillUnlessUsed(I, t, addr);
  const fields = c.fields.filter((f) => !f.isStatic);
  let i = 0;
  for (const b of c.bases) {
    if (i >= args.length) break;
    construct(I, clsType(b.cls), addr + (b.offset ?? 0), [args[i++]], 'direct', false);
  }
  for (const f of fields) {
    if (i < args.length) initFieldFromValue(I, f, addr, args[i++]);
    else initFieldDefault(I, f, addr, c, true);
  }
  if (i < args.length) I.cerr('too many initialisers for an aggregate');
}

function zeroFillUnlessUsed(I: Interp, t: Type, addr: number) { void t; void addr; void I; }

function initFieldFromValue(I: Interp, f: FieldInfo, objAddr: number, v: V) {
  const at = objAddr + (f.offset ?? 0);
  const ft = f.type;
  if (ft.k === 'ref') { const r = bindRef(I, v, ft) as Extract<V, { k: 'l' }>; I.store(ft, at, r); return; }
  if (ft.k === 'cls') { construct(I, ft, at, [v], 'direct'); return; }
  if (ft.k === 'arr') { if (v.k === 'l' && v.t.k === 'arr') I.mem.copy(at, v.a, sizeOf(ft)); return; }
  if (f.bits !== undefined && f.bits > 0) {
    const cv = convertTo(I, v, ft) as Extract<V, { k: 'i' }>;
    I.storeBits({ k: 'l', t: ft, a: at, bf: { bit: f.bitOffset ?? 0, width: f.bits, signed: ft.k === 'int' && ft.signed, unit: f.bitUnit ?? sizeOf(ft) } } as any, cv.v);
    return;
  }
  I.store(ft, at, convertTo(I, v, stripCv(ft)));
}

function initFieldDefault(I: Interp, f: FieldInfo, objAddr: number, c: ClassInfo, aggregate = false) {
  const at = objAddr + (f.offset ?? 0);
  const ft = f.type;
  if (f.init) {
    const init = f.init as { e: A.Expr; brace: boolean };
    const saved = I.scope;
    I.scope = c.x.scope;
    try {
      if (ft.k === 'ref') { const v = evalExpr(I, init.e); I.store(ft, at, bindRef(I, v, ft) as Extract<V, { k: 'l' }>); }
      else if (init.brace && init.e.k === 'init') initFromBraces(I, ft, at, init.e);
      else initFromExpr(I, ft, at, init.e);
    } finally { I.scope = saved; }
    return;
  }
  if (ft.k === 'ref') I.cerr(`reference member '${f.name}' of '${c.name}' must be initialised in the constructor's initialiser list`);
  if (ft.k === 'cls') { construct(I, ft, at, [], aggregate ? 'value' : 'default'); return; }
  if (ft.k === 'arr' && (ft.of as Type).k === 'cls') { construct(I, ft, at, [], aggregate ? 'value' : 'default'); return; }
  if (aggregate) valueInit(I, ft, at);
  else if (ft.const) {
    I.cerr(`uninitialised const member '${f.name}' of '${c.name}' (const members must be initialised)`);
  }
  // otherwise scalars stay uninitialised
}

export { initFieldFromValue, initFieldDefault };

// ---- initialisation from expressions ---------------------------------------------------------------------------------------------
/** copy-initialise an object of type t at addr from an expression (with copy elision for prvalues) */
export function initFromExpr(I: Interp, t: Type, addr: number, e: A.Expr) {
  if (e.k === 'init') { initFromBraces(I, t, addr, e); return; }
  if (t.k === 'ref') {
    const v = evalExpr(I, e);
    const r = bindRef(I, v, t, e) as Extract<V, { k: 'l' }>;
    if (r.tmp) extendTemp(I, r.a);
    I.store(t, addr, r);
    return;
  }
  if (t.k === 'cls') {
    const v = evalExprInto(I, e, addr);
    if (v.k === 'l' && v.t.k === 'cls' && v.a === addr && v.t.c === t.c) return; // constructed in place
    if (v.k === 'l' && v.t.k === 'cls' && v.t.c === t.c && v.tmp) {
      // the prvalue was materialised elsewhere: move/copy it
      construct(I, t, addr, [{ ...v, xv: true }]);
      return;
    }
    construct(I, t, addr, [v]);
    return;
  }
  if (t.k === 'arr') {
    const v = evalExpr(I, e);
    if (v.k === 'l' && v.t.k === 'arr') {
      // char s[] = "text"
      const n = Math.min(sizeOf(t), sizeOf(v.t));
      I.mem.copy(addr, v.a, n);
      if (sizeOf(t) > n) { I.mem.write(addr + n, new Uint8Array(sizeOf(t) - n), 'array padding'); }
      return;
    }
    I.cerr('array initialiser must be a braced list or a string literal');
  }
  const v = evalExpr(I, e);
  checkNarrowing(I, t, v, e, false);
  const cv = convertTo(I, v, stripCv(t), e);
  I.store(t, addr, cv);
}

function extendTemp(I: Interp, addr: number) {
  const t = adoptTemp(I, addr);
  if (t) {
    I.frame.scope.locals?.push({ name: '(temporary)', type: t.type, addr: t.addr, id: 0, dtor: true, constructed: true });
    I.extended = true;
  }
}

export function checkNarrowing(I: Interp, to: Type, v: V, e: A.Expr, brace: boolean) {
  if (!brace) return;
  const x = I.rv(v);
  const T0 = stripCv(to);
  if ((x.k === 'f' && (T0.k === 'int' || T0.k === 'bool' || T0.k === 'enum')) || (x.k === 'f' && T0.k === 'float' && T0.bytes < (x.t as any).bytes && !isConstFloat(e))) {
    I.cerr(`narrowing conversion of '${x.v}' from '${typeStr(x.t)}' to '${typeStr(to)}' inside { } is ill-formed`, e.pos);
  }
  if (x.k === 'i' && (x.t.k === 'int' || x.t.k === 'enum' || x.t.k === 'bool') && (T0.k === 'int' || T0.k === 'bool')) {
    const a = intInfo(x.t), b = intInfo(T0);
    const constant = isConstExpr(e);
    const fits = x.v >= (b.signed ? -(1n << BigInt(b.bytes * 8 - 1)) : 0n) && x.v < (b.signed ? 1n << BigInt(b.bytes * 8 - 1) : 1n << BigInt(b.bytes * 8));
    if (constant ? !fits : (a.bytes > b.bytes || (a.signed !== b.signed && a.bytes >= b.bytes && !(b.signed && !a.signed && b.bytes > a.bytes)))) {
      if (!(constant && fits)) I.cerr(`narrowing conversion of '${x.v}' from '${typeStr(x.t)}' to '${typeStr(to)}' inside { } is ill-formed`, e.pos);
    }
  }
  if (x.k === 'i' && x.t.k !== 'ptr' && T0.k === 'float') {
    if (!isConstExpr(e)) I.cerr(`narrowing conversion of '${x.v}' from '${typeStr(x.t)}' to '${typeStr(to)}' inside { } is ill-formed`, e.pos);
  }
}
const isConstExpr = (e: A.Expr): boolean => e.k === 'num' || e.k === 'chr' || e.k === 'bool' || (e.k === 'un' && (e.op === '-' || e.op === '+') && isConstExpr(e.e)) || e.k === 'sizeof-t' || e.k === 'sizeof-e' || (e.k === 'cast' && isConstExpr(e.e));
const isConstFloat = (e: A.Expr): boolean => e.k === 'fnum' || (e.k === 'un' && isConstFloat(e.e));

/** brace-initialisation of any type */
export function initFromBraces(I: Interp, t: Type, addr: number, e: Extract<A.Expr, { k: 'init' }>) {
  const items = e.items;
  if (I.uneval) return;
  if (t.k === 'ref') {
    if (items.length !== 1) I.cerr('a reference needs exactly one initialiser');
    initFromExpr(I, t, addr, items[0]);
    return;
  }
  if (t.k === 'arr') {
    const es = sizeOf(t.of);
    const n = t.n ?? items.length;
    if (t.n !== null && items.length > t.n) I.cerr(`too many initialisers for '${typeStr(t)}' (${items.length} given, ${t.n} fit)`, e.pos);
    // a string literal initialises a char array
    if (items.length === 1 && items[0].k === 'str' && (t.of.k === 'int')) { initFromExpr(I, t, addr, items[0]); return; }
    for (let i = 0; i < n; i++) {
      const at = addr + i * es;
      if (i < items.length) {
        if (t.of.k === 'arr' && items[i].k !== 'init') {
          // brace elision: fill the sub-array with the following items
          const sub = t.of;
          const per = flatCount(sub);
          const slice = items.slice(i * per, i * per + per);
          if (i * per >= items.length) { valueInit(I, t.of, at); continue; }
          initFromBraces(I, sub, at, { k: 'init', items: slice, pos: e.pos });
          continue;
        }
        initElement(I, t.of, at, items[i]);
      } else valueInit(I, t.of, at);
    }
    return;
  }
  if (t.k === 'cls') {
    const c = t.c;
    I.completeClass(c);
    const ctors = c.x.ctors as Fn[];
    const userCtor = ctors.some((f) => f.userProvided || (!f.special));
    if (c.x.aggregate && !userCtor) {
      // aggregate initialisation (with designated initialisers)
      initAggregate(I, t, addr, e);
      return;
    }
    // initializer_list constructors win when viable
    if (items.length > 0 || true) {
      const ilCtor = (ctors as Fn[]).find((f) => { const s = getSig(I, f); return s.params.length >= 1 && isInitListType(s.params[0]); });
      if (ilCtor && !(items.length === 0 && ctors.some((f) => f.special === 'ctor0' || getSig(I, f).params.length === 0))) {
        const il = makeInitializerList(I, getSig(I, ilCtor).params[0], items);
        const rest: V[] = [il];
        runCtor(I, ilCtor, addr, rest, true);
        markBuilt(I, addr);
        return;
      }
    }
    if (items.length === 0) { construct(I, t, addr, [], 'value'); return; }
    const args = items.some((x) => x.k === 'expand') ? items.flatMap((x) => (x.k === 'expand' ? I.expandPackV(x.e) : [evalExpr(I, x)])) : items.map((x) => evalExpr(I, x));
    checkCtorNarrowing(I, c, args, items);
    construct(I, t, addr, args, 'list');
    return;
  }
  // scalar
  if (items.length === 0) { valueInit(I, t, addr); return; }
  if (items.length > 1) I.cerr(`too many initialisers for '${typeStr(t)}'`, e.pos);
  const v = evalExpr(I, items[0]);
  checkNarrowing(I, t, v, items[0], true);
  I.store(t, addr, convertTo(I, v, stripCv(t), items[0]));
}

function checkCtorNarrowing(I: Interp, c: ClassInfo, args: V[], items: A.Expr[]) {
  void I; void c; void args; void items;
}

function flatCount(t: Type): number {
  if (t.k !== 'arr') return 1;
  return (t.n ?? 0) * flatCount(t.of);
}

function initElement(I: Interp, t: Type, addr: number, e: A.Expr) {
  if (e.k === 'init') { initFromBraces(I, t, addr, e); return; }
  if (t.k === 'cls' || t.k === 'arr') { initFromExpr(I, t, addr, e); return; }
  const v = evalExpr(I, e);
  checkNarrowing(I, t, v, e, true);
  I.store(t, addr, convertTo(I, v, stripCv(t), e));
}

function initAggregate(I: Interp, t: Extract<Type, { k: 'cls' }>, addr: number, e: Extract<A.Expr, { k: 'init' }>) {
  const c = t.c;
  const items = e.items;
  const fields = c.fields.filter((f) => !f.isStatic);
  if (c.tag === 'union') {
    I.mem.setState(addr, sizeOf(t), S.Uninit);
    if (items.length > 1) I.cerr('too many initialisers for a union');
    if (items.length === 1) initElementField(I, fields[0], addr, items[0]);
    return;
  }
  // zero the object first: members without initialisers are value-initialised
  const desig = e.designated;
  let i = 0;
  const used = new Set<FieldInfo>();
  for (const b of c.bases) {
    if (i < items.length && !desig) construct(I, clsType(b.cls), addr + (b.offset ?? 0), items[i].k === 'init' ? [] : [evalExpr(I, items[i])], 'list', false), i++;
    else construct(I, clsType(b.cls), addr + (b.offset ?? 0), [], 'value', false);
  }
  if (desig && desig.some((d) => d)) {
    items.forEach((it, k) => {
      const name = desig[k];
      const f = name ? fields.find((x) => x.name === name) : fields[k];
      if (!f) I.cerr(`'${c.name}' has no member named '${name}'`, e.pos);
      used.add(f);
      initElementField(I, f, addr, it);
    });
    for (const f of fields) if (!used.has(f)) initFieldDefault(I, f, addr, c, true);
    return;
  }
  for (const f of fields) {
    if (i < items.length) {
      const it = items[i++];
      initElementField(I, f, addr, it);
    } else initFieldDefault(I, f, addr, c, true);
  }
  if (i < items.length) I.cerr(`too many initialisers for '${c.name}' (it has ${fields.length} member${fields.length === 1 ? '' : 's'})`, e.pos);
}

function initElementField(I: Interp, f: FieldInfo, objAddr: number, e: A.Expr) {
  const at = objAddr + (f.offset ?? 0);
  const ft = f.type;
  if (f.bits !== undefined && f.bits > 0) {
    const v = evalExpr(I, e);
    checkNarrowing(I, ft, v, e, true);
    initFieldFromValue(I, f, objAddr, v);
    return;
  }
  if (e.k === 'init') { initFromBraces(I, ft, at, e); return; }
  if (ft.k === 'ref' || ft.k === 'cls' || ft.k === 'arr') { initFromExpr(I, ft, at, e); return; }
  const v = evalExpr(I, e);
  checkNarrowing(I, ft, v, e, true);
  I.store(ft, at, convertTo(I, v, stripCv(ft), e));
}

export function isInitListType(t: Type): boolean {
  const b = t.k === 'ref' ? t.to : t;
  return b.k === 'cls' && !!b.c.x.isInitList;
}

/** build a std::initializer_list<T> object from braced items (the backing array is a temporary) */
export function makeInitializerList(I: Interp, listT: Type, items: A.Expr[]): V {
  const lt = (listT.k === 'ref' ? listT.to : listT) as Extract<Type, { k: 'cls' }>;
  const targs = lt.c.x.tmplArgs as TArgVal[];
  const elem = targs[0].k === 'type' ? targs[0].t : I.T.int;
  const n = items.length;
  const es = sizeOf(elem);
  const arrT = arrOf(constOf(elem), n);
  const arrAddr = n > 0 ? newTempObj(I, arrT) : 0;
  for (let i = 0; i < n; i++) initElement(I, elem, arrAddr + i * es, items[i]);
  const obj = newTempObj(I, lt);
  I.initListObject(lt.c, obj, arrAddr, n, es);
  markBuilt(I, obj);
  return { k: 'l', t: lt, a: obj, tmp: true };
}

// =====================================================================================================================
// destruction
// =====================================================================================================================
export function destroyObj(I: Interp, t: Type, addr: number, dispatch: boolean) {
  if (I.uneval) return;
  if (t.k === 'arr') {
    const es = sizeOf(t.of);
    for (let i = (t.n ?? 0) - 1; i >= 0; i--) destroyObj(I, t.of, addr + i * es, false);
    return;
  }
  if (t.k !== 'cls') return;
  const c0 = t.c;
  I.completeClass(c0);
  let c = c0;
  let a = addr;
  if (dispatch && c0.x.dtor && (c0.x.dtor as Fn).isVirtual) {
    const dyn = dynamicObject(I, c0, addr);
    if (dyn) { c = dyn.cls; a = dyn.addr; }
  }
  if (!c.x.nontrivialDtor) return;
  const d = c.x.dtor as Fn;
  const self: Extract<V, { k: 'l' }> = { k: 'l', t: clsType(c), a };
  const sig = ensureRet(I, d);
  const prev = I.ctorMostDerived;
  I.ctorMostDerived = true;
  try { runFrame(I, d, sig, self, [], undefined, []); } finally { I.ctorMostDerived = prev; }
}

export function copyObject(I: Interp, t: Type, dst: number, src: number) {
  construct(I, t, dst, [{ k: 'l', t, a: src }]);
}

export { clsType, constOf, isFloat, isInt, throwStd, condValue, lvalueOf, storeLv, thisFor, unevaluated, prettyType, tryResolveType, targKey, typeKey, evalTArgs, stripRef, CxxThrow };
