// The trace: everything the UI needs to replay (and rewind) an execution, as plain data.
// The engine runs in a Web Worker and emits these events; the UI never talks to the interpreter directly.

/** Per-byte state kept next to every byte of simulated memory ("shadow memory"). */
export const S = {
  Unalloc: 0, // not part of any object
  Uninit: 1, // belongs to an object, never written
  Init: 2, // holds a value written by the program
  Pad: 3, // padding inside an object
  Freed: 4, // heap memory that was freed
  Meta: 5, // allocator bookkeeping (chunk headers, free-list links, guard bytes)
  Dead: 6, // stack memory of a frame that has returned / a scope that ended
} as const;
export type SState = (typeof S)[keyof typeof S];

export const STATE_NAMES = ['unallocated', 'uninitialised', 'initialised', 'padding', 'freed', 'allocator metadata', 'dead stack'] as const;

export type DiagCode =
  | 'uninit-read' | 'use-after-free' | 'dangling-stack' | 'heap-overflow' | 'stack-overflow-write' | 'write-metadata'
  | 'double-free' | 'invalid-free' | 'mismatched-free' | 'leak' | 'out-of-bounds' | 'null-deref' | 'signed-overflow'
  | 'shift-ub' | 'div-zero' | 'unsequenced' | 'strict-aliasing' | 'misaligned' | 'bad-delete' | 'ub-other' | 'info';

export interface Diag {
  code: DiagCode;
  severity: 'error' | 'warn' | 'info';
  title: string;
  /** one or two sentences, plain language */
  body: string;
  addr?: number;
  len?: number;
  line?: number;
}

export type Ev =
  | { t: 'w'; a: number; o: Uint8Array; n: Uint8Array; os: Uint8Array; ns: Uint8Array }
  | { t: 'r'; a: number; l: number }
  | { t: 'line'; line: number; col: number }
  | { t: 'push'; id: number; name: string; base: number; ret: number; retLabel: string; line: number; args: string }
  | { t: 'pop'; id: number }
  | { t: 'var'; id: number; name: string; type: string; a: number; size: number; frame: number; line: number; kind: 'local' | 'param' | 'global' | 'static' | 'temp' | 'member' }
  | { t: 'unvar'; id: number }
  | { t: 'alloc'; id: number; a: number; size: number; usable: number; chunk: number; how: string; line: number; type?: string }
  | { t: 'free'; id: number; how: string; line: number }
  | { t: 'brk'; from: number; to: number }
  | { t: 'out'; s: string }
  | { t: 'diag'; d: Diag }
  | { t: 'note'; msg: string }
  | { t: 'end'; code: number; reason: 'return' | 'exit' | 'fault' | 'limit' | 'abort'; msg?: string };

export interface TypeNode {
  /** display name e.g. "int", "Node", "int[3]", "int *" */
  name: string;
  size: number;
  kind: 'scalar' | 'pointer' | 'array' | 'struct' | 'class' | 'union' | 'enum' | 'ref' | 'func';
  /** for pointers/refs: pointed-to type name */
  to?: string;
  /** for arrays: element type, count */
  elem?: TypeNode;
  count?: number;
  /** for classes: parts (fields, bases, vptr, vbptr, padding) in memory order */
  parts?: Array<{ label: string; off: number; size: number; kind: 'field' | 'base' | 'vptr' | 'vbptr' | 'pad' | 'vbase'; type?: TypeNode; bit?: [number, number] }>;
}

export interface VarMeta { id: number; type: TypeNode }

export interface RunResult {
  platform: string;
  events: Ev[];
  /** types of variables and allocations by event id */
  types: Record<number, TypeNode>;
  source: string;
  truncated: boolean;
  exitCode: number | null;
  stdout: string;
  diagnostics: Diag[];
}
