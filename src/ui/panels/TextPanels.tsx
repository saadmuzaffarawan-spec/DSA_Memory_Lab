import type { Diag } from '../../engine/trace';
import { isUserLine } from '../replay';
import { hexAddr } from '../decode';

export function OutputPanel({ text, stderr, atEnd }: { text: string; stderr?: string; atEnd: boolean }) {
  return (
    <>
      <pre className="out" aria-label="Program output">{text}</pre>
      {atEnd && stderr ? <pre className="out" style={{ color: 'var(--err)', borderTop: '1px solid var(--border)' }}>{stderr}</pre> : null}
    </>
  );
}

export function ProblemsPanel({ diags, onJump }: { diags: Diag[]; onJump(line: number): void }) {
  if (!diags.length) return <div className="empty"><h3>No problems so far</h3>Memory errors, undefined behaviour and leaks are reported here the moment they happen.</div>;
  return (
    <div className="problems">
      {diags.map((d, i) => (
        <div className={'problem ' + d.severity} key={i}>
          <span className="ico">{d.severity === 'error' ? '!' : d.severity === 'warn' ? '▲' : 'i'}</span>
          <div>
            <h4>{d.title}</h4>
            <p>{d.body}</p>
            <div className="where">
              {d.addr !== undefined ? hexAddr(d.addr) : ''}{d.line && isUserLine(d.line) ? <> · <a href="#" onClick={(e) => { e.preventDefault(); onJump(d.line!); }}>line {d.line}</a></> : ''}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
