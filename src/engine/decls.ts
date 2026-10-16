// Declarations: namespaces, types, functions, variables, classes (layout inputs, members, vtables), templates, lambdas.
import type * as A from './ast';
import { S } from './trace';
import type { Interp } from './interp';
import type { ClassTemplate, Ent, Fn, FuncTemplate, LambdaInfo, Scope, TArgVal, V } from './env';
import { newScope } from './env';
import {
  arrOf, clsType, constOf, newClass, ptrTo, refTo, sameType, stripCv, typeStr, withCv, type ClassInfo, type EnumInfo, type FieldInfo, type Type,
} from './types';
import { alignOf, hasVirtualBases, isDynamic, sizeOf } from './layout';
import {
  evalTArgs, isAuto, isBaseOf, lookupQName, lookupUnqualified, resolveTypeExpr, resolveSpec, targKey, typeKey, AUTO,
} from './typeres';
import { bindingScope, bindingsKey, deduceArgs, fillDefaults, mentionsParams, type Bindings } from './templ';
import { evalArgs, evalConstInt, evalExpr, typeOfExpr, unevaluated } from './expr';
import {
  bindRef, convertTo, construct, finalOverrider, getSig, initFromBraces, initFromExpr, prepareStorage, sameSignature, valueInit, markBuilt, hasNontrivialDtor, rootDecl,
} from './call';

// =====================================================================================================================
// naming helpers
// =====================================================================================================================
export function scopePrefix(s: Scope | null): string {
  const parts: string[] = [];
  for (let x: Scope | null = s; x; x = x.parent) {
    if (x.kind === 'ns' && x.name) parts.unshift(x.name);
    else if (x.kind === 'class' && x.cls) { parts.unshift(x.cls.name); break; }
    else if (x.kind === 'func') break;
  }
  return parts.length ? parts.join('::') + '::' : '';
}

export function addEnt(scope: Scope, name: string, ent: Ent) {
  const list = scope.names.get(name);
  if (list) list.push(ent); else scope.names.set(name, [ent]);
}

function fnsEntOf(scope: Scope, name: string): Extract<Ent, { k: 'fns' }> {
  let list = scope.names.get(name);
  if (!list) { list = []; scope.names.set(name, list); }
  let e = list.find((x) => x.k === 'fns') as Extract<Ent, { k: 'fns' }> | undefined;
  if (!e) { e = { k: 'fns', name, fns: [], ftempls: [] }; list.push(e); }
  return e;
}

// =====================================================================================================================
// functions
// =====================================================================================================================
export function makeFn(
  I: Interp, decl: A.FuncDecl, scope: Scope, cls: ClassInfo | null,
  o: { bindings?: Map<string, TArgVal>; tmpl?: FuncTemplate; access?: A.Access } = {},
): Fn {
  const name = decl.name;
  const prefix = cls ? cls.name + '::' : scopePrefix(scope);
  const fn: Fn = {
    id: I.newId(), name, qual: prefix + name, decl, cls, scope, bindings: o.bindings ?? null, tmpl: o.tmpl,
    isStatic: !!cls && decl.storage === 'static', isVirtual: decl.virtual, isCtor: decl.isCtor, isDtor: decl.isDtor, isConv: decl.isConv,
    isConst: decl.constMethod, isExplicit: decl.explicit, isDeleted: decl.deleted, isDefaulted: decl.defaulted, isPure: decl.pure,
    userProvided: !decl.defaulted && !decl.deleted, access: o.access ?? decl.access ?? 'public', addr: 0,
  };
  I.allFns.push(fn);
  const nat = !decl.body && !decl.pure && !decl.deleted && !decl.defaulted ? I.nativeTable.get(fn.qual) : undefined;
  if (nat) fn.native = nat;
  return fn;
}

export function declareFunction(I: Interp, d: A.FuncDecl, scope: Scope) {
  const q = d.qname;
  if (q.parts.length > 1) { defineOutOfClass(I, d, scope); return; }
  const name = d.name;
  if (d.tparams) {
    // explicit specialisation  template<> void f<int>(int)
    if (d.tparams.length === 0 && q.parts[0].targs) {
      const ent = fnsEntOf(scope, name);
      const tmpl = ent.ftempls[0];
      if (!tmpl) I.cerr(`explicit specialisation of '${name}' without a primary template`, d.pos);
      const args = evalTArgs(I, q.parts[0].targs, scope);
      const b: Bindings = new Map();
      (tmpl.decl.tparams ?? []).forEach((tp, i) => { if (args[i]) b.set(tp.name, args[i]); });
      const key = bindingsKey(tmpl.decl.tparams ?? [], b);
      const f = makeFn(I, d, bindingScope(I, scope, b, name), null, { bindings: b });
      tmpl.specs.set(key, f);
      return;
    }
    const ent = fnsEntOf(scope, name);
    const existing = ent.ftempls.find((t) => sameTemplateDecl(t.decl, d));
    if (existing) { if (d.body) existing.decl = d; return; }
    ent.ftempls.push({ kind: 'func', decl: d, scope, cls: null, name, instances: new Map(), specs: new Map() });
    return;
  }
  const f = makeFn(I, d, scope, null);
  const ent = fnsEntOf(scope, name);
  registerFn(I, ent, f);
}

function sameTemplateDecl(a: A.FuncDecl, b: A.FuncDecl): boolean {
  if (a.params.length !== b.params.length) return false;
  // template signatures include the return type and the template parameter list (that is what makes enable_if overloads distinct)
  const sig = (f: A.FuncDecl) => JSON.stringify([f.params.map((p) => p.type), f.ret, f.tparams, f.constMethod], replacer);
  return sig(a) === sig(b);
}
const replacer = (k: string, v: unknown) => (k === 'pos' ? undefined : typeof v === 'bigint' ? v.toString() : v);

/** add `f` to an overload set, merging a definition into a previous declaration of the same function */
function registerFn(I: Interp, ent: Extract<Ent, { k: 'fns' }>, f: Fn) {
  let sigF: ReturnType<typeof getSig> | null = null;
  try { sigF = getSig(I, f); } catch (e) { throw e; }
  for (const old of ent.fns) {
    let so: ReturnType<typeof getSig>;
    try { so = getSig(I, old); } catch { continue; }
    if (old.isConst !== f.isConst) continue;
    if (so.params.length !== sigF.params.length) continue;
    if (!so.params.every((p, i) => sameType(stripCv(p), stripCv(sigF!.params[i]), true))) continue;
    // same function: a redeclaration or the definition
    if (f.decl?.body && old.decl?.body) I.cerr(`redefinition of '${f.qual}'`, f.decl.pos);
    if (f.decl?.body) {
      old.decl = f.decl;
      old.userProvided = true;
      old.native = undefined;
      old.sig = undefined;
      if (f.decl.defaulted) old.isDefaulted = true;
    }
    if (f.decl?.defaulted) old.isDefaulted = true;
    if (f.decl?.deleted) old.isDeleted = true;
    return;
  }
  ent.fns.push(f);
}

/** `int A::f(...) {...}`  /  `void ns::g() {...}`  /  `template<class T> void Stack<T>::push(...)` */
function defineOutOfClass(I: Interp, d: A.FuncDecl, scope: Scope) {
  const q = d.qname;
  const qualifier: A.QName = { ...q, parts: q.parts.slice(0, -1) };
  const lastQual = qualifier.parts[qualifier.parts.length - 1];
  // member of a class template: the qualifier names the template with its own parameters as arguments
  if (d.tparams && lastQual.targs) {
    const base: A.QName = { ...qualifier, parts: qualifier.parts.map((p, i) => (i === qualifier.parts.length - 1 ? { ...p, targs: undefined } : p)) };
    const r = lookupQName(I, base, scope, { noTargs: true });
    const ct = r?.ents.find((e) => e.k === 'ctempl');
    if (ct && ct.k === 'ctempl') {
      (ct.t.outOfClass ??= []).push({ decl: d, qualArgs: lastQual.targs });
      return;
    }
  }
  const r = lookupQName(I, qualifier, scope);
  if (!r) I.cerr(`'${qualifier.parts.map((p) => p.id).join('::')}' is not a class or namespace`, d.pos);
  const owner = r.ents.find((e) => e.k === 'type' || e.k === 'ns');
  if (!owner) I.cerr(`'${qualifier.parts.map((p) => p.id).join('::')}' is not a class or namespace`, d.pos);
  if (owner.k === 'ns') {
    const nd = { ...d, qname: { ...q, parts: [q.parts[q.parts.length - 1]] } } as A.FuncDecl;
    declareFunction(I, nd, owner.scope);
    return;
  }
  if (owner.k !== 'type' || owner.type.k !== 'cls') I.cerr('invalid qualified function definition', d.pos);
  attachMemberDefinition(I, owner.type.c, d, scope);
}

/** give a member function declared in the class its out-of-class definition */
export function attachMemberDefinition(I: Interp, c: ClassInfo, d: A.FuncDecl, scope: Scope, bindings?: Map<string, TArgVal>) {
  I.completeClass(c);
  const name = d.name;
  const cs: Scope = c.x.scope;
  const ent = cs.names.get(name)?.find((e) => e.k === 'fns') as Extract<Ent, { k: 'fns' }> | undefined;
  if (!ent) I.cerr(`no declaration of '${name}' in class '${c.name}' matches this definition`, d.pos);
  // out-of-class defs are parsed with the written return type; compare parameters
  const tmp = makeFn(I, d, cs, c, { bindings, access: 'public' });
  if (bindings) tmp.scope = bindingScope(I, cs, bindings);
  let matched = false;
  const ts = getSig(I, tmp);
  for (const f of ent.fns) {
    if (f.isConst !== d.constMethod) continue;
    const fs = getSig(I, f);
    if (fs.params.length !== ts.params.length) continue;
    if (!fs.params.every((p, i) => sameType(stripCv(p), stripCv(ts.params[i]), true))) continue;
    if (f.decl?.body) I.cerr(`redefinition of '${f.qual}'`, d.pos);
    // keep the in-class declaration's identity (virtual, access ...) and take the body
    const decl: A.FuncDecl = { ...f.decl!, body: d.body, ctorInit: d.ctorInit, params: d.params.map((p, i) => ({ ...p, def: p.def ?? f.decl!.params[i]?.def })), defaulted: d.defaulted || f.decl!.defaulted };
    f.decl = decl;
    f.userProvided = !decl.defaulted;
    f.native = undefined;
    f.sig = undefined;
    f.defaultScope = f.scope;
    matched = true;
    break;
  }
  if (!matched) I.cerr(`no declaration matches '${c.name}::${name}(${ts.params.map((p) => typeStr(p)).join(', ')})' in class '${c.name}'`, d.pos);
}

// =====================================================================================================================
// types
// =====================================================================================================================
export function declareTypedef(I: Interp, d: A.TypedefDecl, scope: Scope) {
  if (d.tparams) {
    const ct: ClassTemplate = { kind: 'class', name: d.name, decl: null as any, scope, specs: [], instances: new Map(), aliasOf: d, defined: true };
    addEnt(scope, d.name, { k: 'ctempl', t: ct });
    return;
  }
  const t = resolveTypeExpr(I, d.type, scope);
  addEnt(scope, d.name, { k: 'type', type: t });
}

export function declareEnum(I: Interp, d: A.EnumDecl, scope: Scope): Type {
  const T = I.T;
  // forward declaration of an already defined enum
  if (d.name) {
    const old = scope.names.get(d.name)?.find((e) => e.k === 'type' && e.type.k === 'enum');
    if (old && old.k === 'type' && d.items.length === 0) return old.type;
  }
  const under = d.under ? resolveTypeExpr(I, d.under, scope) : T.int;
  const info: EnumInfo = { name: scopePrefix(scope) + (d.name || '<anonymous enum>'), scoped: d.scoped, underlying: under, values: new Map(), order: [] };
  const type: Type = { k: 'enum', e: info };
  if (d.name) addEnt(scope, d.name, { k: 'type', type });
  // enumerators see earlier ones
  const inner = newScope('block', scope);
  let next = 0n;
  let maxV = 0n, minV = 0n;
  for (const it of d.items) {
    if (it.value) {
      const r = evalConstInt(I, it.value, inner);
      next = r.v;
    }
    info.values.set(it.name, next);
    info.order.push(it.name);
    const ent: Ent = { k: 'enumc', type, value: next };
    inner.names.set(it.name, [ent]);
    if (!d.scoped) addEnt(scope, it.name, ent);
    if (next > maxV) maxV = next;
    if (next < minV) minV = next;
    next += 1n;
  }
  if (!d.under && (maxV > 0x7fffffffn || minV < -0x80000000n)) info.underlying = maxV > 0xffffffffn || minV < -0x80000000n ? T.long : T.uint;
  return type;
}

// =====================================================================================================================
// variables
// =====================================================================================================================
export function deduceAuto(I: Interp, declared: Type, init: V): Type {
  // declared contains the `auto` marker somewhere: auto, auto&, const auto&, auto&&, auto*
  const strip = (t: Type): Type => {
    t = stripCv(t);
    if (t.k === 'arr') return ptrTo(t.of);
    if (t.k === 'fn') return ptrTo(t);
    return t;
  };
  const vt: Type | null = init.k === 'l' || init.k === 'i' || init.k === 'f' ? init.t : null;
  if (!vt) {
    if (init.k === 'fn') return replaceAuto(declared, init.cands.length ? ptrTo({ k: 'fn', ret: I.T.void, params: [] } as Type) : I.T.int);
    I.cerr('cannot deduce the type of this initialiser');
  }
  const isLv = init.k === 'l' && !init.tmp && !init.xv;
  const rec = (d: Type): Type => {
    if ((d as any).auto) {
      // plain auto: decay by value
      return strip(vt);
    }
    if (d.k === 'ref') {
      const inner = d.to;
      if ((inner as any).auto) {
        if (d.rv && !inner.const) {
          // forwarding reference
          return isLv ? refTo(vt.k === 'arr' ? vt : vt) : refTo(stripCv(vt), true);
        }
        // auto& / const auto&
        const base = vt.k === 'ref' ? vt.to : vt;
        const t2 = inner.const ? constOf(stripCv(base)) : base;
        return refTo(t2, d.rv);
      }
      return refTo(rec(inner), d.rv);
    }
    if (d.k === 'ptr') {
      if ((d.to as any).auto || isAuto(d.to)) {
        const s = strip(vt);
        if (s.k !== 'ptr') I.cerr(`unable to deduce 'auto*' from a non-pointer value of type '${typeStr(vt)}'`);
        const to = d.to.const ? constOf(s.to) : s.to;
        const p = ptrTo(to);
        return d.const ? constOf(p) : p;
      }
    }
    return d;
  };
  let r = rec(declared);
  if (declared.const && !(declared as any).auto) r = constOf(r);
  else if (declared.const && (declared as any).auto) r = constOf(r);
  return r;
}

function replaceAuto(d: Type, t: Type): Type {
  if ((d as any).auto) return t;
  if (d.k === 'ref') return refTo(replaceAuto(d.to, t), d.rv);
  if (d.k === 'ptr') return ptrTo(replaceAuto(d.to, t));
  return d;
}

/** `int a[] = {1,2,3}` / `char s[] = "abc"`: take the bound from the initialiser */
export function completeArrayType(I: Interp, t: Type, dd: A.Declarator): Type {
  if (t.k !== 'arr' || t.n !== null) return t;
  const init = dd.init ?? dd.braceInit;
  if (!init) I.cerr(`array '${dd.name}' has unknown size and no initialiser`, dd.pos);
  if (init.k === 'init') {
    let n = init.items.length;
    if (t.of.k === 'arr') {
      const per = (t.of.n ?? 1);
      n = Math.ceil(init.items.length / (init.items.every((x) => x.k === 'init') ? 1 : per));
    }
    return arrOf(t.of, n);
  }
  if (init.k === 'str') {
    const bytes = init.pre === 'L' || init.pre === 'u' || init.pre === 'U' ? Array.from(init.s).length : new TextEncoder().encode(init.s).length;
    return arrOf(t.of, bytes + 1);
  }
  I.cerr(`cannot determine the size of array '${dd.name}'`, dd.pos);
}

/** initialise the object declared by `dd` at `addr` */
export function initDeclared(I: Interp, t: Type, addr: number, dd: A.Declarator) {
  if (dd.braceInit) {
    if (dd.braceInit.k === 'init') initFromBraces(I, t, addr, dd.braceInit);
    else initFromExpr(I, t, addr, dd.braceInit);
    return;
  }
  if (dd.ctorArgs) {
    if (t.k === 'cls') construct(I, t, addr, evalArgs(I, dd.ctorArgs), 'direct');
    else if (dd.ctorArgs.some((a) => a.k === 'expand')) {
      // T x(args...) with a pack: expand first, then initialise from the single resulting value
      const vals = evalArgs(I, dd.ctorArgs);
      if (vals.length === 0) valueInit(I, t, addr);
      else if (t.k === 'ref') I.store(t, addr, bindRef(I, vals[0], t) as Extract<V, { k: 'l' }>);
      else I.store(t, addr, convertTo(I, vals[0], t));
    }
    else if (t.k === 'ref') initFromExpr(I, t, addr, dd.ctorArgs[0]);
    else if (dd.ctorArgs.length === 0) valueInit(I, t, addr);
    else initFromExpr(I, t, addr, dd.ctorArgs[0]);
    return;
  }
  if (dd.init) { initFromExpr(I, t, addr, dd.init); return; }
  // default-initialisation
  if (t.k === 'cls') construct(I, t, addr, [], 'default');
  else if (t.k === 'arr' && baseElem(t).k === 'cls') construct(I, t, addr, [], 'default');
  else if (t.k === 'ref') I.cerr(`reference variable '${dd.name}' must be initialised`, dd.pos);
  else if (t.const) I.cerr(`uninitialised const '${dd.name}' (a const object must be given a value)`, dd.pos);
}

const baseElem = (t: Type): Type => (t.k === 'arr' ? baseElem(t.of) : t);

/** resolve a declarator's type: handles `auto` and arrays of unknown size */
export function declaredType(I: Interp, dd: A.Declarator, scope: Scope): Type {
  let t = resolveTypeExpr(I, dd.type, scope);
  if (isAuto(t)) {
    const init = dd.init ?? dd.braceInit ?? (dd.ctorArgs && dd.ctorArgs.length === 1 ? dd.ctorArgs[0] : undefined);
    if (!init) I.cerr(`declaration of '${dd.name}' with type 'auto' needs an initialiser`, dd.pos);
    let v: V;
    if (init.k === 'init') {
      // auto x = {1,2,3}  -> std::initializer_list<int>
      const first = init.items[0] ? typeOfExpr(I, init.items[0], scope) : null;
      const et = first && (first.k === 'i' || first.k === 'f' || first.k === 'l') ? stripCv(first.t) : I.T.int;
      const il = I.initListType(et);
      return il;
    }
    v = typeOfExpr(I, init, scope);
    t = deduceAuto(I, t, v);
  }
  if ((t as any).ctad) {
    const init = dd.init ?? dd.braceInit;
    const args: V[] = [];
    if (dd.ctorArgs) { const saved = I.scope; I.scope = scope; try { args.push(...evalArgs(I, dd.ctorArgs)); } finally { I.scope = saved; } }
    else if (init) {
      const saved = I.scope; I.scope = scope;
      try {
        if (init.k === 'init') args.push(...init.items.map((x) => unevaluated(I, () => evalExpr(I, x))));
        else args.push(unevaluated(I, () => evalExpr(I, init)));
      } finally { I.scope = saved; }
    }
    t = I.deduceCtad((t as any).ctad, args);
  }
  t = completeArrayType(I, t, dd);
  return t;
}

export function instantiateVarTemplate(I: Interp, ent: Extract<Ent, { k: 'vtempl' }>, args: TArgVal[]): Extract<Ent, { k: 'var' }> {
  const tps = ent.decl.tparams ?? [];
  const b = bindArgs(I, tps, args, ent.dd.name);
  const key = bindingsKey(tps, b);
  const hit = ent.inst.get(key);
  if (hit && hit.k === 'var') return hit;
  const bscope = bindingScope(I, ent.scope, b, ent.dd.name);
  const plain: A.VarDecl = { ...ent.decl, tparams: null, decls: [ent.dd] };
  const placeholder: Ent = { k: 'var', name: ent.dd.name, type: I.T.int, addr: 0 };
  ent.inst.set(key, placeholder);
  declareGlobalVar(I, plain, bscope);
  const made = bscope.names.get(ent.dd.name)?.find((x) => x.k === 'var') as Extract<Ent, { k: 'var' }>;
  ent.inst.set(key, made);
  return made;
}

export function declareGlobalVar(I: Interp, d: A.VarDecl, scope: Scope) {
  if (d.tparams && d.tparams.length) {
    for (const dd of d.decls) addEnt(scope, dd.name, { k: 'vtempl', decl: d, dd, scope, inst: new Map() });
    return;
  }
  for (const dd of d.decls) {
    if (dd.type.k === 'fn') continue; // function declaration written as a variable
    const qn = dd.qname;
    // static data member definition  int A::count = 5;
    if (qn && qn.parts.length > 1) { defineStaticMember(I, d, dd, scope); continue; }
    const t = declaredType(I, dd, scope);
    if (d.storage === 'extern' && !dd.init && !dd.braceInit) {
      // declaration only: the definition elsewhere provides the storage; allocate when first defined
      if (scope.names.get(dd.name)?.some((e) => e.k === 'var')) continue;
    }
    const existing = scope.names.get(dd.name)?.find((e) => e.k === 'var') as Extract<Ent, { k: 'var' }> | undefined;
    if (existing && (dd.init || dd.braceInit || dd.ctorArgs)) {
      // extern int x;  followed by  int x = 5;
      runGlobalInit(I, existing.type, existing.addr, dd, scope);
      continue;
    }
    if (existing) continue;
    const size = Math.max(1, sizeOf(t.k === 'ref' ? ptrTo(t.to) : t));
    const hasInit = !!(dd.init || dd.braceInit || dd.ctorArgs);
    const seg = t.const && hasInit && isConstantInit(dd) ? 'rodata' : hasInit && !isZeroInit(dd) ? 'data' : 'bss';
    const addr = I.allocStatic(seg === 'rodata' ? 'data' : seg, size, Math.max(1, t.k === 'ref' ? 8 : alignOf(t)));
    I.mem.loadImage(addr, new Uint8Array(size), S.Init); // static storage starts zeroed
    markPaddingStatic(I, t, addr);
    const ent: Ent = { k: 'var', name: dd.name, type: t, addr, isStatic: true };
    addEnt(scope, dd.name, ent);
    I.emitVar(dd.name, t, addr, 'global');
    I.globalVars.push({ name: dd.name, type: t, addr });
    if (hasInit) runGlobalInit(I, t, addr, dd, scope);
    else if (t.k === 'cls') {
      // default constructor runs for class types (zero-initialised first)
      runGlobalInit(I, t, addr, dd, scope);
    }
  }
}

function isZeroInit(dd: A.Declarator): boolean {
  const e = dd.init;
  return !!e && ((e.k === 'num' && e.v === 0n) || (e.k === 'bool' && !e.v) || e.k === 'nullptr');
}
function isConstantInit(dd: A.Declarator): boolean {
  const e = dd.init ?? dd.braceInit;
  if (!e) return false;
  return e.k === 'num' || e.k === 'fnum' || e.k === 'chr' || e.k === 'bool' || e.k === 'str';
}

function markPaddingStatic(I: Interp, t: Type, addr: number) {
  if (t.k === 'cls') for (const [off, len] of I.layoutOf(t.c).padding) I.mem.loadImage(addr + off, new Uint8Array(len), S.Pad);
  else if (t.k === 'arr' && t.of.k === 'cls') {
    const es = sizeOf(t.of);
    for (let i = 0; i < (t.n ?? 0); i++) markPaddingStatic(I, t.of, addr + i * es);
  }
}

function runGlobalInit(I: Interp, t: Type, addr: number, dd: A.Declarator, scope: Scope) {
  const saved = I.scope;
  I.scope = scope;
  try {
    // constants are loaded straight into the image; everything else is "dynamic initialisation" before main
    initDeclared(I, t, addr, dd);
  } finally { I.scope = saved; }
  if (t.k === 'cls' && hasNontrivialDtor(I, t)) I.staticDtors.push({ type: t, addr });
  else if (t.k === 'arr' && hasNontrivialDtor(I, t)) I.staticDtors.push({ type: t, addr });
}

function defineStaticMember(I: Interp, d: A.VarDecl, dd: A.Declarator, scope: Scope) {
  const qn = dd.qname!;
  const qual: A.QName = { ...qn, parts: qn.parts.slice(0, -1) };
  const lastQual = qual.parts[qual.parts.length - 1];
  const name = qn.parts[qn.parts.length - 1].id;
  if (lastQual.targs) {
    const base: A.QName = { ...qual, parts: qual.parts.map((p, i) => (i === qual.parts.length - 1 ? { ...p, targs: undefined } : p)) };
    const r = lookupQName(I, base, scope, { noTargs: true });
    const ct = r?.ents.find((e) => e.k === 'ctempl');
    if (ct && ct.k === 'ctempl') { (ct.t.outOfClassVars ??= []).push({ decl: d, dd, qualArgs: lastQual.targs }); return; }
  }
  const r = lookupQName(I, qual, scope);
  const owner = r?.ents.find((e) => e.k === 'type');
  if (!owner || owner.k !== 'type' || owner.type.k !== 'cls') I.cerr(`'${qual.parts.map((p) => p.id).join('::')}' is not a class`, dd.pos);
  const c = owner.type.c;
  I.completeClass(c);
  const ent = c.x.scope.names.get(name)?.find((e: Ent) => e.k === 'var') as Extract<Ent, { k: 'var' }> | undefined;
  if (!ent) I.cerr(`'${name}' is not a static data member of '${c.name}'`, dd.pos);
  initStaticMember(I, c, ent, dd);
}

function initStaticMember(I: Interp, c: ClassInfo, ent: Extract<Ent, { k: 'var' }>, dd: A.Declarator, withScope?: Scope) {
  const saved = I.scope;
  I.scope = withScope ?? c.x.scope;
  try {
    if (ent.type.k === 'arr' && (ent.type as any).n === null) I.cerr('static array needs a bound');
    initDeclared(I, ent.type, ent.addr, dd);
  } finally { I.scope = saved; }
  if (ent.type.k === 'cls' && hasNontrivialDtor(I, ent.type)) I.staticDtors.push({ type: ent.type, addr: ent.addr });
}

// =====================================================================================================================
// program-level declarations
// =====================================================================================================================
export function declareProgram(I: Interp, decls: A.Decl[], scope: Scope) {
  for (const d of decls) declare(I, d, scope);
}

export function declare(I: Interp, d: A.Decl, scope: Scope) {
  switch (d.k) {
    case 'empty': break;
    case 'func': declareFunction(I, d, scope); break;
    case 'var': declareGlobalVar(I, d, scope); break;
    case 'class': defineClassDecl(I, d, scope); break;
    case 'enum': declareEnum(I, d, scope); break;
    case 'typedef': declareTypedef(I, d, scope); break;
    case 'namespace': {
      let ns: Scope | undefined;
      const old = scope.names.get(d.name)?.find((e) => e.k === 'ns');
      if (old && old.k === 'ns') ns = old.scope;
      if (!ns) {
        ns = newScope('ns', scope, d.name);
        if (d.name) addEnt(scope, d.name, { k: 'ns', scope: ns });
        else scope.usings.push(ns);
      }
      if (d.inline) scope.usings.push(ns);
      declareProgram(I, d.body, ns);
      break;
    }
    case 'using-ns': {
      const r = lookupQName(I, d.q, scope);
      const ent = r?.ents.find((e) => e.k === 'ns');
      if (!ent || ent.k !== 'ns') I.cerr(`'${d.q.parts.map((p) => p.id).join('::')}' is not a namespace`, d.pos);
      if (!scope.usings.includes(ent.scope)) scope.usings.push(ent.scope);
      break;
    }
    case 'using-decl': {
      const r = lookupQName(I, d.q, scope);
      if (!r) I.cerr(`'${d.q.parts.map((p) => p.id).join('::')}' has not been declared`, d.pos);
      const name = d.q.parts[d.q.parts.length - 1].id;
      for (const e of r.ents) {
        if (e.k === 'fns') {
          const mine = fnsEntOf(scope, name);
          for (const f of e.fns) if (!mine.fns.includes(f)) mine.fns.push(f);
          for (const t of e.ftempls) if (!mine.ftempls.includes(t)) mine.ftempls.push(t);
        } else addEnt(scope, name, e);
      }
      break;
    }
    case 'static_assert': checkStaticAssert(I, d.c, d.msg, scope, d.pos); break;
    case 'pack-begin': I.packStack.push(d.n); break;
    case 'pack-end': I.packStack.pop(); break;
  }
}

export function checkStaticAssert(I: Interp, c: A.Expr, msg: string | undefined, scope: Scope, pos: A.Pos) {
  const r = evalConstInt(I, c, scope);
  if (r.v === 0n) I.cerr(`static assertion failed${msg ? ': ' + msg : ''}`, pos);
}

// =====================================================================================================================
// classes
// =====================================================================================================================
function classDisplayName(scope: Scope, name: string, targs?: TArgVal[]): string {
  const pre = scopePrefix(scope);
  return pre + name + (targs ? '<' + targs.map(targDisplay).join(', ') + '>' : '');
}

export function targDisplay(a: TArgVal): string {
  switch (a.k) {
    case 'type': return typeStr(a.t);
    case 'val': return a.t.k === 'bool' ? (a.v ? 'true' : 'false') : a.t.k === 'int' && a.t.bytes === 1 && a.v >= 32n && a.v < 127n ? `'${String.fromCharCode(Number(a.v))}'` : a.v.toString();
    case 'pack': return a.items.map(targDisplay).join(', ');
    case 'tmpl': return a.ent.name;
  }
}

function newClassInfo(I: Interp, d: A.ClassDecl, declScope: Scope, name: string, targs?: TArgVal[], bindings?: Bindings): ClassInfo {
  const c = newClass(classDisplayName(declScope, name, targs), d.tag, I.plat);
  const parent = bindings ? bindingScope(I, declScope, bindings, name) : declScope;
  const cs = newScope('class', parent, name);
  cs.cls = c;
  c.x = { decl: d, declScope: parent, scope: cs, fieldMap: new Map(), methods: [], ctors: [], ctorTemplates: [], convs: [], assigns: [], dtor: null, completed: false, completing: false, friends: new Set(), friendFns: new Set(), outer: declScope.kind === 'class' ? declScope.cls : null };
  if (bindings) c.x.bindings = bindings;
  c.x.ensure = () => completeClass(I, c);
  I.classes.push(c);
  return c;
}

export function defineClassDecl(I: Interp, d: A.ClassDecl, scope: Scope): ClassInfo {
  // class templates
  if (d.tparams !== null) return declareClassTemplate(I, d, scope) as any;
  // find a forward declaration in the same scope
  let c: ClassInfo | undefined;
  if (d.name) {
    const old = scope.names.get(d.name)?.find((e) => e.k === 'type' && e.type.k === 'cls' && !e.type.c.x.completed && e.type.c.x.declScope === scope);
    if (old && old.k === 'type' && old.type.k === 'cls') c = old.type.c;
  }
  if (c && !d.defined) return c;
  if (!c) {
    c = newClassInfo(I, d, scope, d.name || '(anonymous)');
    if (d.name) addEnt(scope, d.name, { k: 'type', type: clsType(c) });
  } else if (d.defined) {
    c.x.decl = d;
  }
  c.tag = d.tag;
  if (d.defined) {
    c.x.decl = d;
    c.x.defIndex = I.nextId;
    completeClass(I, c);
  }
  return c;
}

export function declareClassTemplate(I: Interp, d: A.ClassDecl, scope: Scope): ClassTemplate {
  const existing = scope.names.get(d.name)?.find((e) => e.k === 'ctempl') as Extract<Ent, { k: 'ctempl' }> | undefined;
  let ct: ClassTemplate;
  if (existing) ct = existing.t;
  else {
    ct = { kind: 'class', name: d.name, decl: d, scope, specs: [], instances: new Map(), defined: d.defined };
    addEnt(scope, d.name, { k: 'ctempl', t: ct });
  }
  if (d.spec) {
    ct.specs.push({ decl: d, params: d.tparams ?? [], args: d.spec });
  } else if (d.defined) {
    ct.decl = d;
    ct.defined = true;
  } else if (!existing) ct.decl = d;
  return ct;
}

export function injectedClassName(I: Interp, ct: ClassTemplate, scope: Scope): ClassInfo | null {
  for (let s: Scope | null = scope; s; s = s.parent) {
    if (s.kind === 'class' && s.cls) {
      let c: ClassInfo | null = s.cls;
      while (c) {
        if (c.x.tmplOrigin === ct) return c;
        c = c.x.outer;
      }
    }
  }
  return null;
}

/** instantiate (or look up) a class template for the given arguments; may return a non-class type for alias templates */
export function instantiateClassTemplate(I: Interp, ct: ClassTemplate, args: TArgVal[], useScope: Scope): Type {
  void useScope;
  if (ct.aliasOf) {
    const al = ct.aliasOf;
    const tps = al.tparams ?? [];
    const b = bindArgs(I, tps, args, ct.name);
    return resolveTypeExpr(I, al.type, bindingScope(I, ct.scope, b, ct.name));
  }
  const tps = ct.decl.tparams ?? [];
  const b0 = bindArgs(I, tps, args, ct.name);
  const key = bindingsKey(tps, b0);
  const hit = ct.instances.get(key);
  if (hit) return clsType(hit);
  // choose a (partial) specialisation
  let chosen: { decl: A.ClassDecl; bindings: Bindings } | null = null;
  const full = tps.map((tp) => b0.get(tp.name)!);
  const candidates: Array<{ decl: A.ClassDecl; bindings: Bindings; params: number }> = [];
  for (const sp of ct.specs) {
    const params = new Set(sp.params.map((p) => p.name));
    const b: Bindings = new Map();
    const saved = I.scope;
    try {
      if (deduceArgs(I, sp.args, expandPackArgs(full), params, b, ct.scope)) {
        // fill unmentioned defaults
        candidates.push({ decl: sp.decl, bindings: b, params: sp.params.length });
      }
    } finally { I.scope = saved; }
  }
  if (candidates.length) {
    candidates.sort((x, y) => x.params - y.params);
    chosen = candidates[0];
  }
  const decl = chosen ? chosen.decl : ct.decl;
  const bindings = chosen ? chosen.bindings : b0;
  const c = newClassInfo(I, decl, ct.scope, ct.name, full, bindings);
  c.x.tmplArgs = full;
  c.x.tmplOrigin = ct;
  c.x.isInitList = ct.name === 'initializer_list' && ct.scope.name === 'std';
  c.x.tmplKey = key;
  ct.instances.set(key, c);
  if (!decl.defined) { c.defined = false; return clsType(c); }
  return clsType(c);
}

function expandPackArgs(a: TArgVal[]): TArgVal[] {
  const out: TArgVal[] = [];
  for (const x of a) { if (x.k === 'pack') out.push(...expandPackArgs(x.items)); else out.push(x); }
  return out;
}

function bindArgs(I: Interp, tps: A.TemplateParam[], args: TArgVal[], name: string): Bindings {
  const b: Bindings = new Map();
  let ai = 0;
  for (const tp of tps) {
    if (tp.pack) { b.set(tp.name, { k: 'pack', items: args.slice(ai) }); ai = args.length; continue; }
    if (ai < args.length) {
      const a = args[ai++];
      if (tp.kind === 'type' && a.k !== 'type') I.cerr(`template argument ${ai} for '${name}' must be a type`);
      if (tp.kind === 'nontype' && a.k === 'val') {
        // convert to the declared parameter type
        b.set(tp.name, a);
        continue;
      }
      if (tp.kind === 'nontype' && a.k !== 'val') I.cerr(`template argument ${ai} for '${name}' must be a constant value`);
      b.set(tp.name, a);
    }
  }
  if (ai < args.length) I.cerr(`too many template arguments for '${name}'`);
  const filled = fillDefaults(I, tps, b, I.global);
  if (!filled) I.cerr(`too few template arguments for '${name}'`);
  return filled;
}

/** Build fields, methods, bases of a class from its AST (lazy for template instances). */
export function completeClass(I: Interp, c: ClassInfo) {
  const x = c.x;
  if (x.completed || x.completing || !x.decl) return;
  if (!x.decl.defined) return;
  x.completing = true;
  try { buildClass(I, c); x.completed = true; } finally { x.completing = false; }
}

function buildClass(I: Interp, c: ClassInfo) {
  const x = c.x;
  const d: A.ClassDecl = x.decl;
  const cs: Scope = x.scope;
  const saved = I.scope;
  I.scope = cs;
  try {
    c.tag = d.tag;
    c.defined = true;
    if (d.alignas) c.alignas = Number(evalConstInt(I, d.alignas, cs).v);
    x.nonPod = false;
    // bases
    for (const b of d.bases) {
      if (b.pack) {
        const nm = b.q.parts[0].id;
        const ent = lookupUnqualified(I, nm, cs)?.ents[0];
        if (ent && ent.k === 'pack') {
          for (const it of ent.items) if (it.k === 'type' && it.t.k === 'cls') { completeClass(I, it.t.c); c.bases.push({ cls: it.t.c, virtual: b.virtual, access: b.access }); }
          continue;
        }
        I.cerr('unsupported pack expansion in base list', d.pos);
      }
      const t = resolveSpec(I, { k: 'spec', base: { k: 'name', q: b.q }, pos: b.q.pos }, cs);
      if (t.k !== 'cls') I.cerr(`base class '${b.q.parts.map((p) => p.id).join('::')}' is not a class`, d.pos);
      if (!t.c.x.decl?.defined) I.cerr(`invalid use of incomplete type '${t.c.name}' as a base class`, d.pos);
      completeClass(I, t.c);
      if (t.c.x.decl.final) I.cerr(`cannot derive from 'final' class '${t.c.name}'`, d.pos);
      c.bases.push({ cls: t.c, virtual: b.virtual, access: b.access });
    }
    if (c.bases.length || d.bases.length) x.nonPod = true;
    // members
    let hasDeclaredCtor = false;
    for (const m of d.members) {
      switch (m.k) {
        case 'static_assert': checkStaticAssert(I, (m.s as any).c, (m.s as any).msg, cs, (m.s as any).pos); break;
        case 'class': {
          const inner = m.c;
          if (inner.tparams !== null) { declareClassTemplate(I, inner, cs); break; }
          const ic = defineClassDecl(I, inner, cs);
          if (!inner.name && inner.defined) {
            // anonymous struct / union member
            const f: FieldInfo = { name: '', type: clsType(ic), access: m.access, anonymous: true };
            c.fields.push(f);
          }
          break;
        }
        case 'enum': declareEnum(I, m.e, cs); break;
        case 'typedef': declareTypedef(I, m.d, cs); break;
        case 'using': memberUsing(I, c, m.d, cs, m.access); break;
        case 'friend': memberFriend(I, c, m.target, cs); break;
        case 'field': memberField(I, c, m, cs); break;
        case 'method': {
          const f = m.f;
          if (f.isCtor) hasDeclaredCtor = true;
          memberMethod(I, c, f, cs);
          break;
        }
      }
    }
    for (const f of c.fields) if (!f.isStatic && f.name) x.fieldMap.set(f.name, f);
    finishClass(I, c, hasDeclaredCtor);
  } finally { I.scope = saved; }
  // out-of-class members of class templates
  if (x.tmplOrigin) applyTemplateOutOfClass(I, c);
}

function memberField(I: Interp, c: ClassInfo, m: Extract<A.Member, { k: 'field' }>, cs: Scope) {
  const x = c.x;
  const vd = m.decl;
  for (const dd of vd.decls) {
    if (dd.type.k === 'fn') {
      // a function declarator that the parser classified as a field (e.g. pointer-to-function typedef) is not expected
      continue;
    }
    let t = resolveTypeExpr(I, dd.type, cs);
    if (m.static) {
      t = isAuto(t) ? deduceAuto(I, t, typeOfExpr(I, (dd.init ?? dd.braceInit)!, cs)) : t;
      t = completeArrayType(I, t, dd);
      const size = Math.max(1, sizeOf(t));
      const hasInit = !!(dd.init || dd.braceInit);
      const addr = I.allocStatic(hasInit && !(dd.init && isZeroInit(dd)) ? 'data' : 'bss', size, Math.max(1, alignOf(t)));
      I.mem.loadImage(addr, new Uint8Array(size), S.Init);
      const ent: Extract<Ent, { k: 'var' }> = { k: 'var', name: dd.name, type: t, addr, isStatic: true };
      (ent as any).access = m.access;
      addEnt(cs, dd.name, ent);
      c.fields.push({ name: dd.name, type: t, isStatic: true, access: m.access });
      I.emitVar(c.name + '::' + dd.name, t, addr, 'static');
      if (hasInit) initStaticMember(I, c, ent, dd);
      continue;
    }
    if (isAuto(t)) I.cerr(`non-static data member '${dd.name}' declared with type 'auto'`, dd.pos);
    if (t.k === 'arr' && t.n === null) t = arrOf(t.of, 0); // flexible array member
    if (t.k === 'cls' && !t.c.defined && !t.c.x.completed) {
      completeClass(I, t.c);
      if (!t.c.defined) I.cerr(`field '${dd.name}' has incomplete type '${t.c.name}'`, dd.pos);
    }
    if (t.k === 'void') I.cerr(`field '${dd.name}' declared void`, dd.pos);
    const f: FieldInfo = { name: dd.name, type: t, access: m.access, mutable: m.mutable };
    if (dd.bits) {
      f.bits = Number(evalConstInt(I, dd.bits, cs).v);
    }
    if (m.alignas || vd.alignas) f.alignas = Number(evalConstInt(I, (m.alignas ?? vd.alignas)!, cs).v);
    const init = dd.init ?? dd.braceInit;
    if (init) f.init = { e: init, brace: !!dd.braceInit || init.k === 'init' };
    if (dd.ctorArgs && dd.ctorArgs.length) f.init = { e: { k: 'fcast', t: dd.type, args: dd.ctorArgs, brace: false, pos: dd.pos } as A.Expr, brace: false };
    if (t.k === 'cls') {
      completeClass(I, t.c);
      if (t.c.x.nonPod) x.nonPod = true;
    }
    if (t.k === 'ref') x.nonPod = true;
    c.fields.push(f);
  }
}

function memberUsing(I: Interp, c: ClassInfo, d: A.Decl, cs: Scope, access: A.Access) {
  if (d.k === 'typedef') { declareTypedef(I, d, cs); return; }
  if (d.k === 'using-decl') {
    const name = d.q.parts[d.q.parts.length - 1].id;
    // inheriting constructors:  using Base::Base;
    if (d.q.parts.length >= 2 && d.q.parts[d.q.parts.length - 2].id === name) {
      const r = lookupQName(I, { ...d.q, parts: d.q.parts.slice(0, -1) }, cs);
      const te = r?.ents.find((e) => e.k === 'type');
      if (te && te.k === 'type' && te.type.k === 'cls') {
        c.x.inheritCtors = c.x.inheritCtors ?? [];
        c.x.inheritCtors.push(te.type.c);
        return;
      }
    }
    const r = lookupQName(I, d.q, cs);
    if (!r) I.cerr(`'${d.q.parts.map((p) => p.id).join('::')}' has not been declared`, d.pos);
    const ents = r.hit ? r.hit.ents : r.ents;
    for (const e of ents) {
      if (e.k === 'fns') {
        const mine = fnsEntOf(cs, name);
        for (const f of e.fns) if (!mine.fns.includes(f)) mine.fns.push(f);
        for (const t of e.ftempls) if (!mine.ftempls.includes(t)) mine.ftempls.push(t);
      } else addEnt(cs, name, e);
    }
    if (r.hit?.field) c.x.usingFields = (c.x.usingFields ?? []).concat(name);
    void access;
    return;
  }
  declare(I, d, cs);
}

function memberFriend(I: Interp, c: ClassInfo, target: A.QName | A.ClassDecl | A.FuncDecl, cs: Scope) {
  if ('parts' in target) {
    const r = lookupQName(I, target, cs);
    const te = r?.ents.find((e) => e.k === 'type');
    if (te && te.k === 'type' && te.type.k === 'cls') { c.x.friends.add(te.type.c); return; }
    const ct = r?.ents.find((e) => e.k === 'ctempl');
    if (ct) { c.x.friendTemplates = (c.x.friendTemplates ?? new Set()).add((ct as any).t); return; }
    // friend function declared by name
    c.x.friendFns.add(target.parts[target.parts.length - 1].id);
    return;
  }
  if (target.k === 'func') {
    c.x.friendFns.add(target.name);
    // a friend defined in the class belongs to the enclosing namespace scope
    if (target.body) {
      let ns: Scope = c.x.declScope;
      while (ns.kind === 'class' || ns.kind === 'func' || ns.kind === 'block' || ns.kind === 'tmpl') ns = ns.parent!;
      const f = makeFn(I, { ...target, qname: { ...target.qname, parts: [target.qname.parts[target.qname.parts.length - 1]] } }, ns, null);
      f.friendOf = c;
      registerFn(I, fnsEntOf(ns, target.name), f);
    }
  }
}

function paramIsSelf(I: Interp, f: Fn, c: ClassInfo, kind: 'copy' | 'move'): boolean {
  const s = getSig(I, f);
  if (s.params.length < 1) return false;
  if (!s.defaults.slice(1).every((x) => x) && s.params.length > 1) return false;
  const p = s.params[0];
  if (p.k !== 'ref') return false;
  const b = stripCv(p.to);
  if (b.k !== 'cls' || b.c !== c) return false;
  return kind === 'copy' ? !p.rv : p.rv;
}

function memberMethod(I: Interp, c: ClassInfo, f: A.FuncDecl, cs: Scope) {
  const x = c.x;
  const name = f.name;
  // method templates
  if (f.tparams) {
    const tmpl: FuncTemplate = { kind: 'func', decl: f, scope: cs, cls: c, name, instances: new Map(), specs: new Map() };
    if (f.isCtor) { x.ctorTemplates.push(tmpl); return; } // constructors are never found by name lookup
    fnsEntOf(cs, name).ftempls.push(tmpl);
    return;
  }
  const fn = makeFn(I, f, cs, c, { access: f.access });
  if (f.isCtor) {
    // constructors are not found by ordinary lookup
    x.ctors.push(fn);
    fn.name = c.name.replace(/<.*$/, '').split('::').pop()!;
    return;
  }
  if (f.isDtor) {
    if (x.dtor) I.cerr(`'${c.name}' already has a destructor`, f.pos);
    x.dtor = fn;
    x.methods.push(fn);
    return;
  }
  if (f.isConv) { x.convs.push(fn); x.methods.push(fn); fnsEntOf(cs, name).fns.push(fn); return; }
  const ent = fnsEntOf(cs, name);
  const before = ent.fns.length;
  registerFn(I, ent, fn);
  const added = ent.fns.length > before;
  const real = added ? fn : ent.fns.find((o) => o.decl === f) ?? fn;
  if (added) x.methods.push(fn);
  if (name === 'operator=') {
    if (!x.assigns.includes(real)) x.assigns.push(real);
  }
  void real;
}

/** after all members are known: overrides, special members, trivial/aggregate flags */
function finishClass(I: Interp, c: ClassInfo, hasDeclaredCtor: boolean) {
  const x = c.x;
  const d: A.ClassDecl = x.decl;
  // virtual functions and overriding
  const newVirt: Fn[] = [];
  for (const m of x.methods as Fn[]) {
    if (m.isStatic || m.isCtor) continue;
    let ov: Fn | null = null;
    for (const b of c.bases) {
      const found = findVirtualIn(I, b.cls, m);
      if (found) { ov = found; break; }
    }
    if (ov) {
      m.isVirtual = true;
      m.overrides = ov;
      m.vslot = ov.vslot;
      if (m.decl && m.decl.pure) m.isPure = true;
    } else {
      if (m.decl?.override) I.cerr(`'${m.qual}' is marked 'override' but does not override any base class method`, m.decl.pos);
      if (m.isVirtual) newVirt.push(m);
    }
    if (m.isDtor && !ov && c.bases.some((b) => b.cls.x.dtor?.isVirtual)) m.isVirtual = true;
  }
  if (!x.dtor && c.bases.some((b) => b.cls.x.dtor?.isVirtual)) { /* implicit virtual dtor is created below */ }
  c.declaresVirtual = (x.methods as Fn[]).some((m) => m.isVirtual);
  x.newVirtual = newVirt.length > 0;
  x.newVirtuals = newVirt;
  // classes that only inherit virtual dtor
  const baseVirtualDtor = c.bases.some((b) => b.cls.x.dtor?.isVirtual);
  if (baseVirtualDtor && !c.declaresVirtual) c.declaresVirtual = true;
  if (c.declaresVirtual) x.nonPod = true;
  // special members
  makeImplicitMembers(I, c, hasDeclaredCtor, baseVirtualDtor);
  // aggregate?
  const userCtor = (x.ctors as Fn[]).some((f) => !f.special) || hasDeclaredCtor;
  const publicFields = c.fields.filter((f) => !f.isStatic).every((f) => f.access === 'public');
  x.aggregate = !userCtor && publicFields && !c.declaresVirtual && !hasVirtualBases(c) && c.bases.every((b) => b.access === 'public');
  // abstract classes
  x.abstract = false;
  x.pureList = [];
  if (anyPure(c)) computeAbstract(I, c);
  x.isInitList = !!(x.tmplOrigin && x.tmplOrigin.name === 'initializer_list' && x.tmplOrigin.scope.name === 'std');
  void d;
}

function anyPure(c: ClassInfo): boolean {
  return (c.x.methods as Fn[]).some((m) => m.isPure) || c.bases.some((b) => anyPure(b.cls));
}

function computeAbstract(I: Interp, c: ClassInfo) {
  const roots = new Set<Fn>();
  const collect = (k: ClassInfo) => { for (const m of k.x.methods as Fn[]) if (m.isVirtual) roots.add(rootDecl(m)); k.bases.forEach((b) => collect(b.cls)); };
  collect(c);
  const pure: string[] = [];
  for (const r of roots) {
    const fo = finalOverrider(I, c, r);
    if (fo.isPure) pure.push(fo.qual + (fo.isDtor ? '()' : ''));
  }
  if (pure.length) { c.x.abstract = true; c.x.pureList = pure; }
}

function findVirtualIn(I: Interp, b: ClassInfo, m: Fn): Fn | null {
  completeClassSafe(I, b);
  for (const bm of b.x.methods as Fn[]) {
    if (!bm.isVirtual || bm.isStatic) continue;
    if (m.isDtor ? bm.isDtor : (!bm.isDtor && sameSignature(I, bm, m))) return bm;
  }
  for (const bb of b.bases) { const r = findVirtualIn(I, bb.cls, m); if (r) return r; }
  return null;
}
function completeClassSafe(I: Interp, c: ClassInfo) { completeClass(I, c); }

function synth(I: Interp, c: ClassInfo, name: string, special: NonNullable<Fn['special']>, params: Type[], ret: Type): Fn {
  const fn: Fn = {
    id: I.newId(), name, qual: `${c.name}::${name}`, decl: null, cls: c, scope: c.x.scope, bindings: null, isStatic: false, isVirtual: false,
    isCtor: special === 'ctor0' || special === 'copy' && name !== 'operator=' || special === 'move' && name !== 'operator=', isDtor: special === 'dtor',
    isConv: false, isConst: false, isExplicit: false, isDeleted: false, isDefaulted: true, isPure: false, userProvided: false, access: 'public', addr: 0, special,
  };
  fn.sig = { ret, params, variadic: false, paramNames: params.map(() => 'other'), defaults: params.map(() => undefined) };
  I.allFns.push(fn);
  return fn;
}

function makeImplicitMembers(I: Interp, c: ClassInfo, hasDeclaredCtor: boolean, baseVirtualDtor: boolean) {
  const x = c.x;
  const self = clsType(c);
  const cref = refTo(constOf(self));
  const rref = refTo(self, true);
  const ctors = x.ctors as Fn[];
  // `T(const T&) = default;` and friends behave exactly like the implicit members: drop the declaration and let them be synthesised
  for (const list of [ctors, x.assigns as Fn[]]) {
    for (let i = list.length - 1; i >= 0; i--) {
      const g = list[i];
      if (g.decl?.defaulted && !g.decl.body && (paramIsSelf(I, g, c, 'copy') || paramIsSelf(I, g, c, 'move'))) list.splice(i, 1);
    }
  }
  const userCopy = ctors.find((f) => f.decl && paramIsSelf(I, f, c, 'copy'));
  const userMove = ctors.find((f) => f.decl && paramIsSelf(I, f, c, 'move'));
  const asg = x.assigns as Fn[];
  const userCopyAsg = asg.find((f) => paramIsSelf(I, f, c, 'copy') || (getSig(I, f).params[0]?.k !== 'ref' && stripCv(getSig(I, f).params[0] ?? I.T.int).k === 'cls' && (stripCv(getSig(I, f).params[0]) as any).c === c));
  const userMoveAsg = asg.find((f) => paramIsSelf(I, f, c, 'move'));
  const fields = c.fields.filter((f) => !f.isStatic);

  // does every member / base support the operation?
  const hasRef = fields.some((f) => f.type.k === 'ref');
  const hasConstScalar = fields.some((f) => f.type.k !== 'cls' && f.type.k !== 'ref' && (f.type.const || (f.type.k === 'arr' && f.type.of.const)));
  const classMembers: Type[] = [...c.bases.map((b) => clsType(b.cls)), ...fields.map((f) => { let t = f.type; while (t.k === 'arr') t = t.of; return t; }).filter((t) => t.k === 'cls')];
  const clsOf = (t: Type) => (t as Extract<Type, { k: 'cls' }>).c;
  const memberCan = (pred: (k: ClassInfo) => boolean) => classMembers.every((t) => { completeClass(I, clsOf(t)); return pred(clsOf(t)); });

  // default constructor
  if (!hasDeclaredCtor && ctors.length === 0) {
    const f = synth(I, c, c.name.replace(/<.*$/, '').split('::').pop()!, 'ctor0', [], I.T.void);
    f.isDeleted = hasRef && fields.some((fl) => fl.type.k === 'ref' && !fl.init) || (hasConstScalar && fields.some((fl) => fl.type.const && !fl.init && fl.type.k !== 'cls' && fl.type.k !== 'ref'))
      || !memberCan((k) => (k.x.ctors as Fn[]).some((g) => !g.isDeleted && (g.special === 'ctor0' || (!g.special && getSig(I, g).params.every((_, i) => getSig(I, g).defaults[i])))));
    ctors.push(f);
  }
  x.trivialDefault = !c.declaresVirtual && !fields.some((f) => f.init) && c.bases.length === 0 && ctors.every((f) => f.special === 'ctor0')
    && !classMembers.some((t) => !clsOf(t).x.trivialDefault);
  // copy / move constructors
  const anyCopyLike = !!(userCopy || userCopyAsg || userMoveAsg || x.dtor?.decl);
  if (!userCopy) {
    const f = synth(I, c, c.name.replace(/<.*$/, '').split('::').pop()!, 'copy', [cref], I.T.void);
    f.isDeleted = !!userMove || !!userMoveAsg || !memberCan((k) => (k.x.ctors as Fn[]).some((g) => g.isDeleted ? false : (g.special === 'copy' || (g.decl && paramIsSelf(I, g, k, 'copy')) || (g.decl && g.userProvided && getSig(I, g).params.length === 1))));
    if (!f.isDeleted) f.isDeleted = classMembers.some((t) => !(clsOf(t).x.ctors as Fn[]).some((g) => !g.isDeleted && (g.special === 'copy' || (g.decl && getSig(I, g).params.length >= 1 && getSig(I, g).params[0].k === 'ref'))));
    ctors.push(f);
  }
  if (!userMove && !anyCopyLike && !x.dtor?.decl) {
    const f = synth(I, c, c.name.replace(/<.*$/, '').split('::').pop()!, 'move', [rref], I.T.void);
    // an implicit move constructor that would be deleted is ignored instead
    const ok = memberCan((k) => (k.x.ctors as Fn[]).some((g) => !g.isDeleted && (g.special === 'move' || g.special === 'copy' || g.decl)));
    if (ok) ctors.push(f);
  }
  // trivial copy (bitwise): no virtuals, no user-provided copy/move, members trivially copyable
  x.trivialCopy = !userCopy && !userMove && !c.declaresVirtual && !hasVirtualBases(c)
    && classMembers.every((t) => clsOf(t).x.trivialCopy) && !hasRef;
  // assignment operators
  if (!userCopyAsg) {
    const f = synth(I, c, 'operator=', 'cassign', [cref], refTo(self));
    f.isDeleted = hasRef || hasConstScalar || !!userMoveAsg || !!userMove || !memberCan((k) => (k.x.assigns as Fn[]).some((g) => !g.isDeleted && (g.special === 'cassign' || paramIsSelf(I, g, k, 'copy') || getSig(I, g).params[0]?.k !== 'ref')))
      || fields.some((fl) => fl.type.const && fl.type.k !== 'ref');
    asg.push(f);
  }
  if (!userMoveAsg && !userCopy && !userCopyAsg && !x.dtor?.decl) {
    const f = synth(I, c, 'operator=', 'massign', [rref], refTo(self));
    const ok = !hasRef && !hasConstScalar && memberCan((k) => (k.x.assigns as Fn[]).some((g) => !g.isDeleted));
    if (ok) asg.push(f);
  }
  // destructor
  if (!x.dtor) {
    const f = synth(I, c, '~' + c.name.replace(/<.*$/, '').split('::').pop()!, 'dtor', [], I.T.void);
    f.isVirtual = baseVirtualDtor;
    x.dtor = f;
    x.methods.push(f);
    // a virtual destructor inherited from a base overrides it
    if (baseVirtualDtor) { for (const b of c.bases) { const bd = findVirtualIn(I, b.cls, f); if (bd) { f.overrides = bd; break; } } }
  } else if (!x.dtor.overrides) {
    for (const b of c.bases) { const bd = findVirtualIn(I, b.cls, x.dtor); if (bd) { x.dtor.overrides = bd; x.dtor.isVirtual = true; break; } }
  }
  // all assignment operators are also reachable by name
  if (asg.length) {
    const ent = fnsEntOf(x.scope, 'operator=');
    for (const f of asg) if (!ent.fns.includes(f)) ent.fns.push(f);
  }
  const dt = x.dtor as Fn;
  x.nontrivialDtor = !!dt.decl?.body || !!dt.isVirtual || (dt.decl && !dt.decl.defaulted) || c.bases.some((b) => b.cls.x.nontrivialDtor)
    || fields.some((f) => { let t = f.type; while (t.k === 'arr') t = t.of; return t.k === 'cls' && !!t.c.x.nontrivialDtor; });
  if (dt.decl?.defaulted && !dt.isVirtual) {
    x.nontrivialDtor = c.bases.some((b) => b.cls.x.nontrivialDtor) || fields.some((f) => { let t = f.type; while (t.k === 'arr') t = t.of; return t.k === 'cls' && !!t.c.x.nontrivialDtor; });
  }
  if (x.dtor.decl?.deleted) { /* deleted destructor makes destruction ill-formed */ }
  // user-declared special members make the class non-POD for layout purposes
  if (ctors.some((f) => f.decl && f.userProvided) || (x.dtor as Fn).decl?.body || userCopy || userCopyAsg) x.nonPod = true;
}

/** apply out-of-class member function / static member definitions collected on the class template */
function applyTemplateOutOfClass(I: Interp, c: ClassInfo) {
  const ct: ClassTemplate = c.x.tmplOrigin;
  const tps = ct.decl.tparams ?? [];
  const cs: Scope = c.x.scope;
  const args = c.x.tmplArgs as TArgVal[];
  for (const o of ct.outOfClass ?? []) {
    // map the definition's own template parameter names to the instance's arguments
    const b: Bindings = new Map();
    o.qualArgs.forEach((qa, i) => {
      const nm = qa.k === 'type' && qa.t.k === 'base' && qa.t.spec.base.k === 'name' ? qa.t.spec.base.q.parts[0].id : qa.k === 'expr' && qa.e.k === 'id' ? qa.e.q.parts[0].id : null;
      if (nm && args[i]) b.set(nm, args[i]);
      else if (nm === null && qa.k === 'pack' && qa.t.k === 'base' && qa.t.spec.base.k === 'name') b.set(qa.t.spec.base.q.parts[0].id, { k: 'pack', items: args.slice(i) });
    });
    void tps;
    const d = o.decl;
    const ndecl: A.FuncDecl = { ...d, tparams: null, qname: { ...d.qname, parts: [d.qname.parts[d.qname.parts.length - 1]] } };
    // match against a declaration inside this instance
    const ent = cs.names.get(d.name)?.find((e) => e.k === 'fns') as Extract<Ent, { k: 'fns' }> | undefined;
    const ctorLike = d.isCtor || d.isDtor;
    const bsc = bindingScope(I, ct.scope, b, ct.name);
    const target = ctorLike ? matchCtorDef(I, c, ndecl, bsc) : ent ? matchDef(I, ent.fns, ndecl, bsc, c) : null;
    if (!target) I.cerr(`no declaration of '${c.name}::${d.name}' matches this out-of-class definition`, d.pos);
    target.decl = { ...target.decl!, body: ndecl.body, ctorInit: ndecl.ctorInit, params: ndecl.params.map((p, i) => ({ ...p, def: p.def ?? target!.decl!.params[i]?.def })), defaulted: ndecl.defaulted || target.decl!.defaulted };
    target.userProvided = !target.decl.defaulted;
    target.defaultScope = target.scope;
    target.defParamScope = bsc;
    target.sig = undefined;
    target.native = undefined;
    // parameter and body names use the definition's template parameter names
    target.scope = bindingScope(I, cs, b);
  }
  for (const o of ct.outOfClassVars ?? []) {
    const b: Bindings = new Map();
    o.qualArgs.forEach((qa, i) => {
      const nm = qa.k === 'type' && qa.t.k === 'base' && qa.t.spec.base.k === 'name' ? qa.t.spec.base.q.parts[0].id : qa.k === 'expr' && qa.e.k === 'id' ? qa.e.q.parts[0].id : null;
      if (nm && args[i]) b.set(nm, args[i]);
    });
    const name = o.dd.qname!.parts[o.dd.qname!.parts.length - 1].id;
    const ent = cs.names.get(name)?.find((e) => e.k === 'var') as Extract<Ent, { k: 'var' }> | undefined;
    if (!ent) continue;
    initStaticMember(I, c, ent, o.dd, bindingScope(I, cs, b));
  }
}

function matchCtorDef(I: Interp, c: ClassInfo, d: A.FuncDecl, sc: Scope): Fn | null {
  const x = c.x;
  const tmp = makeFn(I, d, sc, c, {});
  const ts = getSig(I, tmp);
  const list: Fn[] = d.isDtor ? [x.dtor] : x.ctors;
  for (const f of list) {
    if (!f || !f.decl) continue;
    const fs = getSig(I, f);
    if (fs.params.length === ts.params.length && fs.params.every((p, i) => sameType(stripCv(p), stripCv(ts.params[i]), true))) return f;
  }
  return null;
}

function matchDef(I: Interp, fns: Fn[], d: A.FuncDecl, sc: Scope, c: ClassInfo): Fn | null {
  const tmp = makeFn(I, d, sc, c, {});
  let ts: ReturnType<typeof getSig>;
  try { ts = getSig(I, tmp); } catch { return null; }
  for (const f of fns) {
    if (f.isConst !== d.constMethod) continue;
    const fs = getSig(I, f);
    if (fs.params.length === ts.params.length && fs.params.every((p, i) => sameType(stripCv(p), stripCv(ts.params[i]), true))) return f;
  }
  return null;
}

// =====================================================================================================================
// vtables
// =====================================================================================================================
export interface Vtab { sub: ClassInfo; offset: number; vptrAt: number; addr: number; viaVbase: boolean }

/** the virtual tables of a class (one per subobject that owns a vptr), allocated in .rodata on first use */
export function getVtabs(I: Interp, c: ClassInfo): Vtab[] {
  if (c.x.vtabs) return c.x.vtabs;
  c.x.vtabs = [];
  I.completeClass(c);
  if (!isDynamic(c) || c.tag === 'union') return c.x.vtabs;
  const L = I.layoutOf(c);
  const found: Vtab[] = [];
  const seenAt = new Set<number>();
  const visit = (k: ClassInfo, off: number, viaV: boolean) => {
    I.completeClass(k);
    const KL = I.layoutOf(k);
    if (KL.vptrOffset !== null && k.declaresVirtual || (KL.vptrOffset !== null && hasVirt(k))) {
      const at = off + KL.vptrOffset!;
      if (!seenAt.has(at)) { seenAt.add(at); found.push({ sub: k, offset: off, vptrAt: at, addr: 0, viaVbase: viaV }); }
    }
    for (const b of k.bases) {
      if (b.virtual) continue;
      visit(b.cls, off + (b.offset ?? 0), viaV);
    }
  };
  visit(c, 0, false);
  for (const [vb, off] of L.vbaseOffsets) visit(vb, off, true);
  // allocate the tables
  const msvc = I.plat.abi === 'msvc';
  for (const v of found) {
    const slots = vslotsOf(I, v.sub);
    const header = msvc ? 8 : 16;
    const entries: Fn[] = [];
    for (const root of slots) {
      const fo = root.isDtor ? finalDtorOf(c, v, I) : finalOverrider(I, c, root);
      entries.push(fo);
      if (root.isDtor && !msvc) entries.push(fo); // complete + deleting destructor
    }
    const total = header + 8 * Math.max(1, entries.length);
    const base = I.allocStatic('rodata', total, 8);
    const bytes = new Uint8Array(total);
    const dv = new DataView(bytes.buffer);
    // typeinfo / RTTI pointer
    const tiAddr = typeInfoAddr(I, c);
    if (msvc) dv.setBigUint64(0, BigInt(tiAddr), true);
    else { dv.setBigUint64(0, BigInt.asUintN(64, BigInt(-v.offset)), true); dv.setBigUint64(8, BigInt(tiAddr), true); }
    entries.forEach((f, i) => dv.setBigUint64(header + 8 * i, BigInt(fnAddrOf(I, f)), true));
    I.mem.loadImage(base, bytes, S.Init);
    v.addr = base + header;
    I.vtables.set(v.addr, { cls: c, offset: v.offset, vptrOffsetInSub: 0, slots: entries.map((f) => ({ fn: f, adjust: 0 })) } as any);
    I.vtableLabels.set(v.addr, `vtable for ${c.name}${v.sub !== c ? ' (as ' + v.sub.name + ')' : ''}`);
  }
  c.x.vtabs = found;
  return found;
}

function hasVirt(k: ClassInfo): boolean { return k.declaresVirtual || k.bases.some((b) => hasVirt(b.cls)); }

function fnAddrOf(I: Interp, f: Fn): number {
  if (!f.addr) { f.addr = I.newFnAddr(); I.fnByAddr.set(f.addr, f); }
  return f.addr;
}

function finalDtorOf(c: ClassInfo, v: Vtab, I: Interp): Fn {
  void v; void I;
  return c.x.dtor as Fn;
}

function typeInfoAddr(I: Interp, c: ClassInfo): number {
  if (c.x.tiAddr) return c.x.tiAddr;
  const a = I.allocStatic('rodata', 16, 8);
  const name = I.stringLiteral(c.name);
  const b = new Uint8Array(16);
  new DataView(b.buffer).setBigUint64(8, BigInt(name), true);
  I.mem.loadImage(a, b, S.Init);
  c.x.tiAddr = a;
  return a;
}

/** root virtual declarations in vtable order for class k's primary vtable: primary base's slots, then k's new virtuals */
export function vslotsOf(I: Interp, k: ClassInfo): Fn[] {
  if (k.x.vslots) return k.x.vslots;
  I.completeClass(k);
  const out: Fn[] = [];
  const primary = k.bases.find((b) => !b.virtual && isDynamicCls(b.cls));
  if (primary) out.push(...vslotsOf(I, primary.cls));
  for (const m of (k.x.methods as Fn[])) {
    if (!m.isVirtual || m.isStatic) continue;
    const root = rootDecl(m);
    if (!out.includes(root) && !out.some((r) => r.isDtor && root.isDtor)) out.push(root);
  }
  // a class whose only dynamic bases are secondary: its own table carries just its own virtuals
  k.x.vslots = out;
  return out;
}
function isDynamicCls(c: ClassInfo): boolean { return c.declaresVirtual || c.bases.some((b) => b.virtual || isDynamicCls(b.cls)); }

// =====================================================================================================================
// lambdas
// =====================================================================================================================
function idsIn(e: A.Expr | A.Stmt | undefined | null, out: Set<string>) {
  if (!e) return;
  const visitE = (x: A.Expr | undefined | null) => {
    if (!x) return;
    switch (x.k) {
      case 'id': if (x.q.parts.length === 1 && !x.q.global) out.add(x.q.parts[0].id); break;
      case 'un': case 'post': visitE(x.e); break;
      case 'bin': case 'assign': visitE(x.l); visitE(x.r); break;
      case 'cond': visitE(x.c); visitE(x.a); visitE(x.b); break;
      case 'call': visitE(x.f); x.args.forEach(visitE); break;
      case 'index': visitE(x.e); visitE(x.i); break;
      case 'member': visitE(x.e); break;
      case 'cast': visitE(x.e); break;
      case 'fcast': x.args.forEach(visitE); break;
      case 'new': x.place.forEach(visitE); x.args?.forEach(visitE); visitE(x.arr); break;
      case 'delete': visitE(x.e); break;
      case 'lambda': idsIn(x.body, out); x.cap.forEach((c) => visitE(c.init)); break;
      case 'init': x.items.forEach(visitE); break;
      case 'throw': visitE(x.e); break;
      case 'expand': visitE(x.e); break;
      case 'fold': visitE(x.pack); visitE(x.init); break;
      case 'sizeof-e': visitE(x.e); break;
      case 'this': out.add('this'); break;
      default: break;
    }
  };
  const visitS = (s: A.Stmt | undefined | null) => {
    if (!s) return;
    switch (s.k) {
      case 'block': s.body.forEach(visitS); break;
      case 'expr': visitE(s.e); break;
      case 'var': for (const d of s.decls) { visitE(d.init); visitE(d.braceInit); d.ctorArgs?.forEach(visitE); } break;
      case 'if': visitS(s.init); if (s.c && (s.c as any).k === 'var') visitS(s.c as A.Stmt); else visitE(s.c as A.Expr); visitS(s.then); visitS(s.else); break;
      case 'while': if ((s.c as any).k === 'var') visitS(s.c as A.Stmt); else visitE(s.c as A.Expr); visitS(s.body); break;
      case 'do': visitS(s.body); visitE(s.c); break;
      case 'for': visitS(s.init); if (s.c) { if ((s.c as any).k === 'var') visitS(s.c as A.Stmt); else visitE(s.c as A.Expr); } visitE(s.step); visitS(s.body); break;
      case 'rfor': visitS(s.init); visitE(s.range); visitS(s.body); break;
      case 'switch': visitS(s.init); visitE(s.e); visitS(s.body); break;
      case 'case': visitE(s.e); break;
      case 'return': visitE(s.e); break;
      case 'label': visitS(s.stmt); break;
      case 'try': visitS(s.body); s.catches.forEach((c) => visitS(c.body)); break;
      case 'bindings': visitE(s.init); break;
      default: break;
    }
  };
  if ((e as any).body !== undefined || (e as any).k === 'block' || ['expr', 'var', 'if', 'while', 'do', 'for', 'rfor', 'switch', 'return', 'label', 'try', 'bindings', 'case'].includes((e as any).k)) visitS(e as A.Stmt);
  else visitE(e as A.Expr);
}

let lambdaCounter = 0;

export function makeLambdaClass(I: Interp, e: Extract<A.Expr, { k: 'lambda' }>, scope: Scope): ClassInfo {
  const key = I.frame.fn ? I.frame.fn.id : 0;
  const cache: Map<number, ClassInfo> = ((e as any).__cache ??= new Map());
  const cached = cache.get(key);
  if (cached) return cached;
  const outerCls = lambdaOuterClass(I);
  const used = new Set<string>();
  idsIn(e.body, used);
  const caps: LambdaInfo['captures'] = [];
  const initCaps: Array<{ cap: A.LambdaCap; type: Type }> = [];
  const explicitNames = new Set<string>();
  let capThis = false;
  for (const c of e.cap) {
    if (c.this) { capThis = true; continue; }
    explicitNames.add(c.name);
  }
  const varType = (name: string): { type: Type; isLocal: boolean; isMember: boolean } | null => {
    const r = lookupUnqualified(I, name, scope);
    if (!r) return null;
    if (r.hit) return { type: r.hit.field?.type ?? I.T.int, isLocal: false, isMember: true };
    const ent = r.ents[0];
    if (ent.k === 'var') {
      const seg = I.mem.seg(ent.addr)?.name;
      return { type: ent.type.k === 'ref' ? ent.type.to : ent.type, isLocal: seg === 'stack', isMember: false };
    }
    if (ent.k === 'bind') return { type: ent.type, isLocal: true, isMember: false };
    return null;
  };
  const fields: FieldInfo[] = [];
  const cls = newClass(I.plat.abi === 'msvc' ? `<lambda_${++lambdaCounter}>` : `{lambda(...)#${++lambdaCounter}}`, 'struct', I.plat);
  const cs = newScope('class', nonLocalScope(scope), '');
  cs.cls = cls;
  cls.x = { decl: null, declScope: nonLocalScope(scope), scope: cs, fieldMap: new Map(), methods: [], ctors: [], ctorTemplates: [], convs: [], assigns: [], dtor: null, completed: true, completing: false, friends: new Set(), friendFns: new Set(), outer: outerCls, lambda: null, lambdaOuterCls: outerCls, nonPod: true };
  cls.defined = true;
  I.classes.push(cls);
  for (const c of e.cap) {
    if (c.this) continue;
    if (c.init) {
      const v = typeOfExpr(I, c.init, scope);
      const vt = v.k === 'l' || v.k === 'i' || v.k === 'f' ? v.t : I.T.int;
      const t = c.byRef ? refTo(vt.k === 'ref' ? vt.to : vt) : (stripCvArr(vt));
      fields.push({ name: c.name, type: t, access: 'public' });
      caps.push({ name: c.name, byRef: c.byRef, field: c.name, type: t, init: c.init } as any);
      initCaps.push({ cap: c, type: t });
      continue;
    }
    const vt = varType(c.name);
    if (!vt) I.cerr(`'${c.name}' cannot be captured: it was not declared in this scope`, e.pos);
    if (vt.isMember) { capThis = true; continue; }
    const t = c.byRef ? refTo(vt.type) : vt.type;
    fields.push({ name: c.name, type: t, access: 'public' });
    caps.push({ name: c.name, byRef: c.byRef, field: c.name, type: t });
  }
  if (e.capDefault) {
    for (const nm of used) {
      if (explicitNames.has(nm)) continue;
      if (nm === 'this') { capThis = true; continue; }
      const vt = varType(nm);
      if (!vt) continue;
      if (vt.isMember) { capThis = true; continue; }
      if (!vt.isLocal) continue;
      const byRef = e.capDefault === '&';
      const t = byRef ? refTo(vt.type) : vt.type;
      fields.push({ name: nm, type: t, access: 'public' });
      caps.push({ name: nm, byRef, field: nm, type: t });
    }
  }
  if (capThis || (used.has('this') && e.capDefault)) {
    const th = I.frame.thisV;
    if (th && th.k === 'l') {
      fields.push({ name: 'this', type: ptrTo(th.t), access: 'public' });
      caps.push({ name: 'this', byRef: false, field: 'this', type: ptrTo(th.t), isThis: true });
    }
  }
  cls.fields = fields;
  for (const f of fields) cls.x.fieldMap.set(f.name, f);
  // operator()
  const params: A.Param[] = [];
  const tparams: A.TemplateParam[] = e.tparams ? [...e.tparams] : [];
  e.params.forEach((p, i) => {
    const np = rewriteAutoParam(p, i, tparams);
    params.push(np);
  });
  const decl: A.FuncDecl = {
    k: 'func', qname: { parts: [{ id: 'operator()' }], pos: e.pos }, name: 'operator()', ret: e.ret ?? null, params, variadic: false, body: e.body, storage: '', inline: true,
    constexpr: false, virtual: false, pure: false, override: false, final: false, explicit: false, constMethod: !e.mutable, refQual: '', noexcept: false, deleted: false,
    defaulted: false, ctorInit: null, tparams: tparams.length ? tparams : null, access: 'public', isCtor: false, isDtor: false, isConv: false, pos: e.pos,
  };
  const info: LambdaInfo = { node: e, cls, captures: caps };
  cls.x.lambda = info;
  if (tparams.length) {
    const tmpl: FuncTemplate = { kind: 'func', decl, scope: cs, cls, name: 'operator()', instances: new Map(), specs: new Map() };
    fnsEntOf(cs, 'operator()').ftempls.push(tmpl);
  } else {
    const fn = makeFn(I, decl, cs, cls, { access: 'public' });
    fn.lambda = info;
    fn.qual = `${I.frame.fn ? I.frame.fn.qual : 'main'}::${cls.name}::operator()`;
    fnsEntOf(cs, 'operator()').fns.push(fn);
    cls.x.methods.push(fn);
    cls.x.opCall = fn;
  }
  // implicit members (copy/move/dtor)
  const bd = cls.x;
  const ctors = bd.ctors as Fn[];
  const self = clsType(cls);
  const mk = (special: NonNullable<Fn['special']>, params2: Type[], name: string, ret: Type): Fn => synth(I, cls, name, special, params2, ret);
  ctors.push(mk('copy', [refTo(constOf(self))], 'lambda', I.T.void));
  ctors.push(mk('move', [refTo(self, true)], 'lambda', I.T.void));
  const fieldsNS = fields;
  bd.assigns.push(mk('cassign', [refTo(constOf(self))], 'operator=', refTo(self)));
  bd.dtor = mk('dtor', [], '~lambda', I.T.void);
  bd.methods.push(bd.dtor);
  bd.nontrivialDtor = fieldsNS.some((f) => f.type.k === 'cls' && f.type.c.x.nontrivialDtor);
  bd.trivialCopy = fieldsNS.every((f) => f.type.k !== 'cls' || f.type.c.x.trivialCopy);
  bd.trivialDefault = false;
  bd.aggregate = false;
  bd.abstract = false;
  bd.pureList = [];
  cache.set(key, cls);
  return cls;
}

function stripCvArr(t: Type): Type {
  if (t.k === 'arr') return ptrTo(t.of);
  return stripCv(t) as Type;
}

function lambdaOuterClass(I: Interp): ClassInfo | null {
  const th = I.frame.thisV;
  if (th && th.k === 'l' && th.t.k === 'cls') return th.t.c.x.lambda ? (th.t.c.x.lambdaOuterCls ?? null) : th.t.c;
  return null;
}

/** closest enclosing scope that is not a function or block (what a lambda body can see without captures) */
function nonLocalScope(s: Scope): Scope {
  let x: Scope = s;
  while ((x.kind === 'func' || x.kind === 'block') && x.parent) x = x.parent;
  return x;
}

function rewriteAutoParam(p: A.Param, i: number, tparams: A.TemplateParam[]): A.Param {
  let used = false;
  const name = `__auto${i}`;
  const rewrite = (t: A.TypeExpr): A.TypeExpr => {
    switch (t.k) {
      case 'base':
        if (t.spec.base.k === 'auto') {
          used = true;
          return { k: 'base', spec: { ...t.spec, base: { k: 'name', q: { parts: [{ id: name }], pos: t.spec.pos } } } };
        }
        return t;
      case 'ptr': return { ...t, to: rewrite(t.to) };
      case 'ref': return { ...t, to: rewrite(t.to) };
      default: return t;
    }
  };
  const nt = rewrite(p.type);
  if (used) tparams.push({ kind: 'type', name });
  return { ...p, type: nt };
}

export { hasNontrivialDtor, markBuilt, prepareStorage, withCv, typeKey, targKey, mentionsParams, lookupUnqualified, isBaseOf, constOf };
