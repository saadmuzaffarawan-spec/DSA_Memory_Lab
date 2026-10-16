import { useMemo, useState } from 'react';
import type { View } from '../view';
import type { Replay } from '../replay';
import type { Selection } from './MemoryPanel';
import { hexAddr } from '../decode';
import { S } from '../../engine/trace';

interface Owner { lo: number; hi: number; label: string }

type Region = 'selected' | 'stack' | 'heap' | 'globals';

const STATE_WORD: Record<number, string> = {
  [S.Unalloc]: 'unallocated', [S.Uninit]: 'uninitialised', [S.Init]: 'initialised', [S.Pad]: 'padding', [S.Freed]: 'freed', [S.Meta]: 'allocator metadata', [S.Dead]: 'dead stack',
};

function owners(view: View): Owner[] {
  const o: Owner[] = [];
  for (const f of view.frames) {
    for (const v of f.vars) o.push({ lo: v.value.addr, hi: v.value.addr + v.value.size, label: `${v.name} (${v.value.type}) in ${f.name}` });
    o.push({ lo: f.ret - 0, hi: f.ret, label: '' });
  }
  for (const v of view.globals) o.push({ lo: v.value.addr, hi: v.value.addr + v.value.size, label: `${v.name} (${v.value.type}), global` });
  for (const b of view.heap) {
    if (b.addr > b.chunk) o.push({ lo: b.chunk, hi: b.addr, label: `allocator header of block at ${hexAddr(b.addr)}` });
    o.push({ lo: b.addr, hi: b.addr + b.usable, label: `${b.value.type} heap block${b.state === 'freed' ? ' (freed)' : ''}` });
  }
  return o.filter((x) => x.hi > x.lo);
}

function range(view: View, region: Region, sel: Selection): [number, number] | null {
  const cap = 2048;
  const align = (n: number) => n - (n % 16);
  if (region === 'selected' && sel) {
    if (sel.kind === 'var') {
      for (const f of view.frames) for (const v of f.vars) if (v.id === sel.id) return [align(v.value.addr - 16), align(v.value.addr + v.value.size + 31)];
      for (const v of view.globals) if (v.id === sel.id) return [align(v.value.addr - 16), align(v.value.addr + v.value.size + 31)];
    } else {
      const b = view.heap.find((x) => x.id === sel.id);
      if (b) return [align(b.chunk - 0), align(b.addr + b.usable + 31)];
    }
  }
  if (region === 'stack' || region === 'selected') {
    const addrs = view.frames.flatMap((f) => [f.base, ...f.vars.map((v) => v.value.addr)]);
    if (!addrs.length) return null;
    const lo = Math.min(...addrs) - 16;
    const hi = Math.max(...view.frames.map((f) => f.base)) + 64;
    return [align(Math.max(lo, hi - cap)), align(hi)];
  }
  if (region === 'heap') {
    if (!view.heap.length) return null;
    const lo = Math.min(...view.heap.map((b) => b.chunk));
    const hi = Math.max(...view.heap.map((b) => b.addr + b.usable)) + 16;
    return [align(lo), align(Math.min(hi, lo + cap))];
  }
  if (region === 'globals') {
    if (!view.globals.length) return null;
    const lo = Math.min(...view.globals.map((v) => v.value.addr)) - 8;
    const hi = Math.max(...view.globals.map((v) => v.value.addr + v.value.size)) + 24;
    return [align(lo), align(Math.min(hi, lo + cap))];
  }
  return null;
}

export function HexPanel({ rp, view, sel }: { rp: Replay; view: View; sel: Selection }) {
  const [region, setRegion] = useState<Region>('selected');
  const [tip, setTip] = useState<{ x: number; y: number; text: string[] } | null>(null);
  const own = useMemo(() => owners(view), [view]);
  const r = range(view, region, sel);

  const rows = useMemo(() => {
    if (!r) return [];
    const [lo, hi] = r;
    const out: Array<{ addr: number; bytes: number[]; states: number[] }> = [];
    for (let a = lo; a < hi; a += 16) {
      const bytes: number[] = [], states: number[] = [];
      for (let i = 0; i < 16; i++) { bytes.push(rp.byte(a + i)); states.push(rp.state(a + i)); }
      out.push({ addr: a, bytes, states });
    }
    return out;
  }, [r?.[0], r?.[1], view, rp]);

  const edges = useMemo(() => { const s = new Set<number>(); for (const o of own) s.add(o.lo); return s; }, [own]);
  const access = (a: number): 'w' | 'r' | null => { for (const x of view.access) if (a >= x.a && a < x.a + x.l) return x.kind; return null; };
  const ownerOf = (a: number): Owner | undefined => { let best: Owner | undefined; for (const o of own) if (a >= o.lo && a < o.hi && (!best || o.hi - o.lo < best.hi - best.lo)) best = o; return best; };

  const label = (rg: Region) => ({ selected: 'Selected', stack: 'Stack', heap: 'Heap', globals: 'Globals' })[rg];
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100%' }}>
      <div className="hex-tools">
        <div className="seg" role="group" aria-label="Memory region">
          {(['selected', 'stack', 'heap', 'globals'] as Region[]).map((rg) => (
            <button key={rg} aria-pressed={region === rg} onClick={() => setRegion(rg)}>{label(rg)}</button>
          ))}
        </div>
        <span className="muted" style={{ fontSize: 12 }}>
          {r ? `${hexAddr(r[0])} – ${hexAddr(r[1])} · ${r[1] - r[0]} bytes` : region === 'selected' ? 'Click a variable or heap block to inspect its bytes.' : 'Nothing to show here yet.'}
        </span>
      </div>
      <div className="hex" onMouseLeave={() => setTip(null)}>
        {rows.map((row) => (
          <div className="hex-row" key={row.addr}>
            <span className="hex-addr">{hexAddr(row.addr)}</span>
            <span className="hex-bytes">
              {row.bytes.map((b, i) => {
                const a = row.addr + i;
                const acc = access(a);
                return (
                  <span
                    key={i}
                    className={'hb' + (edges.has(a) ? ' edge' : '') + (acc ? ` acc-${acc}` : '')}
                    data-st={row.states[i]}
                    onMouseMove={(e) => {
                      const ow = ownerOf(a);
                      setTip({ x: e.clientX + 12, y: e.clientY + 14, text: [`${hexAddr(a)} · ${STATE_WORD[row.states[i]]}`, ow ? `${ow.label} + ${a - ow.lo}` : 'no variable here', `value ${b} · 0x${b.toString(16).padStart(2, '0')}${b >= 32 && b < 127 ? ` · '${String.fromCharCode(b)}'` : ''}`] });
                    }}
                  >
                    {row.states[i] === S.Unalloc ? '··' : b.toString(16).padStart(2, '0')}
                  </span>
                );
              })}
            </span>
            <span className="hex-ascii">{row.bytes.map((b, i) => (row.states[i] !== S.Unalloc && b >= 32 && b < 127 ? String.fromCharCode(b) : '·')).join('')}</span>
          </div>
        ))}
        {!rows.length && <div className="empty"><h3>Pick something to inspect</h3>Select a variable in <b>Memory</b>, or choose Stack, Heap or Globals above.</div>}
      </div>
      {tip && <div className="tip" style={{ left: tip.x, top: tip.y }}>{tip.text.map((t, i) => (i === 0 ? <b key={i}>{t}</b> : <div key={i}>{t}</div>))}</div>}
      <div style={{ flex: 1 }} />
      <div className="legend">
        <span><i style={{ background: 'var(--st-init-bg)' }} />written</span>
        <span><i style={{ background: 'repeating-linear-gradient(135deg,var(--st-uninit-bg) 0 3px,transparent 3px 6px)' }} />never written</span>
        <span><i style={{ background: 'repeating-linear-gradient(135deg,var(--st-pad-bg) 0 3px,transparent 3px 6px)' }} />padding</span>
        <span><i style={{ background: 'repeating-linear-gradient(135deg,var(--st-freed-bg) 0 3px,transparent 3px 6px)' }} />freed</span>
        <span><i style={{ background: 'var(--st-meta-bg)' }} />allocator data</span>
        <span><i style={{ background: 'var(--st-dead-bg)' }} />dead stack</span>
        <span><i style={{ outline: '2px solid var(--accent)', outlineOffset: -2 }} />just written</span>
        <span><i style={{ outline: '2px dashed var(--link)', outlineOffset: -2 }} />just read</span>
        <span><i style={{ boxShadow: 'inset 2px 0 0 var(--accent)', background: 'var(--surface-2)' }} />object starts</span>
      </div>
    </div>
  );
}
