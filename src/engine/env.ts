// Runtime structures of the interpreter: values, scopes, functions, frames, templates.
import type * as A from './ast';
import type { ClassInfo, Type } from './types';

/** Template argument value */
export type TArgVal =
  | { k: 'type'; t: Type }
  | { k: 'val'; v: bigint; t: Type }
  | { k: 'pack'; items: TArgVal[] }
  | { k: 'tmpl'; ent: ClassTemplate };

export interface BitRef { bit: number; width: number; signed: boolean; unit: number }

/** A value during evaluation */
export type V =
  | { k: 'i'; t: Type; v: bigint }
  | { k: 'f'; t: Type; v: number }
  | { k: 'l'; t: Type; a: number; xv?: boolean; bf?: BitRef; tmp?: boolean }
  | { k: 'void' }
  | { k: 'fn'; name: string; cands: Fn[]; tmpls?: FuncTemplate[]; self?: V; ctxCls?: ClassInfo; targs?: TArgVal[]; virt?: boolean; qualified?: boolean }
  | { k: 'type'; t: Type }
  | { k: 'tmpl'; ent: ClassTemplate }
  | { k: 'init'; items: V[]; node: A.Expr };

export type NativeFn = (I: any, args: V[], thisV: V | undefined, dest: number | undefined) => V;

export interface Sig { ret: Type; params: Type[]; variadic: boolean; paramNames: (string | undefined)[]; defaults: (A.Expr | undefined)[] }

export interface Fn {
  id: number;
  name: string;
  qual: string;
  decl: A.FuncDecl | null;
  cls: ClassInfo | null;
  scope: Scope;
  bindings: Map<string, TArgVal> | null;
  native?: NativeFn;
  nativeName?: string;
  sig?: Sig;
  tmpl?: FuncTemplate;
  isStatic: boolean;
  isVirtual: boolean;
  isCtor: boolean;
  isDtor: boolean;
  isConv: boolean;
  isConst: boolean;
  isExplicit: boolean;
  isDeleted: boolean;
  isDefaulted: boolean;
  isPure: boolean;
  userProvided: boolean;
  /** compiler-generated special member (kind) */
  special?: 'ctor0' | 'copy' | 'move' | 'cassign' | 'massign' | 'dtor';
  access: A.Access;
  addr: number;
  lambda?: LambdaInfo;
  /** class of the function when it is a friend defined in-class (for access checks) */
  friendOf?: ClassInfo;
  /** instantiation key for templates */
  key?: string;
  /** lookup cache for overrides */
  overrides?: Fn | null;
  vslot?: number;
  /** body executed lazily: true once instantiation started (guards recursion) */
  instantiating?: boolean;
  /** NRVO plan */
  nrvoVar?: string | null;
  plan?: FramePlan;
  defaultScope?: Scope;
  defParamScope?: Scope;
  deducing?: boolean;
  packInfo?: { name: string; start: number; count: number };
}

export interface FuncTemplate {
  kind: 'func';
  decl: A.FuncDecl;
  scope: Scope;
  cls: ClassInfo | null;
  name: string;
  instances: Map<string, Fn>;
  /** explicit specialisations: key -> Fn */
  specs: Map<string, Fn>;
  outerBindings?: Map<string, TArgVal>;
}

export interface ClassTemplate {
  kind: 'class';
  name: string;
  decl: A.ClassDecl; // primary
  scope: Scope;
  specs: Array<{ decl: A.ClassDecl; params: A.TemplateParam[]; args: A.TArg[] }>;
  instances: Map<string, ClassInfo>;
  aliasOf?: A.TypedefDecl; // alias template
  /** forward declared only so far */
  defined: boolean;
  outOfClass?: Array<{ decl: A.FuncDecl; qualArgs: A.TArg[] }>;
  outOfClassVars?: Array<{ decl: A.VarDecl; dd: A.Declarator; qualArgs: A.TArg[] }>;
}

export interface LambdaInfo {
  node: A.Expr & { k: 'lambda' };
  cls: ClassInfo;
  captures: Array<{ name: string; byRef: boolean; field: string; type: Type; isThis?: boolean }>;
}

export type Ent =
  | { k: 'var'; name: string; type: Type; addr: number; isStatic?: boolean; constant?: bigint | number; refTo?: undefined; node?: unknown; hidden?: boolean }
  | { k: 'fns'; name: string; fns: Fn[]; ftempls: FuncTemplate[] }
  | { k: 'type'; type: Type }
  | { k: 'ctempl'; t: ClassTemplate }
  | { k: 'vtempl'; decl: A.VarDecl; dd: A.Declarator; scope: Scope; inst: Map<string, Ent> }
  | { k: 'ns'; scope: Scope }
  | { k: 'enumc'; type: Type; value: bigint }
  | { k: 'tval'; value: bigint; type: Type }
  | { k: 'pack'; items: TArgVal[]; vals?: V[] }
  | { k: 'cap'; field: string; byRef: boolean; type: Type }
  | { k: 'bind'; name: string; source: V; index: number; type: Type };

export type ScopeKind = 'global' | 'ns' | 'class' | 'func' | 'block' | 'tmpl';

export interface Scope {
  kind: ScopeKind;
  name: string;
  parent: Scope | null;
  names: Map<string, Ent[]>;
  usings: Scope[];
  cls?: ClassInfo;
  fn?: Fn;
  /** variables to destroy (in reverse order) when the scope ends */
  locals?: LocalObj[];
  /** inline namespaces and using-directives pulled in */
  nsq?: string;
  /** frame cursor when the first late (unplanned) slot of this scope was allocated */
  lateMark?: number;
}

export interface LocalObj {
  name: string;
  type: Type;
  addr: number;
  id: number;
  /** needs destruction */
  dtor: boolean;
  constructed: boolean;
  nrvo?: boolean;
}

export interface FramePlan {
  /** declaration node -> slot offset relative to the frame bottom region (filled at call time) */
  slots: Map<unknown, { size: number; align: number; type: Type }>;
  order: unknown[];
  paramBytes: number;
}

export interface Frame {
  id: number;
  fn: Fn | null;
  thisV: V | null;
  /** value of rsp at the call instruction (16-byte aligned) */
  cfa: number;
  /** lowest address in use by this frame (callees start below it) */
  low: number;
  /** next slot for descending allocation */
  cursor: number;
  /** ascending allocation (MSVC debug) */
  upCursor: number;
  upLimit: number;
  slotMap: Map<unknown, number>;
  retSlot: number | undefined;
  line: number;
  tmpMark: number;
  depth: number;
  nrvo: string | null;
  nrvoAddr: number;
  retType: Type | null;
  varsIds: number[];
  scope: Scope;
  /** for lambdas: closure object address */
  catches: number;
  rbp: number;
  retValue: number;
  minCursor: number;
  planned: number;
  paramSlots: number[];
  nrvoActive?: boolean;
}

export class ControlFlow {
  constructor(public kind: 'break' | 'continue' | 'return' | 'goto', public label?: string, public value?: V) {}
}

export class CxxThrow extends Error {
  constructor(public type: Type, public addr: number, public ptrAdjust = 0) {
    super('C++ exception');
  }
}

export function newScope(kind: ScopeKind, parent: Scope | null, name = ''): Scope {
  return { kind, name, parent, names: new Map(), usings: [] };
}
