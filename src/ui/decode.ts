// Decode raw bytes into the values a C++ programmer expects to see, guided by the engine's type descriptions.
import type { TypeNode } from '../engine/trace';
import { S } from '../engine/trace';
import type { Replay } from './replay';

export interface Value {
  label: string;
  type: string;
  addr: number;
  size: number;
  /** short display text ("42", "3.14", "0x7ffe…", "{…}") */
  text: string;
  /** dominant byte state across the value */
  state: number;
  kind: TypeNode['kind'] | 'pad';
  /** for pointers: the raw address */
  ptr?: number;
  children?: Value[];
  /** a decoded C string preview for char pointers/arrays */
  preview?: string;
  /** set when the field is inherited from a base class */
  via?: string;
}

const hex = (n: number | bigint) => '0x' + n.toString(16);
export const hexAddr = (n: number) => '0x' + n.toString(16);

function readUInt(bytes: Uint8Array): bigint {
  let v = 0n;
  for (let i = bytes.length - 1; i >= 0; i--) v = (v << 8n) | BigInt(bytes[i]);
  return v;
}
function signed(v: bigint, bits: number): bigint {
  const lim = 1n << BigInt(bits - 1);
  return v >= lim ? v - (1n << BigInt(bits)) : v;
}

function fmtFloat(x: number, single: boolean): string {
  if (Number.isNaN(x)) return 'nan';
  if (!Number.isFinite(x)) return x < 0 ? '-inf' : 'inf';
  if (x === 0) return Object.is(x, -0) ? '-0' : '0';
  let s = single ? Number(x.toPrecision(9)).toString() : Number(x.toPrecision(17)).toString();
  // prefer the shortest representation that round-trips
  for (let p = 1; p <= 17; p++) {
    const t = x.toPrecision(p);
    if (single ? Math.fround(Number(t)) === x : Number(t) === x) { s = Number(t).toString(); break; }
  }
  return s;
}

function x87(bytes: Uint8Array): number {
  const mant = readUInt(bytes.subarray(0, 8));
  const se = Number(readUInt(bytes.subarray(8, 10)));
  const sign = se & 0x8000 ? -1 : 1;
  const exp = se & 0x7fff;
  if (exp === 0 && mant === 0n) return sign * 0;
  if (exp === 0x7fff) return (mant << 1n) === 0n ? sign * Infinity : NaN;
  return sign * Number(mant) * Math.pow(2, exp - 16383 - 63);
}

function charText(c: number): string {
  if (c === 0) return "'\\0'";
  if (c === 10) return "'\\n'";
  if (c === 9) return "'\\t'";
  if (c === 13) return "'\\r'";
  if (c === 39) return "'\\''";
  if (c === 92) return "'\\\\'";
  if (c >= 32 && c < 127) return `'${String.fromCharCode(c)}'`;
  return `'\\x${c.toString(16).padStart(2, '0')}'`;
}

function dominantState(states: Uint8Array): number {
  let worst: number = S.Init;
  for (const s of states) {
    if (s === S.Uninit) return S.Uninit;
    if (s === S.Freed || s === S.Dead || s === S.Unalloc) worst = s;
  }
  return worst;
}

export function scalarText(name: string, kind: TypeNode['kind'], bytes: Uint8Array): string {
  const n = name.replace(/\b(const|volatile)\b/g, '').replace(/\s+/g, ' ').trim();
  if (kind === 'pointer' || kind === 'ref') {
    const v = readUInt(bytes);
    return v === 0n ? 'nullptr' : hex(v);
  }
  if (kind === 'enum') return signed(readUInt(bytes), bytes.length * 8).toString();
  if (n === 'bool' || n === '_Bool') return bytes[0] === 0 ? 'false' : bytes[0] === 1 ? 'true' : `${bytes[0]} (not a valid bool)`;
  if (n === 'float') return fmtFloat(new DataView(bytes.buffer, bytes.byteOffset, 4).getFloat32(0, true), true);
  if (n === 'double') return fmtFloat(new DataView(bytes.buffer, bytes.byteOffset, 8).getFloat64(0, true), false);
  if (n === 'long double') return bytes.length === 8 ? fmtFloat(new DataView(bytes.buffer, bytes.byteOffset, 8).getFloat64(0, true), false) : fmtFloat(x87(bytes), false);
  const unsigned = /\bunsigned\b/.test(n) || n === 'size_t' || n === 'uintptr_t' || /^uint/.test(n) || n === 'wchar_t' && false;
  if (n === 'char' || n === 'signed char' || n === 'unsigned char' || n === 'int8_t' || n === 'uint8_t') {
    const v = n === 'char' || n === 'signed char' || n === 'int8_t' ? Number(signed(BigInt(bytes[0]), 8)) : bytes[0];
    return `${v} ${charText(bytes[0])}`;
  }
  if (n === 'wchar_t' || n === 'char16_t' || n === 'char32_t') return `${readUInt(bytes)}`;
  const v = readUInt(bytes);
  return (unsigned ? v : signed(v, bytes.length * 8)).toString();
}

export function peekCString(rp: Replay, addr: number, max = 24): string | undefined {
  if (addr < 0x10000) return undefined;
  let s = '';
  for (let i = 0; i < max; i++) {
    const st = rp.state(addr + i);
    if (st === S.Unalloc || st === S.Uninit) return i === 0 ? undefined : s + '…';
    const c = rp.byte(addr + i);
    if (c === 0) return s;
    if (c < 32 || c > 126) { if (c === 10) { s += '\\n'; continue; } return i === 0 ? undefined : s + '…'; }
    s += String.fromCharCode(c);
  }
  return s + '…';
}

export function decode(node: TypeNode, addr: number, rp: Replay, label: string, depth = 0): Value {
  const states = rp.states(addr, Math.max(1, node.size));
  const base: Value = { label, type: node.name, addr, size: node.size, text: '', state: dominantState(states), kind: node.kind };
  switch (node.kind) {
    case 'scalar':
    case 'enum':
      base.text = scalarText(node.name, node.kind, rp.read(addr, node.size));
      return base;
    case 'pointer':
    case 'ref': {
      const raw = rp.read(addr, node.size);
      base.text = scalarText(node.name, node.kind, raw);
      const v = Number(readUInt(raw));
      base.ptr = v;
      if (v !== 0 && /^(const )?(char|unsigned char|signed char)\b/.test(node.to ?? '')) base.preview = peekCString(rp, v);
      return base;
    }
    case 'array': {
      const elem = node.elem!;
      const count = node.count ?? 0;
      if (/^(const )?(char|unsigned char|signed char)$/.test(elem.name)) {
        let s = '';
        let terminated = false;
        for (let i = 0; i < count; i++) {
          const c = rp.byte(addr + i);
          if (c === 0) { terminated = true; break; }
          s += c >= 32 && c < 127 ? String.fromCharCode(c) : c === 10 ? '\\n' : '·';
        }
        base.preview = s;
        base.text = `"${s}"${terminated ? '' : '…'}`;
      } else base.text = `[${count} × ${elem.name}]`;
      if (depth < 3 && count <= 64) base.children = Array.from({ length: count }, (_, i) => decode(elem, addr + i * elem.size, rp, `[${i}]`, depth + 1));
      else if (depth < 3) base.children = Array.from({ length: 64 }, (_, i) => decode(elem, addr + i * elem.size, rp, `[${i}]`, depth + 1));
      return base;
    }
    case 'struct':
    case 'class':
    case 'union': {
      const kids: Value[] = [];
      for (const p of node.parts ?? []) {
        if (p.kind === 'pad') { kids.push({ label: 'padding', type: '', addr: addr + p.off, size: p.size, text: `${p.size} byte${p.size === 1 ? '' : 's'}`, state: S.Pad, kind: 'pad' }); continue; }
        if (p.kind === 'vptr' || p.kind === 'vbptr') {
          const raw = rp.read(addr + p.off, 8);
          kids.push({ label: p.kind, type: 'pointer to ' + (p.kind === 'vptr' ? 'vtable' : 'vbase table'), addr: addr + p.off, size: 8, text: hex(readUInt(raw)), state: dominantState(rp.states(addr + p.off, 8)), kind: 'pointer', ptr: Number(readUInt(raw)) });
          continue;
        }
        if (p.kind === 'base' && p.type && depth < 4) {
          // a base subobject is shown inline: its fields are the derived object's own, at the same addresses
          const sub = decode(p.type, addr + p.off, rp, p.label, depth + 1);
          for (const k of sub.children ?? []) kids.push(k.kind === 'pad' ? k : { ...k, via: p.label });
          continue;
        }
        if (p.type && depth < 4) kids.push(decode(p.type, addr + p.off, rp, p.label, depth + 1));
        else kids.push({ label: p.label, type: p.type?.name ?? '', addr: addr + p.off, size: p.size, text: '…', state: dominantState(rp.states(addr + p.off, p.size)), kind: p.type?.kind ?? 'scalar' });
      }
      base.children = kids;
      const simple = kids.filter((k) => k.kind !== 'pad');
      base.text = '{' + simple.slice(0, 4).map((k) => `${k.label}: ${k.text}`).join(', ') + (simple.length > 4 ? ', …' : '') + '}';
      return base;
    }
    default:
      base.text = '…';
      return base;
  }
}
