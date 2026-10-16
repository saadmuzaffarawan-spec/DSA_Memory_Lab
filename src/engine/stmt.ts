// Statement execution, function bodies (including constructors / destructors) and exception handling.
import type * as A from './ast';
import { Fault } from './memory';
import { S } from './trace';
import type { Interp } from './interp';
import type { Fn, Frame, Scope, Sig, V } from './env';
import { CxxThrow, newScope } from './env';
import { arrOf, clsType, constOf, ptrTo, refTo, sameType, stripCv, typeStr, withCv, type ClassInfo, type FieldInfo, type Type } from './types';
import { alignOf, sizeOf } from './layout';
import { baseOffsetOf, isAuto, isBaseOf, lookupQName, lookupUnqualified, resolveTypeExpr, tryResolveType } from './typeres';
import { binaryValues, condValue, evalExpr, evalExprInto, lvalueOf, thisFor, typeOfExpr, unevaluated, indexValue, collectBindingFields, fieldLv, evalArgs } from './expr';
import {
  bindRef, callOperator, callFnValue, construct, convertTo, destroyObj, ensureRet, getSig, hasNontrivialDtor, initFromBraces, initFromExpr, markBuilt, newTempObj,
  prepareStorage, makeInitializerList, releaseTemps, tempMark, upcastAddr, valueInit, initFieldDefault, initFieldFromValue, isDerivedPtrConv, adoptTemp,
} from './call';
import { completeArrayType, declare, declaredType, getVtabs, initDeclared, checkStaticAssert } from './decls';

type Completion = undefined | 'break' | 'continue' | 'return' | { goto: string };
const BREAK: Completion = 'break';
const CONTINUE: Completion = 'continue';
const RETURN: Completion = 'return';

// =====================================================================================================================
// function bodies
// =====================================================================================================================
export function execBody(I: Interp, fn: Fn, frame: Frame, retAddr: number | undefined): V {
  const mostDerived = I.ctorMostDerived;
  I.ctorMostDerived = true;
  if (fn.isCtor) { execCtor(I, fn, frame, mostDerived); return I.voidV(); }
  if (fn.isDtor) { execDtor(I, fn, frame, mostDerived); return I.voidV(); }
  if (fn.special) { execSpecialAssign(I, fn, frame); return I.retVal ?? I.voidV(); }
  const body = fn.decl!.body!;
  const sig = fn.sig!;
  I.retVal = null;
  frame.nrvo = null;
  if (retAddr !== undefined && sig.ret.k === 'cls' && !(I.plat.debug && I.plat.id === 'windows')) frame.nrvo = nrvoCandidate(fn, body, sig.ret);
  frame.nrvoAddr = retAddr ?? 0;
  const c = execStmt(I, body);
  void c;
  if (sig.ret.k === 'void') return I.voidV();
  if (I.retVal === null) {
    if (fn.name === 'main' && !fn.cls) return I.mkInt(I.T.int, 0n);
    I.diag('ub-other', 'warn', 'Control reaches the end of a non-void function', `'${fn.qual}' has no return statement on this path. Using its return value is undefined behaviour.`);
    if (sig.ret.k === 'cls') return { k: 'l', t: sig.ret, a: retAddr!, tmp: true };
    return sig.ret.k === 'float' ? I.mkFloat(sig.ret, 0) : sig.ret.k === 'ref' ? { k: 'l', t: sig.ret.to, a: 0 } : sig.ret.k === 'ptr' ? { k: 'i', t: sig.ret, v: 0n } : I.mkInt(sig.ret, 0n);
  }
  const r = I.retVal;
  I.retVal = null;
  return r;
}

/** a local variable that every `return` statement returns by name (eligible for NRVO) */
function nrvoCandidate(fn: Fn, body: A.Stmt, ret: Type): string | null {
  if (fn.nrvoVar !== undefined) return fn.nrvoVar;
  const names = new Set<string>();
  let ok = true;
  let count = 0;
  const decls = new Map<string, A.VarDecl>();
  const walk = (s: A.Stmt | undefined) => {
    if (!s || !ok) return;
    switch (s.k) {
      case 'block': s.body.forEach(walk); break;
      case 'var': for (const d of s.decls) decls.set(d.name, s); break;
      case 'return':
        count++;
        if (s.e && s.e.k === 'id' && s.e.q.parts.length === 1) names.add(s.e.q.parts[0].id); else ok = false;
        break;
      case 'if': walk(s.then); walk(s.else); break;
      case 'while': case 'do': walk(s.body); break;
      case 'for': walk(s.init); walk(s.body); break;
      case 'rfor': walk(s.body); break;
      case 'switch': walk(s.body); break;
      case 'try': walk(s.body); s.catches.forEach((c) => walk(c.body)); break;
      case 'label': walk(s.stmt); break;
      default: break;
    }
  };
  walk(body);
  void ret;
  if (!ok || names.size !== 1 || count === 0) { fn.nrvoVar = null; return null; }
  const nm = [...names][0];
  const d = decls.get(nm);
  // must be a local (not a parameter) of the same class type
  fn.nrvoVar = d && !d.decls.find((x) => x.name === nm)?.type ? null : d ? nm : null;
  return fn.nrvoVar;
}

// ---- return type deduction ---------------------------------------------------------------------------------------
export function inferReturnType(I: Interp, fn: Fn, sig: Sig): Type {
  const body = fn.decl!.body!;
  const saved = I.scope;
  const savedFrames = I.frames.length;
  const hidden = newScope('func', fn.scope, fn.qual);
  hidden.fn = fn;
  sig.params.forEach((t, i) => { const nm = sig.paramNames[i]; if (nm) hidden.names.set(nm, [{ k: 'var', name: nm, type: t, addr: 0 }]); });
  I.scope = hidden;
  I.uneval++;
  const fake: Frame = { ...I.frame, fn, thisV: fn.cls ? ({ k: 'l', t: clsType(fn.cls), a: 0 } as V) : null } as Frame;
  I.frames.push(fake);
  try {
    let found: Type | null = null;
    const walk = (s: A.Stmt | undefined) => {
      if (!s || found) return;
      try {
        switch (s.k) {
          case 'block': {
            const sc = newScope('block', I.scope);
            const prev = I.scope;
            I.scope = sc;
            try { s.body.forEach(walk); } finally { I.scope = prev; }
            break;
          }
          case 'var':
            if (s.storage === 'extern') break;
            for (const d of s.decls) {
              try {
                const t = declaredType(I, d, I.scope);
                I.scope.names.set(d.name, [{ k: 'var', name: d.name, type: t, addr: 0 }]);
              } catch (e: any) { if (e.name !== 'CompileError') throw e; }
            }
            break;
          case 'return': {
            if (!s.e) { found = I.T.void; break; }
            const v = typeOfExpr(I, s.e, I.scope);
            let t: Type;
            if (v.k === 'l') t = v.t; else if (v.k === 'i' || v.k === 'f') t = v.t; else t = I.T.int;
            if (t.k === 'arr') t = ptrTo(t.of); else if (t.k === 'fn') t = ptrTo(t);
            found = stripCv(t.k === 'ref' ? t.to : t);
            break;
          }
          case 'if': walk(s.init); walk(s.then); walk(s.else); break;
          case 'while': case 'do': walk(s.body); break;
          case 'for': walk(s.init); walk(s.body); break;
          case 'rfor': walk(s.body); break;
          case 'switch': walk(s.body); break;
          case 'try': walk(s.body); s.catches.forEach((c) => walk(c.body)); break;
          case 'label': walk(s.stmt); break;
          default: break;
        }
      } catch (e: any) { if (e.name !== 'CompileError') throw e; }
    };
    walk(body);
    return found ?? I.T.void;
  } finally {
    I.uneval--;
    I.frames.length = savedFrames;
    I.scope = saved;
  }
}

// =====================================================================================================================
// constructors and destructors
// =====================================================================================================================
function setVptrs(I: Interp, c: ClassInfo, addr: number, mostDerived: boolean) {
  const tabs = getVtabs(I, c);
  for (const v of tabs) {
    if (v.viaVbase && !mostDerived) continue;
    const b = new Uint8Array(8);
    new DataView(b.buffer).setBigUint64(0, BigInt(v.addr), true);
    I.mem.writeRaw(addr + v.vptrAt, b, S.Init);
  }
}

function resolveInitName(I: Interp, c: ClassInfo, q: A.QName): { field?: FieldInfo; base?: ClassInfo } {
  if (q.parts.length === 1) {
    const f = c.x.fieldMap.get(q.parts[0].id) as FieldInfo | undefined;
    if (f) return { field: f };
  }
  const r = lookupQName(I, q, I.scope);
  const te = r?.ents.find((e) => e.k === 'type');
  if (te && te.k === 'type' && te.type.k === 'cls') return { base: te.type.c };
  const ct = r?.ents.find((e) => e.k === 'ctempl');
  if (ct && ct.k === 'ctempl') {
    // injected class name of a base template
    for (const b of c.bases) if (b.cls.x.tmplOrigin === ct.t) return { base: b.cls };
  }
  // member of an anonymous union
  for (const f of c.fields) {
    if (f.anonymous && f.type.k === 'cls') {
      const inner = f.type.c.x.fieldMap.get(q.parts[0].id);
      if (inner) return { field: { ...inner, offset: (f.offset ?? 0) + (inner.offset ?? 0) } as FieldInfo };
    }
  }
  I.cerr(`'${q.parts.map((p) => p.id).join('::')}' is not a field or base class of '${c.name}'`, q.pos);
}

function execCtor(I: Interp, fn: Fn, frame: Frame, mostDerived: boolean) {
  const c = fn.cls!;
  const self = frame.thisV as Extract<V, { k: 'l' }>;
  const addr = self.a;
  const d = fn.decl;
  const inits = d?.ctorInit ?? [];
  const L = I.layoutOf(c);
  const T = clsType(c);
  I.mem.setState(addr, sizeOf(T), S.Uninit);
  for (const [off, len] of L.padding) I.mem.setState(addr + off, len, S.Pad);
  // implicit special constructors
  if (fn.special) { execSpecialCtor(I, fn, c, addr, mostDerived); return; }
  // delegating constructor
  if (inits.length === 1) {
    const r = tryDelegate(I, c, inits[0]);
    if (r) {
      const args = inits[0].brace && inits[0].args.length === 0 ? [] : evalArgs(I, inits[0].args);
      construct(I, T, addr, args, 'direct', mostDerived);
      if (d?.body) { execStmt(I, d.body); }
      return;
    }
  }
  const byField = new Map<FieldInfo, { args: A.Expr[]; brace: boolean }>();
  const byBase = new Map<ClassInfo, { args: A.Expr[]; brace: boolean }>();
  for (const it of inits) {
    const r = resolveInitName(I, c, it.name);
    if (r.field) byField.set(r.field, { args: it.args, brace: it.brace });
    else if (r.base) {
      if (!(c.bases.some((b) => b.cls === r.base) || L.vbaseOffsets.has(r.base))) I.cerr(`type '${r.base.name}' is not a direct or virtual base of '${c.name}'`, it.name.pos);
      byBase.set(r.base, { args: it.args, brace: it.brace });
    }
  }
  const constructBase = (bc: ClassInfo, at: number, md: boolean) => {
    const ini = byBase.get(bc);
    if (ini) {
      if (ini.brace) initFromBraces(I, clsType(bc), at, { k: 'init', items: ini.args, pos: d!.pos });
      else construct(I, clsType(bc), at, evalArgs(I, ini.args), 'direct', md);
    } else construct(I, clsType(bc), at, [], 'default', md);
  };
  // virtual bases first (most derived object only)
  if (mostDerived) {
    for (const [vb, off] of L.vbaseOffsets) constructBase(vb, addr + off, true);
  }
  for (const b of c.bases) {
    if (b.virtual) continue;
    constructBase(b.cls, addr + (b.offset ?? 0), false);
  }
  setVptrs(I, c, addr, mostDerived);
  for (const f of c.fields) {
    if (f.isStatic) continue;
    if (f.anonymous) continue;
    const ini = byField.get(f);
    const at = addr + (f.offset ?? 0);
    if (ini) {
      const ft = f.type;
      const mark = tempMark(I);
      try {
        if (ini.brace) {
          if (ft.k === 'cls' || ft.k === 'arr') initFromBraces(I, ft, at, { k: 'init', items: ini.args, pos: d!.pos });
          else if (ini.args.length === 0) valueInit(I, ft, at);
          else initFieldFromValue(I, f, addr, evalExpr(I, ini.args[0]));
        } else if (ft.k === 'cls') {
          construct(I, ft, at, evalArgs(I, ini.args), 'direct');
        } else if (ft.k === 'ref') {
          if (ini.args.length !== 1) I.cerr(`reference member '${f.name}' needs exactly one initialiser`);
          initFromExpr(I, ft, at, ini.args[0]);
        } else if (ft.k === 'arr') {
          construct(I, ft, at, [], 'value');
        } else {
          const vals = ini.args.some((x) => x.k === 'expand') ? evalArgs(I, ini.args) : null; // `member(args...)` with a pack
          const n = vals ? vals.length : ini.args.length;
          if (n === 0) valueInit(I, ft, at);
          else if (n === 1) initFieldFromValue(I, f, addr, vals ? vals[0] : evalExpr(I, ini.args[0]));
          else I.cerr(`too many initialisers for member '${f.name}'`);
        }
      } finally { releaseTemps(I, mark); }
    } else {
      const mark = tempMark(I);
      try { initFieldDefault(I, f, addr, c, false); } finally { releaseTemps(I, mark); }
    }
  }
  // anonymous unions / structs: members that were initialised in the list
  for (const f of c.fields) {
    if (f.anonymous && f.type.k === 'cls') {
      construct(I, f.type, addr + (f.offset ?? 0), [], 'default', false);
    }
  }
  if (d?.body) execStmt(I, d.body);
}

function tryDelegate(I: Interp, c: ClassInfo, init: { name: A.QName; args: A.Expr[]; brace: boolean }): boolean {
  if (init.name.parts.length !== 1) return false;
  const id = init.name.parts[0].id;
  const short = c.name.replace(/<.*$/, '').split('::').pop();
  if (id !== short) return false;
  if (c.x.fieldMap.has(id)) return false;
  return true;
}

function execSpecialCtor(I: Interp, fn: Fn, c: ClassInfo, addr: number, mostDerived: boolean) {
  const L = I.layoutOf(c);
  const fields = c.fields.filter((f) => !f.isStatic && !f.anonymous);
  const kind = fn.special!;
  let src: Extract<V, { k: 'l' }> | null = null;
  if (kind === 'copy' || kind === 'move') {
    const o = lookupUnqualified(I, 'other', I.scope);
    const ent = o?.ents[0];
    if (!ent || ent.k !== 'var') I.cerr('internal: missing source of implicit copy');
    src = I.load(ent.type, ent.addr) as Extract<V, { k: 'l' }>;
    if (src.k !== 'l') I.cerr('internal: bad copy source');
  }
  const srcOf = (off: number, t: Type): V => ({ k: 'l', t, a: src!.a + off, xv: kind === 'move' });
  if (mostDerived) for (const [vb, off] of L.vbaseOffsets) {
    construct(I, clsType(vb), addr + off, kind === 'ctor0' ? [] : [srcOf(off, clsType(vb))], kind === 'ctor0' ? 'default' : 'direct', true);
  }
  for (const b of c.bases) {
    if (b.virtual) continue;
    const off = b.offset ?? 0;
    construct(I, clsType(b.cls), addr + off, kind === 'ctor0' ? [] : [srcOf(off, clsType(b.cls))], kind === 'ctor0' ? 'default' : 'direct', false);
  }
  setVptrs(I, c, addr, mostDerived);
  for (const f of fields) {
    const off = f.offset ?? 0;
    const ft = f.type;
    if (kind === 'ctor0') { initFieldDefault(I, f, addr, c, false); continue; }
    copyMember(I, ft, addr + off, src!.a + off, kind === 'move', f);
  }
  for (const f of c.fields) {
    if (f.anonymous && f.type.k === 'cls') {
      const off = f.offset ?? 0;
      if (kind === 'ctor0') construct(I, f.type, addr + off, [], 'default', false);
      else I.mem.copy(addr + off, src!.a + off, sizeOf(f.type), false);
    }
  }
}

function copyMember(I: Interp, ft: Type, dst: number, srcAddr: number, move: boolean, f?: FieldInfo) {
  if (f && f.bits !== undefined && f.bits > 0) {
    // bit-fields share storage units: copy the unit and keep neighbours
    const unit = f.bitUnit ?? sizeOf(ft);
    const raw = I.mem.loadInt(srcAddr, unit, false, 'bit-field');
    const mask = ((1n << BigInt(f.bits)) - 1n) << BigInt(f.bitOffset ?? 0);
    const cur = I.mem.loadInt(dst, unit, false, 'bit-field');
    I.mem.storeInt(dst, unit, (cur & ~mask) | (raw & mask), 'bit-field');
    return;
  }
  if (ft.k === 'cls') { construct(I, ft, dst, [{ k: 'l', t: ft, a: srcAddr, xv: move }], 'direct', false); return; }
  if (ft.k === 'arr') {
    const es = sizeOf(ft.of);
    for (let i = 0; i < (ft.n ?? 0); i++) copyMember(I, ft.of, dst + i * es, srcAddr + i * es, move);
    return;
  }
  I.mem.copy(dst, srcAddr, sizeOf(ft.k === 'ref' ? ptrTo(ft.to) : ft), false);
}

function assignMember(I: Interp, ft: Type, dst: number, srcAddr: number, move: boolean) {
  if (ft.k === 'cls') {
    const lhs: V = { k: 'l', t: ft, a: dst };
    const rhs: V = { k: 'l', t: ft, a: srcAddr, xv: move };
    const r = callOperator(I, 'operator=', [lhs, rhs], undefined, true);
    if (!r) I.cerr(`no assignment operator for member of type '${ft.c.name}'`);
    return;
  }
  if (ft.k === 'arr') {
    const es = sizeOf(ft.of);
    for (let i = 0; i < (ft.n ?? 0); i++) assignMember(I, ft.of, dst + i * es, srcAddr + i * es, move);
    return;
  }
  I.mem.copy(dst, srcAddr, sizeOf(ft), false);
}

function execSpecialAssign(I: Interp, fn: Fn, frame: Frame) {
  const c = fn.cls!;
  const self = frame.thisV as Extract<V, { k: 'l' }>;
  const o = lookupUnqualified(I, 'other', I.scope);
  const ent = o?.ents[0];
  if (!ent || ent.k !== 'var') I.cerr('internal: missing source of implicit assignment');
  const src = I.load(ent.type, ent.addr) as Extract<V, { k: 'l' }>;
  const move = fn.special === 'massign';
  if (src.a === self.a) { I.retVal = { k: 'l', t: self.t, a: self.a }; return; }
  for (const b of c.bases) {
    const off = b.offset ?? 0;
    assignMember(I, clsType(b.cls), self.a + off, src.a + off, move);
  }
  for (const f of c.fields) {
    if (f.isStatic) continue;
    const off = f.offset ?? 0;
    if (f.bits !== undefined && f.bits > 0) { copyMember(I, f.type, self.a + off, src.a + off, move, f); continue; }
    if (f.type.k === 'ref') I.cerr(`cannot assign: '${c.name}' has a reference member '${f.name}'`);
    assignMember(I, f.type, self.a + off, src.a + off, move);
  }
  I.retVal = { k: 'l', t: stripCv(self.t), a: self.a };
}

function execDtor(I: Interp, fn: Fn, frame: Frame, mostDerived: boolean) {
  const c = fn.cls!;
  const self = frame.thisV as Extract<V, { k: 'l' }>;
  const addr = self.a;
  setVptrs(I, c, addr, mostDerived);
  const d = fn.decl;
  if (d?.body) execStmt(I, d.body);
  for (let i = c.fields.length - 1; i >= 0; i--) {
    const f = c.fields[i];
    if (f.isStatic) continue;
    if (f.type.k === 'cls' || f.type.k === 'arr') destroyObj(I, f.type, addr + (f.offset ?? 0), false);
  }
  for (let i = c.bases.length - 1; i >= 0; i--) {
    const b = c.bases[i];
    if (b.virtual) continue;
    destroyBase(I, b.cls, addr + (b.offset ?? 0));
  }
  if (mostDerived) {
    const L = I.layoutOf(c);
    const vbs = [...L.vbaseOffsets.entries()].reverse();
    for (const [vb, off] of vbs) destroyBase(I, vb, addr + off);
  }
}

function destroyBase(I: Interp, bc: ClassInfo, addr: number) {
  if (!bc.x.nontrivialDtor) return;
  const prev = I.ctorMostDerived;
  destroyObj(I, clsType(bc), addr, false);
  I.ctorMostDerived = prev;
}

// =====================================================================================================================
// statements
// =====================================================================================================================
export function execStmt(I: Interp, s: A.Stmt): Completion {
  I.tick();
  switch (s.k) {
    case 'block': return execBlock(I, s.body, s.pos);
    case 'expr': {
      markLine(I, s.pos);
      const mark = tempMark(I);
      try { evalExpr(I, s.e); } finally { releaseTemps(I, mark); }
      return undefined;
    }
    case 'var': markLine(I, s.pos); return execVarDecl(I, s);
    case 'if': return execIf(I, s);
    case 'while': return execWhile(I, s);
    case 'do': return execDo(I, s);
    case 'for': return execFor(I, s);
    case 'rfor': return execRangeFor(I, s);
    case 'switch': return execSwitch(I, s);
    case 'case': case 'default': return undefined;
    case 'break': markLine(I, s.pos); return BREAK;
    case 'continue': markLine(I, s.pos); return CONTINUE;
    case 'return': markLine(I, s.pos); return execReturn(I, s);
    case 'goto': markLine(I, s.pos); return { goto: s.label };
    case 'label': return execStmt(I, s.stmt);
    case 'try': return execTry(I, s);
    case 'empty': return undefined;
    case 'bindings': markLine(I, s.pos); declareBindings(I, s); return undefined;
    case 'static_assert': checkStaticAssert(I, s.c, s.msg, I.scope, s.pos); return undefined;
    case 'func': case 'class': case 'enum': case 'typedef': case 'namespace': case 'using-ns': case 'using-decl': case 'pack-begin': case 'pack-end':
      declare(I, s, I.scope);
      return undefined;
  }
}

export function markLine(I: Interp, pos: A.Pos) {
  I.curLine = pos.line;
  I.mem.line = pos.line;
  I.frame.line = pos.line;
  I.emit({ t: 'line', line: pos.line, col: pos.col });
}

function execBlock(I: Interp, body: A.Stmt[], pos: A.Pos): Completion {
  const scope = newScope('block', I.scope);
  scope.locals = [];
  const prev = I.scope;
  I.scope = scope;
  try {
    let i = 0;
    let c: Completion;
    while (i < body.length) {
      c = execStmt(I, body[i]);
      if (c === undefined) { i++; continue; }
      if (typeof c === 'object') {
        // goto: look for the label in this block
        const idx = body.findIndex((st) => hasLabel(st, c as { goto: string }));
        if (idx >= 0) { i = idx; continue; }
      }
      I.endScope(scope, true);
      I.scope = prev;
      return c;
    }
    I.endScope(scope, true);
    I.scope = prev;
    return undefined;
  } catch (e) {
    I.scope = scope;
    if (e instanceof CxxThrow) { try { I.endScope(scope, true); } finally { I.scope = prev; } }
    else I.scope = prev;
    throw e;
  } finally {
    void pos;
  }
}

function hasLabel(s: A.Stmt, g: { goto: string }): boolean {
  if (s.k === 'label') return s.name === g.goto || hasLabel(s.stmt, g);
  return false;
}

// ---- declarations -------------------------------------------------------------------------------------------------------------
function execVarDecl(I: Interp, s: A.VarDecl): Completion {
  for (const dd of s.decls) {
    if (dd.type.k === 'fn') continue; // local function declaration
    declareLocal(I, s, dd);
  }
  return undefined;
}

export function declareLocal(I: Interp, vd: A.VarDecl, dd: A.Declarator) {
  const frame = I.frame;
  if (vd.storage === 'static') { declareStaticLocal(I, vd, dd); return; }
  if (vd.storage === 'extern') return;
  const t = declaredType(I, dd, I.scope);
  const scope = I.scope;
  const isRef = t.k === 'ref';
  const size = isRef ? 8 : sizeOf(t);
  if (t.k === 'void') I.cerr(`variable or field '${dd.name}' declared void`, dd.pos);
  if (t.k === 'cls') I.completeClass(t.c);
  if (t.k === 'cls' && !t.c.defined) I.cerr(`variable '${dd.name}' has incomplete type '${t.c.name}'`, dd.pos);
  let addr: number | undefined = frame.slotMap.get(dd);
  let late = false;
  let nrvo = false;
  if (frame.nrvo === dd.name && t.k === 'cls' && frame.fn && frame.retType && frame.retType.k === 'cls' && frame.retType.c === t.c && frame.nrvoAddr) {
    addr = frame.nrvoAddr;
    nrvo = true;
    frame.nrvoActive = true;
  }
  if (addr === undefined) {
    if (scope.lateMark === undefined) scope.lateMark = frame.cursor;
    addr = I.stackAlloc(Math.max(1, size), Math.max(1, isRef ? 8 : alignOf(t)));
    late = true;
  } else if (!nrvo && I.plat.id === 'windows' && false) { /* MSVC debug keeps the 0xCC fill from the prologue */ }
  void late;
  if (!nrvo) prepareStorage(I, isRef ? ptrTo(t.to) : t, addr);
  const nm = dd.name;
  const needsDtor = !nrvo && hasNontrivialDtor(I, t);
  I.emitVar(nm, t, addr, 'local');
  const lo = { name: nm, type: t, addr, id: frame.varsIds[frame.varsIds.length - 1], dtor: needsDtor, constructed: false, nrvo };
  scope.locals!.push(lo);
  scope.names.set(nm, [{ k: 'var', name: nm, type: t, addr }]);
  const mark = tempMark(I);
  I.extended = false;
  try {
    initDeclared(I, t, addr, dd);
  } finally { releaseTemps(I, mark, I.extended); }
  lo.constructed = true;
}

function declareStaticLocal(I: Interp, vd: A.VarDecl, dd: A.Declarator) {
  const frame = I.frame;
  const key = `${frame.fn ? frame.fn.id : 0}:${dd.pos.line}:${dd.pos.col}:${dd.name}`;
  let rec = I.staticLocals.get(key);
  const scope = I.scope;
  if (!rec) {
    const t = declaredType(I, dd, scope);
    const size = Math.max(1, sizeOf(t.k === 'ref' ? ptrTo(t.to) : t));
    const hasInit = !!(dd.init || dd.braceInit || dd.ctorArgs);
    const addr = I.allocStatic(hasInit ? 'data' : 'bss', size, Math.max(1, alignOf(t)));
    I.mem.loadImage(addr, new Uint8Array(size), S.Init);
    rec = { addr, type: t };
    I.staticLocals.set(key, rec);
    I.emitVar(`${frame.fn?.name ?? 'main'}::${dd.name}`, t, addr, 'static');
    scope.names.set(dd.name, [{ k: 'var', name: dd.name, type: t, addr }]);
    const mark = tempMark(I);
    try { initDeclared(I, t, addr, dd); } finally { releaseTemps(I, mark); }
    if (t.k === 'cls' && hasNontrivialDtor(I, t)) I.staticDtors.push({ type: t, addr });
  } else {
    scope.names.set(dd.name, [{ k: 'var', name: dd.name, type: rec.type, addr: rec.addr }]);
  }
}

function declareBindings(I: Interp, s: Extract<A.Stmt, { k: 'bindings' }>) {
  const frame = I.frame;
  const scope = I.scope;
  const mark = tempMark(I);
  let src: Extract<V, { k: 'l' }>;
  const hiddenName = '[' + s.names.join(', ') + ']';
  try {
    const iv = unevaluated(I, () => evalExpr(I, s.init));
    const ity = iv.k === 'l' || iv.k === 'i' || iv.k === 'f' ? iv.t : I.T.int;
    if (s.ref) {
      const v = evalExpr(I, s.init);
      src = lvalueOf(I, v.k === 'l' ? v : I.cerr('structured binding reference needs an lvalue')) as Extract<V, { k: 'l' }>;
      if (v.k === 'l' && v.tmp) {
        // lifetime extension of a temporary
        const t = adoptTemp(I, v.a);
        if (t) scope.locals!.push({ name: hiddenName, type: t.type, addr: t.addr, id: 0, dtor: true, constructed: true });
      }
    } else {
      const vt = stripCv(ity.k === 'ref' ? ity.to : ity);
      const t = s.spec.const ? constOf(vt) : vt;
      if (scope.lateMark === undefined) scope.lateMark = frame.cursor;
      const addr = I.stackAlloc(Math.max(1, sizeOf(t)), Math.max(1, alignOf(t)));
      prepareStorage(I, t, addr);
      I.emitVar(hiddenName, t, addr, 'local');
      scope.locals!.push({ name: hiddenName, type: t, addr, id: frame.varsIds[frame.varsIds.length - 1], dtor: hasNontrivialDtor(I, t), constructed: false });
      initFromExpr(I, t, addr, s.init);
      scope.locals![scope.locals!.length - 1].constructed = true;
      src = { k: 'l', t, a: addr };
    }
  } finally { releaseTemps(I, mark, true); }
  const t = src.t;
  let n = 0;
  if (t.k === 'arr') n = t.n ?? 0;
  else if (t.k === 'cls') n = collectBindingFields(I, t.c).length;
  else I.cerr('this type cannot be decomposed by a structured binding');
  if (n !== s.names.length) I.cerr(`${n} name${n === 1 ? ' is' : 's are'} required to decompose '${typeStr(t)}', but ${s.names.length} ${s.names.length === 1 ? 'was' : 'were'} given`, s.pos);
  s.names.forEach((nm, i) => {
    let et: Type;
    if (t.k === 'arr') et = t.of;
    else { const f = collectBindingFields(I, (t as Extract<Type, { k: 'cls' }>).c)[i]; et = f.f.type; }
    scope.names.set(nm, [{ k: 'bind', name: nm, source: src, index: i, type: et }]);
    const lv = bindingAddr(I, src, i);
    if (lv) I.emitVar(nm, et.k === 'ref' ? et : et, lv, 'local');
  });
}

function bindingAddr(I: Interp, src: Extract<V, { k: 'l' }>, i: number): number | null {
  const t = src.t;
  if (t.k === 'arr') return src.a + i * sizeOf(t.of);
  if (t.k === 'cls') { const f = collectBindingFields(I, t.c)[i]; return src.a + f.base + (f.f.offset ?? 0); }
  return null;
}

// ---- control flow --------------------------------------------------------------------------------------------------------------------
function evalCondition(I: Interp, c: A.Expr | A.VarDecl): boolean {
  if ((c as A.VarDecl).k === 'var') {
    const vd = c as A.VarDecl;
    declareLocal(I, vd, vd.decls[0]);
    const nm = vd.decls[0].name;
    const r = lookupUnqualified(I, nm, I.scope);
    const ent = r?.ents[0];
    if (!ent || ent.k !== 'var') return false;
    return condValue(I, ent.type.k === 'ref' ? I.load(ent.type, ent.addr) : { k: 'l', t: ent.type, a: ent.addr });
  }
  const mark = tempMark(I);
  try { return condValue(I, evalExpr(I, c as A.Expr)); } finally { releaseTemps(I, mark); }
}

function withScope<T>(I: Interp, f: (sc: Scope) => T): T {
  const scope = newScope('block', I.scope);
  scope.locals = [];
  const prev = I.scope;
  I.scope = scope;
  try {
    const r = f(scope);
    I.endScope(scope, true);
    return r;
  } catch (e) {
    if (e instanceof CxxThrow) I.endScope(scope, true);
    throw e;
  } finally { I.scope = prev; }
}

function execIf(I: Interp, s: Extract<A.Stmt, { k: 'if' }>): Completion {
  markLine(I, s.pos);
  return withScope(I, () => {
    if (s.init) execStmt(I, s.init);
    const c = evalCondition(I, s.c);
    if (c) return execStmt(I, s.then);
    if (s.else) return execStmt(I, s.else);
    return undefined;
  });
}

function loopBody(I: Interp, body: A.Stmt): 'break' | 'continue' | 'return' | undefined | { goto: string } {
  const c = execStmt(I, body);
  if (c === 'break') return 'break';
  if (c === 'continue') return undefined;
  return c;
}

function execWhile(I: Interp, s: Extract<A.Stmt, { k: 'while' }>): Completion {
  return withScope(I, () => {
    for (;;) {
      markLine(I, s.pos);
      // a declaration in the condition is re-created each iteration
      const inner = newScope('block', I.scope);
      inner.locals = [];
      const prev = I.scope;
      I.scope = inner;
      let r: Completion | 'stop' = undefined;
      try {
        if (!evalCondition(I, s.c)) r = 'stop';
        else {
          const c = loopBody(I, s.body);
          if (c === 'break') r = 'stop';
          else if (c !== undefined) r = c;
        }
        I.endScope(inner, true);
      } catch (e) { if (e instanceof CxxThrow) I.endScope(inner, true); throw e; } finally { I.scope = prev; }
      if (r === 'stop') return undefined;
      if (r !== undefined) return r;
    }
  });
}

function execDo(I: Interp, s: Extract<A.Stmt, { k: 'do' }>): Completion {
  for (;;) {
    const c = loopBody(I, s.body);
    if (c === 'break') return undefined;
    if (c !== undefined) return c;
    markLine(I, s.c.pos);
    const mark = tempMark(I);
    let go: boolean;
    try { go = condValue(I, evalExpr(I, s.c)); } finally { releaseTemps(I, mark); }
    if (!go) return undefined;
  }
}

function execFor(I: Interp, s: Extract<A.Stmt, { k: 'for' }>): Completion {
  return withScope(I, () => {
    if (s.init) execStmt(I, s.init);
    for (;;) {
      markLine(I, s.pos);
      if (s.c && !evalCondition(I, s.c)) return undefined;
      const c = loopBody(I, s.body);
      if (c === 'break') return undefined;
      if (c !== undefined) return c;
      if (s.step) {
        markLine(I, s.step.pos);
        const mark = tempMark(I);
        try { evalExpr(I, s.step); } finally { releaseTemps(I, mark); }
      }
    }
  });
}

function execRangeFor(I: Interp, s: Extract<A.Stmt, { k: 'rfor' }>): Completion {
  return withScope(I, (outer) => {
    if (s.init) execStmt(I, s.init);
    markLine(I, s.pos);
    const frame = I.frame;
    const mark = tempMark(I);
    const rv0 = evalExpr(I, s.range);
    // bind the range: auto&& __range = expr;
    let range: Extract<V, { k: 'l' }>;
    if (rv0.k === 'l') range = rv0;
    else if (rv0.k === 'init' && rv0.node.k === 'init') {
      // for (int x : {1, 2, 3}) — the braced list becomes a std::initializer_list<T>
      const its = rv0.node.items;
      const first = its.length ? unevaluated(I, () => evalExpr(I, its[0])) : null;
      const et = first && (first.k === 'i' || first.k === 'f' || first.k === 'l') ? stripCv(first.t) : I.T.int;
      range = makeInitializerList(I, I.initListType(et), its) as Extract<V, { k: 'l' }>;
    }
    else range = lvalueOf(I, I.cerr('range expression must be an object') as never);
    if (range.tmp) {
      const t = adoptTemp(I, range.a);
      if (t) outer.locals!.push({ name: '__range', type: t.type, addr: t.addr, id: 0, dtor: true, constructed: true });
      I.extended = true;
    }
    releaseTemps(I, mark, true);
    const declareElem = (valueAt: V | (() => V)) => {
      // new scope per iteration for the loop variable
      const sc = newScope('block', I.scope);
      sc.locals = [];
      const prev = I.scope;
      I.scope = sc;
      return { sc, prev, v: valueAt };
    };
    void declareElem;
    const bodyOnce = (elem: V): 'stop' | Completion => {
      const sc = newScope('block', I.scope);
      sc.locals = [];
      const prev = I.scope;
      I.scope = sc;
      try {
        bindLoopVar(I, s, elem);
        const c = loopBody(I, s.body);
        I.endScope(sc, true);
        if (c === 'break') return 'stop';
        return c;
      } catch (e) { if (e instanceof CxxThrow) I.endScope(sc, true); throw e; } finally { I.scope = prev; }
    };
    const t = range.t;
    if (t.k === 'arr') {
      const n = t.n ?? 0;
      const es = sizeOf(t.of);
      // hidden pointers __begin / __end exist in the frame like in a real build
      outer.lateMark ??= frame.cursor;
      const pbeg = I.stackAlloc(8, 8), pend = I.stackAlloc(8, 8);
      I.mem.setState(pbeg, 16, S.Init);
      I.emitVar('__begin1', ptrTo(t.of), pbeg, 'local');
      I.emitVar('__end1', ptrTo(t.of), pend, 'local');
      I.store(ptrTo(t.of), pbeg, I.mkPtr(t.of, range.a));
      I.store(ptrTo(t.of), pend, I.mkPtr(t.of, range.a + n * es));
      for (let i = 0; i < n; i++) {
        const r = bodyOnce({ k: 'l', t: (range.t.const ? constOf(t.of) : t.of), a: range.a + i * es });
        I.store(ptrTo(t.of), pbeg, I.mkPtr(t.of, range.a + (i + 1) * es));
        if (r === 'stop') return undefined;
        if (r !== undefined) return r;
      }
      return undefined;
    }
    if (t.k !== 'cls') I.cerr('this range expression cannot be iterated', s.pos);
    // begin() / end()
    const beginV = callMethodOrFree(I, range, 'begin');
    const endV = callMethodOrFree(I, range, 'end');
    const itT = beginV.k === 'l' ? beginV.t : beginV.k === 'i' ? beginV.t : I.T.int;
    outer.lateMark ??= frame.cursor;
    const itSize = sizeOf(itT);
    const abeg = I.stackAlloc(itSize, alignOf(itT));
    const aend = I.stackAlloc(itSize, alignOf(itT));
    prepareStorage(I, itT, abeg); prepareStorage(I, itT, aend);
    I.emitVar('__begin1', itT, abeg, 'local');
    I.emitVar('__end1', itT, aend, 'local');
    const place = (a: number, v: V) => {
      if (itT.k === 'cls') { construct(I, itT, a, [{ ...(v as Extract<V, { k: 'l' }>), xv: true }], 'direct'); markBuilt(I, a); } else I.store(itT, a, v);
    };
    place(abeg, beginV);
    place(aend, endV);
    if (itT.k === 'cls' && hasNontrivialDtor(I, itT)) {
      outer.locals!.push({ name: '__end1', type: itT, addr: aend, id: 0, dtor: true, constructed: true });
      outer.locals!.push({ name: '__begin1', type: itT, addr: abeg, id: 0, dtor: true, constructed: true });
    }
    const itLv = (a: number): V => ({ k: 'l', t: itT, a });
    for (;;) {
      const m2 = tempMark(I);
      let more: boolean;
      let elem: V;
      try {
        const ne = binaryValues(I, '!=', itLv(abeg), itLv(aend));
        more = I.isTrue(ne);
        if (!more) { releaseTemps(I, m2); break; }
        // *__begin
        const dv = itT.k === 'cls' ? (callOperator(I, 'operator*', [itLv(abeg)]) ?? I.cerr('iterator has no operator*')) : { k: 'l', t: (itT as Extract<Type, { k: 'ptr' }>).to, a: Number((I.load(itT, abeg) as Extract<V, { k: 'i' }>).v) } as V;
        elem = dv;
        const r = bodyOnceWithTemps(I, bodyOnce, elem);
        // ++__begin
        releaseTemps(I, m2);
        const mi = tempMark(I);
        if (itT.k === 'cls') callOperator(I, 'operator++', [itLv(abeg)]);
        else { const cur = I.load(itT, abeg) as Extract<V, { k: 'i' }>; I.store(itT, abeg, { k: 'i', t: itT, v: cur.v + BigInt(sizeOf((itT as Extract<Type, { k: 'ptr' }>).to)) }); }
        releaseTemps(I, mi);
        if (r === 'stop') return undefined;
        if (r !== undefined) return r;
      } catch (e) { throw e; }
    }
    return undefined;
  });
}

function bodyOnceWithTemps(I: Interp, f: (v: V) => 'stop' | Completion, elem: V) { return f(elem); }

function callMethodOrFree(I: Interp, obj: Extract<V, { k: 'l' }>, name: string): V {
  const r = callOperatorLike(I, obj, name);
  if (r) return r;
  I.cerr(`range-based for: '${typeStr(obj.t)}' has no ${name}()`);
}

function callOperatorLike(I: Interp, obj: Extract<V, { k: 'l' }>, name: string): V | null {
  // member first, then free function via lookup / ADL
  const cls = obj.t.k === 'cls' ? obj.t.c : null;
  if (cls) {
    const hit = I.findMemberPublic(cls, name);
    if (hit) {
      return callFnValue(I, { k: 'fn', name, cands: hit.fns, tmpls: hit.tmpls, self: { k: 'l', t: withCv(clsType(hit.owner), obj.t), a: obj.a + hit.baseOffset }, qualified: false }, []);
    }
  }
  const r = lookupUnqualified(I, name, I.scope);
  const fns = r ? r.ents.flatMap((e) => (e.k === 'fns' ? e.fns : [])) : [];
  const tm = r ? r.ents.flatMap((e) => (e.k === 'fns' ? e.ftempls : [])) : [];
  return callFnValue(I, { k: 'fn', name, cands: fns, tmpls: tm }, [obj]);
}

/** declare the loop variable of a range-for for one element */
function bindLoopVar(I: Interp, s: Extract<A.Stmt, { k: 'rfor' }>, elem: V) {
  const frame = I.frame;
  const scope = I.scope;
  const e = elem as Extract<V, { k: 'l' }>;
  if (s.decl.k === 'bindings') {
    const d = s.decl;
    const t = e.t;
    const n = t.k === 'arr' ? (t.n ?? 0) : t.k === 'cls' ? collectBindingFields(I, t.c).length : 0;
    if (n !== d.names.length) I.cerr(`${n} names are required to decompose '${typeStr(t)}', but ${d.names.length} were given`, d.pos);
    let src: Extract<V, { k: 'l' }> = e;
    if (!d.ref) {
      // by value: copy the element into a hidden variable
      const vt = stripCv(e.t);
      if (scope.lateMark === undefined) scope.lateMark = frame.cursor;
      const addr = I.stackAlloc(Math.max(1, sizeOf(vt)), Math.max(1, alignOf(vt)));
      prepareStorage(I, vt, addr);
      I.emitVar('[' + d.names.join(', ') + ']', vt, addr, 'local');
      if (vt.k === 'cls') { construct(I, vt, addr, [e], 'direct'); scope.locals!.push({ name: 'binding', type: vt, addr, id: 0, dtor: hasNontrivialDtor(I, vt), constructed: true }); }
      else I.mem.copy(addr, e.a, sizeOf(vt));
      src = { k: 'l', t: d.spec.const ? constOf(vt) : vt, a: addr };
    } else if (e.t.const || d.spec.const) src = { ...e, t: constOf(stripCv(e.t)) };
    d.names.forEach((nm, i) => {
      let et: Type;
      if (src.t.k === 'arr') et = src.t.of; else et = collectBindingFields(I, (src.t as Extract<Type, { k: 'cls' }>).c)[i].f.type;
      scope.names.set(nm, [{ k: 'bind', name: nm, source: src, index: i, type: et }]);
      const a = bindingAddr(I, src, i);
      if (a !== null) I.emitVar(nm, et, a, 'local');
    });
    return;
  }
  const vd = s.decl;
  const dd = vd.decls[0];
  let t = resolveTypeExpr(I, dd.type, scope);
  if (isAuto(t)) {
    const d2 = { ...dd };
    t = declaredTypeFromValue(I, t, elem);
    void d2;
  }
  const isRef = t.k === 'ref';
  const size = isRef ? 8 : sizeOf(t);
  let addr = frame.slotMap.get(dd);
  if (addr === undefined) {
    if (scope.lateMark === undefined) scope.lateMark = frame.cursor;
    addr = I.stackAlloc(Math.max(1, size), Math.max(1, isRef ? 8 : alignOf(t)));
  }
  prepareStorage(I, isRef ? ptrTo((t as any).to) : t, addr);
  I.emitVar(dd.name, t, addr, 'local');
  scope.locals!.push({ name: dd.name, type: t, addr, id: frame.varsIds[frame.varsIds.length - 1], dtor: hasNontrivialDtor(I, t), constructed: false });
  scope.names.set(dd.name, [{ k: 'var', name: dd.name, type: t, addr }]);
  const mark = tempMark(I);
  try {
    if (t.k === 'ref') I.store(t, addr, bindRef(I, elem, t) as Extract<V, { k: 'l' }>);
    else if (t.k === 'cls') construct(I, t, addr, [elem], 'direct');
    else I.store(t, addr, convertTo(I, elem, stripCv(t)));
  } finally { releaseTemps(I, mark); }
  scope.locals![scope.locals!.length - 1].constructed = true;
}

import { deduceAuto } from './decls';
function declaredTypeFromValue(I: Interp, t: Type, v: V): Type { return deduceAuto(I, t, v); }

function execSwitch(I: Interp, s: Extract<A.Stmt, { k: 'switch' }>): Completion {
  markLine(I, s.pos);
  return withScope(I, () => {
    if (s.init) execStmt(I, s.init);
    const mark = tempMark(I);
    let val: bigint;
    try {
      const v = I.rv(evalExpr(I, s.e));
      if (v.k !== 'i') I.cerr('switch quantity is not an integer', s.pos);
      val = v.v;
    } finally { releaseTemps(I, mark); }
    const body = s.body.k === 'block' ? s.body.body : [s.body];
    let start = -1;
    let def = -1;
    for (let i = 0; i < body.length; i++) {
      const st = body[i];
      if (st.k === 'case') {
        const cv = I.mem.withSilence(() => I.rv(evalExpr(I, st.e)));
        if (cv.k === 'i' && cv.v === val) { start = i; break; }
      } else if (st.k === 'default') def = i;
    }
    if (start < 0) start = def;
    if (start < 0) return undefined;
    const sc = newScope('block', I.scope);
    sc.locals = [];
    const prev = I.scope;
    I.scope = sc;
    try {
      for (let i = start; i < body.length; i++) {
        const c = execStmt(I, body[i]);
        if (c === 'break') break;
        if (c !== undefined) { I.endScope(sc, true); I.scope = prev; return c; }
      }
      I.endScope(sc, true);
    } catch (e) { if (e instanceof CxxThrow) I.endScope(sc, true); throw e; } finally { I.scope = prev; }
    return undefined;
  });
}

function execReturn(I: Interp, s: Extract<A.Stmt, { k: 'return' }>): Completion {
  const frame = I.frame;
  const rt = frame.retType ?? I.T.void;
  const mark = tempMark(I);
  try {
    if (!s.e) { I.retVal = I.voidV(); return RETURN; }
    if (rt.k === 'void') { evalExpr(I, s.e); I.retVal = I.voidV(); return RETURN; }
    if (rt.k === 'cls') {
      const dest = frame.nrvoAddr || frame.retSlot!;
      // NRVO: the named local already lives in the destination
      if (frame.nrvoActive && s.e.k === 'id' && s.e.q.parts.length === 1 && s.e.q.parts[0].id === frame.nrvo) {
        I.retVal = { k: 'l', t: rt, a: dest, tmp: true };
        return RETURN;
      }
      let v: V;
      if (s.e.k === 'init') { initFromBraces(I, rt, dest, s.e); I.retVal = { k: 'l', t: rt, a: dest, tmp: true }; return RETURN; }
      v = evalExprInto(I, s.e, dest, rt);
      if (v.k === 'l' && v.t.k === 'cls' && v.a === dest) { I.retVal = { k: 'l', t: rt, a: dest, tmp: true }; return RETURN; }
      // returning a local by name allows an implicit move
      let src: V = v;
      if (v.k === 'l' && s.e.k === 'id' && v.t.k === 'cls' && isLocalObject(I, v.a)) src = { ...v, xv: true };
      if (v.k === 'l' && v.t.k === 'cls' && v.tmp) src = { ...v, xv: true };
      construct(I, rt, dest, [src], 'direct');
      I.retVal = { k: 'l', t: rt, a: dest, tmp: true };
      return RETURN;
    }
    if (rt.k === 'ref') {
      const v = s.e.k === 'init' ? evalExpr(I, s.e) : evalExpr(I, s.e);
      const r = bindRef(I, v, rt, s.e) as Extract<V, { k: 'l' }>;
      warnDangling(I, r.a, 'reference', s.pos);
      I.retVal = r;
      return RETURN;
    }
    // scalar
    let v: V;
    if (s.e.k === 'init') {
      const items = s.e.items;
      v = items.length === 0 ? (rt.k === 'float' ? I.mkFloat(rt, 0) : rt.k === 'ptr' ? ({ k: 'i', t: rt, v: 0n } as V) : I.mkInt(rt, 0n)) : evalExpr(I, items[0]);
    } else v = evalExpr(I, s.e);
    const cv = convertTo(I, v, stripCv(rt) as Type, s.e);
    if (cv.k === 'i' && cv.t.k === 'ptr') warnDangling(I, Number(cv.v), 'pointer', s.pos);
    I.retVal = cv;
    return RETURN;
  } finally {
    // destroying temporaries can run library functions, and a function that returns clears I.retVal: keep ours
    const pending = I.retVal;
    releaseTemps(I, mark);
    I.retVal = pending;
  }
}

function isLocalObject(I: Interp, addr: number): boolean {
  const f = I.frame;
  return addr >= Math.min(f.minCursor, f.cursor) && addr < f.cfa;
}

function warnDangling(I: Interp, addr: number, what: string, pos: A.Pos) {
  if (I.uneval) return;
  const f = I.frame;
  const lo = Math.min(f.minCursor, f.cursor);
  if (addr >= lo && addr < f.cfa - 8 && addr >= f.rbp - 0x100000) {
    // the address is inside this very frame
    if (addr >= Math.min(lo, f.rbp - 0x4000)) {
      I.diag('dangling-stack', 'warn', `Returning a ${what} to a local variable`, `'${f.fn?.qual ?? 'this function'}' returns a ${what} to memory inside its own stack frame (line ${pos.line}). The frame disappears when the function returns, so the caller is left with a dangling ${what}.`, addr, 1);
    }
  }
}

// ---- exceptions -------------------------------------------------------------------------------------------------------------------------
function execTry(I: Interp, s: Extract<A.Stmt, { k: 'try' }>): Completion {
  markLine(I, s.pos);
  try {
    return execStmt(I, s.body);
  } catch (e) {
    if (!(e instanceof CxxThrow)) throw e;
    for (const h of s.catches) {
      const m = matchHandler(I, h, e);
      if (m === null) continue;
      return runHandler(I, h, e, m);
    }
    throw e;
  }
}

/** returns the address to bind to, or null if this handler does not match */
function matchHandler(I: Interp, h: { param: A.Param | null; body: A.Stmt }, e: CxxThrow): number | null {
  if (!h.param) return e.addr;
  const pt0 = resolveTypeExpr(I, h.param.type, I.scope);
  const pt = pt0.k === 'ref' ? pt0.to : pt0;
  const thrown = e.type;
  if (pt.k === 'cls' && thrown.k === 'cls') {
    if (pt.c === thrown.c) return e.addr;
    if (isBaseOf(pt.c, thrown.c)) return upcastAddr(I, thrown.c, pt.c, e.addr);
    return null;
  }
  if (pt.k === 'ptr' && thrown.k === 'ptr') {
    if (sameType(stripCv(pt.to), stripCv(thrown.to), true)) return e.addr;
    if (pt.to.k === 'void') return e.addr;
    if (pt.to.k === 'cls' && thrown.to.k === 'cls' && isBaseOf(pt.to.c, thrown.to.c)) return e.addr;
    return null;
  }
  if (pt.k === 'nullptr' && thrown.k === 'nullptr') return e.addr;
  if (sameType(stripCv(pt), stripCv(thrown), true)) return e.addr;
  return null;
}

function runHandler(I: Interp, h: { param: A.Param | null; body: A.Stmt }, e: CxxThrow, objAddr: number): Completion {
  const scope = newScope('block', I.scope);
  scope.locals = [];
  const prev = I.scope;
  I.scope = scope;
  I.handling.push({ type: e.type, addr: e.addr });
  let rethrown = false;
  try {
    if (h.param && h.param.name) {
      const pt = resolveTypeExpr(I, h.param.type, scope);
      const frame = I.frame;
      scope.lateMark = frame.cursor;
      if (pt.k === 'ref') {
        const a = I.stackAlloc(8, 8);
        I.mem.setState(a, 8, S.Uninit);
        I.store(pt, a, { k: 'l', t: pt.to, a: objAddr });
        I.emitVar(h.param.name, pt, a, 'local');
        scope.locals!.push({ name: h.param.name, type: pt, addr: a, id: frame.varsIds[frame.varsIds.length - 1], dtor: false, constructed: true });
        scope.names.set(h.param.name, [{ k: 'var', name: h.param.name, type: pt, addr: a }]);
      } else {
        const a = I.stackAlloc(Math.max(1, sizeOf(pt)), Math.max(1, alignOf(pt)));
        prepareStorage(I, pt, a);
        I.emitVar(h.param.name, pt, a, 'local');
        if (pt.k === 'cls') {
          construct(I, pt, a, [{ k: 'l', t: pt, a: objAddr }], 'direct');
          scope.locals!.push({ name: h.param.name, type: pt, addr: a, id: frame.varsIds[frame.varsIds.length - 1], dtor: hasNontrivialDtor(I, pt), constructed: true });
        } else {
          I.store(pt, a, I.load(pt, objAddr));
          scope.locals!.push({ name: h.param.name, type: pt, addr: a, id: frame.varsIds[frame.varsIds.length - 1], dtor: false, constructed: true });
        }
        scope.names.set(h.param.name, [{ k: 'var', name: h.param.name, type: pt, addr: a }]);
      }
    }
    const c = execStmt(I, h.body);
    I.endScope(scope, true);
    return c;
  } catch (ex) {
    if (ex instanceof CxxThrow && ex.addr === e.addr) rethrown = true;
    if (ex instanceof CxxThrow) I.endScope(scope, true);
    throw ex;
  } finally {
    I.scope = prev;
    I.handling.pop();
    if (!rethrown) I.destroyException(e);
  }
}

export { arrOf, refTo, indexValue, fieldLv, upcastAddr, isDerivedPtrConv, getSig, ensureRet, baseOffsetOf, tryResolveType, completeArrayType, lookupUnqualified, initFieldFromValue };
export type { Completion };
