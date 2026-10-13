import type { Platform } from './platform';

export interface Cv { const?: boolean; volatile?: boolean }

export type Type = (
  | { k: 'void' }
  | { k: 'bool' }
  | { k: 'int'; bytes: 1 | 2 | 4 | 8; signed: boolean; nm: string }
  | { k: 'float'; bytes: 4 | 8 | 16; nm: string }
  | { k: 'nullptr' }
  | { k: 'ptr'; to: Type }
  | { k: 'ref'; to: Type; rv: boolean }
  | { k: 'arr'; of: Type; n: number | null }
  | { k: 'fn'; ret: Type; params: Type[]; variadic?: boolean }
  | { k: 'cls'; c: ClassInfo }
  | { k: 'enum'; e: EnumInfo }
) & Cv;

export type Access = 'public' | 'protected' | 'private';

export interface FieldInfo {
  name: string;
  type: Type;
  bits?: number;
  isStatic?: boolean;
  access: Access;
  /** default member initializer (AST) */
  init?: unknown;
  anonymous?: boolean;
  mutable?: boolean;
  alignas?: number;
  // filled by layout
  offset?: number;
  bitOffset?: number;
  bitUnit?: number;
}

export interface BaseInfo { cls: ClassInfo; virtual: boolean; access: Access; offset?: number }

export interface Layout {
  size: number;
  align: number;
  /** non-virtual size (Itanium) */
  nvsize: number;
  nvalign: number;
  dsize: number;
  dynamic: boolean;
  empty: boolean;
  vptrOffset: number | null;
  vbptrOffset: number | null;
  /** vbase offsets within the complete object */
  vbaseOffsets: Map<ClassInfo, number>;
  /** true when alignment comes from alignas (not reduced by #pragma pack) */
  explicitAlign?: boolean;
  /** padding intervals [offset, length] inside the complete object */
  padding: Array<[number, number]>;
}

export interface EnumInfo {
  name: string;
  scoped: boolean;
  underlying: Type;
  values: Map<string, bigint>;
  order: string[];
}

export interface ClassInfo {
  id: number;
  name: string;
  tag: 'struct' | 'class' | 'union';
  plat: Platform;
  bases: BaseInfo[];
  fields: FieldInfo[];
  /** declares at least one virtual member function (incl. virtual destructor) */
  declaresVirtual: boolean;
  defined: boolean;
  alignas?: number;
  /** #pragma pack(N) */
  pack?: number;
  layout?: Layout;
  /** interpreter-owned data (methods, ctors, vtables ...) */
  x: any;
}

let classCounter = 1;
export function newClass(name: string, tag: ClassInfo['tag'], plat: Platform): ClassInfo {
  return { id: classCounter++, name, tag, plat, bases: [], fields: [], declaresVirtual: false, defined: false, x: {} };
}

export interface TypeSet {
  void: Type; bool: Type; char: Type; schar: Type; uchar: Type; short: Type; ushort: Type;
  int: Type; uint: Type; long: Type; ulong: Type; llong: Type; ullong: Type;
  wchar: Type; char16: Type; char32: Type;
  float: Type; double: Type; ldouble: Type; nullptr: Type;
  sizeT: Type; ptrdiffT: Type;
}

export function mkTypes(p: Platform): TypeSet {
  const I = (bytes: 1 | 2 | 4 | 8, signed: boolean, nm: string): Type => ({ k: 'int', bytes, signed, nm });
  const T: TypeSet = {
    void: { k: 'void' }, bool: { k: 'bool' },
    char: I(1, p.charSigned, 'char'), schar: I(1, true, 'signed char'), uchar: I(1, false, 'unsigned char'),
    short: I(2, true, 'short'), ushort: I(2, false, 'unsigned short'),
    int: I(4, true, 'int'), uint: I(4, false, 'unsigned int'),
    long: I(p.longBytes, true, 'long'), ulong: I(p.longBytes, false, 'unsigned long'),
    llong: I(8, true, 'long long'), ullong: I(8, false, 'unsigned long long'),
    wchar: I(p.wcharBytes, p.wcharSigned, 'wchar_t'), char16: I(2, false, 'char16_t'), char32: I(4, false, 'char32_t'),
    float: { k: 'float', bytes: 4, nm: 'float' }, double: { k: 'float', bytes: 8, nm: 'double' },
    ldouble: { k: 'float', bytes: p.longDoubleBytes, nm: 'long double' },
    nullptr: { k: 'nullptr' },
    sizeT: p.sizeTIsLongLong ? I(8, false, 'unsigned long long') : I(8, false, 'unsigned long'),
    ptrdiffT: p.sizeTIsLongLong ? I(8, true, 'long long') : I(8, true, 'long'),
  };
  return T;
}

export const ptrTo = (to: Type): Type => ({ k: 'ptr', to });
export const arrOf = (of: Type, n: number | null): Type => ({ k: 'arr', of, n });
export const refTo = (to: Type, rv = false): Type => ({ k: 'ref', to, rv });
export const clsType = (c: ClassInfo): Type => ({ k: 'cls', c });
export const withCv = (t: Type, cv: Cv): Type => ({ ...t, ...(cv.const ? { const: true } : {}), ...(cv.volatile ? { volatile: true } : {}) } as Type);
export const constOf = (t: Type): Type => (t.const ? t : ({ ...t, const: true } as Type));
export const stripCv = (t: Type): Type => {
  if (!t.const && !t.volatile) return t;
  const { const: _c, volatile: _v, ...rest } = t as any;
  return rest as Type;
};
export const stripRef = (t: Type): Type => (t.k === 'ref' ? t.to : t);

export const isInt = (t: Type) => t.k === 'int' || t.k === 'bool' || t.k === 'enum';
export const isFloat = (t: Type) => t.k === 'float';
export const isArith = (t: Type) => isInt(t) || isFloat(t);
export const isPtr = (t: Type) => t.k === 'ptr';
export const isScalar = (t: Type) => isArith(t) || t.k === 'ptr' || t.k === 'nullptr';
export const isClass = (t: Type) => t.k === 'cls';
export const isSignedInt = (t: Type): boolean => (t.k === 'int' ? t.signed : t.k === 'enum' ? isSignedInt(t.e.underlying) : false);

/** the integer type that backs an enum/bool/int */
export function intInfo(t: Type): { bytes: number; signed: boolean } {
  if (t.k === 'int') return { bytes: t.bytes, signed: t.signed };
  if (t.k === 'bool') return { bytes: 1, signed: false };
  if (t.k === 'enum') return intInfo(t.e.underlying);
  if (t.k === 'ptr' || t.k === 'nullptr') return { bytes: 8, signed: false };
  throw new Error('not an integer type: ' + typeStr(t));
}

export function sameType(a: Type, b: Type, ignoreCv = false): boolean {
  if (a === b) return true;
  if (a.k !== b.k) return false;
  if (!ignoreCv && (!!a.const !== !!b.const || !!a.volatile !== !!b.volatile)) return false;
  switch (a.k) {
    case 'int': return a.nm === (b as any).nm;
    case 'float': return a.nm === (b as any).nm;
    case 'ptr': return sameType(a.to, (b as any).to);
    case 'ref': return a.rv === (b as any).rv && sameType(a.to, (b as any).to);
    case 'arr': return a.n === (b as any).n && sameType(a.of, (b as any).of);
    case 'cls': return a.c === (b as any).c;
    case 'enum': return a.e === (b as any).e;
    case 'fn': {
      const f = b as any;
      return a.params.length === f.params.length && sameType(a.ret, f.ret) && a.params.every((p, i) => sameType(p, f.params[i]));
    }
    default: return true;
  }
}

export function typeStr(t: Type, inner = ''): string {
  const cv = (t.const ? 'const ' : '') + (t.volatile ? 'volatile ' : '');
  const sp = (s: string) => (inner ? s + ' ' + inner : s);
  switch (t.k) {
    case 'void': return sp(cv + 'void');
    case 'bool': return sp(cv + 'bool');
    case 'int': case 'float': return sp(cv + t.nm);
    case 'nullptr': return sp('std::nullptr_t');
    case 'cls': return sp(cv + t.c.name);
    case 'enum': return sp(cv + t.e.name);
    case 'ptr': {
      const star = '*' + (t.const ? ' const' : '') + (inner ? inner : '');
      const tt = t.to;
      if (tt.k === 'arr' || tt.k === 'fn') return typeStr(tt, '(' + star + ')');
      return typeStr(tt, star).replace(/\* \*/g, '**');
    }
    case 'ref': {
      const amp = (t.rv ? '&&' : '&') + inner;
      if (t.to.k === 'arr' || t.to.k === 'fn') return typeStr(t.to, '(' + amp + ')');
      return typeStr(t.to, amp);
    }
    case 'arr': return typeStr(t.of, inner + '[' + (t.n ?? '') + ']');
    case 'fn': return typeStr(t.ret, (inner || '') + '(' + t.params.map((p) => typeStr(p)).join(', ') + (t.variadic ? ', ...' : '') + ')');
  }
}

/** Compact pretty form used in the UI: "int *", "int[3]" */
export function prettyType(t: Type): string {
  return typeStr(t).replace(/\s+\*/g, '*').replace(/\*\s+(?=\w)/g, '* ').replace(/ &/g, '&');
}
