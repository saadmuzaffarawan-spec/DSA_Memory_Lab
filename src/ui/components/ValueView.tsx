import type { Value } from '../decode';
import { hexAddr } from '../decode';
import { S } from '../../engine/trace';

export interface ValueCtx {
  /** how the current step touched this range, if at all */
  touched(addr: number, size: number): 'w' | 'r' | null;
  /** can the pointer value be followed to something the program owns? */
  resolves(ptr: number): boolean;
  /** is some pointer aimed exactly at this address? */
  pointed(addr: number): boolean;
  onPointer(ptr: number): void;
  /** highlight the cell/chip holding this address (hovered from elsewhere) */
  focusAddr?: number;
}

const STATE_WORD: Record<number, string> = {
  [S.Unalloc]: 'not part of any object', [S.Uninit]: 'never written: reading it gives garbage', [S.Init]: 'holds a value', [S.Pad]: 'padding the compiler inserted',
  [S.Freed]: 'freed: no longer yours', [S.Meta]: 'allocator bookkeeping', [S.Dead]: 'stack memory of a finished call',
};

function title(v: Value): string {
  return `${v.label} · ${v.type || 'padding'}${v.via ? ` (from base ${v.via})` : ''}\n${hexAddr(v.addr)} · ${v.size} byte${v.size === 1 ? '' : 's'}\n${STATE_WORD[v.state] ?? ''}`;
}

function Leaf({ v, ctx }: { v: Value; ctx: ValueCtx }) {
  const isPtr = (v.kind === 'pointer' || v.kind === 'ref') && v.ptr !== undefined;
  const nonNull = isPtr && (v.ptr ?? 0) !== 0;
  const t = ctx.touched(v.addr, v.size);
  const dangling = nonNull && v.state === S.Init && !ctx.resolves(v.ptr!);
  const cls = ['chip', isPtr ? 'ptr' : '', isPtr && !nonNull ? 'null' : '', ctx.pointed(v.addr) ? 'pointed' : '', t === 'w' ? 'touched-w' : '', ctx.focusAddr !== undefined && ctx.focusAddr >= v.addr && ctx.focusAddr < v.addr + v.size ? 'hit' : ''].filter(Boolean).join(' ');
  return (
    <span
      className={cls}
      data-st={v.state}
      data-cell={v.addr}
      data-ptr={nonNull && v.state === S.Init ? v.ptr : undefined}
      title={title(v) + (dangling ? '\nThis address is not inside anything the program currently owns.' : '')}
      onClick={nonNull ? () => ctx.onPointer(v.ptr!) : undefined}
      role={nonNull ? 'button' : undefined}
    >
      {v.text}
      {v.preview !== undefined && <span className="preview">"{v.preview}"</span>}
      {dangling && <span aria-label="dangling"> ⚠</span>}
    </span>
  );
}

const isLeafKind = (v: Value) => v.kind === 'scalar' || v.kind === 'enum' || v.kind === 'pointer' || v.kind === 'ref';

function Cells({ items, ctx }: { items: Value[]; ctx: ValueCtx }) {
  return (
    <div className="cells">
      {items.map((c, i) => (
        <div className="cell" key={i}>
          <Leaf v={c} ctx={ctx} />
          <span className="idx">{i}</span>
        </div>
      ))}
    </div>
  );
}

export function ValueView({ v, ctx }: { v: Value; ctx: ValueCtx }) {
  if (isLeafKind(v)) return <Leaf v={v} ctx={ctx} />;
  if (v.kind === 'pad') return <span className="pad-note">{v.text} of padding</span>;
  if (v.kind === 'array') {
    const kids = v.children ?? [];
    if (v.preview !== undefined && kids.every(isLeafKind)) {
      return (
        <div>
          <span className="chip" data-st={v.state} title={title(v)} data-cell={v.addr}>{v.text}</span>
          <div style={{ marginTop: 6 }}><Cells items={kids} ctx={ctx} /></div>
        </div>
      );
    }
    if (kids.length && kids.every(isLeafKind)) return <Cells items={kids} ctx={ctx} />;
    if (kids.length && kids.every((k) => k.kind === 'array')) {
      const deep = kids.some((k) => (k.children ?? []).some((g) => g.kind === 'array'));
      return (
        <div className="grid2">
          {kids.map((k, i) => (
            <div className={'rowline' + (deep ? ' layer-wrap' : '')} key={i}>
              <span className="rowlabel">[{i}]</span>
              {deep ? <div className="layer"><ValueView v={k} ctx={ctx} /></div> : <ValueView v={k} ctx={ctx} />}
            </div>
          ))}
        </div>
      );
    }
    return (
      <div className="fields">
        {kids.map((k, i) => (
          <Row key={i} label={`[${i}]`} v={k} ctx={ctx} />
        ))}
      </div>
    );
  }
  // struct / class / union
  return (
    <div className="fields">
      {(v.children ?? []).map((k, i) =>
        k.kind === 'pad' ? (
          <div key={i} style={{ gridColumn: '1 / -1' }} className="pad-note" title={title(k)}>▨ {k.text} padding</div>
        ) : (
          <Row key={i} label={k.label} v={k} ctx={ctx} />
        ),
      )}
    </div>
  );
}

function Row({ label, v, ctx }: { label: string; v: Value; ctx: ValueCtx }) {
  return (
    <>
      <span className="flabel">{label}{v.type && !label.startsWith('[') ? <small>{v.type}</small> : null}</span>
      <div><ValueView v={v} ctx={ctx} /></div>
    </>
  );
}
