import type { View } from '../view';
import type { Platform } from '../../engine/platform';
import { hexAddr } from '../decode';
import { isUserLine } from '../replay';

const kb = (n: number) => (n >= 1048576 ? (n / 1048576).toFixed(n % 1048576 ? 1 : 0) + ' MB' : n >= 1024 ? (n / 1024).toFixed(n % 1024 ? 1 : 0) + ' KB' : n + ' B');

interface Region { name: string; lo: number; size: number; note: string; used?: string; tone: string }

export function MapPanel({ view, plat }: { view: View; plat: Platform }) {
  const { image, heap: heapR, stack } = plat;
  const frameAddrs = view.frames.flatMap((f) => [f.base, ...f.vars.map((v) => v.value.addr)]);
  const lowestStack = frameAddrs.length ? Math.min(...frameAddrs) : stack.top;
  const stackUsed = view.frames.length ? stack.top - lowestStack : 0;
  const live = view.heap.filter((b) => b.state === 'live');
  const freed = view.heap.filter((b) => b.state === 'freed');
  const liveBytes = live.reduce((s, b) => s + b.size, 0);
  const segs = [...view.heap].sort((a, b) => a.chunk - b.chunk);
  const hLo = segs.length ? segs[0].chunk : heapR.base;
  const hHi = segs.length ? Math.max(...segs.map((b) => b.addr + b.usable)) + 8 : heapR.base + 1;
  const hSpan = Math.max(hHi - hLo, 1);

  const regions: Region[] = [
    { name: 'Stack', lo: stack.top - stack.size, size: stack.size, tone: 'stack', used: view.frames.length ? `${kb(stackUsed)} in use` : 'empty', note: 'Local variables and call frames. Grows toward lower addresses.' },
    { name: 'Heap', lo: heapR.base, size: heapR.size, tone: 'heap', used: view.heap.length ? `${live.length} live block${live.length === 1 ? '' : 's'}` : 'empty', note: 'Memory you request with new / malloc. Grows toward higher addresses.' },
    { name: 'Globals & statics', lo: image.data, size: image.dataSize + image.bssSize, tone: 'data', used: `${view.globals.length} yours`, note: 'Exist before main starts and until the program ends.' },
    { name: 'Read-only data', lo: image.rodata, size: image.rodataSize, tone: 'ro', note: 'String literals. Writing here crashes the program.' },
    { name: 'Program code', lo: image.text, size: image.textSize, tone: 'code', note: 'Machine instructions. Here only the range is reserved.' },
  ].sort((a, b) => b.lo - a.lo);

  // stack frame segments, outermost first (high addresses on the right)
  const frames = [...view.frames].reverse().map((f, i, all) => {
    const lows = [f.base, ...f.vars.map((v) => v.value.addr)];
    const lo = Math.min(...lows);
    const hi = i === 0 ? stack.top : all[i - 1].vars.length ? Math.min(...all[i - 1].vars.map((v) => v.value.addr), all[i - 1].base) : all[i - 1].base;
    return { f, lo, hi: Math.max(hi, lo + 8) };
  });
  const sLo = frames.length ? Math.min(...frames.map((x) => x.lo)) : stack.top - 64;
  const sSpan = Math.max(stack.top - sLo, 1);

  return (
    <div className="map">
      <div className="card" style={{ padding: 14 }}>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>This machine's address space, highest address at the top. The order comes from the {plat.label} loader, which is why it differs between systems.</div>
        <div className="amap">
          {regions.map((r, i) => (
            <div key={r.name}>
              {i > 0 && <div className="agap">· · · unmapped · · ·</div>}
              <div className={'abox ' + r.tone}>
                <div><b>{r.name}</b><div className="aaddr">{hexAddr(r.lo + r.size)}<br />{hexAddr(r.lo)}</div></div>
                <div className="anote">{r.note}</div>
                <div className="aused">{kb(r.size)}{r.used ? <><br /><b>{r.used}</b></> : null}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="card" style={{ padding: 14 }}>
        <h4 style={{ margin: '0 0 2px' }}>Stack, zoomed in</h4>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>{kb(stackUsed)} of {kb(stack.size)} in use. {plat.id === 'windows' ? 'Windows gives a thread only 1 MB by default, so deep recursion fails sooner here than on Linux or macOS (8 MB).' : 'The main thread starts with 8 MB.'}</div>
        <div className="zoom">
          {frames.length === 0 && <div className="zseg gap" style={{ flex: 1 }}>no frames</div>}
          {frames.map(({ f, lo, hi }) => (
            <div key={f.id} className="zseg frame" style={{ flex: `${Math.max(hi - lo, 1)} 1 0` }} title={`${f.name} · ${hexAddr(lo)} – ${hexAddr(hi)} · ${hi - lo} bytes`}>{f.name}</div>
          ))}
        </div>
        <div className="bar-caption"><span>{hexAddr(sLo)}</span><span>{hexAddr(stack.top)} (top)</span></div>
      </div>

      <div className="card" style={{ padding: 14 }}>
        <h4 style={{ margin: '0 0 2px' }}>Heap, zoomed in</h4>
        <div className="muted" style={{ fontSize: 12, marginBottom: 8 }}>
          {live.length} live · {freed.length} freed · {liveBytes} bytes in use. Each block is preceded by allocator bookkeeping (purple). Freed blocks (hatched) can be handed out again.
        </div>
        <div className="zoom">
          {segs.length === 0 && <div className="zseg gap" style={{ flex: 1 }}>nothing allocated</div>}
          {segs.map((b, i) => {
            const prevEnd = i === 0 ? hLo : segs[i - 1].addr + segs[i - 1].usable;
            const gap = Math.max(0, b.chunk - prevEnd);
            return (
              <span key={b.id} style={{ display: 'contents' }}>
                {gap > 0 && <div className="zseg gap" style={{ flex: `${gap} 1 0` }} />}
                <div className="zseg meta" style={{ flex: `${Math.max(b.addr - b.chunk, 1)} 1 0` }} title="allocator header" />
                <div className={'zseg ' + (b.state === 'live' ? 'live' : 'freed')} style={{ flex: `${Math.max(b.usable, 1)} 1 0` }} title={`${b.value.type} · ${b.size} B · ${b.state}`}>{hSpan / segs.length > 60 ? b.value.type : ''}</div>
              </span>
            );
          })}
        </div>
        <div className="bar-caption"><span>{hexAddr(hLo)}</span><span>{hexAddr(hHi)}</span></div>
        {segs.length > 0 && (
          <table className="btable">
            <thead><tr><th>Address</th><th>Holds</th><th>Asked for</th><th>Block holds</th><th>State</th><th>Allocated by</th></tr></thead>
            <tbody>
              {segs.map((b) => (
                <tr key={b.id} className={b.state}>
                  <td className="mono">{hexAddr(b.addr)}</td><td className="mono">{b.value.type}</td><td>{b.size} B</td><td>{b.usable} B</td>
                  <td><span className={'tag ' + (b.state === 'live' ? 'live' : 'freed')}>{b.state}</span></td>
                  <td>{b.how}{isUserLine(b.line) ? ` · line ${b.line}` : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
