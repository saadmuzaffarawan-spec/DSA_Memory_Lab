// Converts an interpreter Type into the plain-data TypeNode the UI uses to draw objects.
import type { Interp } from './interp';
import type { TypeNode } from './trace';
import { prettyType, type Type } from './types';
import { sizeOf } from './layout';

export function typeNodeOf(I: Interp, t: Type, depth = 0): TypeNode {
  const name = prettyType(t);
  const size = t.k === 'ref' ? 8 : t.k === 'fn' || t.k === 'void' ? 0 : safeSize(t);
  switch (t.k) {
    case 'ptr': return { name, size, kind: 'pointer', to: prettyType(t.to) };
    case 'ref': return { name, size, kind: 'ref', to: prettyType(t.to) };
    case 'nullptr': return { name, size, kind: 'pointer', to: 'void' };
    case 'fn': return { name, size, kind: 'func' };
    case 'enum': return { name, size, kind: 'enum' };
    case 'arr': return { name, size, kind: 'array', elem: depth > 6 ? undefined : typeNodeOf(I, t.of, depth + 1), count: t.n ?? 0 };
    case 'cls': {
      const c = t.c;
      I.completeClass(c);
      if (!c.defined) return { name, size: 0, kind: 'class' };
      const L = I.layoutOf(c);
      const kind: TypeNode['kind'] = c.tag === 'union' ? 'union' : c.tag === 'struct' ? 'struct' : 'class';
      const node: TypeNode = { name, size: L.size, kind, parts: [] };
      const parts = node.parts!;
      if (L.vptrOffset !== null) parts.push({ label: I.plat.id === 'windows' ? '__vfptr' : '_vptr', off: L.vptrOffset, size: 8, kind: 'vptr' });
      if (L.vbptrOffset !== null) parts.push({ label: '__vbptr', off: L.vbptrOffset, size: 8, kind: 'vbptr' });
      for (const b of c.bases) {
        if (b.virtual) {
          const off = L.vbaseOffsets.get(b.cls);
          if (off !== undefined) parts.push({ label: b.cls.name, off, size: I.layoutOf(b.cls).nvsize || I.layoutOf(b.cls).size, kind: 'vbase', type: depth > 4 ? undefined : typeNodeOf(I, { k: 'cls', c: b.cls }, depth + 1) });
        } else {
          parts.push({ label: b.cls.name, off: b.offset ?? 0, size: I.layoutOf(b.cls).nvsize || I.layoutOf(b.cls).size, kind: 'base', type: depth > 4 ? undefined : typeNodeOf(I, { k: 'cls', c: b.cls }, depth + 1) });
        }
      }
      for (const f of c.fields) {
        if (f.isStatic) continue;
        const ft = f.type.k === 'ref' ? f.type : f.type;
        const p: NonNullable<TypeNode['parts']>[number] = {
          label: f.name || '(anonymous)', off: f.offset ?? 0, size: f.bits !== undefined ? Math.max(1, Math.ceil(((f.bitOffset ?? 0) % 8 + f.bits) / 8)) : f.type.k === 'ref' ? 8 : safeSize(ft),
          kind: 'field', type: depth > 4 ? undefined : typeNodeOf(I, ft, depth + 1),
        };
        if (f.bits !== undefined) p.bit = [(f.bitOffset ?? 0) % 8, f.bits];
        parts.push(p);
      }
      for (const [off, len] of L.padding) parts.push({ label: 'padding', off, size: len, kind: 'pad' });
      parts.sort((a, b) => a.off - b.off || (a.kind === 'pad' ? 1 : 0) - (b.kind === 'pad' ? 1 : 0));
      return node;
    }
    default: return { name, size, kind: 'scalar' };
  }
}

function safeSize(t: Type): number {
  try { return sizeOf(t); } catch { return 0; }
}
