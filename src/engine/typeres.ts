// Name lookup, type resolution and template-argument handling.
import type * as A from './ast';
import type { ClassTemplate, Ent, Fn, FuncTemplate, Scope, TArgVal } from './env';
import type { Interp } from './interp';
import { arrOf, clsType, constOf, isInt, ptrTo, refTo, sameType, stripCv, typeStr, type ClassInfo, type FieldInfo, type Type } from './types';
import { evalConstInt } from './expr';
import { instantiateClassTemplate } from './decls';

export const AUTO: Type = { k: 'void', auto: true } as any;
export const isAuto = (t: Type): boolean => !!(t as any).auto || (t.k === 'ptr' && isAuto(t.to)) || (t.k === 'ref' && isAuto(t.to)) || (t.k === 'arr' && isAuto(t.of));

// ---- type keys --------------------------------------------------------------------------------------------------
export function typeKey(t: Type): string {
  const cv = (t.const ? 'c' : '') + (t.volatile ? 'v' : '');
  switch (t.k) {
    case 'int': case 'float': return cv + t.nm;
    case 'cls': return cv + '#' + t.c.id;
    case 'enum': return cv + 'E' + t.e.name;
    case 'ptr': return cv + 'P(' + typeKey(t.to) + ')';
    case 'ref': return 'R' + (t.rv ? '&' : '') + '(' + typeKey(t.to) + ')';
    case 'arr': return cv + 'A' + (t.n ?? '') + '(' + typeKey(t.of) + ')';
    case 'fn': return 'F(' + typeKey(t.ret) + ';' + t.params.map(typeKey).join(',') + (t.variadic ? ',...' : '') + ')';
    default: return cv + t.k;
  }
}

export function targKey(a: TArgVal): string {
  switch (a.k) {
    case 'type': return typeKey(a.t);
    case 'val': return 'v' + a.v.toString();
    case 'pack': return '[' + a.items.map(targKey).join(',') + ']';
    case 'tmpl': return 'T:' + a.ent.name;
  }
}

// ---- class members ---------------------------------------------------------------------------------------------------
export interface MemberHit {
  ents: Ent[];
  field?: FieldInfo;
  owner: ClassInfo;
  /** byte offset of the owner subobject inside the object we searched in */
  baseOffset: number;
  viaVirtual?: boolean;
}

/** offset of base subobject `base` within the complete object of class `cls` (first match) */
export function baseOffsetOf(I: Interp, cls: ClassInfo, base: ClassInfo): number | null {
  if (cls === base) return 0;
  const L = I.layoutOf(cls);
  const direct = L.vbaseOffsets.get(base);
  if (direct !== undefined) return direct;
  for (const b of cls.bases) {
    if (b.virtual) {
      const vo = L.vbaseOffsets.get(b.cls);
      if (vo !== undefined) {
        if (b.cls === base) return vo;
        const inner = baseOffsetOf(I, b.cls, base);
        if (inner !== null) return vo + inner;
      }
      continue;
    }
    const inner = baseOffsetOf(I, b.cls, base);
    if (inner !== null) return (b.offset ?? 0) + inner;
  }
  // virtual bases of bases are laid out at the complete-object level
  for (const [vb, off] of L.vbaseOffsets) {
    if (vb === base) return off;
    const inner = baseOffsetOf(I, vb, base);
    if (inner !== null) return off + inner;
  }
  return null;
}

export function isBaseOf(base: ClassInfo, derived: ClassInfo): boolean {
  if (base === derived) return true;
  return derived.bases.some((b) => isBaseOf(base, b.cls));
}

function findAnon(ac: ClassInfo, name: string, off: number): { field: FieldInfo; off: number } | null {
  const fld = ac.x.fieldMap?.get(name) as FieldInfo | undefined;
  if (fld) return { field: fld, off };
  for (const af of ac.fields) {
    if (!af.anonymous || af.type.k !== 'cls') continue;
    const r = findAnon(af.type.c, name, off + (af.offset ?? 0));
    if (r) return r;
  }
  return null;
}

export function findMember(I: Interp, cls: ClassInfo, name: string): MemberHit | null {
  const seen = new Set<ClassInfo>();
  const hits: MemberHit[] = [];
  const visit = (c: ClassInfo, off: number): boolean => {
    I.completeClass(c);
    const x = c.x;
    const fld = x.fieldMap?.get(name) as FieldInfo | undefined;
    if (fld) { hits.push({ ents: [], field: fld, owner: c, baseOffset: off }); return true; }
    // members of anonymous unions / structs are members of the enclosing class
    for (const af of c.fields) {
      if (!af.anonymous || af.type.k !== 'cls') continue;
      if (!c.layout && !c.x.completing) I.layoutOf(c);
      const inner = findAnon(af.type.c, name, off + (af.offset ?? 0));
      if (inner) { hits.push({ ents: [], field: inner.field, owner: c, baseOffset: inner.off }); return true; }
    }
    const ents = x.scope?.names.get(name);
    if (ents && ents.length) { hits.push({ ents, owner: c, baseOffset: off }); return true; }
    let found = false;
    for (const b of c.bases) {
      if (seen.has(b.cls) && b.virtual) continue;
      if (b.virtual) seen.add(b.cls);
      let bo: number;
      if (b.virtual) bo = baseOffsetOf(I, cls, b.cls) ?? 0;
      else { if (!c.layout && !c.x.completing) I.layoutOf(c); bo = off + (b.offset ?? 0); }
      if (visit(b.cls, bo)) found = true;
    }
    return found;
  };
  visit(cls, 0);
  if (hits.length === 0) return null;
  if (hits.length > 1) {
    // same member through several paths of one shared base is fine; different bases are ambiguous
    const owners = new Set(hits.map((h) => h.owner));
    if (owners.size > 1) I.cerr(`request for member '${name}' is ambiguous`);
    const first = hits[0];
    if (!first.field && first.ents.some((e) => e.k === 'var' || e.k === 'fns')) {
      // non-virtual duplicated base: ambiguous only for non-static entities; keep the first
    }
    return first;
  }
  return hits[0];
}

// ---- unqualified / qualified lookup --------------------------------------------------------------------------------------
export interface LookupResult { ents: Ent[]; hit?: MemberHit; scope: Scope }

export function lookupUnqualified(I: Interp, name: string, scope: Scope): LookupResult | null {
  for (let s: Scope | null = scope; s; s = s.parent) {
    if (s.cls && s.kind === 'class') {
      const hit = findMember(I, s.cls, name);
      if (hit) return { ents: hit.ents, hit, scope: s };
    }
    const local = s.names.get(name);
    if (local && local.length) {
      // functions found in several using-directives merge below; stop at first scope with a match
      return { ents: mergeFns(local, s, name), scope: s };
    }
    const viaUsing = lookupUsings(I, name, s, new Set());
    if (viaUsing) return { ents: viaUsing, scope: s };
  }
  return null;
}

function mergeFns(local: Ent[], s: Scope, name: string): Ent[] {
  // overloads can be spread over using-directives of the same scope
  if (local.length && local[0].k === 'fns') {
    const merged: Ent = { k: 'fns', name, fns: [...(local[0] as any).fns], ftempls: [...(local[0] as any).ftempls] };
    for (const u of s.usings) {
      const ents = u.names.get(name);
      if (ents) for (const e of ents) if (e.k === 'fns') { merged.fns.push(...e.fns); merged.ftempls.push(...e.ftempls); }
    }
    return [merged, ...local.slice(1)];
  }
  return local;
}

function lookupUsings(I: Interp, name: string, s: Scope, seen: Set<Scope>): Ent[] | null {
  let found: Ent[] | null = null;
  for (const u of s.usings) {
    if (seen.has(u)) continue;
    seen.add(u);
    const e = u.names.get(name);
    if (e && e.length) { found = found ? [...found, ...e] : [...e]; continue; }
    const deeper = lookupUsings(I, name, u, seen);
    if (deeper) found = found ? [...found, ...deeper] : deeper;
  }
  if (found && found.length > 1 && found.every((x) => x.k === 'fns')) {
    const m: Ent = { k: 'fns', name, fns: [], ftempls: [] };
    for (const f of found) if (f.k === 'fns') { m.fns.push(...f.fns); m.ftempls.push(...f.ftempls); }
    return [m];
  }
  return found;
}

/** look a name up inside a namespace or class (qualified lookup) */
export function lookupIn(I: Interp, owner: Ent, name: string): LookupResult | null {
  if (owner.k === 'ns') {
    const s = owner.scope;
    const e = s.names.get(name);
    if (e && e.length) return { ents: e, scope: s };
    const u = lookupUsings(I, name, s, new Set());
    if (u) return { ents: u, scope: s };
    // inline namespaces (e.g. std::__cxx11) are modelled via usings
    return null;
  }
  if (owner.k === 'type' && owner.type.k === 'cls') {
    const hit = findMember(I, owner.type.c, name);
    if (hit) return { ents: hit.ents, hit, scope: owner.type.c.x.scope };
    return null;
  }
  if (owner.k === 'type' && owner.type.k === 'enum') {
    const e = owner.type.e;
    const v = e.values.get(name);
    if (v !== undefined) return { ents: [{ k: 'enumc', type: owner.type, value: v }], scope: I.global };
  }
  return null;
}

export function lookupQName(I: Interp, q: A.QName, scope: Scope, opts: { needType?: boolean; noTargs?: boolean } = {}): LookupResult | null {
  let cur: LookupResult | null = null;
  let owner: Ent | null = null;
  for (let i = 0; i < q.parts.length; i++) {
    const part = q.parts[i];
    let res: LookupResult | null;
    if (i === 0) {
      if (q.global) res = lookupIn(I, { k: 'ns', scope: I.global }, part.id);
      else res = lookupUnqualified(I, part.id, scope);
    } else {
      if (!owner) return null;
      res = lookupIn(I, owner, part.id);
    }
    if (!res) {
      if (i < q.parts.length - 1 || true) return null;
    }
    // template-id on a class template -> instantiate
    let ents = res.ents;
    if (part.targs && !opts.noTargs) {
      const ct = ents.find((e) => e.k === 'ctempl');
      if (ct && ct.k === 'ctempl') {
        const args = evalTArgs(I, part.targs, scope);
        const inst = instantiateClassTemplate(I, ct.t, args, scope);
        ents = [{ k: 'type', type: inst }];
        res = { ...res, ents };
      }
    }
    cur = res;
    if (i < q.parts.length - 1) {
      // the next lookup happens inside what we found
      const pick = ents.find((e) => e.k === 'ns' || e.k === 'type') ?? ents.find((e) => e.k === 'ctempl');
      if (!pick) return null;
      if (pick.k === 'ctempl') {
        // injected-class-name of a template used as qualifier without args: use primary instance if exactly default-constructible
        I.cerr(`'${part.id}' is a template: template arguments are required before '::'`);
      }
      let o = pick;
      if (o.k === 'type' && o.type.k !== 'cls' && o.type.k !== 'enum') {
        o = { k: 'type', type: o.type };
      }
      owner = o;
    }
  }
  return cur;
}

// ---- template arguments -------------------------------------------------------------------------------------------------------
export function evalTArgs(I: Interp, targs: A.TArg[], scope: Scope): TArgVal[] {
  const out: TArgVal[] = [];
  for (const a0 of targs) {
    const a: A.TArg = a0.k === 'type' && a0.t.k === 'pack' ? { k: 'pack', t: a0.t.of } : a0;
    if (a.k === 'pack') {
      // a pattern that merely contains a pack (T&..., const T&..., typename X<T>::type...) is expanded once per element
      const names = packNamesIn(I, a.t, scope);
      if (names.length === 1 && isBarePackType(a.t) && I.packIdx.get(names[0]) === undefined) {
        const bare = lookupUnqualified(I, names[0], scope)!.ents.find((e) => e.k === 'pack');
        if (bare && bare.k === 'pack') { out.push(...bare.items); continue; }
      }
      if (names.length && !isBarePackType(a.t)) {
        const lens = names.map((n) => { const ent = lookupUnqualified(I, n, scope)!.ents.find((e) => e.k === 'pack'); return ent && ent.k === 'pack' ? ent.items.length : 0; });
        const saved = new Map(I.packIdx);
        try {
          for (let i = 0; i < lens[0]; i++) {
            for (const nm of names) I.packIdx.set(nm, i);
            out.push({ k: 'type', t: resolveTypeExpr(I, a.t, scope) });
          }
        } finally { I.packIdx = saved; }
        continue;
      }
      const t = resolveTypeExpr(I, a.t, scope);
      if (t.k === 'void' && (t as any).pack) out.push(...((t as any).pack as TArgVal[])); else out.push({ k: 'type', t });
      continue;
    }
    if (a.k === 'type') {
      // a type-id that is really a value (e.g. an enumerator or constant name) is retried as an expression
      const t = tryResolveType(I, a.t, scope);
      if (t) {
        const maybePack = (t as any).packItems as TArgVal[] | undefined;
        if (maybePack) out.push(...maybePack); else out.push({ k: 'type', t });
        continue;
      }
      const e = typeExprAsExpr(a.t);
      if (e) { const { v, t: vt } = evalConstValue(I, e, scope); out.push({ k: 'val', v, t: vt }); continue; }
      I.cerr('invalid template argument');
    } else {
      // an expression may name a class template (template template parameter) or a pack
      const { v, t } = evalConstValue(I, a.e, scope);
      out.push({ k: 'val', v, t });
    }
  }
  return out;
}

function typeExprAsExpr(te: A.TypeExpr): A.Expr | null {
  if (te.k === 'base' && te.spec.base.k === 'name') return { k: 'id', q: te.spec.base.q, pos: te.spec.pos };
  return null;
}

export function evalConstValue(I: Interp, e: A.Expr, scope: Scope): { v: bigint; t: Type } {
  const r = evalConstInt(I, e, scope);
  return r;
}

// ---- builtin type words ---------------------------------------------------------------------------------------------------------
export function builtinFromWords(I: Interp, names: string[]): Type {
  const T = I.T;
  const count = (w: string) => names.filter((x) => x === w).length;
  const uns = count('unsigned') > 0;
  const sgn = count('signed') > 0;
  if (count('void')) return T.void;
  if (count('bool')) return T.bool;
  if (count('wchar_t')) return T.wchar;
  if (count('char16_t')) return T.char16;
  if (count('char32_t')) return T.char32;
  if (count('char')) return uns ? T.uchar : sgn ? T.schar : T.char;
  if (count('float')) return T.float;
  if (count('double')) return count('long') ? T.ldouble : T.double;
  if (count('short')) return uns ? T.ushort : T.short;
  if (count('__int64')) return uns ? T.ullong : T.llong;
  const longs = count('long');
  if (longs >= 2) return uns ? T.ullong : T.llong;
  if (longs === 1) return uns ? T.ulong : T.long;
  return uns ? T.uint : T.int;
}

// ---- type resolution ------------------------------------------------------------------------------------------------------------------
export function tryResolveType(I: Interp, te: A.TypeExpr, scope: Scope): Type | null {
  try { return resolveTypeExpr(I, te, scope); } catch (e: any) {
    if (e && e.name === 'CompileError' && /does not name a type|undeclared|not declared/.test(e.message)) return null;
    throw e;
  }
}

export function resolveSpec(I: Interp, spec: A.TSpec, scope: Scope): Type {
  let t: Type;
  const b = spec.base;
  switch (b.k) {
    case 'builtin': t = builtinFromWords(I, b.names); break;
    case 'auto': t = AUTO; break;
    case 'decltype': t = I.typeOfExprForDecltype(b.e, scope); break;
    case 'anon-class': t = clsType(I.defineClassDecl(b.cls, scope)); break;
    case 'elab': case 'name': {
      const q = b.q;
      const r = lookupQName(I, q, scope);
      if (!r) {
        const n = q.parts.map((p) => p.id).join('::');
        I.cerr(`'${n}' does not name a type (it was not declared in this scope)`, spec.pos);
      }
      const packEnt = r.ents.find((e) => e.k === 'pack');
      if (packEnt && packEnt.k === 'pack' && q.parts.length === 1) {
        // a type pack element, selected by the expansion currently being evaluated
        const idx = I.packIdx.get(q.parts[0].id);
        const item = idx === undefined ? undefined : packEnt.items[idx];
        if (item && item.k === 'type') { t = item.t; break; }
      }
      const ent = r.ents.find((e) => e.k === 'type') ?? r.ents.find((e) => e.k === 'ctempl') ?? r.ents.find((e) => e.k === 'tval' || e.k === 'enumc');
      if (!ent) { I.cerr(`'${q.parts.map((p) => p.id).join('::')}' does not name a type`, spec.pos); }
      if (ent.k === 'type') t = ent.type;
      else if (ent.k === 'ctempl') {
        // class template without arguments: injected-class-name inside the template itself, or class-template argument deduction
        const last = q.parts[q.parts.length - 1];
        if (last.targs) t = instantiateClassTemplate(I, ent.t, evalTArgs(I, last.targs, scope), scope);
        else {
          const injected = I.injectedClassName(ent.t, scope);
          if (injected) t = clsType(injected);
          else (t = { k: 'void', ctad: ent.t } as any);
        }
      } else I.cerr(`'${q.parts.map((p) => p.id).join('::')}' does not name a type`, spec.pos);
      break;
    }
  }
  if (spec.const || spec.volatile) t = { ...t, ...(spec.const ? { const: true } : {}), ...(spec.volatile ? { volatile: true } : {}) } as Type;
  return t;
}

export function resolveTypeExpr(I: Interp, te: A.TypeExpr, scope: Scope): Type {
  switch (te.k) {
    case 'base': return resolveSpec(I, te.spec, scope);
    case 'ptr': {
      const to = resolveTypeExpr(I, te.to, scope);
      const p = ptrTo(to);
      return te.const || te.volatile ? ({ ...p, ...(te.const ? { const: true } : {}), ...(te.volatile ? { volatile: true } : {}) } as Type) : p;
    }
    case 'ref': {
      let to = resolveTypeExpr(I, te.to, scope);
      // reference collapsing
      if (to.k === 'ref') { const rv = te.rv && to.rv; return refTo(to.to, rv); }
      return refTo(to, te.rv);
    }
    case 'arr': {
      const of = resolveTypeExpr(I, te.of, scope);
      let n: number | null = null;
      if (te.n) {
        const r = evalConstInt(I, te.n, scope);
        if (r.v < 0n) I.cerr('size of array is negative');
        n = Number(r.v);
      }
      return arrOf(of, n);
    }
    case 'fn': {
      const ret = resolveTypeExpr(I, te.ret, scope);
      const params = te.params.map((p) => adjustParam(resolveTypeExpr(I, p.type, scope)));
      return { k: 'fn', ret, params, variadic: te.variadic };
    }
    case 'memptr': I.cerr('pointers to members are not supported by this simulator');
    case 'pack': {
      // pack expansion in a type context: only valid via explicit handling of parameter packs
      I.cerr('parameter pack used outside of a template parameter pack expansion');
    }
  }
}

/** function parameter adjustments: arrays decay to pointers, top-level cv dropped */
export function adjustParam(t: Type): Type {
  if (t.k === 'arr') return ptrTo(t.of);
  if (t.k === 'fn') return ptrTo(t);
  return t;
}

export function isSameClassOrDerived(a: ClassInfo, b: ClassInfo) { return isBaseOf(a, b); }

export { sameType, stripCv, typeStr, constOf, isInt };
export type { Fn, FuncTemplate, ClassTemplate };


/** names of template parameter packs mentioned anywhere in a type expression */
function packNamesIn(I: Interp, te: unknown, scope: Scope, out: Set<string> = new Set()): string[] {
  const walk = (o: unknown) => {
    if (!o || typeof o !== 'object') return;
    if (Array.isArray(o)) { o.forEach(walk); return; }
    const r = o as Record<string, unknown>;
    if (typeof r.id === 'string') {
      const lk = lookupUnqualified(I, r.id, scope);
      if (lk && lk.ents.some((e) => e.k === 'pack')) out.add(r.id);
    }
    for (const k of Object.keys(r)) if (k !== 'pos') walk(r[k]);
  };
  walk(te);
  return [...out];
}

/** `T...` where the pattern is just the pack's own name, possibly with a cv-qualifier: handled by the original code path */
function isBarePackType(te: A.TypeExpr): boolean {
  if (te.k !== 'base') return false;
  const b = te.spec.base;
  return b.k === 'name' && b.q.parts.length === 1 && !b.q.parts[0].targs;
}
