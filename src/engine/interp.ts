// The interpreter: state, memory layout of the process image, and the basic value operations.
// Expression / statement / call logic lives in sibling modules that take the Interp as first argument.
import { CompileError } from './lexer';
import { Memory, Fault, encodeFloat, decodeFloat } from './memory';
import { Glibc } from './glibc';
import { MacHeap, WinDebugHeap } from './otherheaps';
import type { Heap } from './heap';
import type { Platform } from './platform';
import { S, type Diag, type Ev, type TypeNode } from './trace';
import { mkTypes, type ClassInfo, type Type, type TypeSet, intInfo, isFloat, isInt, constOf } from './types';
import { sizeOf } from './layout';
import type { Fn, Frame, LocalObj, Scope, V } from './env';
import { newScope } from './env';
import type { ClassTemplate, TArgVal } from './env';
import type * as A from './ast';
import { completeClass, defineClassDecl, injectedClassName, instantiateClassTemplate } from './decls';
import { evalConstInt, expandPack, typeOfExpr } from './expr';
import { destroyObj } from './call';
import { bindingScope, deduceCtad } from './templ';
import { findMember, lookupQName } from './typeres';
import { typeNodeOf } from './typenode';
import { layoutOf } from './layout';
import { prettyType, refTo } from './types';

export interface RunOptions {
  stdin?: string;
  maxSteps?: number;
  maxDepth?: number;
}

export class Interp {
  mem: Memory;
  heap: Heap;
  T: TypeSet;
  global: Scope;
  stdScope!: Scope;
  frames: Frame[] = [];
  steps = 0;
  maxSteps = 4_000_000;
  maxDepth = 1400;
  nextId = 1;
  out = '';
  stdin = '';
  stdinPos = 0;
  exitCode: number | null = null;
  typeInfo: Record<number, TypeNode> = {};
  allFns: Fn[] = [];
  fnByAddr = new Map<number, Fn>();
  classes: ClassInfo[] = [];
  /** vtable address -> info */
  vtables = new Map<number, { cls: ClassInfo; offset: number; vptrOffsetInSub?: number; slots: Array<{ fn: Fn; adjust: number }> }>();
  strLits = new Map<string, number>();
  /** cursors inside the image segments */
  cur = { text: 0, rodata: 0, data: 0, bss: 0 };
  /** objects with static storage that need destruction at exit, in construction order */
  staticDtors: Array<{ type: Type; addr: number }> = [];
  tmpStack: Array<{ type: Type; addr: number; owner: number; built: boolean; needs: boolean; cursor: number }> = [];
  curLine = 0;
  atExit: Fn[] = [];
  callDepth = 0;
  liveVars = new Map<number, true>();
  fatal: Fault | null = null;
  packStack: Array<number | null> = [];
  sourceLines: string[] = [];
  /** extra info for the leak report */
  startedMain = false;
  mainDone = false;
  /** counters for naming temporaries etc. */
  tmpCounter = 0;
  /** exception currently being handled (for `throw;`) */
  handling: Array<{ type: Type; addr: number }> = [];
  /** unspecified-but-stable random for rand() */
  randState = 1;
  /** per-run caches */
  caches = { memberLookup: new Map<string, unknown>() };
  nativeTable: Map<string, import('./env').NativeFn> = new Map();
  stdoutFlush = '';
  /** current lexical scope during execution */
  scope!: Scope;
  /** > 0 while evaluating without side effects (sizeof, decltype, return-type deduction) */
  uneval = 0;
  strictAccess = false;
  allowConstWrite = false;
  retVal: V | null = null;
  ctorMostDerived = true;
  packIdx = new Map<string, number>();
  extended = false;
  staticLocals = new Map<string, { addr: number; type: Type }>();
  vtableLabels = new Map<number, string>();
  globalVars: Array<{ name: string; type: Type; addr: number }> = [];
  fatalPending = false;
  private tempIds = new Map<number, number>();

  constructor(public plat: Platform, public opts: RunOptions = {}) {
    this.mem = new Memory(plat);
    this.T = mkTypes(plat);
    this.global = newScope('global', null, '');
    this.scope = this.global;
    const id = () => this.nextId++;
    this.heap = plat.allocator === 'glibc' ? new Glibc(this.mem, plat, id) : plat.allocator === 'ucrt' ? new WinDebugHeap(this.mem, plat, id) : new MacHeap(this.mem, plat, id);
    this.cur.text = plat.image.text + 0x1000;
    this.cur.rodata = plat.image.rodata + 0x40;
    this.cur.data = plat.image.data + 0x10;
    this.cur.bss = plat.image.bss + 0x10;
    if (opts.maxSteps) this.maxSteps = opts.maxSteps;
    if (opts.maxDepth) this.maxDepth = opts.maxDepth;
    this.stdin = opts.stdin ?? '';
  }

  // ---- errors -------------------------------------------------------------------------------------------------
  cerr(msg: string, pos?: { line: number; col: number }): never {
    throw new CompileError(msg, pos?.line ?? this.curLine, pos?.col ?? 0);
  }

  diag(code: Diag['code'], severity: Diag['severity'], title: string, body: string, addr?: number, len?: number) {
    this.mem.diag(code, severity, title, body, addr, len);
  }

  newId() { return this.nextId++; }

  tick(n = 1) {
    this.steps += n;
    if (this.steps > this.maxSteps) throw new Fault('limit', `Step limit reached (${this.maxSteps.toLocaleString()} operations). The program probably contains an infinite loop, so the simulator stopped it.`, undefined, 0);
  }

  emit(e: Ev) { if (this.uneval) return; this.mem.emit(e); }

  // ---- static storage -----------------------------------------------------------------------------------------------
  allocStatic(seg: 'data' | 'bss' | 'rodata' | 'text', size: number, align: number): number {
    const im = this.plat.image;
    const base = im[seg];
    const lim = base + im[(seg + 'Size') as 'textSize'];
    let a = Math.ceil(this.cur[seg] / Math.max(1, align)) * Math.max(1, align);
    if (a + size > lim) this.cerr(`the program image is too large: out of ${seg} space`);
    this.cur[seg] = a + Math.max(size, 1);
    return a;
  }

  /** a read-only string literal; identical literals share storage */
  stringLiteral(s: string, bytesPer = 1): number {
    const key = bytesPer + ':' + s;
    const old = this.strLits.get(key);
    if (old !== undefined) return old;
    let bytes: Uint8Array;
    if (bytesPer === 1) {
      const enc = new TextEncoder().encode(s);
      bytes = new Uint8Array(enc.length + 1);
      bytes.set(enc);
    } else {
      const cps = Array.from(s).map((c) => c.codePointAt(0)!);
      bytes = new Uint8Array((cps.length + 1) * bytesPer);
      cps.forEach((cp, i) => { for (let b = 0; b < bytesPer; b++) bytes[i * bytesPer + b] = (cp >> (8 * b)) & 0xff; });
    }
    const a = this.allocStatic('rodata', bytes.length, bytesPer);
    this.mem.loadImage(a, bytes, S.Init);
    this.strLits.set(key, a);
    return a;
  }

  newFnAddr(): number {
    return this.allocStatic('text', 16, 16);
  }

  // ---- value construction --------------------------------------------------------------------------------------------
  wrapInt(t: Type, v: bigint): bigint {
    const { bytes, signed } = intInfo(t);
    if (t.k === 'bool') return v !== 0n ? 1n : 0n;
    return signed ? BigInt.asIntN(bytes * 8, v) : BigInt.asUintN(bytes * 8, v);
  }

  mkInt(t: Type, v: bigint): V { return { k: 'i', t, v: this.wrapInt(t, v) }; }
  mkBool(b: boolean): V { return { k: 'i', t: this.T.bool, v: b ? 1n : 0n }; }
  mkFloat(t: Type, v: number): V {
    if (t.k === 'float' && t.bytes === 4) v = Math.fround(v);
    return { k: 'f', t, v };
  }
  mkPtr(to: Type, a: number | bigint): V { return { k: 'i', t: { k: 'ptr', to }, v: BigInt(a) }; }
  voidV(): V { return { k: 'void' }; }

  // ---- loading and storing scalars --------------------------------------------------------------------------------------
  /** load a scalar of type t at address a (class and array types stay as lvalues) */
  load(t: Type, a: number, what?: string): V {
    switch (t.k) {
      case 'int': case 'bool': case 'enum': {
        const { bytes, signed } = intInfo(t);
        const v = this.mem.loadInt(a, bytes, signed, what);
        return { k: 'i', t, v: t.k === 'bool' ? (v !== 0n ? 1n : 0n) : v };
      }
      case 'float': return { k: 'f', t, v: this.mem.loadFloat(a, t.bytes, what) };
      case 'ptr': case 'nullptr': {
        if (a % 8 !== 0) this.diag('misaligned', 'warn', 'Misaligned pointer access', `A pointer was read from 0x${a.toString(16)}, which is not 8-byte aligned.`, a, 8);
        return { k: 'i', t, v: this.mem.loadInt(a, 8, false, what) };
      }
      case 'ref': {
        const p = Number(this.mem.loadInt(a, 8, false, 'reference'));
        return { k: 'l', t: t.to, a: p, xv: t.rv };
      }
      case 'cls': case 'arr': case 'fn': return { k: 'l', t, a };
      case 'void': return { k: 'void' };
    }
  }

  /** store an rvalue scalar of type t */
  store(t: Type, a: number, v: V, what?: string) {
    const x = this.rv(v);
    switch (t.k) {
      case 'int': case 'bool': case 'enum': {
        const { bytes } = intInfo(t);
        if (x.k === 'f') this.mem.storeInt(a, bytes, BigInt(Math.trunc(x.v)), what);
        else if (x.k === 'i') this.mem.storeInt(a, bytes, t.k === 'bool' ? (x.v !== 0n ? 1n : 0n) : x.v, what);
        else this.cerr('cannot store this value into an integer');
        return;
      }
      case 'float': {
        const n = x.k === 'f' ? x.v : x.k === 'i' ? Number(x.v) : NaN;
        this.mem.storeFloat(a, t.bytes, n, what);
        return;
      }
      case 'ptr': case 'nullptr': {
        if (x.k !== 'i') this.cerr('cannot store this value into a pointer');
        if (a % 8 !== 0) this.diag('misaligned', 'warn', 'Misaligned pointer store', `A pointer is being written to 0x${a.toString(16)}, which is not 8-byte aligned.`, a, 8);
        this.mem.storeInt(a, 8, x.v, what);
        return;
      }
      case 'ref': {
        if (x.k === 'l') this.mem.storeInt(a, 8, BigInt(x.a), 'reference');
        else this.cerr('cannot bind a reference to this value');
        return;
      }
      default: this.cerr('internal: store of non-scalar type');
    }
  }

  /** rvalue conversion: load lvalues, decay arrays and functions */
  rv(v: V): V {
    if (v.k !== 'l') return v;
    const t = v.t;
    if (t.k === 'arr') return { k: 'i', t: { k: 'ptr', to: t.of }, v: BigInt(v.a) };
    if (t.k === 'fn') return { k: 'i', t: { k: 'ptr', to: t }, v: BigInt(v.a) };
    if (t.k === 'cls') return v;
    if (v.bf) return this.loadBits(v);
    return this.load(t, v.a);
  }

  loadBits(v: V & { k: 'l' }): V {
    const bf = v.bf!;
    const raw = this.mem.loadInt(v.a, bf.unit, false, 'bit-field');
    let x = (raw >> BigInt(bf.bit)) & ((1n << BigInt(bf.width)) - 1n);
    if (bf.signed && (x >> BigInt(bf.width - 1)) & 1n) x -= 1n << BigInt(bf.width);
    return { k: 'i', t: v.t, v: v.t.k === 'bool' ? (x !== 0n ? 1n : 0n) : x };
  }

  storeBits(v: V & { k: 'l' }, val: bigint) {
    const bf = v.bf!;
    const raw = this.mem.loadInt(v.a, bf.unit, false, 'bit-field');
    const mask = ((1n << BigInt(bf.width)) - 1n) << BigInt(bf.bit);
    const nv = (raw & ~mask) | ((BigInt.asUintN(bf.width, val) << BigInt(bf.bit)) & mask);
    this.mem.storeInt(v.a, bf.unit, nv, 'bit-field');
  }

  // ---- type helpers ----------------------------------------------------------------------------------------------------------------------
  sizeOf(t: Type): number { return sizeOf(t); }

  isTrue(v: V): boolean {
    const x = this.rv(v);
    if (x.k === 'i') return x.v !== 0n;
    if (x.k === 'f') return x.v !== 0;
    this.cerr('value cannot be used as a condition');
  }

  toNumber(v: V): number {
    const x = this.rv(v);
    if (x.k === 'f') return x.v;
    if (x.k === 'i') return Number(x.v);
    this.cerr('a number was expected');
  }

  toBig(v: V): bigint {
    const x = this.rv(v);
    if (x.k === 'i') return x.v;
    if (x.k === 'f') return BigInt(Math.trunc(x.v));
    this.cerr('an integer was expected');
  }

  // ---- stack frames ---------------------------------------------------------------------------------------------------------------------
  get frame(): Frame { return this.frames[this.frames.length - 1]; }

  float(t: Type, v: number) { void t; return v; }

  // ---- delegations to the semantic modules (kept here so modules need no cyclic value imports) ----------------------------
  layoutOf(c: ClassInfo) { return layoutOf(c); }
  completeClass(c: ClassInfo) { completeClass(this, c); }
  defineClassDecl(d: A.ClassDecl, scope: Scope) { return defineClassDecl(this, d, scope); }
  injectedClassName(ct: ClassTemplate, scope: Scope) { return injectedClassName(this, ct, scope); }
  instantiateClassTemplate(ct: ClassTemplate, args: TArgVal[]): Type { return instantiateClassTemplate(this, ct, args, this.global); }
  deduceCtad(ct: ClassTemplate, args: V[]): Type { return deduceCtad(this, ct, args); }
  typeNodeOf(t: Type): TypeNode { return typeNodeOf(this, t); }
  expandPackV(e: A.Expr): V[] { return expandPack(this, e); }
  constEvalIn(e: A.Expr, scope: Scope, b: Map<string, TArgVal>): bigint { return evalConstInt(this, e, bindingScope(this, scope, b)).v; }
  constEvalValue(e: A.Expr, scope: Scope) { return evalConstInt(this, e, scope); }
  typeOfExprForDecltype(e: A.Expr, scope: Scope): Type {
    const v = typeOfExpr(this, e, scope);
    if (v.k === 'l') {
      const plain = e.k === 'id' || e.k === 'member';
      return plain ? v.t : refTo(v.t, !!v.xv);
    }
    if (v.k === 'i' || v.k === 'f') return v.t;
    return this.T.void;
  }
  findMemberPublic(cls: ClassInfo, name: string) {
    const h = findMember(this, cls, name);
    if (!h || h.field) return null;
    const fns = h.ents.flatMap((e) => (e.k === 'fns' ? e.fns : []));
    const tmpls = h.ents.flatMap((e) => (e.k === 'fns' ? e.ftempls : []));
    if (!fns.length && !tmpls.length) return null;
    return { fns, tmpls, owner: h.owner, baseOffset: h.baseOffset };
  }
  isNullConstant(v: V): boolean { return v.k === 'i' && v.v === 0n && v.t.k !== 'ptr'; }

  initListType(elem: Type): Type {
    const r = lookupQName(this, { parts: [{ id: 'std' }, { id: 'initializer_list' }], pos: { line: 0, col: 0 } }, this.global);
    const ent = r?.ents.find((x) => x.k === 'ctempl');
    if (!ent || ent.k !== 'ctempl') this.cerr("'std::initializer_list' is not available — add #include <initializer_list> (or any standard container header)");
    return this.instantiateClassTemplate(ent.t, [{ k: 'type', t: elem }]);
  }

  /** fill a std::initializer_list object: {pointer to first, length} (libstdc++/libc++) or {first, last} (MSVC) */
  initListObject(c: ClassInfo, obj: number, arr: number, n: number, es: number) {
    const f = c.fields.filter((x) => !x.isStatic);
    const o0 = f[0]?.offset ?? 0, o1 = f[1]?.offset ?? 8;
    const w = (a: number, v: number) => { const b = new Uint8Array(8); new DataView(b.buffer).setBigUint64(0, BigInt(v), true); this.mem.writeRaw(a, b, S.Init); };
    w(obj + o0, arr);
    w(obj + o1, this.plat.stdlib === 'msvc-stl' ? arr + n * es : n);
  }

  // ---- stack ------------------------------------------------------------------------------------------------------------------------------
  stackAlloc(size: number, align: number): number {
    const f = this.frame;
    const al = Math.max(1, align);
    const c = Math.floor((f.cursor - size) / al) * al;
    if (c < this.mem.stack.base + 0x1000) {
      const win = this.plat.id === 'windows';
      throw new Fault('stack-overflow', win ? 'Stack overflow (0xC00000FD): the 1 MB stack is exhausted' : `${this.plat.faultName} — stack overflow: the ${this.plat.stack.size / 1048576} MB stack is exhausted`, c, win ? 0xC00000FD : 139);
    }
    f.cursor = c;
    if (c < f.minCursor) f.minCursor = c;
    return c;
  }

  releaseStack(to: number) {
    const f = this.frame;
    if (to > f.cursor && !this.fatalPending && !this.uneval) this.mem.setState(f.cursor, to - f.cursor, S.Dead);
    f.cursor = to;
  }

  /** leave a lexical scope: run destructors newest-first, retire variables, free late slots */
  endScope(scope: Scope, runDtors: boolean) {
    const locals = scope.locals ?? [];
    scope.locals = [];
    for (let i = locals.length - 1; i >= 0; i--) {
      const lo = locals[i];
      try {
        if (runDtors && lo.dtor && lo.constructed && !lo.nrvo) destroyObj(this, lo.type, lo.addr, false);
      } finally {
        if (lo.id) this.emit({ t: 'unvar', id: lo.id });
        if (runDtors && !lo.nrvo && !this.fatalPending && !this.uneval) {
          const sz = lo.type.k === 'ref' ? 8 : sizeOf(lo.type);
          if (sz > 0 && this.mem.seg(lo.addr)?.name === 'stack') this.mem.setState(lo.addr, sz, S.Dead);
        }
      }
    }
    if (scope.lateMark !== undefined) {
      const m = scope.lateMark;
      scope.lateMark = undefined;
      if (runDtors) this.releaseStack(m); else this.frame.cursor = Math.max(this.frame.cursor, m);
    }
  }

  // ---- trace helpers -----------------------------------------------------------------------------------------------------------------
  emitVar(name: string, type: Type, addr: number, kind: 'local' | 'param' | 'global' | 'static' | 'temp' | 'member') {
    if (this.uneval) return;
    const id = this.newId();
    this.frame.varsIds.push(id);
    this.typeInfo[id] = typeNodeOf(this, type);
    this.emit({ t: 'var', id, name, type: prettyType(type), a: addr, size: type.k === 'ref' ? 8 : sizeOf(type), frame: this.frame.id, line: this.curLine, kind });
  }

  emitTemp(t: Type, a: number) {
    if (this.uneval) return;
    const id = this.newId();
    this.tempIds.set(a, id);
    this.typeInfo[id] = typeNodeOf(this, t);
    this.emit({ t: 'var', id, name: '(temporary)', type: prettyType(t), a, size: sizeOf(t), frame: this.frame.id, line: this.curLine, kind: 'temp' });
  }

  emitTempEnd(a: number) {
    const id = this.tempIds.get(a);
    if (id === undefined) return;
    this.tempIds.delete(a);
    this.emit({ t: 'unvar', id });
  }

  // ---- exceptions --------------------------------------------------------------------------------------------------------------------------
  private excHeader() { return this.plat.id === 'windows' ? 0 : 128; }

  allocException(t: Type): number {
    const hdr = this.excHeader();
    const p = this.heap.malloc(Math.max(1, sizeOf(t)) + hdr, '__cxa_allocate_exception');
    if (!p) throw new Fault('oom', 'terminate called after throwing an instance of \'std::bad_alloc\'', undefined, 134);
    if (hdr) this.mem.setState(p, hdr, S.Meta);
    return p + hdr;
  }

  destroyException(e: { type: Type; addr: number }) {
    destroyObj(this, e.type, e.addr, false);
    this.heap.free(e.addr - this.excHeader(), '__cxa_free_exception');
  }

  // ---- user-defined global operator new / delete ----------------------------------------------------------------------------
  private userOp(name: string): Extract<V, { k: 'fn' }> | null {
    const ents = this.global.names.get(name) ?? [];
    const fns = ents.flatMap((e) => (e.k === 'fns' ? e.fns : [])).filter((f) => f.decl && f.decl.body);
    return fns.length ? { k: 'fn', name, cands: fns, qualified: true } : null;
  }
  userGlobalNew(array: boolean) { return this.userOp(array ? 'operator new[]' : 'operator new'); }
  userGlobalDelete(array: boolean) { return this.userOp(array ? 'operator delete[]' : 'operator delete'); }
}

export { Fault, encodeFloat, decodeFloat, isFloat, isInt, constOf };
export type { ClassInfo, LocalObj };
