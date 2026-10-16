// Recursive-descent parser for the C++17 teaching subset. It tracks which identifiers are type / template names
// (C++ cannot be parsed without that) and uses backtracking for the declaration-vs-expression ambiguity.
import { CompileError, type Token } from './lexer';
import type {
  Access, ClassDecl, Declarator, Decl, EnumDecl, Expr, FuncDecl, LambdaCap, Member, Param, Pos, QName, Stmt, TArg, TemplateParam,
  TSpec, TypeExpr, TypedefDecl, VarDecl, NamePart,
} from './ast';

export interface ParseCtx {
  typeNames: Set<string>;
  templNames: Set<string>;
  /** names of function templates (they take <...> but are not types) */
  funcTempls: Set<string>;
  /** names that are definitely values (not types) when they clash, e.g. function names */
}

let anonCounter = 0;
export function newParseCtx(): ParseCtx {
  return { typeNames: new Set(), templNames: new Set(), funcTempls: new Set() };
}
export function cloneCtx(c: ParseCtx): ParseCtx {
  return { typeNames: new Set(c.typeNames), templNames: new Set(c.templNames), funcTempls: new Set(c.funcTempls) };
}

const BUILTIN_WORDS = new Set(['void', 'bool', 'char', 'short', 'int', 'long', 'float', 'double', 'signed', 'unsigned', 'wchar_t', 'char16_t', 'char32_t', '__int64', '__int128']);
const CV = new Set(['const', 'volatile']);
const STORAGE = new Set(['static', 'extern', 'register', 'thread_local', 'mutable']);
const KEYWORDS = new Set([
  'alignas', 'alignof', 'asm', 'auto', 'bool', 'break', 'case', 'catch', 'char', 'char16_t', 'char32_t', 'class', 'const', 'constexpr', 'const_cast', 'continue', 'decltype', 'default', 'delete', 'do', 'double',
  'dynamic_cast', 'else', 'enum', 'explicit', 'export', 'extern', 'false', 'float', 'for', 'friend', 'goto', 'if', 'inline', 'int', 'long', 'mutable', 'namespace', 'new', 'noexcept', 'nullptr', 'operator',
  'private', 'protected', 'public', 'register', 'reinterpret_cast', 'return', 'short', 'signed', 'sizeof', 'static', 'static_assert', 'static_cast', 'struct', 'switch', 'template', 'this', 'thread_local', 'throw',
  'true', 'try', 'typedef', 'typeid', 'typename', 'union', 'unsigned', 'using', 'virtual', 'void', 'volatile', 'wchar_t', 'while',
]);

const BIN_PREC: Record<string, number> = {
  '||': 1, '&&': 2, '|': 3, '^': 4, '&': 5, '==': 6, '!=': 6, '<': 7, '>': 7, '<=': 7, '>=': 7, '<=>': 7, '<<': 8, '>>': 8, '+': 9, '-': 9, '*': 10, '/': 10, '%': 10, '.*': 11, '->*': 11,
};
const ASSIGN_OPS = new Set(['=', '+=', '-=', '*=', '/=', '%=', '&=', '|=', '^=', '<<=', '>>=']);

export class Parser {
  p = 0;
  noGt = 0; // inside template argument lists '>' closes
  className: string[] = [];
  sawPackDecl = false;
  templDepth = 0;

  constructor(public toks: Token[], public ctx: ParseCtx) {}

  // ---- token helpers --------------------------------------------------------------------------------------------
  get t(): Token { return this.toks[this.p]; }
  peek(n = 1): Token { return this.toks[Math.min(this.p + n, this.toks.length - 1)]; }
  pos(): Pos { return { line: this.t.origLine ?? this.t.line, col: this.t.col }; }
  isOp(s: string) { return this.t.k === 'op' && this.t.s === s; }
  isId(s: string) { return this.t.k === 'id' && this.t.s === s; }
  isOpAt(n: number, s: string) { const x = this.peek(n); return x.k === 'op' && x.s === s; }
  eof() { return this.t.k === 'eof'; }
  err(msg: string, tok: Token = this.t): never {
    throw new CompileError(msg, tok.origLine ?? tok.line, tok.col);
  }
  accept(s: string): boolean {
    if ((this.t.k === 'op' || this.t.k === 'id') && this.t.s === s) { this.p++; return true; }
    return false;
  }
  expect(s: string, ctx?: string): Token {
    if ((this.t.k === 'op' || this.t.k === 'id') && this.t.s === s) return this.toks[this.p++];
    const near = this.t.k === 'eof' ? 'end of file' : `'${this.t.s}'`;
    this.err(`expected '${s}'${ctx ? ' ' + ctx : ''} before ${near}`);
  }
  ident(what = 'identifier'): string {
    if (this.t.k !== 'id' || KEYWORDS.has(this.t.s)) {
      const near = this.t.k === 'eof' ? 'end of file' : `'${this.t.s}'`;
      this.err(`expected ${what} before ${near}`);
    }
    return this.toks[this.p++].s;
  }

  try<T>(f: () => T): T | null {
    const save = this.p;
    const saveGt = this.noGt;
    const nTok = this.toks.length;
    try { return f(); } catch (e) {
      if (e instanceof CompileError) { this.p = save; this.noGt = saveGt; void nTok; return null; }
      throw e;
    }
  }

  /** consume a '>' that closes a template argument list, splitting '>>' / '>=' / '>>=' when needed */
  closeAngle() {
    const t = this.t;
    if (t.k === 'op' && t.s === '>') { this.p++; return; }
    if (t.k === 'op' && (t.s === '>>' || t.s === '>=' || t.s === '>>=')) {
      const rest = t.s.slice(1);
      const a: Token = { ...t, s: '>' };
      const b: Token = { ...t, s: rest, col: t.col + 1, sp: false, bol: false };
      (a as any).split = true;
      (b as any).split = true;
      this.toks.splice(this.p, 1, a, b);
      this.p++;
      return;
    }
    this.err(`expected '>' to close the template argument list before '${t.s}'`);
  }

  // ---- program ----------------------------------------------------------------------------------------------------------
  parseProgram(): Decl[] {
    const out: Decl[] = [];
    while (!this.eof()) {
      const d = this.parseExternalDecl();
      if (Array.isArray(d)) out.push(...d); else if (d) out.push(d);
    }
    return out;
  }

  private skipAttributes() {
    while (this.isOp('[') && this.isOpAt(1, '[')) {
      let depth = 0;
      do {
        if (this.isOp('[')) depth++;
        else if (this.isOp(']')) depth--;
        this.p++;
      } while (depth > 0 && !this.eof());
    }
    if (this.isId('__attribute__') || this.isId('__declspec')) {
      this.p++;
      if (this.isOp('(')) this.skipParens();
    }
  }

  private skipParens() {
    let depth = 0;
    do {
      if (this.isOp('(')) depth++;
      else if (this.isOp(')')) depth--;
      this.p++;
    } while (depth > 0 && !this.eof());
  }

  parseExternalDecl(): Decl | Decl[] | null {
    this.skipAttributes();
    const pos = this.pos();
    if (this.accept(';')) return null;
    if (this.isOp('#pragma_pack')) return this.parsePragmaPack();
    if (this.isId('namespace') || (this.isId('inline') && this.peek().s === 'namespace')) {
      const inl = this.accept('inline');
      this.expect('namespace');
      const names: string[] = [];
      if (this.t.k === 'id') { names.push(this.ident()); while (this.accept('::')) names.push(this.ident()); }
      this.skipAttributes();
      if (this.isOp('=')) { // namespace alias: namespace fs = std::filesystem;  — ignore
        while (!this.accept(';')) this.p++;
        return null;
      }
      this.expect('{');
      const body: Decl[] = [];
      while (!this.isOp('}')) {
        if (this.eof()) this.err("expected '}' at end of namespace");
        const d = this.parseExternalDecl();
        if (Array.isArray(d)) body.push(...d); else if (d) body.push(d);
      }
      this.expect('}');
      let node: Decl = { k: 'namespace', name: names[names.length - 1] ?? '', body, inline: inl, pos };
      for (let i = names.length - 2; i >= 0; i--) node = { k: 'namespace', name: names[i], body: [node], pos };
      return node;
    }
    if (this.isId('using')) return this.parseUsing(pos);
    if (this.isId('template')) return this.parseTemplate();
    if (this.isId('static_assert')) { const s = this.parseStaticAssert(); return { k: 'static_assert', c: s.c, msg: s.msg, pos }; }
    if (this.isId('extern') && this.peek().k === 'str') {
      this.p += 2;
      if (this.accept('{')) {
        const body: Decl[] = [];
        while (!this.isOp('}')) { const d = this.parseExternalDecl(); if (Array.isArray(d)) body.push(...d); else if (d) body.push(d); }
        this.expect('}');
        return body;
      }
      return this.parseExternalDecl();
    }
    return this.parseDeclaration({ inClass: false, access: 'public', tparams: null });
  }

  private parsePragmaPack(): Decl {
    const pos = this.pos();
    this.p++;
    // tokens: ( push , N ) | ( pop ) | ( N ) | ( )
    const items: Token[] = [];
    while (!this.isOp('#pragma_end') && !this.eof()) { items.push(this.t); this.p++; }
    this.p++;
    const words = items.map((x) => x.s);
    if (words.includes('pop')) return { k: 'pack-end', pos };
    const num = items.find((x) => x.k === 'num');
    if (words.includes('push')) return { k: 'pack-begin', n: num ? Number(num.big) : null, pos };
    return { k: 'pack-begin', n: num ? Number(num.big) : null, pos: { ...pos, col: -1 } };
  }

  private parseStaticAssert(): { c: Expr; msg?: string } {
    this.expect('static_assert');
    this.expect('(');
    const c = this.parseAssign();
    let msg: string | undefined;
    if (this.accept(',')) { if (this.t.k === 'str') { msg = this.t.s; this.p++; while (this.t.k === 'str') { msg += this.t.s; this.p++; } } }
    this.expect(')');
    this.expect(';');
    return { c, msg };
  }

  private parseUsing(pos: Pos): Decl | null {
    this.expect('using');
    if (this.accept('namespace')) {
      const q = this.parseQName(false);
      this.expect(';');
      return { k: 'using-ns', q, pos };
    }
    if (this.t.k === 'id' && this.peek().k === 'op' && this.peek().s === '=') {
      const name = this.ident();
      this.expect('=');
      const type = this.parseTypeId();
      this.expect(';');
      this.ctx.typeNames.add(name);
      return { k: 'typedef', name, type, tparams: null, pos };
    }
    this.accept('typename');
    const q = this.parseQName(false);
    this.expect(';');
    // using Base::foo;  also makes the name usable; if it names a type we should remember it
    const last = q.parts[q.parts.length - 1].id;
    if (this.ctx.typeNames.has(last)) this.ctx.typeNames.add(last);
    return { k: 'using-decl', q, pos };
  }

  // ---- templates ---------------------------------------------------------------------------------------------------------
  private parseTemplateParams(): TemplateParam[] {
    this.expect('<');
    const ps: TemplateParam[] = [];
    const tmpNames: string[] = [];
    this.noGt++;
    while (!this.isOp('>') && !this.isOp('>>')) {
      if (this.isId('typename') || this.isId('class')) {
        this.p++;
        const pack = this.accept('...');
        const name = this.t.k === 'id' && !this.isOp(',') ? this.ident() : '';
        let def: TypeExpr | undefined;
        if (this.accept('=')) def = this.parseTypeId();
        ps.push({ kind: 'type', name, def, pack });
        if (name && !this.ctx.typeNames.has(name)) { this.ctx.typeNames.add(name); tmpNames.push(name); }
      } else if (this.isId('template')) {
        this.p++;
        this.parseTemplateParams();
        this.expect('class');
        const pack = this.accept('...');
        const name = this.ident();
        let def: TypeExpr | undefined;
        if (this.accept('=')) def = this.parseTypeId();
        ps.push({ kind: 'template', name, def, pack });
        this.ctx.templNames.add(name);
      } else {
        const ntype = this.parseTypeId();
        const pack = this.accept('...');
        const name = this.t.k === 'id' ? this.ident() : '';
        let def: Expr | undefined;
        if (this.accept('=')) def = this.parseCond();
        ps.push({ kind: 'nontype', name, ntype, def, pack });
      }
      if (!this.accept(',')) break;
    }
    this.noGt--;
    for (const n of tmpNames) this.ctx.typeNames.delete(n);
    this.closeAngle();
    return ps;
  }

  private withTemplateParams<T>(ps: TemplateParam[], f: () => T): T {
    const added: string[] = [];
    const addedT: string[] = [];
    for (const p of ps) {
      if (p.kind === 'type' && p.name && !this.ctx.typeNames.has(p.name)) { this.ctx.typeNames.add(p.name); added.push(p.name); }
      if (p.kind === 'template' && p.name && !this.ctx.templNames.has(p.name)) { this.ctx.templNames.add(p.name); addedT.push(p.name); }
    }
    this.templDepth++;
    try { return f(); } finally {
      this.templDepth--;
      for (const a of added) this.ctx.typeNames.delete(a);
      for (const a of addedT) this.ctx.templNames.delete(a);
    }
  }

  parseTemplate(inClass = false, access: Access = 'public'): Decl | Decl[] | null {
    this.expect('template');
    // explicit instantiation: template class Foo<int>;
    if (!this.isOp('<')) {
      while (!this.accept(';')) { if (this.eof()) this.err('unexpected end of file'); this.p++; }
      return null;
    }
    const tparams = this.parseTemplateParams();
    return this.withTemplateParams(tparams, () => {
      if (this.isId('using')) {
        const pos = this.pos();
        this.p++;
        const name = this.ident();
        this.expect('=');
        const type = this.parseTypeId();
        this.expect(';');
        this.ctx.typeNames.add(name);
        this.ctx.templNames.add(name);
        return { k: 'typedef', name, type, tparams, pos } as TypedefDecl;
      }
      if (this.isId('template')) { // member template of template: template<class T> template<class U> ...
        const inner = this.parseTemplate(inClass, access);
        return inner;
      }
      const d = this.parseDeclaration({ inClass, access, tparams });
      return d;
    });
  }

  // ---- declarations -------------------------------------------------------------------------------------------------------
  /** parses decl-specifiers, then either a class/enum definition, or declarators (functions / variables) */
  parseDeclaration(cx: { inClass: boolean; access: Access; tparams: TemplateParam[] | null }): Decl | Decl[] | null {
    const startPos = this.pos();
    this.skipAttributes();
    this.pendingTemplateClass = cx.tparams !== null;
    const ds = this.parseDeclSpecs(cx.inClass);
    this.pendingTemplateClass = false;
    // class/enum definitions
    if (ds.classDecl) {
      const c = ds.classDecl;
      c.tparams = cx.tparams;
      if (ds.alignas && !c.alignas) c.alignas = ds.alignas;
      if (ds.spec === null) { // pure definition: class X { ... };   or  struct X;
        if (!this.accept(';')) this.err(`expected ';' after ${c.tag} definition`);
        return c;
      }
      // struct S { } s;  — declarators follow
      const decls = this.parseInitDeclarators(ds.spec, ds);
      this.expect(';');
      return [c, { k: 'var', spec: ds.spec, decls, storage: ds.storage, constexpr: ds.constexpr, pos: startPos } as VarDecl];
    }
    if (ds.enumDecl) {
      if (ds.spec === null) { this.expect(';'); return ds.enumDecl; }
      const decls = this.parseInitDeclarators(ds.spec, ds);
      this.expect(';');
      return [ds.enumDecl, { k: 'var', spec: ds.spec, decls, storage: ds.storage, constexpr: ds.constexpr, pos: startPos } as VarDecl];
    }
    if (ds.typedef) {
      // typedef <spec> declarator, ...;
      const spec = ds.spec!;
      const out: Decl[] = [];
      do {
        const d = this.parseDeclarator({ k: 'base', spec }, true);
        this.ctx.typeNames.add(d.name);
        out.push({ k: 'typedef', name: d.name, type: d.type, tparams: null, pos: startPos });
      } while (this.accept(','));
      this.expect(';');
      return out;
    }
    // constructors / destructors / conversion operators have no type specifier
    const spec = ds.spec;
    if (!spec) return this.parseCtorLike(ds, cx, startPos);

    // function or variable(s)
    const declarators: Declarator[] = [];
    let first = true;
    for (;;) {
      const dpos = this.pos();
      const d = this.parseDeclarator({ k: 'base', spec }, true, cx.inClass);
      if (d.type.k === 'fn' && (d.qname || d.name)) {
        // function declaration / definition
        const f = this.finishFunction(d, ds, cx, dpos);
        if (f) {
          if (first && (f.body !== null || f.ctorInit)) return f;
          // declaration only; more declarators may follow (rare): e.g. int f(), g();
          declarators.push(d);
          if (f.body === null) {
            if (this.accept(',')) { first = false; continue; }
            this.expect(';');
            return f;
          }
        }
      }
      this.finishVarDeclarator(d, cx.inClass);
      declarators.push(d);
      first = false;
      if (!this.accept(',')) break;
    }
    this.expect(';', 'after declaration');
    const v: VarDecl = { k: 'var', spec, decls: declarators, storage: ds.storage, constexpr: ds.constexpr, pos: startPos, alignas: ds.alignas, mutable: ds.mutable };
    if (cx.tparams && !cx.inClass) { v.tparams = cx.tparams; for (const dd of declarators) this.ctx.templNames.add(dd.name); }
    if (cx.inClass) return v;
    return v;
  }

  private parseInitDeclarators(spec: TSpec, ds: DeclSpecs): Declarator[] {
    const out: Declarator[] = [];
    do {
      const d = this.parseDeclarator({ k: 'base', spec }, true);
      this.finishVarDeclarator(d, false);
      out.push(d);
    } while (this.accept(','));
    void ds;
    return out;
  }

  private finishVarDeclarator(d: Declarator, inClass: boolean) {
    if (this.accept('=')) {
      d.init = this.isOp('{') ? this.parseBraceInit() : this.parseAssign();
    } else if (this.isOp('(') && !inClass || (this.isOp('(') && d.type.k !== 'fn')) {
      this.p++;
      d.ctorArgs = this.parseArgList(')');
    } else if (this.isOp('{')) {
      d.braceInit = this.parseBraceInit();
    } else if (this.isOp(':') && inClass) {
      // bitfield
      this.p++;
      d.bits = this.parseCond();
      if (this.accept('=')) d.init = this.parseAssign();
      else if (this.isOp('{')) d.braceInit = this.parseBraceInit();
    }
    if (this.isOp(':') && d.bits === undefined && inClass) { this.p++; d.bits = this.parseCond(); }
  }

  /** after a declarator of function type: body / default / delete / pure / ctor-init */
  private finishFunction(d: Declarator, ds: DeclSpecs, cx: { inClass: boolean; access: Access; tparams: TemplateParam[] | null }, pos: Pos): FuncDecl | null {
    const ft = d.type as Extract<TypeExpr, { k: 'fn' }>;
    const q: QName = d.qname ?? { parts: [{ id: d.name }], pos };
    const name = q.parts[q.parts.length - 1].id;
    // trailing qualifiers were captured in the fn type (cv)
    const f: FuncDecl = {
      k: 'func', qname: q, name, ret: ft.ret, params: ft.params, variadic: ft.variadic, body: null,
      storage: ds.storage === 'thread_local' ? '' : (ds.storage as '' | 'static' | 'extern'), inline: ds.inline, constexpr: ds.constexpr, virtual: ds.virtual,
      pure: false, override: false, final: false, explicit: ds.explicit, constMethod: !!ft.cv, refQual: (d as any).refQual ?? '', noexcept: !!ft.noexcept, deleted: false, defaulted: false,
      ctorInit: null, tparams: cx.tparams, access: cx.access, isCtor: false, isDtor: false, isConv: false, pos,
    };
    if ((d as any).trailing) f.trailingRet = true;
    if (cx.tparams && !name.startsWith('operator') && !name.startsWith('~')) { this.ctx.templNames.add(name); this.ctx.funcTempls.add(name); }
    // virt-specifiers
    for (;;) {
      if (this.isId('override')) { this.p++; f.override = true; continue; }
      if (this.isId('final')) { this.p++; f.final = true; continue; }
      if (this.isId('noexcept')) { this.p++; f.noexcept = true; if (this.isOp('(')) { this.p++; const ce = this.parseCond(); this.expect(')'); f.noexceptCond = ce; } continue; }
      break;
    }
    if (this.isOp('=')) {
      const save = this.p;
      this.p++;
      if (this.isId('default')) { this.p++; f.defaulted = true; return f; }
      if (this.isId('delete')) { this.p++; f.deleted = true; return f; }
      if (this.t.k === 'num' && this.t.big === 0n) { this.p++; f.pure = true; return f; }
      this.p = save;
      return null;
    }
    if (this.isOp('{') || this.isOp(':') || this.isId('try')) {
      if (this.isId('try')) this.p++;
      if (this.accept(':')) f.ctorInit = this.parseCtorInit();
      this.className.push(this.currentClassName());
      f.body = this.parseBlock();
      this.className.pop();
      if (this.isId('catch')) this.err('function-try-blocks are not supported');
      return f;
    }
    return f;
  }

  private currentClassName() { return this.className[this.className.length - 1] ?? ''; }

  private parseCtorInit(): NonNullable<FuncDecl['ctorInit']> {
    const list: NonNullable<FuncDecl['ctorInit']> = [];
    do {
      const name = this.parseQName(true);
      let args: Expr[];
      let brace = false;
      if (this.accept('(')) args = this.parseArgList(')');
      else if (this.isOp('{')) { const init = this.parseBraceInit(); args = (init as any).items; brace = true; }
      else this.err("expected '(' or '{' in member initializer");
      const pack = this.accept('...');
      list.push({ name, args, brace, pack });
    } while (this.accept(','));
    return list;
  }

  private parseCtorLike(ds: DeclSpecs, cx: { inClass: boolean; access: Access; tparams: TemplateParam[] | null }, pos: Pos): Decl | null {
    // forms: X(...)  ~X()  X::X(...)  X::~X()  operator T()  A::operator T()
    const q = this.parseQName(true, true);
    const last = q.parts[q.parts.length - 1].id;
    const isDtor = last.startsWith('~');
    const isConv = last.startsWith('operator ') && !last.startsWith('operator new') && !last.startsWith('operator delete');
    this.expect('(', 'after constructor/destructor name');
    const { params, variadic } = this.parseParams();
    const f: FuncDecl = {
      k: 'func', qname: q, name: last, ret: null, params, variadic, body: null, storage: '', inline: ds.inline, constexpr: ds.constexpr, virtual: ds.virtual,
      pure: false, override: false, final: false, explicit: ds.explicit, constMethod: false, refQual: '', noexcept: false, deleted: false, defaulted: false,
      ctorInit: null, tparams: cx.tparams, access: cx.access, isCtor: !isDtor && !isConv, isDtor, isConv, pos,
    };
    if (isConv) { f.convType = this.convTypeFromName(last); }
    for (;;) {
      if (this.isId('const')) { this.p++; f.constMethod = true; continue; }
      if (this.isId('override')) { this.p++; f.override = true; continue; }
      if (this.isId('final')) { this.p++; f.final = true; continue; }
      if (this.isId('noexcept')) { this.p++; f.noexcept = true; if (this.isOp('(')) { this.p++; const ce = this.parseCond(); this.expect(')'); f.noexceptCond = ce; } continue; }
      break;
    }
    if (this.isOp('=')) {
      this.p++;
      if (this.accept('default')) { f.defaulted = true; this.expect(';'); return f; }
      if (this.accept('delete')) { f.deleted = true; this.expect(';'); return f; }
      if (this.t.k === 'num' && this.t.big === 0n) { this.p++; f.pure = true; this.expect(';'); return f; }
      this.err('invalid function definition');
    }
    if (this.isOp(':') || this.isOp('{') || this.isId('try')) {
      if (this.isId('try')) this.p++;
      if (this.accept(':')) f.ctorInit = this.parseCtorInit();
      this.className.push(q.parts.length > 1 ? q.parts[q.parts.length - 2].id : this.currentClassName());
      f.body = this.parseBlock();
      this.className.pop();
      return f;
    }
    this.expect(';');
    return f;
  }

  private convTypeFromName(_n: string): TypeExpr | undefined { return this.pendingConvType; }
  private pendingConvType: TypeExpr | undefined;

  // ---- decl-specifiers ------------------------------------------------------------------------------------------------
  private parseDeclSpecs(inClass: boolean): DeclSpecs {
    const ds: DeclSpecs = { spec: null, storage: '', inline: false, constexpr: false, virtual: false, explicit: false, friend: false, typedef: false };
    const words: string[] = [];
    let cv: { const?: boolean; volatile?: boolean } = {};
    let haveType = false;
    let pos = this.pos();
    for (;;) {
      this.skipAttributes();
      const t = this.t;
      if (t.k !== 'id') break;
      const w = t.s;
      if (w === 'alignas') {
        this.p++; this.expect('(');
        ds.alignas = this.isOpAt(0, ')') ? undefined : (this.tryTypeAlign() ?? this.parseCond());
        this.expect(')');
        continue;
      }
      if (STORAGE.has(w)) { this.p++; if (w === 'static' || w === 'extern' || w === 'thread_local') ds.storage = w as any; if (w === 'mutable') ds.mutable = true; continue; }
      if (w === 'inline') { this.p++; ds.inline = true; continue; }
      if (w === 'constexpr' || w === 'consteval' || w === 'constinit') { this.p++; ds.constexpr = true; continue; }
      if (w === 'virtual') { this.p++; ds.virtual = true; continue; }
      if (w === 'explicit') { this.p++; ds.explicit = true; if (this.isOp('(')) this.skipParens(); continue; }
      if (w === 'friend') { this.p++; ds.friend = true; continue; }
      if (w === 'typedef') { this.p++; ds.typedef = true; continue; }
      if (CV.has(w)) { this.p++; (cv as any)[w] = true; continue; }
      if (haveType) break;
      if (w === 'class' || w === 'struct' || w === 'union') {
        if (ds.friend) { // friend class X;
          this.p++;
          const q = this.parseQName(false);
          void q;
          this.expect(';');
          ds.spec = null;
          ds.friendDone = true;
          return this.finishFriend(ds);
        }
        const c = this.parseClassSpecifier();
        if (c.defined || this.isOp(';')) { ds.classDecl = c; if (this.isOp(';') || this.isOp('}')) { ds.spec = null; return ds; } }
        // used as a type:  struct S x;   or class definition followed by declarators
        if (c.defined && !c.name) c.name = `(anonymous ${c.tag} #${++anonCounter})`;
        ds.spec = c.defined ? { k: 'spec', base: { k: 'name', q: { parts: [{ id: c.name }], pos: c.pos } }, pos: c.pos } : { k: 'spec', base: { k: 'elab', tag: c.tag, q: { parts: [{ id: c.name }], pos: c.pos } }, pos: c.pos };
        if (!c.defined) ds.classDecl = undefined;
        haveType = true;
        continue;
      }
      if (w === 'enum') {
        const e = this.parseEnum();
        if (e.defined) { ds.enumDecl = e.decl; if (this.isOp(';')) { ds.spec = null; return ds; } }
        ds.spec = { k: 'spec', base: { k: 'name', q: { parts: [{ id: e.decl.name }], pos: e.decl.pos } }, pos: e.decl.pos };
        haveType = true;
        continue;
      }
      if (w === 'auto') { this.p++; ds.spec = { k: 'spec', base: { k: 'auto' }, pos }; haveType = true; continue; }
      if (w === 'decltype') {
        this.p++; this.expect('(');
        let e: Expr;
        if (this.isId('auto')) { this.p++; e = { k: 'id', q: { parts: [{ id: 'auto' }], pos }, pos }; } else e = this.parseExpr();
        this.expect(')');
        ds.spec = { k: 'spec', base: { k: 'decltype', e }, pos };
        haveType = true;
        continue;
      }
      if (BUILTIN_WORDS.has(w)) {
        const names: string[] = [];
        while (this.t.k === 'id' && (BUILTIN_WORDS.has(this.t.s) || CV.has(this.t.s))) {
          if (CV.has(this.t.s)) { (cv as any)[this.t.s] = true; this.p++; continue; }
          names.push(this.t.s); this.p++;
        }
        ds.spec = { k: 'spec', base: { k: 'builtin', names }, pos };
        haveType = true;
        continue;
      }
      if (w === 'typename') {
        this.p++;
        const q = this.parseQName(true);
        ds.spec = { k: 'spec', base: { k: 'name', q, typename: true }, pos };
        haveType = true;
        continue;
      }
      // a named type?
      if (this.isTypeNameStart(inClass)) {
        const q = this.parseQName(true);
        ds.spec = { k: 'spec', base: { k: 'name', q }, pos };
        haveType = true;
        continue;
      }
      break;
    }
    if (ds.spec) {
      ds.spec.const = cv.const;
      ds.spec.volatile = cv.volatile;
      ds.spec.pos = pos;
    } else if (cv.const || cv.volatile) {
      // `const x = 5;` is invalid in C++, but `const auto`/`const T` handled above
    }
    void pos;
    pos = this.pos();
    // operator conversion function:  operator int() const   — handled by parseCtorLike through parseQName
    return ds;
  }

  private finishFriend(ds: DeclSpecs): DeclSpecs {
    ds.spec = null;
    return ds;
  }

  private tryTypeAlign(): Expr | undefined {
    const t = this.try(() => this.parseTypeId());
    if (t && this.isOp(')')) return { k: 'alignof', t, pos: this.pos() };
    return undefined;
  }

  /** is the current identifier the start of a (possibly qualified) type name? */
  private isTypeNameStart(inClass: boolean): boolean {
    if (this.t.k !== 'id' && !(this.t.k === 'op' && this.t.s === '::')) return false;
    let q = this.p;
    let prevId = '';
    if (this.toks[q].s === '::') q++;
    for (;;) {
      const tk = this.toks[q];
      if (!tk || tk.k !== 'id') return false;
      if (tk.s === 'template') { q++; continue; }
      const nx = this.toks[q + 1];
      // last component?
      if (!(nx && nx.k === 'op' && (nx.s === '::' || (nx.s === '<' && this.ctx.templNames.has(tk.s))))) {
        // end of qualified chain
        if (this.ctx.typeNames.has(tk.s) || this.ctx.templNames.has(tk.s)) {
          // `Foo(` directly inside class Foo, or `Foo::Foo(` anywhere, names a constructor, not a type
          if (nx && nx.k === 'op' && nx.s === '(' && (tk.s === prevId || (inClass && tk.s === this.currentClassName()) || (this.className.length > 0 && tk.s === this.currentClassName() && prevId === ''))) return false;
          return true;
        }
        return false;
      }
      if (nx.s === '<') {
        // skip template args to find what follows
        let depth = 0;
        let j = q + 1;
        for (; j < this.toks.length; j++) {
          const s = this.toks[j];
          if (s.k === 'op') {
            if (s.s === '<') depth++;
            else if (s.s === '>') { depth--; if (depth === 0) break; }
            else if (s.s === '>>') { depth -= 2; if (depth <= 0) break; }
            else if (s.s === ';' || s.s === '{' || s.s === '}') return this.ctx.typeNames.has(tk.s) || this.ctx.templNames.has(tk.s);
          }
        }
        const after = this.toks[j + 1];
        if (after && after.k === 'op' && after.s === '::') { prevId = tk.s; q = j + 2; continue; }
        return true;
      }
      prevId = tk.s;
      q += 2; // skip id and '::'
    }
  }

  // ---- class / enum specifiers ------------------------------------------------------------------------------------
  private parseClassSpecifier(): ClassDecl {
    const pos = this.pos();
    const tag = this.t.s as 'struct' | 'class' | 'union';
    this.p++;
    this.skipAttributes();
    let align: Expr | undefined;
    if (this.isId('alignas')) { this.p++; this.expect('('); align = this.parseCond(); this.expect(')'); }
    let name = '';
    let spec: TArg[] | undefined;
    if (this.t.k === 'id' && !this.isId('final') || (this.isId('final') && this.peek().k === 'id' && false)) {
      const q = this.parseQName(true);
      name = q.parts[q.parts.length - 1].id;
      if (q.parts[q.parts.length - 1].targs) spec = q.parts[q.parts.length - 1].targs;
      this.ctx.typeNames.add(name);
      if (this.pendingTemplateClass) this.ctx.templNames.add(name);
    }
    let isFinal = false;
    if (this.isId('final')) { this.p++; isFinal = true; }
    const c: ClassDecl = { k: 'class', tag, name, bases: [], members: [], defined: false, tparams: null, spec, final: isFinal, alignas: align, pos };
    if (this.isOp(':') || this.isOp('{')) {
      if (this.accept(':')) {
        do {
          let virt = false;
          let acc: Access = tag === 'class' ? 'private' : 'public';
          for (;;) {
            if (this.isId('virtual')) { this.p++; virt = true; continue; }
            if (this.isId('public') || this.isId('protected') || this.isId('private')) { acc = this.t.s as Access; this.p++; continue; }
            break;
          }
          const q = this.parseQName(true);
          const pack = this.accept('...');
          c.bases.push({ q, virtual: virt, access: acc, pack });
        } while (this.accept(','));
      }
      this.expect('{');
      c.defined = true;
      this.className.push(name);
      let access: Access = tag === 'class' ? 'private' : 'public';
      while (!this.isOp('}')) {
        if (this.eof()) this.err("expected '}' at end of class definition");
        if (this.isId('public') || this.isId('private') || this.isId('protected')) {
          access = this.t.s as Access; this.p++; this.expect(':'); continue;
        }
        if (this.isOp('#pragma_pack')) { this.parsePragmaPack(); continue; }
        this.parseMember(c, access);
      }
      this.expect('}');
      this.className.pop();
    }
    return c;
  }

  private parseMember(c: ClassDecl, access: Access) {
    this.pendingTemplateClass = false;
    this.skipAttributes();
    if (this.accept(';')) return;
    if (this.isId('static_assert')) { const s = this.parseStaticAssert(); c.members.push({ k: 'static_assert', s: { k: 'static_assert', c: s.c, msg: s.msg, pos: this.pos() } }); return; }
    if (this.isId('using')) {
      const pos = this.pos();
      const d = this.parseUsing(pos);
      if (d) c.members.push({ k: 'using', d, access });
      return;
    }
    if (this.isId('friend')) {
      const pos = this.pos();
      this.p++;
      // friend class X;  friend struct X;  friend X;  friend void f(...);  friend ostream& operator<<(...) { ... }
      if (this.isId('class') || this.isId('struct')) { this.p++; const q = this.parseQName(false); this.expect(';'); c.members.push({ k: 'friend', target: q, pos }); return; }
      const save = this.p;
      const q0 = this.try(() => { const q = this.parseQName(false); if (!this.isOp(';')) throw new CompileError('x'); return q; });
      if (q0) { this.p++; c.members.push({ k: 'friend', target: q0, pos }); return; }
      this.p = save;
      const d = this.parseDeclaration({ inClass: true, access, tparams: null });
      const f = Array.isArray(d) ? d[0] : d;
      if (f && f.k === 'func') c.members.push({ k: 'friend', target: f, pos });
      return;
    }
    let tparams: TemplateParam[] | null = null;
    if (this.isId('template')) {
      const saved = this.p;
      this.expect('template');
      tparams = this.parseTemplateParams();
      const d = this.withTemplateParams(tparams, () => this.parseDeclaration({ inClass: true, access, tparams }));
      this.addMemberDecl(c, d, access, saved);
      return;
    }
    const d = this.parseDeclaration({ inClass: true, access, tparams: null });
    this.addMemberDecl(c, d, access, this.p);
  }

  private addMemberDecl(c: ClassDecl, d: Decl | Decl[] | null, access: Access, _p: number) {
    if (!d) return;
    const list = Array.isArray(d) ? d : [d];
    for (const x of list) {
      switch (x.k) {
        case 'func': x.access = access; c.members.push({ k: 'method', f: x }); break;
        case 'var': {
          const isStatic = x.storage === 'static';
          for (const dd of x.decls) {
            if (dd.type.k === 'fn') continue;
          }
          c.members.push({ k: 'field', decl: x, access, mutable: !!x.mutable, static: isStatic, alignas: x.alignas });
          break;
        }
        case 'class': c.members.push({ k: 'class', c: x, access }); break;
        case 'enum': c.members.push({ k: 'enum', e: x, access }); break;
        case 'typedef': c.members.push({ k: 'typedef', d: x, access }); break;
        default: break;
      }
    }
  }

  private parseEnum(): { decl: EnumDecl; defined: boolean } {
    const pos = this.pos();
    this.expect('enum');
    let scoped = false;
    if (this.isId('class') || this.isId('struct')) { this.p++; scoped = true; }
    let name = '';
    if (this.t.k === 'id') name = this.ident();
    let under: TypeExpr | undefined;
    if (this.accept(':')) under = this.parseTypeId();
    const e: EnumDecl = { k: 'enum', name, scoped, under, items: [], pos };
    if (name) this.ctx.typeNames.add(name);
    let defined = false;
    if (this.accept('{')) {
      defined = true;
      while (!this.isOp('}')) {
        const n = this.ident('enumerator name');
        let value: Expr | undefined;
        if (this.accept('=')) value = this.parseCond();
        e.items.push({ name: n, value });
        if (!this.accept(',')) break;
      }
      this.expect('}');
    }
    return { decl: e, defined };
  }

  // ---- names ----------------------------------------------------------------------------------------------------------------
  parseQName(allowTargs: boolean, declaratorId = false): QName {
    const pos = this.pos();
    const q: QName = { parts: [], pos };
    if (this.accept('::')) q.global = true;
    for (;;) {
      this.accept('template');
      let id: string;
      if (this.isOp('~')) {
        this.p++;
        id = '~' + this.ident();
      } else if (this.isId('operator')) {
        id = this.parseOperatorName();
      } else {
        id = this.ident();
      }
      const part: NamePart = { id };
      if (allowTargs && this.isOp('<') && (this.ctx.templNames.has(id) || this.forceTargs)) {
        const targs = this.try(() => this.parseTemplateArgs());
        if (targs) part.targs = targs;
      } else if (allowTargs && this.isOp('<') && declaratorId === false && this.looksLikeTemplateCall(id)) {
        const targs = this.try(() => this.parseTemplateArgs());
        if (targs) part.targs = targs;
      }
      q.parts.push(part);
      if (this.isOp('::') && (this.peek().k === 'id' || (this.peek().k === 'op' && (this.peek().s === '~')))) { this.p++; continue; }
      break;
    }
    return q;
  }

  forceTargs = false;
  pendingTemplateClass = false;
  private looksLikeTemplateCall(_id: string): boolean { return false; }

  private parseOperatorName(): string {
    this.expect('operator');
    const t = this.t;
    if (t.k === 'op') {
      if (t.s === '(' && this.isOpAt(1, ')')) { this.p += 2; return 'operator()'; }
      if (t.s === '[' && this.isOpAt(1, ']')) { this.p += 2; return 'operator[]'; }
      this.p++;
      // handle >> that may be two tokens etc.; ++ -- etc are single tokens
      return 'operator' + t.s;
    }
    if (t.k === 'str' && t.s === '') { this.p++; const id = this.ident(); return 'operator""' + id; }
    if (t.k === 'id') {
      if (t.s === 'new' || t.s === 'delete') {
        this.p++;
        if (this.isOp('[') && this.isOpAt(1, ']')) { this.p += 2; return 'operator ' + t.s + '[]'; }
        return 'operator ' + t.s;
      }
      // conversion operator: operator T
      const cds = this.parseDeclSpecs(false);
      if (!cds.spec) this.err("expected a type after 'operator'");
      let ty: TypeExpr = { k: 'base', spec: cds.spec };
      for (;;) {
        if (this.accept('*')) {
          const pt: TypeExpr = { k: 'ptr', to: ty };
          while (this.isId('const') || this.isId('volatile')) { if (this.t.s === 'const') pt.const = true; else pt.volatile = true; this.p++; }
          ty = pt;
        } else if (this.accept('&')) ty = { k: 'ref', to: ty, rv: false };
        else if (this.accept('&&')) ty = { k: 'ref', to: ty, rv: true };
        else break;
      }
      this.pendingConvType = ty;
      return 'operator ' + this.typeText(ty);
    }
    this.err('invalid operator name');
  }

  private typeText(t: TypeExpr): string {
    switch (t.k) {
      case 'base': return t.spec.base.k === 'builtin' ? t.spec.base.names.join(' ') : t.spec.base.k === 'name' ? t.spec.base.q.parts.map((p) => p.id).join('::') : 'T';
      case 'ptr': return this.typeText(t.to) + '*';
      case 'ref': return this.typeText(t.to) + '&';
      default: return 'T';
    }
  }

  parseTemplateArgs(): TArg[] {
    this.expect('<');
    const args: TArg[] = [];
    this.noGt++;
    try {
      while (!(this.isOp('>') || this.isOp('>>') || this.isOp('>=') || this.isOp('>>='))) {
        // type or expression?
        const asType = this.try(() => {
          const t = this.parseTypeId();
          const pack = this.accept('...');
          if (!(this.isOp(',') || this.isOp('>') || this.isOp('>>') || this.isOp('>=') || this.isOp('>>='))) throw new CompileError('not a type argument');
          return { t, pack };
        });
        if (asType) args.push(asType.pack ? { k: 'pack', t: asType.t } : { k: 'type', t: asType.t });
        else {
          const e = this.parseTernaryNoGt();
          args.push({ k: 'expr', e });
        }
        if (!this.accept(',')) break;
      }
    } finally { this.noGt--; }
    this.closeAngle();
    return args;
  }

  private parseTernaryNoGt(): Expr { return this.parseCond(); }

  // ---- declarators -------------------------------------------------------------------------------------------------------------
  /** parse a declarator (possibly abstract) given the base type; returns the name and the full type */
  parseDeclarator(base: TypeExpr, named: boolean, inClass = false): Declarator & { refQual?: string; trailing?: boolean } {
    const pos = this.pos();
    const res = this.declaratorFn(named, inClass);
    const type = res.apply(base);
    return { name: res.name, qname: res.qname, type, pos, refQual: res.refQual, trailing: res.trailing } as any;
  }

  private declaratorFn(named: boolean, inClass: boolean): { name: string; qname?: QName; apply: (t: TypeExpr) => TypeExpr; refQual?: string; trailing?: boolean } {
    const prefix: Array<(t: TypeExpr) => TypeExpr> = [];
    for (;;) {
      if (this.isOp('*')) {
        this.p++;
        let cv: { const?: boolean; volatile?: boolean } = {};
        while (this.isId('const') || this.isId('volatile')) { (cv as any)[this.t.s] = true; this.p++; }
        prefix.push((t) => ({ k: 'ptr', to: t, ...cv }));
        continue;
      }
      if (this.isOp('&')) { this.p++; prefix.push((t) => ({ k: 'ref', to: t, rv: false })); continue; }
      if (this.isOp('&&')) { this.p++; prefix.push((t) => ({ k: 'ref', to: t, rv: true })); continue; }
      if (this.t.k === 'id' && this.peek().k === 'op' && this.peek().s === '::' && this.peek(2).s === '*' ) { // pointer to member
        const q = this.parseQName(false);
        this.expect('::'); this.expect('*');
        prefix.push((t) => ({ k: 'memptr', cls: q, to: t }));
        continue;
      }
      this.skipAttributes();
      break;
    }
    let name = '';
    let qname: QName | undefined;
    let inner: ((t: TypeExpr) => TypeExpr) | null = null;
    let packDecl = false;
    if (this.isOp('...')) { this.p++; packDecl = true; }
    if (this.isOp('(') && this.isNestedDeclarator()) {
      this.p++;
      const sub = this.declaratorFn(named, inClass);
      this.expect(')');
      name = sub.name; qname = sub.qname;
      inner = sub.apply;
    } else if (named && (this.t.k === 'id' || this.isOp('::') || this.isOp('~'))) {
      // declarator-id (possibly qualified, possibly operator)
      const save = this.p;
      const isTypeStart = this.t.k === 'id' && !KEYWORDS.has(this.t.s) || this.isId('operator') || this.isOp('::') || this.isOp('~');
      if (!isTypeStart) this.err(`expected identifier before '${this.t.s}'`);
      const q = this.parseQName(true, true);
      qname = q.parts.length > 1 || q.global ? q : undefined;
      name = q.parts[q.parts.length - 1].id;
      void save;
    } else if (!named) {
      // abstract declarator: optional identifier is not allowed
    } else if (this.isId('operator')) {
      name = this.parseOperatorName();
    }
    // suffixes
    const suffix: Array<(t: TypeExpr) => TypeExpr> = [];
    let refQual = '';
    let trailing = false;
    for (;;) {
      if (this.isOp('[')) {
        this.p++;
        let n: Expr | null = null;
        if (!this.isOp(']')) n = this.parseAssign();
        this.expect(']');
        suffix.push((t) => ({ k: 'arr', of: t, n }));
        continue;
      }
      if (this.isOp('(')) {
        if (named && name === '' && inner === null) break;
        if (!named && !(this.isOpAt(1, ')') || this.startsTypeAt(1))) break;
        const save = this.p;
        this.p++;
        let params: Param[];
        let variadic = false;
        try {
          const r = this.parseParams();
          params = r.params; variadic = r.variadic;
        } catch (e) {
          if (e instanceof CompileError && inClass === false && named) { this.p = save; break; }
          throw e;
        }
        let cv = false;
        let noexc = false;
        for (;;) {
          if (this.isId('const')) { this.p++; cv = true; continue; }
          if (this.isId('volatile')) { this.p++; continue; }
          if (this.isOp('&&')) { this.p++; refQual = '&&'; continue; }
          if (this.isOp('&')) { this.p++; refQual = '&'; continue; }
          if (this.isId('noexcept')) { this.p++; noexc = true; if (this.isOp('(')) this.skipParens(); continue; }
          if (this.isId('throw') && this.isOpAt(1, '(')) { this.p++; this.skipParens(); continue; }
          break;
        }
        let trailingRet: TypeExpr | null = null;
        if (this.isOp('->')) { this.p++; trailingRet = this.parseTypeId(); trailing = true; }
        suffix.push((t) => ({ k: 'fn', ret: trailingRet ?? t, params, variadic, cv, noexcept: noexc }));
        continue;
      }
      break;
    }
    if (packDecl) this.sawPackDecl = true;
    return {
      name, qname, refQual, trailing,
      apply: (t: TypeExpr) => {
        let ty = t;
        for (const f of prefix) ty = f(ty);
        // suffixes bind tighter than prefix ops: apply in reverse so that  int *a[3]  = array of pointer
        for (let i = suffix.length - 1; i >= 0; i--) ty = suffix[i](ty);
        if (inner) ty = inner(ty);
        return ty;
      },
    };
  }

  private startsTypeAt(n: number): boolean {
    const t = this.peek(n);
    if (t.k !== 'id') return false;
    if (CV.has(t.s) || BUILTIN_WORDS.has(t.s) || t.s === 'auto') return true;
    if (KEYWORDS.has(t.s)) return false;
    return this.ctx.typeNames.has(t.s) || this.ctx.templNames.has(t.s);
  }

  /** after '(' in a declarator: is this a nested declarator like (*fp) rather than a parameter list? */
  private isNestedDeclarator(): boolean {
    const n = this.peek();
    if (n.k === 'op' && (n.s === '*' || n.s === '&' || n.s === '&&' || n.s === '(')) return true;
    if (n.k === 'id' && this.peek(2).k === 'op' && this.peek(2).s === '::' && this.peek(3).s === '*') return true;
    return false;
  }

  parseParams(): { params: Param[]; variadic: boolean } {
    // after '('
    const params: Param[] = [];
    let variadic = false;
    if (this.accept(')')) return { params, variadic };
    if (this.isId('void') && this.isOpAt(1, ')')) { this.p += 2; return { params, variadic }; }
    for (;;) {
      if (this.accept('...')) { variadic = true; break; }
      const pos = this.pos();
      this.skipAttributes();
      const ds = this.parseDeclSpecs(false);
      if (!ds.spec) this.err(`expected parameter type before '${this.t.s}'`);
      this.sawPackDecl = false;
      const d = this.parseDeclarator({ k: 'base', spec: ds.spec }, true, true);
      let pack = this.sawPackDecl;
      this.sawPackDecl = false;
      if (this.accept('...')) pack = true;
      const param: Param = { type: pack ? { k: 'pack', of: d.type } : d.type, name: d.name || undefined, pos, pack };
      if (this.accept('=')) param.def = this.parseAssign();
      params.push(param);
      if (this.accept(',')) {
        if (this.isOp('...')) { this.p++; variadic = true; break; }
        continue;
      }
      if (this.isOp('...')) { this.p++; variadic = true; }
      break;
    }
    this.expect(')', 'to close the parameter list');
    return { params, variadic };
  }

  parseTypeId(): TypeExpr {
    const ds = this.parseDeclSpecs(false);
    if (!ds.spec) this.err(`expected a type before '${this.t.k === 'eof' ? 'end of file' : this.t.s}'`);
    const d = this.parseDeclarator({ k: 'base', spec: ds.spec }, false);
    return d.type;
  }

  // ---- statements ---------------------------------------------------------------------------------------------------------------
  parseBlock(): Stmt {
    const pos = this.pos();
    this.expect('{');
    const body: Stmt[] = [];
    while (!this.isOp('}')) {
      if (this.eof()) this.err("expected '}' at end of input");
      body.push(...this.parseStatements());
    }
    this.expect('}');
    return { k: 'block', body, pos };
  }

  private parseStatements(): Stmt[] {
    const s = this.parseStatement();
    return Array.isArray(s) ? s : [s];
  }

  parseStatement(): Stmt | Stmt[] {
    this.skipAttributes();
    const pos = this.pos();
    const t = this.t;
    if (t.k === 'op') {
      if (t.s === '{') return this.parseBlock();
      if (t.s === ';') { this.p++; return { k: 'empty', pos }; }
      if (t.s === '#pragma_pack') { const d = this.parsePragmaPack(); return d as unknown as Stmt; }
    }
    if (t.k === 'id') {
      switch (t.s) {
        case 'if': return this.parseIf();
        case 'while': {
          this.p++; this.expect('(');
          const c = this.parseCondition();
          this.expect(')');
          const body = this.parseStatementBody();
          return { k: 'while', c, body, pos };
        }
        case 'do': {
          this.p++;
          const body = this.parseStatementBody();
          this.expect('while'); this.expect('(');
          const c = this.parseExpr();
          this.expect(')'); this.expect(';');
          return { k: 'do', body, c, pos };
        }
        case 'for': return this.parseFor();
        case 'switch': {
          this.p++; this.expect('(');
          let init: Stmt | undefined;
          const save = this.p;
          const maybeInit = this.try(() => { const s = this.parseSimpleDeclOrExpr(); if (!this.accept(';')) throw new CompileError('x'); return s; });
          if (maybeInit) init = maybeInit; else this.p = save;
          const e = this.parseExpr();
          this.expect(')');
          const body = this.parseStatementBody();
          return { k: 'switch', init, e, body, pos };
        }
        case 'case': { this.p++; const e = this.parseCond(); this.expect(':'); return { k: 'case', e, pos }; }
        case 'default': { if (this.isOpAt(1, ':')) { this.p += 2; return { k: 'default', pos }; } break; }
        case 'break': this.p++; this.expect(';'); return { k: 'break', pos };
        case 'continue': this.p++; this.expect(';'); return { k: 'continue', pos };
        case 'return': {
          this.p++;
          let e: Expr | undefined;
          if (!this.isOp(';')) e = this.isOp('{') ? this.parseBraceInit() : this.parseExpr();
          this.expect(';', 'after return value');
          return { k: 'return', e, pos };
        }
        case 'goto': { this.p++; const label = this.ident('label'); this.expect(';'); return { k: 'goto', label, pos }; }
        case 'try': return this.parseTry();
        case 'throw': break;
        case 'static_assert': { const s = this.parseStaticAssert(); return { k: 'static_assert', c: s.c, msg: s.msg, pos }; }
        case 'using': { const d = this.parseUsing(pos); return d ? (d as unknown as Stmt) : { k: 'empty', pos }; }
        case 'typedef': case 'enum': case 'struct': case 'class': case 'union': {
          if (t.s === 'struct' || t.s === 'class' || t.s === 'union' || t.s === 'enum' || t.s === 'typedef') {
            const d = this.parseDeclaration({ inClass: false, access: 'public', tparams: null });
            if (!d) return { k: 'empty', pos };
            return (Array.isArray(d) ? d : [d]) as unknown as Stmt[];
          }
          break;
        }
        case 'template': { const d = this.parseTemplate(); return d ? ((Array.isArray(d) ? d : [d]) as unknown as Stmt[]) : { k: 'empty', pos }; }
        default: break;
      }
      // label?
      if (this.peek().k === 'op' && this.peek().s === ':' && !KEYWORDS.has(t.s) && !(this.peek(2).k === 'op' && this.peek(2).s === ':')) {
        const name = t.s; this.p += 2;
        const stmt = this.isOp('}') ? ({ k: 'empty', pos } as Stmt) : (this.parseStatement() as Stmt);
        return { k: 'label', name, stmt: Array.isArray(stmt) ? { k: 'block', body: stmt, pos } : stmt, pos };
      }
    }
    return this.parseSimpleStatement();
  }

  private parseStatementBody(): Stmt {
    const s = this.parseStatement();
    return Array.isArray(s) ? { k: 'block', body: s, pos: this.pos() } : s;
  }

  private parseSimpleStatement(): Stmt | Stmt[] {
    const s = this.parseSimpleDeclOrExpr();
    this.expect(';', 'after statement');
    return s;
  }

  /** a declaration (without the trailing ';') or an expression statement */
  private parseSimpleDeclOrExpr(): Stmt {
    const pos = this.pos();
    if (this.startsDeclaration()) {
      const save = this.p;
      let declErr: CompileError | null = null;
      try { return this.parseLocalDeclaration(); } catch (e) { if (!(e instanceof CompileError)) throw e; declErr = e; this.p = save; }
      const asExpr = this.try(() => { const e = this.parseExpr(); if (!(this.isOp(';') || this.isOp(')') || this.isOp(':'))) throw new CompileError('x'); return e; });
      if (asExpr) return { k: 'expr', e: asExpr, pos };
      throw declErr;
    }
    const e = this.parseExpr();
    return { k: 'expr', e, pos };
  }

  private startsDeclaration(): boolean {
    const t = this.t;
    if (t.k === 'op') return t.s === '::' && this.isTypeNameStart(false);
    if (t.k !== 'id') return false;
    if (CV.has(t.s) || STORAGE.has(t.s) || t.s === 'constexpr' || t.s === 'auto' || t.s === 'decltype' || t.s === 'alignas' || t.s === 'typename' || t.s === 'inline') return true;
    if (BUILTIN_WORDS.has(t.s)) {
      // int(x) functional cast expression:  int(3.5);
      return !(this.isOpAt(1, '(')) || this.isOpAt(2, '*') || this.isOpAt(2, '&');
    }
    if (KEYWORDS.has(t.s)) return false;
    if (!this.isTypeNameStart(false)) return false;
    // `Foo(x);`, `Foo{...};`  are expressions (temporary); `Foo x;` `Foo* x;` `Foo& x` `Foo<T> x` are declarations
    const save = this.p;
    const ok = this.try(() => {
      this.parseQName(true);
      const nx = this.t;
      if (nx.k === 'id' && !KEYWORDS.has(nx.s)) return true;
      if (nx.k === 'op' && (nx.s === '*' || nx.s === '&' || nx.s === '&&')) return true;
      if (nx.k === 'op' && nx.s === '[' && this.isOpAt(1, ']')) return false;
      if (nx.k === 'op' && nx.s === '(') return this.isOpAt(1, '*') || this.isOpAt(1, '&');
      if (nx.k === 'op' && nx.s === '::') return false;
      if (nx.k === 'id' && nx.s === 'const') return true;
      return false;
    });
    this.p = save;
    return !!ok;
  }

  private parseLocalDeclaration(): Stmt {
    const pos = this.pos();
    const ds = this.parseDeclSpecs(false);
    if (ds.classDecl || ds.enumDecl || ds.typedef) this.err('local type declaration');
    if (!ds.spec) this.err('expected declaration');
    // structured binding:  auto [a, b] = expr;  auto& [a, b] = ...
    if (ds.spec.base.k === 'auto' && (this.isOp('[') || ((this.isOp('&') || this.isOp('&&')) && this.isOpAt(1, '[')))) {
      let ref = false, rv = false;
      if (this.isOp('&')) { ref = true; this.p++; } else if (this.isOp('&&')) { ref = true; rv = true; this.p++; }
      this.expect('[');
      const names: string[] = [];
      do names.push(this.ident()); while (this.accept(','));
      this.expect(']');
      let init: Expr;
      if (this.accept('=')) init = this.parseAssign();
      else if (this.isOp('{')) init = this.parseBraceInit();
      else if (this.accept('(')) { const a = this.parseArgList(')'); init = a[0]; }
      else this.err('structured binding needs an initializer');
      return { k: 'bindings', spec: ds.spec, names, init, ref, rv, pos };
    }
    const decls: Declarator[] = [];
    do {
      const d = this.parseDeclarator({ k: 'base', spec: ds.spec }, true);
      if (!d.name) this.err('expected a variable name');
      this.finishVarDeclarator(d, false);
      decls.push(d);
    } while (this.accept(','));
    return { k: 'var', spec: ds.spec, decls, storage: ds.storage, constexpr: ds.constexpr, pos, alignas: ds.alignas };
  }

  private parseCondition(): Expr | VarDecl {
    // `if (T x = expr)` is allowed
    if (this.startsDeclaration()) {
      const d = this.try(() => {
        const s = this.parseLocalDeclaration();
        if (s.k !== 'var' || !this.isOp(')')) throw new CompileError('x');
        return s;
      });
      if (d && d.k === 'var') return d;
    }
    return this.parseExpr();
  }

  private parseIf(): Stmt {
    const pos = this.pos();
    this.expect('if');
    const cexpr = this.accept('constexpr');
    this.expect('(');
    let init: Stmt | undefined;
    const maybeInit = this.try(() => { const s = this.parseSimpleDeclOrExpr(); if (!this.accept(';')) throw new CompileError('x'); return s; });
    if (maybeInit) init = maybeInit;
    const c = this.parseCondition();
    this.expect(')');
    const then = this.parseStatementBody();
    let els: Stmt | undefined;
    if (this.accept('else')) els = this.parseStatementBody();
    return { k: 'if', init, c, then, else: els, constexpr: cexpr, pos };
  }

  private parseFor(): Stmt {
    const pos = this.pos();
    this.expect('for');
    this.expect('(');
    // range-for?
    const range = this.try(() => {
      let init: Stmt | undefined;
      const mi = this.try(() => { const s = this.parseSimpleDeclOrExpr(); if (!this.accept(';')) throw new CompileError('x'); return s; });
      if (mi) init = mi;
      const ds = this.parseDeclSpecs(false);
      if (!ds.spec) throw new CompileError('x');
      if (ds.spec.base.k === 'auto' && (this.isOp('[') || ((this.isOp('&') || this.isOp('&&')) && this.isOpAt(1, '[')))) {
        let ref: TypeExpr | null = null;
        if (this.isOp('&')) { this.p++; ref = { k: 'ref', to: { k: 'base', spec: ds.spec }, rv: false }; } else if (this.isOp('&&')) { this.p++; ref = { k: 'ref', to: { k: 'base', spec: ds.spec }, rv: true }; }
        this.expect('[');
        const names: string[] = [];
        do names.push(this.ident()); while (this.accept(','));
        this.expect(']');
        this.expect(':');
        const rng = this.parseBraceOrExpr();
        this.expect(')');
        return { init, decl: { k: 'bindings' as const, names, ref, spec: ds.spec, pos }, rng };
      }
      const d = this.parseDeclarator({ k: 'base', spec: ds.spec }, true);
      if (!this.isOp(':')) throw new CompileError('x');
      this.p++;
      const rng = this.parseBraceOrExpr();
      this.expect(')');
      const decl: VarDecl = { k: 'var', spec: ds.spec, decls: [d], storage: '', constexpr: false, pos };
      return { init, decl, rng };
    });
    if (range) {
      const body = this.parseStatementBody();
      return { k: 'rfor', init: range.init, decl: range.decl, range: range.rng, body, pos };
    }
    let init: Stmt | undefined;
    if (!this.accept(';')) { init = this.parseSimpleDeclOrExpr(); this.expect(';'); }
    let c: Expr | VarDecl | undefined;
    if (!this.isOp(';')) c = this.parseCondition();
    this.expect(';');
    let step: Expr | undefined;
    if (!this.isOp(')')) step = this.parseExpr();
    this.expect(')');
    const body = this.parseStatementBody();
    return { k: 'for', init, c, step, body, pos };
  }

  private parseBraceOrExpr(): Expr { return this.isOp('{') ? this.parseBraceInit() : this.parseExpr(); }

  private parseTry(): Stmt {
    const pos = this.pos();
    this.expect('try');
    const body = this.parseBlock();
    const catches: Array<{ param: Param | null; body: Stmt; pos: Pos }> = [];
    while (this.isId('catch')) {
      const cpos = this.pos();
      this.p++;
      this.expect('(');
      let param: Param | null = null;
      if (this.accept('...')) { /* catch-all */ } else {
        const ppos = this.pos();
        const ds = this.parseDeclSpecs(false);
        if (!ds.spec) this.err('expected exception type');
        const d = this.parseDeclarator({ k: 'base', spec: ds.spec }, true);
        param = { type: d.type, name: d.name || undefined, pos: ppos };
      }
      this.expect(')');
      const cb = this.parseBlock();
      catches.push({ param, body: cb, pos: cpos });
    }
    if (catches.length === 0) this.err("expected 'catch' after try block");
    return { k: 'try', body, catches, pos };
  }

  // ---- expressions -----------------------------------------------------------------------------------------------------------------
  parseExpr(): Expr {
    let e = this.parseAssign();
    while (this.isOp(',') ) {
      if (this.noGt > 0 && false) break;
      const pos = this.pos();
      this.p++;
      const r = this.parseAssign();
      e = { k: 'bin', op: ',', l: e, r, pos };
    }
    return e;
  }

  parseArgList(close: string): Expr[] {
    const args: Expr[] = [];
    if (this.accept(close)) return args;
    const savedGt = this.noGt;
    this.noGt = 0;
    for (;;) {
      let a = this.isOp('{') ? this.parseBraceInit() : this.parseAssign();
      if (this.isOp('...')) { const pos = this.pos(); this.p++; a = { k: 'expand', e: a, pos }; }
      args.push(a);
      if (!this.accept(',')) break;
    }
    this.noGt = savedGt;
    this.expect(close, close === ')' ? 'to close the argument list' : undefined);
    return args;
  }

  parseBraceInit(): Expr {
    const pos = this.pos();
    this.expect('{');
    const items: Expr[] = [];
    const desig: Array<string | null> = [];
    let anyDesig = false;
    const savedGt = this.noGt;
    this.noGt = 0;
    while (!this.isOp('}')) {
      if (this.isOp('.') && this.peek().k === 'id') {
        this.p++;
        const n = this.ident();
        this.expect('=');
        desig.push(n); anyDesig = true;
      } else desig.push(null);
      let e = this.isOp('{') ? this.parseBraceInit() : this.parseAssign();
      if (this.isOp('...')) { const p2 = this.pos(); this.p++; e = { k: 'expand', e, pos: p2 }; }
      items.push(e);
      if (!this.accept(',')) break;
    }
    this.noGt = savedGt;
    this.expect('}', 'to close the initializer list');
    return { k: 'init', items, pos, designated: anyDesig ? desig : undefined };
  }

  parseAssign(): Expr {
    if (this.isId('throw')) {
      const pos = this.pos();
      this.p++;
      if (this.isOp(';') || this.isOp(')') || this.isOp(',')) return { k: 'throw', e: null, pos };
      return { k: 'throw', e: this.parseAssign(), pos };
    }
    const l = this.parseCond();
    const t = this.t;
    if (t.k === 'op' && ASSIGN_OPS.has(t.s)) {
      const pos = this.pos();
      this.p++;
      const r = this.isOp('{') ? this.parseBraceInit() : this.parseAssign();
      return { k: 'assign', op: t.s, l, r, pos };
    }
    // split tokens '>' '>=' that came from '>>=' are handled by closeAngle only for templates
    if (t.k === 'op' && t.s === '>' && (this.toks[this.p] as any).split === undefined && this.peek().s === '>=' && (this.peek() as any).adj) { /* unreachable */ }
    return l;
  }

  parseCond(): Expr {
    const c = this.parseBinary(1);
    if (this.isOp('?')) {
      const pos = this.pos();
      this.p++;
      const savedGt = this.noGt; this.noGt = 0;
      const a = this.parseExpr();
      this.noGt = savedGt;
      this.expect(':');
      const b = this.parseAssign();
      return { k: 'cond', c, a, b, pos };
    }
    return c;
  }

  private binOp(): string | null {
    const t = this.t;
    if (t.k !== 'op') return null;
    if (this.noGt > 0 && (t.s === '>' || t.s === '>>')) return null;
    // re-join split '>' '>' (from a speculative template parse)
    if (t.s === '>' && (t as any).split && this.peek().s === '>' && (this.peek() as any).split) return '>>';
    const s = t.s;
    if (s in BIN_PREC) return s;
    return null;
  }

  parseBinary(minPrec: number): Expr {
    let l = this.parseUnary();
    for (;;) {
      const op = this.binOp();
      if (!op) break;
      const prec = BIN_PREC[op];
      if (prec < minPrec) break;
      const pos = this.pos();
      this.p += op === '>>' && this.t.s === '>' ? 2 : 1;
      const r = this.parseBinary(prec + 1);
      l = { k: 'bin', op, l, r, pos };
    }
    return l;
  }

  parseUnary(): Expr {
    const pos = this.pos();
    const t = this.t;
    if (t.k === 'op') {
      switch (t.s) {
        case '++': case '--': { this.p++; const e = this.parseUnary(); return { k: 'un', op: t.s, e, pos }; }
        case '+': case '-': case '!': case '~': case '*': case '&': { this.p++; const e = this.parseUnary(); return { k: 'un', op: t.s, e, pos }; }
        case '&&': { this.p++; const e = this.parseUnary(); return { k: 'un', op: '&', e: { k: 'un', op: '&', e, pos }, pos }; }
        case '::': {
          if (this.peek().k === 'id' && (this.peek().s === 'new' || this.peek().s === 'delete')) { this.p++; return this.parseUnary(); }
          break;
        }
        case '(': {
          // C-style cast?
          const cast = this.try(() => {
            this.p++;
            if (!this.looksLikeTypeHere()) throw new CompileError('x');
            const ty = this.parseTypeId();
            this.expect(')');
            // what follows must start a unary-expression, and not be a binary operator
            const nx = this.t;
            if (nx.k === 'eof') throw new CompileError('x');
            if (nx.k === 'op' && !['(', '-', '+', '*', '&', '!', '~', '++', '--', '{', '::', '&&'].includes(nx.s)) throw new CompileError('x');
            if (nx.k === 'op' && (nx.s === '-' || nx.s === '+' || nx.s === '*' || nx.s === '&') && !(ty.k === 'ptr' || ty.k === 'ref' || (ty.k === 'base' && (ty.spec.base.k === 'builtin' || ty.spec.base.k === 'auto' || ty.spec.base.k === 'name')))) throw new CompileError('x');
            return ty;
          });
          if (cast) {
            if (this.isOp('{')) { const init = this.parseBraceInit(); return { k: 'fcast', t: cast, args: (init as any).items, brace: true, pos }; }
            const e = this.parseUnary();
            return { k: 'cast', kind: 'c', t: cast, e, pos };
          }
          break;
        }
      }
    }
    if (t.k === 'id' && t.s.startsWith('__is_') && this.isOpAt(1, '(')) {
      this.p += 2;
      const types: TypeExpr[] = [];
      for (;;) { types.push(this.parseTypeId()); if (!this.accept(',')) break; }
      this.expect(')');
      return { k: 'trait', name: t.s, types, pos };
    }
    if (t.k === 'id') {
      switch (t.s) {
        case 'sizeof': {
          this.p++;
          if (this.accept('...')) { this.expect('('); const n = this.ident(); this.expect(')'); return { k: 'sizeof-pack', name: n, pos }; }
          if (this.isOp('(')) {
            const ty = this.try(() => { this.p++; if (!this.looksLikeTypeHere()) throw new CompileError('x'); const ty = this.parseTypeId(); this.expect(')'); return ty; });
            if (ty) return { k: 'sizeof-t', t: ty, pos };
          }
          const e = this.parseUnary();
          return { k: 'sizeof-e', e, pos };
        }
        case 'alignof': case '_Alignof': { this.p++; this.expect('('); const ty = this.parseTypeId(); this.expect(')'); return { k: 'alignof', t: ty, pos }; }
        case 'new': return this.parseNew(pos);
        case 'delete': {
          this.p++;
          let arr = false;
          if (this.isOp('[') && this.isOpAt(1, ']')) { this.p += 2; arr = true; }
          const e = this.parseUnary();
          return { k: 'delete', arr, e, pos };
        }
        case 'noexcept': { this.p++; this.expect('('); const e = this.parseExpr(); this.expect(')'); return { k: 'noexcept', e, pos }; }
        case 'throw': return this.parseAssign();
        case 'co_await': case 'co_yield': case 'co_return': this.err('coroutines are not supported');
      }
    }
    return this.parsePostfix();
  }

  /** after '(' — does a type-id start here? */
  private looksLikeTypeHere(): boolean {
    const t = this.t;
    if (t.k !== 'id') return t.k === 'op' && t.s === '::' && this.isTypeNameStart(false);
    if (CV.has(t.s) || BUILTIN_WORDS.has(t.s) || t.s === 'auto' || t.s === 'decltype' || t.s === 'typename' || t.s === 'struct' || t.s === 'class' || t.s === 'enum' || t.s === 'union') return true;
    if (KEYWORDS.has(t.s)) return false;
    return this.isTypeNameStart(false);
  }

  private parseNew(pos: Pos): Expr {
    this.expect('new');
    const place: Expr[] = [];
    if (this.isOp('(')) {
      // placement args  new (p) T   — or parenthesised type  new (T)
      const asType = this.try(() => { this.p++; const t = this.parseTypeId(); this.expect(')'); return t; });
      if (!asType) { this.p++; place.push(...this.parseArgList(')')); }
      else this.p = this.p; // consumed the type; handled below
      if (asType) {
        let arr: Expr | null = null;
        let args: Expr[] | null = null;
        let brace = false;
        if (this.accept('(')) args = this.parseArgList(')');
        else if (this.isOp('{')) { const i = this.parseBraceInit(); args = (i as any).items; brace = true; }
        return { k: 'new', t: asType, place, args, brace, arr, pos };
      }
    }
    const ds = this.parseDeclSpecs(false);
    if (!ds.spec) this.err('expected a type after new');
    // declarator without a name: pointers and the first array bound
    let ty: TypeExpr = { k: 'base', spec: ds.spec };
    while (this.isOp('*')) { this.p++; while (this.isId('const')) this.p++; ty = { k: 'ptr', to: ty }; }
    let arr: Expr | null = null;
    const dims: Array<Expr | null> = [];
    while (this.isOp('[')) {
      this.p++;
      const n = this.isOp(']') ? null : this.parseExpr();
      this.expect(']');
      dims.push(n);
    }
    if (dims.length) {
      arr = dims[0];
      // inner dimensions become part of the element type: new int[3][4]  => array 3 of int[4]
      for (let i = dims.length - 1; i >= 1; i--) ty = { k: 'arr', of: ty, n: dims[i] };
      if (dims.length === 1 && arr === null) arr = { k: 'num', v: 0n, suf: '', raw: '0', pos };
    }
    let args: Expr[] | null = null;
    let brace = false;
    if (this.accept('(')) args = this.parseArgList(')');
    else if (this.isOp('{')) { const i = this.parseBraceInit(); args = (i as any).items; brace = true; }
    return { k: 'new', t: ty, place, args, brace, arr, pos };
  }

  parsePostfix(): Expr {
    let e = this.parsePrimary();
    for (;;) {
      const pos = this.pos();
      const t = this.t;
      if (t.k !== 'op') break;
      if (t.s === '(') {
        this.p++;
        const args = this.parseArgList(')');
        e = { k: 'call', f: e, args, pos };
      } else if (t.s === '[') {
        this.p++;
        const savedGt = this.noGt; this.noGt = 0;
        const i = this.isOp('{') ? this.parseBraceInit() : this.parseExpr();
        this.noGt = savedGt;
        this.expect(']');
        e = { k: 'index', e, i, pos };
      } else if (t.s === '.' || t.s === '->') {
        this.p++;
        this.accept('template');
        // member name: id, ~id, operator...
        const q = this.parseMemberName();
        e = { k: 'member', e, name: q, arrow: t.s === '->', pos };
      } else if (t.s === '++' || t.s === '--') {
        this.p++;
        e = { k: 'post', op: t.s, e, pos };
      } else break;
    }
    return e;
  }

  private parseMemberName(): QName {
    const pos = this.pos();
    if (this.isOp('~')) { this.p++; const id = this.ident(); return { parts: [{ id: '~' + id }], pos }; }
    if (this.isId('operator')) { const id = this.parseOperatorName(); return { parts: [{ id }], pos }; }
    // may be qualified: p->Base::f()
    const save = this.forceTargs;
    this.forceTargs = true;
    try { return this.parseQName(true); } finally { this.forceTargs = save; }
  }

  private parsePrimary(): Expr {
    const pos = this.pos();
    const t = this.t;
    switch (t.k) {
      case 'num': this.p++; return { k: 'num', v: t.big!, suf: t.suf ?? '', raw: t.raw ?? t.s, pos };
      case 'fnum': this.p++; return { k: 'fnum', v: t.flt!, suf: t.suf ?? '', pos };
      case 'chr': this.p++; return { k: 'chr', v: t.big!, pre: t.pre ?? '', pos };
      case 'str': {
        this.p++;
        let s = t.s;
        let pre = t.pre ?? '';
        while (this.t.k === 'str') { s += this.t.s; if (!pre) pre = this.t.pre ?? ''; this.p++; }
        return { k: 'str', s, pre, pos };
      }
      case 'eof': this.err('unexpected end of file in expression');
      case 'op': {
        if (t.s === '(') {
          this.p++;
          const savedGt = this.noGt; this.noGt = 0;
          // fold expression  (... op pack)  (pack op ...)  (init op ... op pack)
          const fold = this.tryFold(pos);
          if (fold) { this.noGt = savedGt; return fold; }
          const e = this.parseExpr();
          this.noGt = savedGt;
          this.expect(')');
          return e;
        }
        if (t.s === '[') return this.parseLambda(pos);
        if (t.s === '{') return this.parseBraceInit();
        if (t.s === '::') {
          const q = this.parseQName(true);
          return this.finishIdExpr(q, pos);
        }
        this.err(`expected expression before '${t.s}'`);
      }
      case 'id': break;
    }
    // identifiers and keywords
    switch (t.s) {
      case 'true': this.p++; return { k: 'bool', v: true, pos };
      case 'false': this.p++; return { k: 'bool', v: false, pos };
      case 'nullptr': this.p++; return { k: 'nullptr', pos };
      case 'this': this.p++; return { k: 'this', pos };
      case 'static_cast': case 'const_cast': case 'reinterpret_cast': case 'dynamic_cast': {
        this.p++;
        this.expect('<');
        this.noGt++;
        const ty = this.parseTypeId();
        this.noGt--;
        this.closeAngle();
        this.expect('(');
        const savedGt = this.noGt; this.noGt = 0;
        const e = this.parseExpr();
        this.noGt = savedGt;
        this.expect(')');
        return { k: 'cast', kind: t.s.replace('_cast', '') as any, t: ty, e, pos };
      }
      case 'typeid': {
        this.p++; this.expect('(');
        const ty = this.try(() => { if (!this.looksLikeTypeHere()) throw new CompileError('x'); const ty = this.parseTypeId(); if (!this.isOp(')')) throw new CompileError('x'); return ty; });
        let r: Expr;
        if (ty) r = { k: 'typeid', t: ty, pos }; else r = { k: 'typeid', e: this.parseExpr(), pos };
        this.expect(')');
        return r;
      }
      case 'operator': {
        const id = this.parseOperatorName();
        return this.finishIdExpr({ parts: [{ id }], pos }, pos);
      }
    }
    // builtin type used functionally:  int(3.5)  unsigned(x)  double{1}
    if (BUILTIN_WORDS.has(t.s) || t.s === 'auto' || t.s === 'decltype' || t.s === 'typename') {
      const dsp = this.parseDeclSpecs(false);
      if (!dsp.spec) this.err('expected a type');
      const ty: TypeExpr = { k: 'base', spec: dsp.spec };
      if (this.isOp('(')) { this.p++; const args = this.parseArgList(')'); return { k: 'fcast', t: ty, args, brace: false, pos }; }
      if (this.isOp('{')) { const init = this.parseBraceInit(); return { k: 'fcast', t: ty, args: (init as any).items, brace: true, pos }; }
      return { k: 'type', t: ty, pos };
    }
    if (KEYWORDS.has(t.s) && !this.ctx.typeNames.has(t.s)) this.err(`expected expression before '${t.s}'`);
    const q = this.parseQName(true);
    return this.finishIdExpr(q, pos);
  }

  private finishIdExpr(q: QName, pos: Pos): Expr {
    const last = q.parts[q.parts.length - 1].id;
    const isTypeName = this.ctx.typeNames.has(last) || (this.ctx.templNames.has(last) && !this.ctx.funcTempls.has(last));
    // T(args) / T{args}  -> functional cast / construction
    if (isTypeName && (this.isOp('{') || (this.isOp('(') && !this.looksLikeCallToFunction(q)))) {
      const ty: TypeExpr = { k: 'base', spec: { k: 'spec', base: { k: 'name', q }, pos } };
      if (this.isOp('{')) { const init = this.parseBraceInit(); return { k: 'fcast', t: ty, args: (init as any).items, brace: true, pos }; }
      this.p++;
      const args = this.parseArgList(')');
      return { k: 'fcast', t: ty, args, brace: false, pos };
    }
    return { k: 'id', q, pos };
  }

  private looksLikeCallToFunction(_q: QName): boolean { return false; }

  private tryFold(pos: Pos): Expr | null {
    // (... op e)   (e op ...)   (e op ... op e)
    if (this.isOp('...')) {
      return this.try(() => {
        this.p++;
        const op = this.t.s; this.p++;
        const pack = this.parseCast();
        this.expect(')');
        return { k: 'fold', op, pack, left: true, pos } as Expr;
      });
    }
    return this.try(() => {
      const save = this.noGt;
      const e = this.parseBinary(12);
      this.noGt = save;
      const op = this.t.s;
      if (this.t.k !== 'op' || !(op in BIN_PREC || ASSIGN_OPS.has(op) || op === ',')) throw new CompileError('x');
      this.p++;
      this.expect('...');
      if (this.accept(')')) return { k: 'fold', op, pack: e, left: false, pos } as Expr;
      const op2 = this.t.s;
      if (op2 !== op) throw new CompileError('x');
      this.p++;
      const r = this.parseCast();
      this.expect(')');
      return { k: 'fold', op, pack: e, init: r, left: false, pos } as Expr;
    });
  }

  private parseCast(): Expr { return this.parseUnary(); }

  private parseLambda(pos: Pos): Expr {
    this.expect('[');
    const cap: LambdaCap[] = [];
    let capDefault: '' | '=' | '&' = '';
    while (!this.isOp(']')) {
      if (this.isOp('=')) { this.p++; capDefault = '='; }
      else if (this.isOp('&') && (this.isOpAt(1, ',') || this.isOpAt(1, ']'))) { this.p++; capDefault = '&'; }
      else if (this.isId('this')) { this.p++; cap.push({ name: 'this', byRef: true, this: true }); }
      else if (this.isOp('*') && this.isOpAt(1, 'this')) { this.p += 2; cap.push({ name: 'this', byRef: false, this: true }); }
      else {
        let byRef = false;
        if (this.accept('&')) byRef = true;
        const pack = this.accept('...');
        const name = this.ident();
        const c: LambdaCap = { name, byRef, pack };
        if (this.accept('=')) c.init = this.parseAssign();
        else if (this.isOp('{')) c.init = this.parseBraceInit();
        else if (this.isOp('(')) { this.p++; c.init = this.parseArgList(')')[0]; }
        cap.push(c);
      }
      if (!this.accept(',')) break;
    }
    this.expect(']');
    let tparams: TemplateParam[] | undefined;
    if (this.isOp('<')) tparams = this.parseTemplateParams();
    let params: Param[] = [];
    let mutable = false;
    let ret: TypeExpr | undefined;
    if (this.accept('(')) {
      const r = this.parseParams();
      params = r.params;
    }
    for (;;) {
      if (this.isId('mutable')) { this.p++; mutable = true; continue; }
      if (this.isId('constexpr') || this.isId('consteval')) { this.p++; continue; }
      if (this.isId('noexcept')) { this.p++; if (this.isOp('(')) this.skipParens(); continue; }
      break;
    }
    if (this.accept('->')) ret = this.parseTypeId();
    if (!this.isOp('{')) this.err("expected '{' for the lambda body");
    const body = this.parseBlock();
    return { k: 'lambda', cap, capDefault, params, ret, body, mutable, tparams, pos };
  }
}

interface DeclSpecs {
  spec: TSpec | null;
  storage: '' | 'static' | 'extern' | 'thread_local';
  inline: boolean;
  constexpr: boolean;
  virtual: boolean;
  explicit: boolean;
  friend: boolean;
  typedef: boolean;
  mutable?: boolean;
  classDecl?: ClassDecl;
  enumDecl?: EnumDecl;
  alignas?: Expr;
  friendDone?: boolean;
}

export function parseTokens(tokens: Token[], ctx: ParseCtx): Decl[] {
  const p = new Parser(tokens, ctx);
  return p.parseProgram();
}
