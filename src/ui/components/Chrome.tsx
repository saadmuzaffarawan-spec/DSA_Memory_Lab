import { useEffect, useRef, useState, type ReactNode } from 'react';
import { EXAMPLES, type Example } from '../../content/examples';
import { PLATFORMS, type PlatformId } from '../../engine/platform';

export function Logo({ size = 26 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="7" style={{ fill: 'var(--text)' }} />
      <rect x="6" y="7" width="14" height="5" rx="1.5" style={{ fill: 'var(--accent)' }} />
      <rect x="10" y="13.5" width="16" height="5" rx="1.5" style={{ fill: 'var(--bg)' }} />
      <rect x="6" y="20" width="12" height="5" rx="1.5" style={{ fill: 'var(--ok)' }} />
    </svg>
  );
}

export function useOutsideClose(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) close(); };
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('mousedown', down); document.removeEventListener('keydown', key); };
  }, [open, close]);
  return ref;
}

export function ExamplesMenu({ onPick, current }: { onPick(e: Example): void; current?: string }) {
  const [open, setOpen] = useState(false);
  const ref = useOutsideClose(open, () => setOpen(false));
  const groups = Array.from(new Set(EXAMPLES.map((e) => e.group)));
  return (
    <div className="menu" ref={ref}>
      <button className="btn" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
        <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M2 3h12v2H2zm0 4h12v2H2zm0 4h8v2H2z" /></svg>
        <span className="label">Examples</span>
      </button>
      {open && (
        <div className="menu-pop" role="menu">
          {groups.map((g) => (
            <div key={g}>
              <div className="menu-group">{g}</div>
              {EXAMPLES.filter((e) => e.group === g).map((e) => (
                <button key={e.id} role="menuitem" className="menu-item" onClick={() => { setOpen(false); onPick(e); }} aria-current={current === e.id}>
                  <b>{e.title}</b><span>{e.blurb}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function PlatformSwitch({ value, onChange }: { value: PlatformId; onChange(p: PlatformId): void }) {
  const items: Array<[PlatformId, string]> = [['windows', 'Windows'], ['linux', 'Linux'], ['macos', 'macOS']];
  return (
    <div className="seg" role="group" aria-label="Target machine">
      {items.map(([id, label]) => (
        <button key={id} aria-pressed={value === id} onClick={() => onChange(id)} title={PLATFORMS[id].compiler}>{label}</button>
      ))}
    </div>
  );
}

export function Dialog({ title, onClose, children, wide }: { title: string; onClose(): void; children: ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const key = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', key);
    ref.current?.focus();
    return () => document.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div className="overlay" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className={'dialog' + (wide ? ' wide' : '')} role="dialog" aria-modal="true" aria-label={title} ref={ref} tabIndex={-1}>
        <header><h2>{title}</h2><span style={{ flex: 1 }} /><button className="btn ghost iconbtn" onClick={onClose} aria-label="Close">✕</button></header>
        <div className="body">{children}</div>
      </div>
    </div>
  );
}

export const REPO_URL = 'https://github.com/saadmuzaffarawan-spec/dsa_memory_lab';

export function AboutDialog({ onClose }: { onClose(): void }) {
  const rows = (Object.keys(PLATFORMS) as PlatformId[]).map((id) => PLATFORMS[id]);
  const parts: Array<[string, 'dataModel' | 'classLayout' | 'stdlib' | 'heap' | 'stack']> = [['Type sizes', 'dataModel'], ['Class layout', 'classLayout'], ['Standard library', 'stdlib'], ['Heap allocator', 'heap'], ['Stack', 'stack']];
  return (
    <Dialog title="About Stackyard" onClose={onClose}>
      <p>Stackyard is a free, open-source memory lab for C++ learners. You type real C++, it runs on a simulated machine that has its own virtual memory, and every byte is drawn on screen: the stack, the heap, pointers, arrays, objects and the allocator's bookkeeping. You can step backwards as well as forwards.</p>
      <p>Created by <b>Saad Muzaffar Awan</b>. Released under the MIT licence. <a href={REPO_URL} target="_blank" rel="noreferrer">Source code on GitHub</a>.</p>
      <h3>How faithful is it?</h3>
      <p>The simulator mirrors a specific machine for each platform. Some parts are checked line by line against a real compiler, others follow published documentation, and some are close approximations. The table says which is which, so you know how far to trust each picture.</p>
      <table>
        <thead><tr><th>Part of the model</th>{rows.map((p) => <th key={p.id}>{p.label}</th>)}</tr></thead>
        <tbody>
          {parts.map(([label, key]) => (
            <tr key={key}><td>{label}</td>{rows.map((p) => <td key={p.id}><span className={'conf ' + p.confidence[key]}>{p.confidence[key]}</span></td>)}</tr>
          ))}
        </tbody>
      </table>
      <p style={{ marginTop: 10 }} className="muted"><b>verified</b> = compared automatically against real GCC output. <b>documented</b> = follows the ABI or vendor documentation. <b>approximate</b> = the shape is right, exact sizes or addresses may differ from a real machine.</p>
      <h3>Good to know</h3>
      <ul>
        <li>Addresses are simulated, but laid out like the real thing for the chosen platform. They are the same on every run (like a debugger with ASLR off).</li>
        <li>Windows mimics a Visual Studio Debug build (MSVC, UCRT). Linux mimics GCC with glibc. macOS mimics Apple Clang with libc++.</li>
        <li>There are no threads, files or network. Only the parts of the standard library listed in the repository's LIMITS.md are available.</li>
        <li>Very long runs are cut off with a note, so the page stays responsive.</li>
      </ul>
      <h3>Keyboard</h3>
      <p><span className="mono">Ctrl/⌘ + Enter</span> run · <span className="mono">→</span> step · <span className="mono">←</span> step back · <span className="mono">F10</span> step over · <span className="mono">Shift+F11</span> step out · <span className="mono">Space</span> play or pause</p>
    </Dialog>
  );
}
