// Compiler-provided type traits (the __is_xxx(T) builtins that libstdc++'s <type_traits> is built on) and noexcept analysis.
import type { Interp } from './interp';
import type { Fn } from './env';
import type { ClassInfo, Type } from './types';
import { sameType, stripCv, stripRef } from './types';
import { getSig, hasNontrivialDtor, rankConv, defaultV } from './call';
import { isBaseOf } from './typeres';

type SpecialKind = 'default' | 'copy' | 'move' | 'copy-assign' | 'move-assign' | 'dtor';

function selfRefKind(I: Interp, f: Fn, c: ClassInfo): 'copy' | 'move' | null {
  const s = getSig(I, f);
  if (s.params.length < 1) return null;
  if (!s.defaults.slice(1).every((d) => d) && s.params.length > 1) return null;
  const p = s.params[0];
  if (p.k !== 'ref') return null;
  const b = stripCv(p.to);
  if (b.k !== 'cls' || b.c !== c) return null;
  return p.rv ? 'move' : 'copy';
}

/** the special member function overload resolution would pick for `kind` (null: none usable) */
export function specialMember(I: Interp, c: ClassInfo, kind: SpecialKind): Fn | null {
  I.completeClass(c);
  const x = c.x;
  const usable = (f: Fn) => !f.isDeleted;
  switch (kind) {
    case 'default':
      return (x.ctors as Fn[]).find((f) => usable(f) && (f.special === 'ctor0' || (!f.special && getSig(I, f).params.every((_, i) => getSig(I, f).defaults[i])))) ?? null;
    case 'copy': {
      const all = (x.ctors as Fn[]).filter((f) => selfRefKind(I, f, c) === 'copy');
      return all.find(usable) ?? null;
    }
    case 'move': {
      const mv = (x.ctors as Fn[]).find((f) => selfRefKind(I, f, c) === 'move');
      if (mv && usable(mv)) return mv;
      if (mv && !usable(mv)) return null;
      return specialMember(I, c, 'copy');
    }
    case 'copy-assign': return (x.assigns as Fn[]).find((f) => usable(f) && selfRefKind(I, f, c) === 'copy' || (usable(f) && f.special === 'cassign')) ?? (x.assigns as Fn[]).find((f) => usable(f) && getSig(I, f).params[0]?.k !== 'ref') ?? null;
    case 'move-assign': {
      const mv = (x.assigns as Fn[]).find((f) => selfRefKind(I, f, c) === 'move');
      if (mv && usable(mv)) return mv;
      if (mv) return null;
      return specialMember(I, c, 'copy-assign');
    }
    case 'dtor': return x.dtor ?? null;
  }
}

function elemOf(t: Type): Type { let u = stripCv(t); while (u.k === 'arr') u = stripCv(u.of); return u; }

/** is the (possibly implicit) function noexcept? */
export function fnIsNoexcept(I: Interp, f: Fn, kind: SpecialKind): boolean {
  if (f.native) return true;
  const d = f.decl;
  if (d && !(f.isDefaulted && !f.userProvided)) {
    const cond = (d as any).noexceptCond;
    if (cond) {
      try { const v = I.constEvalValue(cond, f.scope); return !!v.v; } catch { return false; }
    }
    if (d.noexcept) return true;
    return kind === 'dtor'; // destructors are noexcept unless declared otherwise
  }
  // implicit or defaulted: noexcept iff every subobject operation is
  const c = f.cls;
  if (!c) return true;
  if (kind === 'dtor') return true;
  const subs: Type[] = [...c.bases.map((b) => ({ k: 'cls', c: b.cls } as Type)), ...c.fields.filter((fl) => !fl.isStatic).map((fl) => fl.type)];
  if (c.declaresVirtual && kind === 'default') return true;
  return subs.every((t) => nothrowOp(I, t, kind));
}

function nothrowOp(I: Interp, t: Type, kind: SpecialKind): boolean {
  const u = elemOf(t);
  if (u.k === 'ref') return true;
  if (u.k !== 'cls') return true;
  const f = specialMember(I, u.c, kind);
  if (!f) return false;
  return fnIsNoexcept(I, f, kind);
}

export function isNothrow(I: Interp, t: Type, kind: SpecialKind): boolean { return nothrowOp(I, t, kind); }

function can(I: Interp, t: Type, kind: SpecialKind): boolean {
  const u = elemOf(t);
  if (u.k === 'ref') return kind === 'copy' || kind === 'move' || kind === 'copy-assign' || kind === 'move-assign' ? true : false;
  if (u.k === 'void') return false;
  if (u.k !== 'cls') return true;
  if (u.k === 'cls' && u.c.x.abstract && kind !== 'dtor') return false;
  return !!specialMember(I, u.c, kind);
}

const isScalarT = (t: Type) => ['int', 'bool', 'float', 'ptr', 'enum', 'nullptr'].includes(t.k);

export function evalTrait(I: Interp, name: string, ts: Type[]): boolean {
  const t0 = ts[0] ?? I.T.void;
  const u0 = stripCv(t0);
  const cls = u0.k === 'cls' ? u0.c : null;
  if (cls) I.completeClass(cls);
  switch (name) {
    case '__is_class': return !!cls && cls.tag !== 'union';
    case '__is_union': return !!cls && cls.tag === 'union';
    case '__is_enum': return u0.k === 'enum';
    case '__is_polymorphic': return !!cls && (cls.declaresVirtual || cls.bases.some((b) => evalTrait(I, '__is_polymorphic', [{ k: 'cls', c: b.cls } as Type])));
    case '__is_abstract': return !!cls && !!cls.x.abstract;
    case '__is_final': return !!cls && !!cls.x.decl?.final;
    case '__is_empty': return !!cls && cls.tag !== 'union' && !cls.declaresVirtual && cls.fields.filter((f) => !f.isStatic).length === 0 && cls.bases.every((b) => evalTrait(I, '__is_empty', [{ k: 'cls', c: b.cls } as Type]));
    case '__is_aggregate': return !!cls && !!cls.x.aggregate || u0.k === 'arr';
    case '__is_standard_layout': return !cls || (!cls.declaresVirtual && cls.bases.length === 0);
    case '__is_trivially_copyable': return !cls ? u0.k !== 'ref' : !!cls.x.trivialCopy && !cls.x.nontrivialDtor;
    case '__is_trivially_destructible': return !cls ? true : !hasNontrivialDtor(I, u0);
    case '__is_trivially_default_constructible': return !cls ? true : !!cls.x.trivialDefault;
    case '__is_trivial': return !cls ? true : !!cls.x.trivialDefault && !!cls.x.trivialCopy && !cls.x.nontrivialDtor;
    case '__is_pod': return !cls ? true : !!cls.x.trivialDefault && !!cls.x.trivialCopy && !cls.x.nontrivialDtor && !cls.declaresVirtual && cls.bases.length === 0;
    case '__is_copy_constructible': return can(I, t0, 'copy');
    case '__is_move_constructible': return can(I, t0, 'move');
    case '__is_default_constructible': return can(I, t0, 'default');
    case '__is_copy_assignable': return can(I, t0, 'copy-assign');
    case '__is_move_assignable': return can(I, t0, 'move-assign');
    case '__is_destructible': return u0.k === 'void' ? false : can(I, t0, 'dtor') || !cls;
    case '__is_nothrow_move_constructible': return can(I, t0, 'move') && nothrowOp(I, t0, 'move');
    case '__is_nothrow_copy_constructible': return can(I, t0, 'copy') && nothrowOp(I, t0, 'copy');
    case '__is_nothrow_default_constructible': return can(I, t0, 'default') && nothrowOp(I, t0, 'default');
    case '__is_nothrow_move_assignable': return can(I, t0, 'move-assign') && nothrowOp(I, t0, 'move-assign');
    case '__is_nothrow_copy_assignable': return can(I, t0, 'copy-assign') && nothrowOp(I, t0, 'copy-assign');
    case '__is_nothrow_destructible': return !cls || nothrowOp(I, t0, 'dtor');
    case '__is_base_of': {
      const d = stripCv(ts[1] ?? I.T.void);
      return !!cls && d.k === 'cls' && (d.c === cls || isBaseOf(cls, d.c));
    }
    case '__is_same': return sameType(ts[0], ts[1] ?? I.T.void, true);
    case '__is_convertible': {
      const from = ts[0], to = ts[1] ?? I.T.void;
      if (to.k === 'void') return from.k === 'void';
      if (from.k === 'void') return false;
      try {
        const v = defaultV(I, from);
        return rankConv(I, v, to) !== null;
      } catch { return false; }
    }
    case '__is_scalar': return isScalarT(u0);
    default: I.cerr(`unknown type trait '${name}'`);
  }
  void stripRef; void defaultV;
}
