// Class layout engine: Itanium C++ ABI (Linux, macOS) and MSVC x64 ABI (Windows).
// Cross-checked against clang -fdump-record-layouts in tests/oracle/layout.test.ts.
import type { BaseInfo, ClassInfo, FieldInfo, Layout, Type } from './types';

export function sizeOf(t: Type): number {
  switch (t.k) {
    case 'void': return 1;
    case 'bool': return 1;
    case 'int': case 'float': return t.bytes;
    case 'nullptr': case 'ptr': case 'ref': return 8;
    case 'arr': return (t.n ?? 0) * sizeOf(t.of);
    case 'fn': return 1;
    case 'enum': return sizeOf(t.e.underlying);
    case 'cls': return layoutOf(t.c).size;
  }
}

export function alignOf(t: Type): number {
  switch (t.k) {
    case 'void': case 'bool': case 'fn': return 1;
    case 'int': return t.bytes;
    case 'float': return t.bytes;
    case 'nullptr': case 'ptr': case 'ref': return 8;
    case 'arr': return alignOf(t.of);
    case 'enum': return alignOf(t.e.underlying);
    case 'cls': return layoutOf(t.c).align;
  }
}

export function layoutOf(c: ClassInfo): Layout {
  if (c.layout) return c.layout;
  const l = c.plat.abi === 'msvc' ? layoutMsvc(c) : layoutItanium(c);
  c.layout = l;
  return l;
}

export function isDynamic(c: ClassInfo): boolean {
  return c.declaresVirtual || c.bases.some((b) => b.virtual || isDynamic(b.cls));
}

export function hasVirtualFns(c: ClassInfo): boolean {
  return c.declaresVirtual || c.bases.some((b) => hasVirtualFns(b.cls));
}

/** dynamic class that contains nothing but its vptr */
export function isNearlyEmpty(c: ClassInfo): boolean {
  if (!isDynamic(c) || c.tag === 'union') return false;
  const l = layoutOf(c);
  return l.nvsize === 8 && l.vptrOffset === 0;
}

export function hasVirtualBases(c: ClassInfo): boolean {
  return c.bases.some((b) => b.virtual || hasVirtualBases(b.cls));
}

export function nonStaticFields(c: ClassInfo): FieldInfo[] {
  return c.fields.filter((f) => !f.isStatic);
}

/** C++ "empty class": no non-static data, no vptr, no virtual bases, all bases empty */
export function isEmptyClass(c: ClassInfo): boolean {
  if (c.tag === 'union') return false;
  if (isDynamic(c)) return false;
  if (nonStaticFields(c).some((f) => f.bits !== 0)) return false;
  return c.bases.every((b) => !b.virtual && isEmptyClass(b.cls));
}

/** Plain-old-data for the purpose of layout (C++03 POD): tail padding is NOT reused by derived classes. */
export function isPodForLayout(c: ClassInfo): boolean {
  if (c.x?.nonPod) return false;
  if (c.bases.length) return false;
  if (c.declaresVirtual) return false;
  const acc = nonStaticFields(c).map((f) => f.access);
  if (acc.some((a) => a !== 'public')) return false;
  for (const f of nonStaticFields(c)) {
    let t = f.type;
    while (t.k === 'arr') t = t.of;
    if (t.k === 'ref') return false;
    if (t.k === 'cls' && !isPodForLayout(t.c)) return false;
  }
  return true;
}

const alignTo = (n: number, a: number) => (a <= 1 ? n : Math.ceil(n / a) * a);

function fieldAlign(c: ClassInfo, f: FieldInfo, natural: number): number {
  let t = f.type;
  while (t.k === 'arr') t = t.of;
  if (c.pack && !(t.k === 'cls' && layoutOf(t.c).explicitAlign)) return Math.min(natural, c.pack);
  return natural;
}
const capPack = (c: ClassInfo, a: number, explicit: boolean | undefined) => (c.pack && !explicit ? Math.min(a, c.pack) : a);
const subExplicit = (c: ClassInfo): boolean =>
  !!c.alignas || c.bases.some((b) => layoutOf(b.cls).explicitAlign) || c.fields.some((f) => { let t = f.type; while (t.k === 'arr') t = t.of; return t.k === 'cls' && !f.isStatic && !!layoutOf(t.c).explicitAlign; });

interface Occupant { off: number; cls: ClassInfo }

/** Empty-subobject tracking for the empty base optimisation. */
class EmptyMap {
  occ: Occupant[] = [];
  // all empty subobjects (offset relative to the object start) inside class c (recursively)
  static collect(c: ClassInfo, base: number, out: Occupant[]) {
    const l = layoutOf(c);
    if (!l.empty) {
      // still record empty bases/fields nested inside non-empty classes
    }
    for (const b of c.bases) {
      if (b.virtual) continue;
      const bo = b.offset ?? 0;
      if (isEmptyClass(b.cls)) out.push({ off: base + bo, cls: b.cls });
      EmptyMap.collect(b.cls, base + bo, out);
    }
    for (const f of nonStaticFields(c)) {
      if (f.type.k === 'cls' && isEmptyClass(f.type.c) && f.offset !== undefined) {
        out.push({ off: base + f.offset, cls: f.type.c });
        EmptyMap.collect(f.type.c, base + f.offset, out);
      } else if (f.type.k === 'cls' && f.offset !== undefined) {
        EmptyMap.collect(f.type.c, base + f.offset, out);
      }
    }
  }
  canPlace(cls: ClassInfo, off: number): boolean {
    const mine: Occupant[] = [{ off, cls }];
    // the empty class itself plus nested empty subobjects
    const nested: Occupant[] = [];
    EmptyMap.collect(cls, off, nested);
    const all = mine.concat(nested);
    return !all.some((m) => this.occ.some((o) => o.off === m.off && o.cls === m.cls));
  }
  add(cls: ClassInfo, off: number) {
    this.occ.push({ off, cls });
    const nested: Occupant[] = [];
    EmptyMap.collect(cls, off, nested);
    this.occ.push(...nested);
  }
}

function paddingFrom(size: number, spans: Array<[number, number]>): Array<[number, number]> {
  const covered = new Uint8Array(size);
  for (const [o, n] of spans) for (let i = o; i < Math.min(size, o + n); i++) covered[i] = 1;
  const pads: Array<[number, number]> = [];
  let i = 0;
  while (i < size) {
    if (covered[i]) { i++; continue; }
    let j = i;
    while (j < size && !covered[j]) j++;
    pads.push([i, j - i]);
    i = j;
  }
  return pads;
}

function coveredSpans(c: ClassInfo, l: { vptr: number | null; vbptr: number | null }): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  if (l.vptr !== null) spans.push([l.vptr, 8]);
  if (l.vbptr !== null) spans.push([l.vbptr, 8]);
  for (const f of nonStaticFields(c)) {
    if (f.offset === undefined) continue;
    if (f.bits !== undefined) {
      const startBit = f.offset * 8 + (f.bitOffset ?? 0);
      const s = Math.floor(startBit / 8), e = Math.ceil((startBit + f.bits) / 8);
      if (f.bits > 0) spans.push([s, e - s]);
    } else if (f.type.k === 'cls') {
      const sub = layoutOf(f.type.c);
      // the field's own padding stays padding; mark covered, minus sub padding
      const subCov = paddingFrom(sub.size, []);
      void subCov;
      let cur = f.offset;
      for (const [po, pl] of sub.padding) { if (po > cur - f.offset) spans.push([cur, po - (cur - f.offset)]); cur = f.offset + po + pl; }
      if (cur < f.offset + sub.size) spans.push([cur, f.offset + sub.size - cur]);
    } else {
      spans.push([f.offset, sizeOf(f.type)]);
    }
  }
  for (const b of c.bases) {
    if (b.virtual || b.offset === undefined) continue;
    const bl = layoutOf(b.cls);
    let cur = 0;
    for (const [po, pl] of bl.padding) { if (po > cur) spans.push([b.offset + cur, po - cur]); cur = po + pl; }
    if (cur < bl.size) spans.push([b.offset + cur, bl.size - cur]);
  }
  return spans;
}

// ---------------------------------------------------------------------------------------------
// Itanium C++ ABI
// ---------------------------------------------------------------------------------------------
function layoutItanium(c: ClassInfo): Layout {
  const isUnion = c.tag === 'union';
  const dynamic = isDynamic(c);
  const em = new EmptyMap();
  let sizeBits = 0; // total size so far (bits)
  let dataBits = 0; // data size so far (bits)
  let align = 1; // bytes
  let vptrOffset: number | null = null;
  const vbaseOffsets = new Map<ClassInfo, number>();

  let primary: BaseInfo | undefined;
  let primaryVirtual = false;
  if (dynamic) {
    primary = c.bases.find((b) => !b.virtual && isDynamic(b.cls));
    if (!primary) { primary = c.bases.find((b) => b.virtual && isNearlyEmpty(b.cls)); primaryVirtual = !!primary; }
  }

  const placeBase = (b: BaseInfo, virtual: boolean) => {
    const bl = layoutOf(b.cls);
    const baseAlign = capPack(c, bl.nvalign || bl.align, bl.explicitAlign);
    if (bl.empty && em.canPlace(b.cls, 0)) {
      if (virtual) vbaseOffsets.set(b.cls, 0); else b.offset = 0;
      em.add(b.cls, 0);
      sizeBits = Math.max(sizeBits, bl.size * 8);
      align = Math.max(align, baseAlign);
      return;
    }
    let off = alignTo(Math.ceil(dataBits / 8), baseAlign);
    if (bl.empty) while (!em.canPlace(b.cls, off)) off += baseAlign;
    if (!bl.empty) {
      const nv = isPodForLayout(b.cls) ? bl.size : bl.nvsize;
      dataBits = (off + nv) * 8;
      sizeBits = Math.max(sizeBits, dataBits);
    } else sizeBits = Math.max(sizeBits, (off + bl.size) * 8);
    em.add(b.cls, off);
    align = Math.max(align, baseAlign);
    if (virtual) vbaseOffsets.set(b.cls, off); else b.offset = off;
  };

  const visited = new Set<ClassInfo>();
  if (!isUnion) {
    if (primary) {
      if (primaryVirtual) visited.add(primary.cls);
      placeBase(primary, primaryVirtual);
      vptrOffset = 0;
    } else if (dynamic) {
      vptrOffset = 0;
      sizeBits = 64; dataBits = 64; align = Math.max(align, capPack(c, 8, false));
    }
    for (const b of c.bases) {
      if (b.virtual || b === primary) continue;
      placeBase(b, false);
    }
  }

  for (const f of c.fields) {
    if (f.isStatic) continue;
    const ft = f.type;
    let fa = fieldAlign(c, f, alignOf(ft));
    if (f.alignas) fa = Math.max(fa, f.alignas);
    if (f.bits !== undefined) {
      const typeBytes = sizeOf(ft);
      const typeBits = typeBytes * 8;
      const typeAlignBits = fa * 8;
      let pos = isUnion ? 0 : dataBits;
      if (f.bits === 0) {
        pos = alignTo(pos, typeAlignBits);
        if (!isUnion) { dataBits = pos; sizeBits = Math.max(sizeBits, pos); }
        f.offset = Math.floor(pos / 8); f.bitOffset = pos % 8; f.bitUnit = typeBytes;
        continue;
      }
      if (!c.pack) {
        if ((pos % typeAlignBits) + f.bits > typeBits) pos = alignTo(pos, typeAlignBits);
      }
      f.offset = Math.floor(pos / 8);
      f.bitOffset = pos % 8;
      f.bitUnit = typeBytes;
      if (isUnion) sizeBits = Math.max(sizeBits, f.bits);
      else { dataBits = pos + f.bits; sizeBits = Math.max(sizeBits, dataBits); }
      align = Math.max(align, fa);
      continue;
    }
    const fs = sizeOf(ft);
    let off = isUnion ? 0 : alignTo(Math.ceil(dataBits / 8), fa);
    if (ft.k === 'cls' && isEmptyClass(ft.c) && !isUnion) {
      while (!em.canPlace(ft.c, off)) off += fa;
      em.add(ft.c, off);
    }
    f.offset = off;
    if (isUnion) sizeBits = Math.max(sizeBits, fs * 8);
    else { dataBits = (off + fs) * 8; sizeBits = Math.max(sizeBits, dataBits); }
    align = Math.max(align, fa);
  }

  const explicit = subExplicit(c);
  if (c.alignas) align = Math.max(align, c.alignas);
  const nvsizeBytes = Math.ceil((isUnion ? sizeBits : dataBits) / 8);
  const nvalign = align;

  const layVirtual = (cls: ClassInfo) => {
    for (const b of cls.bases) {
      if (b.virtual && !visited.has(b.cls)) { visited.add(b.cls); placeBase(b, true); }
      layVirtual(b.cls);
    }
  };
  if (!isUnion) layVirtual(c);
  align = Math.max(align, ...[...vbaseOffsets.keys()].map((k) => capPack(c, layoutOf(k).align, layoutOf(k).explicitAlign)));

  let size = Math.ceil(sizeBits / 8);
  const empty = isEmptyClass(c);
  if (size === 0) size = 1;
  size = alignTo(size, align);
  const lay: Layout = {
    size, align, nvsize: nvsizeBytes, nvalign, dsize: Math.ceil(dataBits / 8), dynamic, empty,
    vptrOffset, vbptrOffset: null, vbaseOffsets, padding: [], explicitAlign: explicit || undefined,
  };
  c.layout = lay;
  lay.padding = paddingFrom(size, coveredSpans(c, { vptr: vptrOffset, vbptr: null }).concat(virtualSpans(vbaseOffsets)));
  return lay;
}

function virtualSpans(m: Map<ClassInfo, number>): Array<[number, number]> {
  const spans: Array<[number, number]> = [];
  for (const [cls, off] of m) {
    const bl = layoutOf(cls);
    let cur = 0;
    for (const [po, pl] of bl.padding) { if (po > cur) spans.push([off + cur, po - cur]); cur = po + pl; }
    if (cur < bl.size) spans.push([off + cur, bl.size - cur]);
  }
  return spans;
}

// ---------------------------------------------------------------------------------------------
// MSVC x64 ABI
// ---------------------------------------------------------------------------------------------
const msSubZero = (c: ClassInfo): boolean => layoutOf(c).nvsize === 0 || c.bases.some((b) => !b.virtual && msSubZero(b.cls));
const msLeadsZero = (c: ClassInfo): boolean => {
  if (layoutOf(c).nvsize === 0) return true;
  const first = c.bases.find((b) => !b.virtual && b.offset === 0);
  return !!first && msLeadsZero(first.cls);
};

/** true when the class (or any base, virtual ones included) carries a vfptr */
const hasVfptrDeep = (c: ClassInfo): boolean => layoutOf(c).vptrOffset !== null || c.bases.some((b) => hasVfptrDeep(b.cls));

function layoutMsvc(c: ClassInfo): Layout {
  const isUnion = c.tag === 'union';
  const dynamic = isDynamic(c);
  let size = 0;
  let align = 1;
  let vptrOffset: number | null = null;
  let vbptrOffset: number | null = null;
  const vbaseOffsets = new Map<ClassInfo, number>();

  const vfBase = c.bases.find((b) => !b.virtual && layoutOf(b.cls).vptrOffset !== null);
  const vbBase = c.bases.find((b) => !b.virtual && layoutOf(b.cls).vbptrOffset !== null);
  const needsVbptr = c.bases.some((b) => b.virtual || hasVirtualBases(b.cls)) && !vbBase;
  // A class only gets its own vfptr when it introduces a NEW virtual function. A class that merely overrides
  // functions of a dynamic virtual base reuses the vbase's table (and gets vtordisp slots instead).
  const introducesNew: boolean = typeof c.x.newVirtual === 'boolean' ? c.x.newVirtual
    : c.declaresVirtual && !c.bases.some((b) => hasVfptrDeep(b.cls));
  const ownVfptr = c.declaresVirtual && !vfBase && introducesNew;
  const overridesVbase = c.declaresVirtual && !introducesNew;
  let baseAlignSoFar = 0;
  let afterVbptr = false;

  let prev: ClassInfo | null = null;
  const placeBase = (b: BaseInfo) => {
    const bl = layoutOf(b.cls);
    if (prev && msSubZero(prev) && msLeadsZero(b.cls)) size += 1;
    const ba = capPack(c, bl.nvalign, bl.explicitAlign);
    const off = alignTo(size, ba);
    b.offset = off;
    size = off + bl.nvsize;
    align = Math.max(align, ba);
    prev = b.cls;
    if (bl.nvsize > 0) baseAlignSoFar = Math.max(baseAlignSoFar, ba);
  };

  if (!isUnion) {
    if (ownVfptr) { vptrOffset = 0; size = 8; align = Math.max(align, capPack(c, 8, false)); }
    const leading = (b: BaseInfo) => layoutOf(b.cls).vptrOffset === 0;
    const withVf = c.bases.filter((b) => !b.virtual && leading(b));
    for (const b of withVf) placeBase(b);
    if (vfBase) vptrOffset = (vfBase.offset ?? 0) + (layoutOf(vfBase.cls).vptrOffset ?? 0);
    const rest = c.bases.filter((b) => !b.virtual && !withVf.includes(b));
    // With a vbptr the zero-size bases are laid out after it; without one, plain declaration order.
    const nonEmpty = needsVbptr ? rest.filter((b) => layoutOf(b.cls).nvsize > 0) : rest;
    const zero = needsVbptr ? rest.filter((b) => layoutOf(b.cls).nvsize === 0) : [];
    for (const b of nonEmpty) placeBase(b);
    if (needsVbptr) {
      const off = alignTo(size, capPack(c, 8, false));
      vbptrOffset = off; size = off + 8; align = Math.max(align, capPack(c, 8, false));
      afterVbptr = true;
    }
    for (const b of zero) placeBase(b);
    if (!needsVbptr && vbBase) vbptrOffset = (vbBase.offset ?? 0) + layoutOf(vbBase.cls).vbptrOffset!;
  }

  let unit: { bytes: number; used: number; bitStart: number } | null = null;
  for (const f of c.fields) {
    if (f.isStatic) continue;
    const fs = sizeOf(f.type);
    let fa = fieldAlign(c, f, alignOf(f.type));
    if (f.alignas) fa = Math.max(fa, f.alignas);
    if (afterVbptr && f.bits === undefined && !isUnion) {
      // MSVC quirk (found with the clang oracle): a first field more aligned than everything before the vbptr
      // is placed a full field-alignment past the vbptr instead of at the next aligned slot.
      if (baseAlignSoFar > 0 && fa > baseAlignSoFar) size += fa;
      afterVbptr = false;
    } else if (afterVbptr) afterVbptr = false;
    if (f.bits !== undefined) {
      if (f.bits === 0) { if (unit) align = Math.max(align, fa); unit = null; const off = alignTo(size, fa); f.offset = off; f.bitOffset = 0; f.bitUnit = fs; size = Math.max(size, off); continue; }
      const tb = fs * 8;
      if (isUnion) { f.offset = 0; f.bitOffset = 0; f.bitUnit = fs; size = Math.max(size, fs); align = Math.max(align, fa); continue; }
      if (!unit || unit.bytes !== fs || unit.used + f.bits > tb) {
        const off = alignTo(size, fa);
        unit = { bytes: fs, used: 0, bitStart: off * 8 };
        size = off + fs;
      }
      const pos = unit.bitStart + unit.used;
      f.offset = Math.floor(pos / 8); f.bitOffset = pos % 8; f.bitUnit = fs;
      unit.used += f.bits;
      align = Math.max(align, fa);
      continue;
    }
    unit = null;
    if (isUnion) { f.offset = 0; size = Math.max(size, fs); }
    else { const off = alignTo(size, fa); f.offset = off; size = off + fs; }
    align = Math.max(align, fa);
  }

  const explicit = subExplicit(c);
  const naturalAlign = align;
  if (c.alignas) align = Math.max(align, c.alignas);
  const nvalign = align;
  const nvsize = size === 0 ? 0 : alignTo(size, naturalAlign);
  void dynamic;

  if (!isUnion) {
    const seen = new Set<ClassInfo>();
    const walk = (cls: ClassInfo) => {
      for (const b of cls.bases) {
        walk(b.cls);
        if (b.virtual && !seen.has(b.cls)) {
          seen.add(b.cls);
          const bl = layoutOf(b.cls);
          const ba = capPack(c, bl.align, bl.explicitAlign);
          const vt = overridesVbase && hasVfptrDeep(b.cls) ? 4 : 0;
          const off = alignTo(size + vt, Math.max(ba, align));
          vbaseOffsets.set(b.cls, off);
          size = off + bl.nvsize;
          align = Math.max(align, ba);
        }
      }
    };
    walk(c);
  }

  const empty = isEmptyClass(c);
  if (size === 0) size = 1;
  size = alignTo(size, align);
  const lay: Layout = { size, align, nvsize, nvalign, dsize: size, dynamic: isDynamic(c), empty, vptrOffset, vbptrOffset, vbaseOffsets, padding: [], explicitAlign: explicit || undefined };
  c.layout = lay;
  lay.padding = paddingFrom(size, coveredSpans(c, { vptr: vptrOffset, vbptr: vbptrOffset }).concat(virtualSpans(vbaseOffsets)));
  return lay;
}
