// Template argument deduction and matching (class-template partial specialisations and function templates).
import type * as A from './ast';
import type { ClassTemplate, Scope, TArgVal, V } from './env';
import { newScope } from './env';
import type { Interp } from './interp';
import { constOf, isInt, sameType, stripCv, stripRef, type ClassInfo, type Type } from './types';
import { evalTArgs, lookupQName, resolveTypeExpr, tryResolveType, typeKey } from './typeres';

export type Bindings = Map<string, TArgVal>;

/** Does the type expression mention any of the template parameter names? */
export function mentionsParams(te: A.TypeExpr, params: Set<string>): boolean {
  switch (te.k) {
    case 'base': {
      const b = te.spec.base;
      if (b.k === 'name') return b.q.parts.some((p) => params.has(p.id) || (p.targs?.some((a) => (a.k === 'expr' ? exprMentions(a.e, params) : mentionsParams(a.t, params))) ?? false));
      if (b.k === 'decltype') return true;
      return false;
    }
    case 'ptr': case 'ref': return mentionsParams(te.to, params);
    case 'arr': return mentionsParams(te.of, params) || (te.n ? exprMentions(te.n, params) : false);
    case 'fn': return mentionsParams(te.ret, params) || te.params.some((p) => mentionsParams(p.type, params));
    case 'pack': return mentionsParams(te.of, params);
    default: return false;
  }
}

function exprMentions(e: A.Expr, params: Set<string>): boolean {
  switch (e.k) {
    case 'id': return e.q.parts.some((p) => params.has(p.id));
    case 'bin': return exprMentions(e.l, params) || exprMentions(e.r, params);
    case 'un': return exprMentions(e.e, params);
    case 'cond': return exprMentions(e.c, params) || exprMentions(e.a, params) || exprMentions(e.b, params);
    case 'call': return exprMentions(e.f, params) || e.args.some((a) => exprMentions(a, params));
    case 'cast': return exprMentions(e.e, params);
    case 'sizeof-t': return mentionsParams(e.t, params);
    default: return false;
  }
}

function sameTArg(a: TArgVal, b: TArgVal): boolean {
  if (a.k !== b.k) return false;
  if (a.k === 'type') return sameType(a.t, (b as any).t);
  if (a.k === 'val') return a.v === (b as any).v;
  if (a.k === 'pack') return a.items.length === (b as any).items.length && a.items.every((x, i) => sameTArg(x, (b as any).items[i]));
  return true;
}

function bind(b: Bindings, name: string, v: TArgVal): boolean {
  const old = b.get(name);
  if (!old) { b.set(name, v); return true; }
  return sameTArg(old, v);
}

/**
 * Match a template-parameter pattern (a type-id that mentions parameters) against an actual type.
 * `actual` already has references/top-level cv handled by the caller where C++ requires it.
 */
export function deduceType(I: Interp, pat: A.TypeExpr, actual: Type, params: Set<string>, b: Bindings, scope: Scope): boolean {
  switch (pat.k) {
    case 'base': {
      const spec = pat.spec;
      const base = spec.base;
      if (base.k === 'name') {
        const parts = base.q.parts;
        const last = parts[parts.length - 1];
        // plain parameter name  T
        if (parts.length === 1 && params.has(last.id) && !last.targs) {
          let t = actual;
          // `const T` pattern strips the const from the actual type
          if (spec.const && actual.const) t = stripCv(actual) as Type;
          return bind(b, last.id, { k: 'type', t });
        }
        // class template instance  C<args>
        if (last.targs && last.targs.length) {
          if (actual.k !== 'cls') return false;
          const ct = lookupQName(I, { ...base.q, parts: parts.map((p, i) => (i === parts.length - 1 ? { ...p, targs: undefined } : p)) }, scope, { noTargs: true });
          const ent = ct?.ents.find((e) => e.k === 'ctempl');
          if (!ent || ent.k !== 'ctempl') return false;
          const x = actual.c.x;
          // find the template instance in the class or its bases
          const inst = findTemplateInstance(actual.c, ent.t);
          if (!inst) return false;
          return deduceArgs(I, last.targs, inst.x.tmplArgs as TArgVal[], params, b, scope);
        }
      }
      // non-dependent: resolve and compare
      const t = tryResolveType(I, pat, scope);
      if (!t) return false;
      return sameType(t, actual, true) || (pat.spec.const ? sameType(stripCv(t), stripCv(actual)) : false);
    }
    case 'ptr': {
      if (actual.k !== 'ptr') return false;
      return deduceType(I, pat.to, actual.to, params, b, scope);
    }
    case 'ref': {
      if (actual.k !== 'ref' || !!actual.rv !== !!pat.rv) return false;
      return deduceType(I, pat.to, actual.to, params, b, scope);
    }
    case 'arr': {
      if (actual.k !== 'arr') return false;
      if (pat.n && pat.n.k === 'id' && pat.n.q.parts.length === 1 && params.has(pat.n.q.parts[0].id)) {
        if (actual.n === null) return false;
        if (!bind(b, pat.n.q.parts[0].id, { k: 'val', v: BigInt(actual.n), t: I.T.sizeT })) return false;
      }
      return deduceType(I, pat.of, actual.of, params, b, scope);
    }
    case 'fn': {
      if (actual.k !== 'fn') return false;
      if (!deduceType(I, pat.ret, actual.ret, params, b, scope)) return false;
      if (pat.params.length !== actual.params.length) return false;
      return pat.params.every((p, i) => deduceType(I, p.type, actual.params[i], params, b, scope));
    }
    default: return false;
  }
}

export function findTemplateInstance(c: ClassInfo, ct: unknown): ClassInfo | null {
  if (c.x.tmplOrigin === ct) return c;
  for (const bs of c.bases) { const r = findTemplateInstance(bs.cls, ct); if (r) return r; }
  return null;
}

/** match template-argument patterns (from a specialisation or a template-id in a parameter type) */
export function deduceArgs(I: Interp, pats: A.TArg[], actual: TArgVal[], params: Set<string>, b: Bindings, scope: Scope): boolean {
  let ai = 0;
  for (let pi = 0; pi < pats.length; pi++) {
    const p = pats[pi];
    if (p.k === 'pack') {
      // trailing pack `Args...` swallows the rest
      const rest = actual.slice(ai);
      const inner = p.t;
      if (inner.k === 'base' && inner.spec.base.k === 'name' && params.has(inner.spec.base.q.parts[0].id)) {
        if (!bind(b, inner.spec.base.q.parts[0].id, { k: 'pack', items: rest })) return false;
        ai = actual.length;
        continue;
      }
      return false;
    }
    const a = actual[ai++];
    if (!a) return false;
    if (p.k === 'type') {
      if (a.k !== 'type') {
        // a value passed where the pattern names a non-type parameter written as a type-id
        const te = p.t;
        if (te.k === 'base' && te.spec.base.k === 'name' && params.has(te.spec.base.q.parts[0].id) && a.k === 'val') { if (!bind(b, te.spec.base.q.parts[0].id, a)) return false; continue; }
        return false;
      }
      if (!deduceType(I, p.t, a.t, params, b, scope)) return false;
    } else {
      const e = p.e;
      if (e.k === 'id' && e.q.parts.length === 1 && params.has(e.q.parts[0].id)) {
        if (a.k !== 'val') return false;
        if (!bind(b, e.q.parts[0].id, a)) return false;
      } else {
        // constant pattern
        const ev = I.constEvalIn(e, scope, b);
        if (a.k !== 'val' || ev !== a.v) return false;
      }
    }
  }
  return ai === actual.length;
}

/** scope that makes template parameters visible as names */
export function bindingScope(I: Interp, parent: Scope, b: Bindings, name = ''): Scope {
  const s = newScope('tmpl', parent, name);
  for (const [k, v] of b) {
    switch (v.k) {
      case 'type': s.names.set(k, [{ k: 'type', type: v.t }]); break;
      case 'val': s.names.set(k, [{ k: 'tval', value: v.v, type: v.t }]); break;
      case 'pack': s.names.set(k, [{ k: 'pack', items: v.items }]); break;
      case 'tmpl': s.names.set(k, [{ k: 'ctempl', t: v.ent }]); break;
    }
  }
  return s;
}

/**
 * Deduce function template arguments from call arguments.
 * argTypes: for each argument the type and whether it is an lvalue.
 */
export function deduceFunction(
  I: Interp,
  decl: A.FuncDecl,
  defScope: Scope,
  explicit: TArgVal[],
  args: Array<{ t: Type; lv: boolean }>,
  extraBindings?: Bindings,
): Bindings | null {
  const tparams = decl.tparams ?? [];
  const params = new Set(tparams.map((p) => p.name));
  const b: Bindings = new Map(extraBindings ?? []);
  // explicit arguments fill leading parameters
  let ei = 0;
  for (const tp of tparams) {
    if (tp.pack) {
      const rest = explicit.slice(ei);
      if (rest.length) { b.set(tp.name, { k: 'pack', items: rest }); ei = explicit.length; }
      continue;
    }
    if (ei < explicit.length) { b.set(tp.name, explicit[ei++]); }
  }
  // deduce from call arguments
  let ai = 0;
  for (let pi = 0; pi < decl.params.length; pi++) {
    const p = decl.params[pi];
    const pt = p.type;
    if (p.pack || pt.k === 'pack') {
      const inner = pt.k === 'pack' ? pt.of : pt;
      // trailing pack of function parameters: deduce one type per remaining argument
      const rest = args.slice(ai);
      const items: TArgVal[] = [];
      let packName: string | null = null;
      const nm = baseNameOfPattern(inner);
      if (nm && params.has(nm)) packName = nm;
      for (const a of rest) {
        const tmp: Bindings = new Map();
        if (!deduceParam(I, inner, a, params, tmp, defScope)) return null;
        if (packName && tmp.has(packName)) items.push(tmp.get(packName)!);
      }
      if (packName) {
        const already = b.get(packName);
        if (already && already.k === 'pack') { if (already.items.length < items.length) { /* explicit prefix + deduced rest */ b.set(packName, { k: 'pack', items: [...already.items, ...items.slice(already.items.length)] }); } }
        else b.set(packName, { k: 'pack', items });
      }
      ai = args.length;
      break;
    }
    if (ai >= args.length) break; // default arguments cover the rest
    const a = args[ai++];
    if (!mentionsParams(pt, params)) continue;
    if (nonDeduced(pt)) continue; // e.g. typename remove_reference<T>::type& : T must come from elsewhere
    // already-explicit parameters make the pattern non-deduced
    if (!deduceParam(I, pt, a, params, b, defScope)) return null;
  }
  // defaults and completeness
  const full = fillDefaults(I, tparams, b, defScope);
  return full;
}

/** a nested-name-specifier that depends on a parameter (X<T>::type) is a non-deduced context */
function nonDeduced(te: A.TypeExpr): boolean {
  switch (te.k) {
    case 'base': {
      const b = te.spec.base;
      return b.k === 'name' && b.q.parts.length > 1 && b.q.parts.slice(0, -1).some((p) => !!p.targs);
    }
    case 'ref': case 'ptr': return nonDeduced(te.to);
    default: return false;
  }
}

function baseNameOfPattern(te: A.TypeExpr): string | null {
  switch (te.k) {
    case 'base': return te.spec.base.k === 'name' && te.spec.base.q.parts.length === 1 ? te.spec.base.q.parts[0].id : null;
    case 'ref': case 'ptr': return baseNameOfPattern(te.to);
    default: return null;
  }
}

/** deduce one function parameter, applying the forwarding-reference and by-value decay rules */
function deduceParam(I: Interp, pt: A.TypeExpr, a: { t: Type; lv: boolean }, params: Set<string>, b: Bindings, scope: Scope): boolean {
  if (pt.k === 'ref') {
    const inner = pt.to;
    const bare = inner.k === 'base' && inner.spec.base.k === 'name' && inner.spec.base.q.parts.length === 1 && params.has(inner.spec.base.q.parts[0].id) && !inner.spec.const;
    if (pt.rv && bare) {
      // forwarding reference: T&& binds T = X& for lvalues
      const nm = (inner as any).spec.base.q.parts[0].id as string;
      const bound: Type = a.lv ? ({ k: 'ref', to: a.t, rv: false } as Type) : stripCv(a.t);
      return bind(b, nm, { k: 'type', t: a.lv ? (a.t.k === 'ref' ? a.t : bound) : bound });
    }
    return deduceType(I, inner, a.t, params, b, scope);
  }
  // by value: array and function decay, top-level cv ignored
  let t = a.t;
  if (t.k === 'ref') t = t.to;
  if (t.k === 'arr') t = { k: 'ptr', to: t.of };
  else if (t.k === 'fn') t = { k: 'ptr', to: t };
  else t = stripCv(t);
  if (pt.k === 'base' && pt.spec.const) t = stripCv(t);
  return deduceType(I, pt, t, params, b, scope);
}

/** apply default template arguments and verify that every parameter is bound */
export function fillDefaults(I: Interp, tparams: A.TemplateParam[], b: Bindings, scope: Scope): Bindings | null {
  for (const tp of tparams) {
    if (b.has(tp.name)) continue;
    if (tp.pack) { b.set(tp.name, { k: 'pack', items: [] }); continue; }
    if (tp.def) {
      const s = bindingScope(I, scope, b);
      if (tp.kind === 'type') {
        const t = resolveTypeExpr(I, tp.def as A.TypeExpr, s);
        b.set(tp.name, { k: 'type', t });
      } else if (tp.kind === 'nontype') {
        const r = I.constEvalValue(tp.def as A.Expr, s);
        b.set(tp.name, { k: 'val', v: r.v, t: r.t });
      }
      continue;
    }
    return null;
  }
  return b;
}

export function bindingsKey(tparams: A.TemplateParam[], b: Bindings): string {
  const parts: string[] = [];
  for (const tp of tparams) {
    const v = b.get(tp.name);
    parts.push(tp.name + '=' + (v ? tkey(v) : '?'));
  }
  return parts.join(';');
}

function tkey(a: TArgVal): string {
  switch (a.k) {
    case 'type': return typeKey(a.t);
    case 'val': return 'v' + a.v.toString();
    case 'pack': return '[' + a.items.map(tkey).join(',') + ']';
    default: return 'tmpl';
  }
}

export { evalTArgs, isInt, constOf, stripRef };


/** Class template argument deduction: `vector v{1,2,3}`, `pair p(1, 2.5)`, `Box b = Box(3)` */
export function deduceCtad(I: Interp, ct: ClassTemplate, args: V[]): Type {
  const primary = ct.decl;
  const ctps = primary.tparams ?? [];
  const argInfo = args.map((a) => {
    if (a.k === 'init') {
      const first = a.items[0];
      const et = first && (first.k === 'i' || first.k === 'f' || first.k === 'l') ? stripCv((first as any).t as Type) : I.T.int;
      return { t: I.initListType(et), lv: false };
    }
    if (a.k === 'l') return { t: a.t, lv: !a.xv };
    if (a.k === 'i' || a.k === 'f') return { t: a.t, lv: false };
    return { t: I.T.int, lv: false };
  });
  // copy deduction candidate: C(C<T>) -> C<T>
  if (args.length === 1 && argInfo[0].t.k === 'cls') {
    const inst = findTemplateInstance(argInfo[0].t.c, ct);
    if (inst) return { k: 'cls', c: inst };
  }
  const tryDecl = (params: A.Param[], extra: A.TemplateParam[], variadic: boolean): Type | null => {
    const synth = { ...(primary as any), k: 'func', qname: { parts: [{ id: ct.name }], pos: primary.pos }, name: ct.name, params, tparams: [...ctps, ...extra], variadic, ret: null, body: null } as unknown as A.FuncDecl;
    const hasPack = params.some((p) => p.pack || p.type.k === 'pack');
    const required = params.filter((p) => !p.def && !p.pack && p.type.k !== 'pack').length;
    if (!hasPack && (args.length > params.length || args.length < required)) return null;
    const b = deduceFunction(I, synth, ct.scope, [], argInfo);
    if (!b) return null;
    const targs: TArgVal[] = ctps.map((tp) => b.get(tp.name) ?? { k: 'pack', items: [] });
    const t = I.instantiateClassTemplate(ct, targs);
    return t;
  };
  // 1. constructors (initializer_list constructors first for braced-init)
  const ctors = primary.members.filter((m): m is Extract<A.Member, { k: 'method' }> => m.k === 'method' && m.f.isCtor).map((m) => m.f);
  const isIL = (f: A.FuncDecl) => f.params.length >= 1 && /initializer_list/.test(JSON.stringify(f.params[0].type, (k, v) => (k === 'pos' ? undefined : v)));
  const hasInitArg = args.some((a) => a.k === 'init');
  const ordered = hasInitArg ? [...ctors.filter(isIL), ...ctors.filter((f) => !isIL(f))] : ctors.filter((f) => !isIL(f));
  for (const f of ordered) {
    const r = tryDecl(f.params, f.tparams ?? [], f.variadic);
    if (r) return r;
  }
  // 2. aggregate deduction from member types
  const fields = primary.members.filter((m): m is Extract<A.Member, { k: 'field' }> => m.k === 'field' && !m.static);
  if (fields.length && ctors.length === 0) {
    const flat: A.Param[] = [];
    for (const m of fields) for (const d of m.decl.decls) flat.push({ type: d.type, name: d.name, pos: d.pos });
    const r = tryDecl(flat, [], false);
    if (r) return r;
  }
  // 3. default constructible with all-default template parameters
  if (args.length === 0) {
    const r = tryDecl([], [], false);
    if (r) return r;
  }
  I.cerr(`class template argument deduction failed for '${ct.name}': no deduction guide or constructor matches these arguments`);
}
