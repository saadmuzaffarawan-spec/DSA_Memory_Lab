import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Editor, type Marks } from './Editor';
import { Transport } from './components/Transport';
import { QuizDialog } from './components/Quiz';
import { AboutDialog, ExamplesMenu, Logo, PlatformSwitch, REPO_URL } from './components/Chrome';
import { MemoryPanel, type Selection } from './panels/MemoryPanel';
import { HexPanel } from './panels/HexPanel';
import { MapPanel } from './panels/MapPanel';
import { OutputPanel, ProblemsPanel } from './panels/TextPanels';
import { Replay, isUserLine } from './replay';
import { buildView } from './view';
import { runInWorker } from './runner';
import { EXAMPLES, DEFAULT_EXAMPLE, byId, type Example } from '../content/examples';
import { DEFAULT_PLATFORM, PLATFORMS, type PlatformId } from '../engine/platform';
import type { RunResult } from '../engine/trace';

type Tab = 'memory' | 'hex' | 'map' | 'output' | 'problems';

// ---- persistence & sharing (all optional: storage can be blocked) ------------------------------------------------------
const LS = 'stackyard:v1';
function loadSaved(): { source: string; platform: PlatformId; exampleId?: string } | null {
  try {
    const h = new URLSearchParams(location.hash.slice(1));
    const c = h.get('c');
    if (c) {
      const bin = atob(c.replace(/-/g, '+').replace(/_/g, '/'));
      const source = decodeURIComponent(escape(bin));
      const p = h.get('p') as PlatformId | null;
      return { source, platform: p && PLATFORMS[p] ? p : DEFAULT_PLATFORM };
    }
  } catch { /* fall through */ }
  try {
    const raw = localStorage.getItem(LS);
    if (raw) { const o = JSON.parse(raw); if (typeof o.source === 'string') return o; }
  } catch { /* ignore */ }
  return null;
}
function save(source: string, platform: PlatformId, exampleId?: string) {
  try { localStorage.setItem(LS, JSON.stringify({ source, platform, exampleId })); } catch { /* ignore */ }
}
function shareUrl(source: string, platform: PlatformId): string {
  const b64 = btoa(unescape(encodeURIComponent(source))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `${location.origin}${location.pathname}#c=${b64}&p=${platform}`;
}

export function App() {
  const saved = useMemo(loadSaved, []);
  const startExample = byId(saved?.exampleId ?? '') ?? byId(DEFAULT_EXAMPLE)!;
  const [source, setSource] = useState(saved?.source ?? startExample.code);
  const [exampleId, setExampleId] = useState<string | undefined>(saved ? saved.exampleId : startExample.id);
  const [platform, setPlatform] = useState<PlatformId>(saved?.platform ?? DEFAULT_PLATFORM);
  const [run, setRun] = useState<RunResult | null>(null);
  const [ranSource, setRanSource] = useState<string | null>(null);
  const [status, setStatus] = useState<'idle' | 'running' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);
  const [k, setK] = useState(0);
  const [sel, setSel] = useState<Selection>(null);
  const [tab, setTab] = useState<Tab>('memory');
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(550);
  const [showLib, setShowLib] = useState(false);
  const [about, setAbout] = useState(false);
  const [quiz, setQuiz] = useState(false);
  const [pane, setPane] = useState<'code' | 'inspect'>('code');
  const [toast, setToast] = useState<string | null>(null);
  const [theme, setTheme] = useState<'auto' | 'light' | 'dark'>(() => { try { return (localStorage.getItem('stackyard:theme') as 'light' | 'dark' | null) ?? 'auto'; } catch { return 'auto'; } });

  useEffect(() => {
    const el = document.documentElement;
    if (theme === 'auto') el.removeAttribute('data-theme'); else el.setAttribute('data-theme', theme);
    try { if (theme === 'auto') localStorage.removeItem('stackyard:theme'); else localStorage.setItem('stackyard:theme', theme); } catch { /* ignore */ }
  }, [theme]);

  const rp = useMemo(() => (run && !run.compileError ? new Replay(run) : null), [run]);
  const view = useMemo(() => {
    if (!rp) return null;
    rp.seekStep(k);
    return buildView(rp, showLib);
  }, [rp, k, showLib]);

  const plat = PLATFORMS[run?.platform as PlatformId] ?? PLATFORMS[platform];
  const dirty = ranSource !== null && ranSource !== source;

  const doRun = useCallback(async (src = source, p = platform) => {
    setStatus('running'); setError(null); setPlaying(false);
    try {
      const r = await runInWorker(src, p);
      setRun(r); setRanSource(src); setK(0); setSel(null);
      setStatus('idle');
      if (r.compileError) { setTab('problems'); }
      else if (tab === 'problems' && r.diagnostics.length === 0) setTab('memory');
    } catch (e) {
      setStatus('error'); setError(e instanceof Error ? e.message : String(e));
    }
  }, [source, platform, tab]);

  // first run + persist
  const didInit = useRef(false);
  useEffect(() => { if (!didInit.current) { didInit.current = true; void doRun(); } }, [doRun]);
  useEffect(() => { save(source, platform, exampleId); }, [source, platform, exampleId]);

  const loadExample = (e: Example) => { setSource(e.code); setExampleId(e.id); void doRun(e.code, platform); };
  const switchPlatform = (p: PlatformId) => { setPlatform(p); void doRun(source, p); };

  // ---- navigation -----------------------------------------------------------------------------------------------------
  const steps = rp?.steps ?? [];
  const count = steps.length;
  const atEnd = !!view?.atEnd || k >= count;
  const curDepth = steps[Math.min(k, count - 1)]?.depth ?? 1;
  const go = useCallback((n: number) => setK(Math.max(0, Math.min(count, n))), [count]);
  const into = useCallback(() => go(k + 1), [go, k]);
  const over = useCallback(() => { let j = k + 1; while (j < count && steps[j].depth > curDepth) j++; go(j); }, [go, k, count, steps, curDepth]);
  const out = useCallback(() => { let j = k + 1; while (j < count && steps[j].depth >= curDepth) j++; go(j); }, [go, k, count, steps, curDepth]);

  useEffect(() => {
    if (!playing) return;
    if (k >= count) { setPlaying(false); return; }
    const id = setTimeout(() => setK((x) => x + 1), speed);
    return () => clearTimeout(id);
  }, [playing, k, count, speed]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement;
      if (t.closest('.cm-editor') || t.tagName === 'INPUT' || t.tagName === 'SELECT' || t.tagName === 'TEXTAREA') {
        if (e.key === 'F10') { e.preventDefault(); over(); }
        return;
      }
      if (!rp) return;
      if (e.key === 'ArrowRight' || e.key === 'F11' && !e.shiftKey) { e.preventDefault(); into(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); go(k - 1); }
      else if (e.key === 'F10') { e.preventDefault(); over(); }
      else if (e.key === 'F11' && e.shiftKey) { e.preventDefault(); out(); }
      else if (e.key === ' ' && !(t.tagName === 'BUTTON')) { e.preventDefault(); setPlaying((p) => !p); }
      else if (e.key === 'Home') go(0);
      else if (e.key === 'End') go(count);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [rp, into, over, out, go, k, count]);

  // ---- editor marks ---------------------------------------------------------------------------------------------------
  const marks: Marks = useMemo(() => ({
    exec: view && !view.atEnd ? view.line : 0,
    diags: (view?.diags ?? []).filter((d) => d.line && isUserLine(d.line)).map((d) => ({ line: d.line!, severity: d.severity })),
    error: run?.compileError && run.compileError.line > 0 ? run.compileError.line : 0,
  }), [view, run]);

  const stdout = view?.stdout ?? '';
  const problemCount = (view?.diags.length ?? 0) + (run?.compileError ? 1 : 0);
  const errCount = (view?.diags.filter((d) => d.severity === 'error').length ?? 0) + (run?.compileError ? 1 : 0);

  const diagsForPanel = useMemo(() => {
    const d = [...(view?.diags ?? [])];
    if (run?.compileError) d.unshift({ code: 'info', severity: 'error', title: 'The program does not compile', body: run.compileError.message, line: run.compileError.line > 0 ? run.compileError.line : undefined });
    if (run && !run.compileError && view?.atEnd && run.reason && run.reason !== 'return' && run.reason !== 'exit') {
      d.push({ code: 'info', severity: run.reason === 'limit' ? 'warn' : 'error', title: run.reason === 'limit' ? 'Stopped early' : 'The program crashed', body: run.endMessage ?? run.reason });
    }
    return d;
  }, [view, run]);

  const copyShare = async () => {
    const url = shareUrl(source, platform);
    try { await navigator.clipboard.writeText(url); setToast('Link copied. Anyone who opens it gets this exact program.'); }
    catch { setToast('Could not copy automatically. The address bar now holds the link.'); history.replaceState(null, '', url); }
    setTimeout(() => setToast(null), 3200);
  };

  const tabs: Array<[Tab, string]> = [['memory', 'Memory'], ['hex', 'Bytes'], ['map', 'Address space'], ['output', 'Output'], ['problems', 'Problems']];

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand"><Logo /> Stackyard <small>see your C++ memory</small></div>
        <PlatformSwitch value={platform} onChange={switchPlatform} />
        <ExamplesMenu onPick={loadExample} current={exampleId} />
        <button className="btn" onClick={() => setQuiz(true)} title="Predict what the program prints, then see why"><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M8 1a7 7 0 1 0 0 14A7 7 0 0 0 8 1zm.8 11H7.200v-1.500h1.600zm1.300-4.300c-.5.6-.9.800-1.100 1.100-.1.200-.2.300-.2.700H7.300c0-.7.1-1.100.4-1.500.3-.4.800-.7 1-1 .2-.2.300-.5.300-.8 0-.5-.4-.9-1-.9s-1 .4-1 1H5.400c0-1.500 1.100-2.400 2.600-2.400s2.600.9 2.600 2.200c0 .6-.2 1.100-.5 1.600z" /></svg><span className="label">Quiz</span></button>
        <div className="mobile-tabs seg" role="group" aria-label="Show">
          <button aria-pressed={pane === 'code'} onClick={() => setPane('code')}>Code</button>
          <button aria-pressed={pane === 'inspect'} onClick={() => setPane('inspect')}>Memory</button>
        </div>
        <span className="spacer" />
        {dirty && <span className="dirty">Edited · press Run</span>}
        <button className="btn primary" onClick={() => void doRun()} disabled={status === 'running'} title="Run the program (Ctrl/⌘ + Enter)">
          {status === 'running' ? <span className="spinner" /> : <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M4 2.5v11l9-5.500z" /></svg>}
          <span className="label">Run</span> <kbd className="hide-sm">⌘↵</kbd>
        </button>
        <button className="btn ghost" onClick={copyShare} title="Copy a link to this program"><span className="label">Share</span><svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><path d="M11 1a3 3 0 1 1-2.400 4.800L6 7.200a3 3 0 0 1 0 1.600l2.600 1.400A3 3 0 1 1 8 11.600L5.400 10.200a3 3 0 1 1 0-4.400L8 4.400A3 3 0 0 1 11 1z" /></svg></button>
        <button className="btn ghost iconbtn" onClick={() => setTheme(theme === 'dark' ? 'light' : theme === 'light' ? 'auto' : 'dark')} title={`Theme: ${theme}`} aria-label={`Theme: ${theme}. Click to change`}>
          {theme === 'dark' ? '☾' : theme === 'light' ? '☀' : '◐'}
        </button>
        <button className="btn ghost iconbtn" onClick={() => setAbout(true)} title="About, accuracy and shortcuts" aria-label="About">?</button>
      </header>

      <div className="main">
        <section className="pane" data-mobile-hidden={pane !== 'code'} aria-label="Code">
          <div className="pane-head"><span className="pane-title">main.cpp</span><span style={{ flex: 1 }} /><span className="muted" style={{ fontSize: 12 }}>{PLATFORMS[platform].compiler.split('·')[0]}</span></div>
          <Editor value={source} onChange={(v) => { setSource(v); setExampleId(undefined); }} marks={marks} onRun={() => void doRun()} />
          {run?.compileError && (
            <div className="banner" role="alert">
              <strong>{PLATFORMS[platform].id === 'windows' ? 'error C2065' : 'error'}{run.compileError.line > 0 ? ` · line ${run.compileError.line}` : ''}</strong>
              <span>{run.compileError.message}</span>
            </div>
          )}
          {status === 'error' && <div className="banner" role="alert"><strong>Could not run</strong><span>{error}</span></div>}
        </section>

        <section className="pane" data-mobile-hidden={pane !== 'inspect'} aria-label="Inspector">
          <div className="pane-head">
            <div className="tabs" role="tablist">
              {tabs.map(([id, label]) => (
                <button key={id} role="tab" className="tab" aria-selected={tab === id} onClick={() => setTab(id)}>
                  {label}
                  {id === 'problems' && problemCount > 0 && <span className={'badge ' + (errCount ? 'err' : 'warn')}>{problemCount}</span>}
                </button>
              ))}
            </div>
            <span style={{ flex: 1 }} />
            {tab === 'memory' && (
              <label className="muted" style={{ fontSize: 12, display: 'flex', gap: 6, alignItems: 'center' }} title="Also show the frames and blocks that belong to the standard library">
                <input type="checkbox" checked={showLib} onChange={(e) => setShowLib(e.target.checked)} /> library internals
              </label>
            )}
          </div>
          <div className="pane-body" role="tabpanel">
            {!view && !run?.compileError && <div className="empty"><h3>{status === 'running' ? 'Running…' : 'Nothing to show yet'}</h3>Press <b>Run</b> to execute your program on the simulated machine.</div>}
            {run?.compileError && tab !== 'problems' && <div className="empty"><h3>The program does not compile</h3>Fix the error shown under the editor, then run again. Just like a real compiler, nothing executes until it builds.</div>}
            {view && rp && tab === 'memory' && <MemoryPanel view={view} sel={sel} onSelect={(s) => { setSel(s); }} showLib={showLib} />}
            {view && rp && tab === 'hex' && <HexPanel rp={rp} view={view} sel={sel} />}
            {view && tab === 'map' && <MapPanel view={view} plat={plat} />}
            {tab === 'output' && <OutputPanel text={stdout} stderr={run?.stderr} atEnd={!!view?.atEnd} />}
            {tab === 'problems' && <ProblemsPanel diags={diagsForPanel} onJump={() => setPane('code')} />}
          </div>
        </section>
      </div>

      <Transport
        step={Math.min(k, count)} count={count} line={view?.line ?? 0} atEnd={atEnd} playing={playing} speed={speed} disabled={!rp || count === 0}
        onFirst={() => go(0)} onBack={() => go(k - 1)} onInto={into} onOver={over} onOut={out} onLast={() => go(count)}
        onPlay={() => { if (atEnd) go(0); setPlaying((p) => !p); }} onScrub={go} onSpeed={setSpeed}
      />

      <footer className="footer">
        <span>Stackyard</span>
        <span className="hide-sm">· a visual C++ memory lab</span>
        <span>· Created by <span className="credit">Saad Muzaffar Awan</span></span>
        <span className="spacer" />
        <span className="hide-sm">{plat.compiler}</span>
        <a href={REPO_URL} target="_blank" rel="noreferrer">GitHub</a>
        <span>MIT</span>
      </footer>

      {toast && <div className="tip" style={{ left: '50%', bottom: 76, top: 'auto', transform: 'translateX(-50%)' }} role="status">{toast}</div>}
      {about && <AboutDialog onClose={() => setAbout(false)} />}
      {quiz && <QuizDialog platform={platform} onClose={() => setQuiz(false)} onOpen={(q) => { setQuiz(false); setSource(q.code); setExampleId(undefined); void doRun(q.code, platform); }} />}
      {EXAMPLES.length === 0 ? null : null}
    </div>
  );
}
