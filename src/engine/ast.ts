// AST for the C++17 teaching subset.
export interface Pos { line: number; col: number }

// ---- names and types (syntactic) ----------------------------------------------------------------------------
export interface NamePart { id: string; targs?: TArg[]; /** operator/destructor names are stored in id too */ }
export interface QName { global?: boolean; parts: NamePart[]; pos: Pos }
export type TArg = { k: 'type'; t: TypeExpr } | { k: 'expr'; e: Expr } | { k: 'pack'; t: TypeExpr };

export interface TSpec {
  k: 'spec';
  base:
    | { k: 'builtin'; names: string[] }
    | { k: 'name'; q: QName; typename?: boolean }
    | { k: 'auto' }
    | { k: 'decltype'; e: Expr }
    | { k: 'elab'; tag: 'struct' | 'class' | 'union' | 'enum'; q: QName }
    | { k: 'anon-class'; cls: ClassDecl };
  const?: boolean;
  volatile?: boolean;
  pos: Pos;
}

export type TypeExpr =
  | { k: 'base'; spec: TSpec }
  | { k: 'ptr'; to: TypeExpr; const?: boolean; volatile?: boolean }
  | { k: 'ref'; to: TypeExpr; rv: boolean }
  | { k: 'arr'; of: TypeExpr; n: Expr | null }
  | { k: 'fn'; ret: TypeExpr; params: Param[]; variadic: boolean; cv?: boolean; noexcept?: boolean }
  | { k: 'memptr'; cls: QName; to: TypeExpr }
  | { k: 'pack'; of: TypeExpr };

export interface Param {
  type: TypeExpr;
  name?: string;
  def?: Expr;
  pack?: boolean;
  pos: Pos;
}

export interface TemplateParam {
  kind: 'type' | 'nontype' | 'template';
  name: string;
  def?: TypeExpr | Expr;
  pack?: boolean;
  ntype?: TypeExpr;
}

// ---- expressions ----------------------------------------------------------------------------------------------
export type Expr =
  | { k: 'num'; v: bigint; suf: string; raw: string; pos: Pos }
  | { k: 'fnum'; v: number; suf: string; pos: Pos }
  | { k: 'str'; s: string; pre: string; pos: Pos }
  | { k: 'chr'; v: bigint; pre: string; pos: Pos }
  | { k: 'bool'; v: boolean; pos: Pos }
  | { k: 'nullptr'; pos: Pos }
  | { k: 'this'; pos: Pos }
  | { k: 'id'; q: QName; pos: Pos }
  | { k: 'un'; op: string; e: Expr; pos: Pos }
  | { k: 'post'; op: '++' | '--'; e: Expr; pos: Pos }
  | { k: 'bin'; op: string; l: Expr; r: Expr; pos: Pos }
  | { k: 'assign'; op: string; l: Expr; r: Expr; pos: Pos }
  | { k: 'cond'; c: Expr; a: Expr; b: Expr; pos: Pos }
  | { k: 'call'; f: Expr; args: Expr[]; pos: Pos }
  | { k: 'index'; e: Expr; i: Expr; pos: Pos }
  | { k: 'member'; e: Expr; name: QName; arrow: boolean; pos: Pos }
  | { k: 'cast'; kind: 'c' | 'static' | 'reinterpret' | 'const' | 'dynamic'; t: TypeExpr; e: Expr; pos: Pos }
  | { k: 'fcast'; t: TypeExpr; args: Expr[]; brace: boolean; pos: Pos }
  | { k: 'sizeof-t'; t: TypeExpr; pos: Pos }
  | { k: 'sizeof-e'; e: Expr; pos: Pos }
  | { k: 'alignof'; t: TypeExpr; pos: Pos }
  | { k: 'sizeof-pack'; name: string; pos: Pos }
  | { k: 'new'; t: TypeExpr; place: Expr[]; args: Expr[] | null; brace: boolean; arr: Expr | null; pos: Pos }
  | { k: 'delete'; arr: boolean; e: Expr; pos: Pos }
  | { k: 'lambda'; cap: LambdaCap[]; capDefault: '' | '=' | '&'; params: Param[]; ret?: TypeExpr; body: Stmt; mutable: boolean; tparams?: TemplateParam[]; pos: Pos }
  | { k: 'init'; items: Expr[]; pos: Pos; designated?: Array<string | null> }
  | { k: 'throw'; e: Expr | null; pos: Pos }
  | { k: 'typeid'; e?: Expr; t?: TypeExpr; pos: Pos }
  | { k: 'fold'; op: string; pack: Expr; init?: Expr; left: boolean; pos: Pos }
  | { k: 'expand'; e: Expr; pos: Pos }
  | { k: 'type'; t: TypeExpr; pos: Pos }
  | { k: 'noexcept'; e: Expr; pos: Pos }
  | { k: 'trait'; name: string; types: TypeExpr[]; pos: Pos };

export interface LambdaCap { name: string; byRef: boolean; init?: Expr; this?: boolean; pack?: boolean }

// ---- statements -------------------------------------------------------------------------------------------------
export interface Declarator {
  name: string;
  qname?: QName;
  type: TypeExpr;
  init?: Expr;
  /** direct-init arguments  T x(a, b)  */
  ctorArgs?: Expr[];
  /** brace-init  T x{a, b} */
  braceInit?: Expr;
  bits?: Expr;
  pos: Pos;
}

export interface VarDecl {
  k: 'var';
  spec: TSpec;
  decls: Declarator[];
  storage: '' | 'static' | 'extern' | 'thread_local';
  constexpr: boolean;
  pos: Pos;
  alignas?: Expr;
  mutable?: boolean;
  /** variable template:  template <class T> constexpr bool v = ...; */
  tparams?: TemplateParam[] | null;
}

export type Stmt =
  | { k: 'block'; body: Stmt[]; pos: Pos }
  | { k: 'expr'; e: Expr; pos: Pos }
  | VarDecl
  | { k: 'if'; init?: Stmt; c: Expr | VarDecl; then: Stmt; else?: Stmt; constexpr?: boolean; pos: Pos }
  | { k: 'while'; c: Expr | VarDecl; body: Stmt; pos: Pos }
  | { k: 'do'; body: Stmt; c: Expr; pos: Pos }
  | { k: 'for'; init?: Stmt; c?: Expr | VarDecl; step?: Expr; body: Stmt; pos: Pos }
  | { k: 'rfor'; init?: Stmt; decl: VarDecl | { k: 'bindings'; names: string[]; ref: TypeExpr | null; spec: TSpec; pos: Pos }; range: Expr; body: Stmt; pos: Pos }
  | { k: 'switch'; init?: Stmt; e: Expr; body: Stmt; pos: Pos }
  | { k: 'case'; e: Expr; pos: Pos }
  | { k: 'default'; pos: Pos }
  | { k: 'break'; pos: Pos }
  | { k: 'continue'; pos: Pos }
  | { k: 'return'; e?: Expr; pos: Pos }
  | { k: 'goto'; label: string; pos: Pos }
  | { k: 'label'; name: string; stmt: Stmt; pos: Pos }
  | { k: 'try'; body: Stmt; catches: Array<{ param: Param | null; body: Stmt; pos: Pos }>; pos: Pos }
  | { k: 'empty'; pos: Pos }
  | { k: 'bindings'; spec: TSpec; names: string[]; init: Expr; ref: boolean; rv: boolean; pos: Pos }
  | { k: 'static_assert'; c: Expr; msg?: string; pos: Pos }
  | Decl;

// ---- declarations ---------------------------------------------------------------------------------------------------
export interface FuncDecl {
  k: 'func';
  /** name as written (may contain :: for out-of-class definitions, or "operator+" / "~X") */
  qname: QName;
  name: string;
  ret: TypeExpr | null; // null for constructors/destructors/conversion ops
  params: Param[];
  variadic: boolean;
  body: Stmt | null;
  storage: '' | 'static' | 'extern';
  inline: boolean;
  constexpr: boolean;
  virtual: boolean;
  pure: boolean;
  override: boolean;
  final: boolean;
  explicit: boolean;
  constMethod: boolean;
  refQual: '' | '&' | '&&';
  noexcept: boolean;
  noexceptCond?: Expr;
  deleted: boolean;
  defaulted: boolean;
  ctorInit: Array<{ name: QName; args: Expr[]; brace: boolean; pack?: boolean }> | null;
  tparams: TemplateParam[] | null;
  access: Access;
  isCtor: boolean;
  isDtor: boolean;
  isConv: boolean;
  convType?: TypeExpr;
  trailingRet?: boolean;
  pos: Pos;
}

export type Access = 'public' | 'protected' | 'private';

export interface ClassDecl {
  k: 'class';
  tag: 'struct' | 'class' | 'union';
  name: string;
  bases: Array<{ q: QName; virtual: boolean; access: Access; pack?: boolean }>;
  members: Member[];
  defined: boolean;
  tparams: TemplateParam[] | null;
  /** explicit/partial specialisation arguments */
  spec?: TArg[];
  final: boolean;
  pack?: number;
  alignas?: Expr;
  pos: Pos;
}

export type Member =
  | { k: 'field'; decl: VarDecl; access: Access; mutable: boolean; static: boolean; alignas?: Expr }
  | { k: 'method'; f: FuncDecl }
  | { k: 'class'; c: ClassDecl; access: Access }
  | { k: 'enum'; e: EnumDecl; access: Access }
  | { k: 'typedef'; d: TypedefDecl; access: Access }
  | { k: 'friend'; target: QName | ClassDecl | FuncDecl; pos: Pos }
  | { k: 'using'; d: Decl; access: Access }
  | { k: 'static_assert'; s: Stmt };

export interface EnumDecl {
  k: 'enum';
  name: string;
  scoped: boolean;
  under?: TypeExpr;
  items: Array<{ name: string; value?: Expr }>;
  pos: Pos;
}

export interface TypedefDecl {
  k: 'typedef';
  name: string;
  type: TypeExpr;
  tparams: TemplateParam[] | null;
  pos: Pos;
}

export type Decl =
  | VarDecl
  | FuncDecl
  | ClassDecl
  | EnumDecl
  | TypedefDecl
  | { k: 'namespace'; name: string; body: Decl[]; inline?: boolean; pos: Pos }
  | { k: 'using-ns'; q: QName; pos: Pos }
  | { k: 'using-decl'; q: QName; pos: Pos }
  | { k: 'static_assert'; c: Expr; msg?: string; pos: Pos }
  | { k: 'pack-begin'; n: number | null; pos: Pos }
  | { k: 'pack-end'; pos: Pos }
  | { k: 'empty'; pos: Pos };

export interface Program { decls: Decl[] }
