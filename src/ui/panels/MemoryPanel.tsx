import { useLayoutEffect, useMemo, useRef, useState } from 'react';
import type { View, VarView, BlockView } from '../view';
import { ValueView, type ValueCtx } from '../components/ValueView';
import { hexAddr } from '../decode';
import { isUserLine } from '../replay';

export type Selection = { kind: 'var' | 'block'; id: number } | null;

interface Props {
  view: View;
  sel: Selection;
  onSelect(s: Selection): void;
  showLib: boolean;
}

interface Arrow { d: string; kind: 'ok' | 'sel'; x1: number; y1: number }

function VarRow({ v, ctx, selected, onSelect }: { v: VarView; ctx: ValueCtx; selected: boolean; onSelect(): void }) {
  return (
    <div className={'var' + (selected ? ' selected' : '')} data-anchor={`var:${v.id}`} onClick={onSelect}>
      <div className="var-head">
        <span className="var-name">{v.name}</span>
        <span className="var-type">{v.value.type}</span>
      </div>
      <div className="var-right"><span className="var-addr">{hexAddr(v.value.addr)}</span></div>
      <div className="var-val"><ValueView v={v.value} ctx={ctx} /></div>
    </div>
  );
}

function BlockCard({ b, ctx, selected, onSelect }: { b: BlockView; ctx: ValueCtx; selected: boolean; onSelect(): void }) {
  const lib = !isUserLine(b.line);
  return (
    <div className={'card' + (b.state === 'freed' ? ' ghost' : '') + (selected ? ' current' : '')} data-anchor={`block:${b.id}`} onClick={onSelect}>
      <div className="card-head">
        <span className="fn">{b.value.type}</span>
        <span className={'tag ' + (b.state === 'freed' ? 'freed' : 'live')}>{b.state === 'freed' ? 'freed' : 'live'}</span>
        <span className="meta">{b.size} B · {hexAddr(b.addr)}</span>
      </div>
      <div style={{ padding: '8px 10px' }}>
        <ValueView v={b.value} ctx={ctx} />
        <div className="var-type" style={{ marginTop: 6 }}>
          {b.how}{!lib && b.line ? ` · line ${b.line}` : lib ? ' · inside the standard library' : ''}
          {b.usable !== b.size ? ` · block really holds ${b.usable} B` : ''}
        </div>
      </div>
    </div>
  );
}

export function MemoryPanel({ view, sel, onSelect, showLib }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const [arrows, setArrows] = useState<Arrow[]>([]);
  const [size, setSize] = useState(0);
  const [focusAddr, setFocusAddr] = useState<number | undefined>(undefined);

  const pointed = useMemo(() => {
    const set = new Set<number>();
    const walk = (v: import('../decode').Value) => {
      if (v.ptr && v.state === 2) { const t = view.locate(v.ptr); if (t && t.offset !== 0) set.add(v.ptr); } // a pointer into the middle of an object: mark the exact element
      v.children?.forEach(walk);
    };
    view.frames.forEach((f) => f.vars.forEach((x) => walk(x.value)));
    view.globals.forEach((x) => walk(x.value));
    view.heap.forEach((b) => b.state === 'live' && walk(b.value));
    return set;
  }, [view]);

  const ctx = useMemo<ValueCtx>(
    () => ({
      pointed: (a) => pointed.has(a),
      touched: (a, n) => {
        for (const x of view.access) if (x.a < a + n && a < x.a + x.l) return x.kind;
        return null;
      },
      resolves: (p) => view.locate(p) !== null,
      onPointer: (p) => {
        const t = view.locate(p);
        if (t) onSelect({ kind: t.kind, id: t.id });
        setFocusAddr(p);
        setTimeout(() => setFocusAddr(undefined), 1400);
      },
      focusAddr,
    }),
    [view, onSelect, focusAddr, pointed],
  );

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const ro = new ResizeObserver(() => setSize(root.offsetWidth * 10000 + root.offsetHeight));
    ro.observe(root);
    return () => ro.disconnect();
  }, []);

  useLayoutEffect(() => {
    const root = ref.current;
    if (!root) return;
    const rb = root.getBoundingClientRect();
    const out: Arrow[] = [];
    const selKey = sel ? `${sel.kind}:${sel.id}` : '';
    const lanes = new Map<Element, number>();
    root.querySelectorAll<HTMLElement>('[data-ptr]').forEach((src) => {
      const p = Number(src.dataset.ptr);
      const t = view.locate(p);
      if (!t) return;
      const anchor = root.querySelector<HTMLElement>(`[data-anchor="${t.kind}:${t.id}"]`);
      if (!anchor || anchor.contains(src) && t.kind === 'block' && false) return;
      const cell = t.offset === 0 ? null : Array.from(root.querySelectorAll<HTMLElement>(`[data-cell="${p}"]`)).filter((e) => e !== src && anchor.contains(e)).pop() ?? null;
      const sr = src.getBoundingClientRect();
      const ar = anchor.getBoundingClientRect();
      if (sr.width === 0 || ar.width === 0) return;
      const cr = cell?.getBoundingClientRect();
      const header = anchor.classList.contains('card') ? Math.min(ar.height / 2, 18) : ar.height / 2;
      const ty = (cr ? Math.min(Math.max(cr.top + cr.height / 2, ar.top + 8), ar.bottom - 8) : ar.top + header) - rb.top;
      const sy = sr.top + sr.height / 2 - rb.top;
      const srcCol = src.closest('.mem-col');
      const dstCol = anchor.closest('.mem-col');
      const key = (src.closest('[data-anchor]') as HTMLElement | null)?.dataset.anchor ?? '';
      const kind: Arrow['kind'] = key === selKey || `${t.kind}:${t.id}` === selKey ? 'sel' : 'ok';
      let d: string, x1: number;
      if (srcCol && srcCol === dstCol) {
        // same column: run the wire down the right-hand margin so it never crosses text
        const col = (srcCol as HTMLElement).getBoundingClientRect();
        const lane = lanes.get(srcCol) ?? 0;
        lanes.set(srcCol, lane + 1);
        x1 = sr.right - rb.left;
        const xr = col.right - rb.left - 5 - (lane % 6) * 5;
        const xt = ar.right - rb.left;
        d = `M${x1},${sy} H${xr} V${ty} H${xt + 1}`;
      } else if (ar.left + ar.width / 2 >= sr.left + sr.width / 2) {
        x1 = sr.right - rb.left;
        const dx = ar.left - rb.left;
        const k = Math.max(36, (dx - x1) / 2);
        d = `M${x1},${sy} C${x1 + k},${sy} ${dx - k},${ty} ${dx},${ty}`;
      } else {
        x1 = sr.left - rb.left;
        const dx = ar.right - rb.left;
        const k = Math.max(36, (x1 - dx) / 2);
        d = `M${x1},${sy} C${x1 - k},${sy} ${dx + k},${ty} ${dx},${ty}`;
      }
      out.push({ d, kind, x1, y1: sy });
    });
    setArrows(out);
  }, [view, sel, size, focusAddr, showLib]);

  const selVar = sel?.kind === 'var' ? sel.id : -1;
  const selBlock = sel?.kind === 'block' ? sel.id : -1;
  const heap = view.heap.filter((b) => b.state === 'live' || true);
  const liveCount = view.heap.filter((b) => b.state === 'live').length;
  const hasHeap = view.heap.length > 0;
  const heapUser = showLib ? heap : heap.filter((b) => isUserLine(b.line) || b.state === 'live');

  return (
    <div className={'mem'} ref={ref}>
      <svg className="arrows" aria-hidden="true">
        <defs>
          <marker id="ah" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" style={{ fill: 'var(--link)', stroke: 'none' }} />
          </marker>
          <marker id="ahs" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto-start-reverse">
            <path d="M0,0 L10,5 L0,10 z" style={{ fill: 'var(--accent)', stroke: 'none' }} />
          </marker>
        </defs>
        {arrows.map((a, i) => (
          <g key={i}>
            <path d={a.d} className={a.kind === 'sel' ? 'sel' : ''} markerEnd={`url(#${a.kind === 'sel' ? 'ahs' : 'ah'})`} />
            <circle cx={a.x1} cy={a.y1} r="3" style={{ fill: a.kind === 'sel' ? 'var(--accent)' : 'var(--link)' }} />
          </g>
        ))}
      </svg>

      <div className="mem-col">
        <div className="col-title">Stack <span>grows downward · automatic</span></div>
        {view.frames.length === 0 && <div className="card"><div className="empty"><h3>No function is running</h3>Press <b>Run</b>, then step into <span className="mono">main</span>.</div></div>}
        {view.frames.map((f, i) => (
          <div className={'card' + (i === 0 ? ' current' : '')} key={f.id} data-anchor={`frame:${f.id}`}>
            <div className="card-head">
              <span className="fn">{f.name}({f.args})</span>
              {i < view.frames.length - 1 && f.callLine > 0 && isUserLine(f.callLine) && <span className="tag">called from line {f.callLine}</span>}
              <span className="meta">frame {hexAddr(f.base)}</span>
            </div>
            <div className="vars">
              {f.vars.length === 0 && <div className="var"><span className="var-type">no variables yet</span></div>}
              {f.vars.map((v) => (
                <VarRow key={v.id} v={v} ctx={ctx} selected={selVar === v.id} onSelect={() => onSelect({ kind: 'var', id: v.id })} />
              ))}
              <div className="var" style={{ background: 'var(--surface-2)' }} title="Where execution continues when this function returns">
                <span className="var-type">↩ returns to {f.retLabel || hexAddr(f.ret)}</span>
                <div className="var-right"><span className="var-addr">{hexAddr(f.ret)}</span></div>
              </div>
            </div>
          </div>
        ))}
        {view.globals.length > 0 && (
          <>
            <div className="col-title">Globals <span>static storage · lives for the whole run</span></div>
            <div className="card">
              <div className="vars">
                {view.globals.map((v) => (
                  <VarRow key={v.id} v={v} ctx={ctx} selected={selVar === v.id} onSelect={() => onSelect({ kind: 'var', id: v.id })} />
                ))}
              </div>
            </div>
          </>
        )}
      </div>

      <div className="mem-col">
        <div className="col-title">Heap <span>{liveCount} live block{liveCount === 1 ? '' : 's'} · you allocate and free</span></div>
        {!hasHeap && (
          <div className="card"><div className="empty"><h3>The heap is empty</h3>Blocks appear here when the program calls <span className="mono">new</span>, <span className="mono">malloc</span> or grows a container.</div></div>
        )}
        {heapUser.map((b) => (
          <BlockCard key={b.id} b={b} ctx={ctx} selected={selBlock === b.id} onSelect={() => onSelect({ kind: 'block', id: b.id })} />
        ))}
      </div>
    </div>
  );
}
