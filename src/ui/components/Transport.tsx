import type { ReactNode } from 'react';

interface Props {
  step: number;       // current step index (the line about to run)
  count: number;      // number of steps
  line: number;
  atEnd: boolean;
  playing: boolean;
  speed: number;
  disabled: boolean;
  onFirst(): void; onBack(): void; onInto(): void; onOver(): void; onOut(): void; onPlay(): void; onLast(): void;
  onScrub(k: number): void;
  onSpeed(v: number): void;
}

const I = (d: ReactNode) => <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true">{d}</svg>;
const icons = {
  first: I(<path d="M3 2h2v12H3zM13 2.5v11L6 8z" />),
  back: I(<path d="M12 2.5v11L4 8z" />),
  into: I(<path d="M8 1v8.2L5.4 6.6 4 8l4 4 4-4-1.4-1.4L9 9.2V1zM3 13h10v2H3z" />),
  over: I(<path d="M2 9a6 6 0 0 1 11-3.2V3h2v6h-6V7h2.4A4 4 0 0 0 4 9zm0 4h12v2H2z" />),
  out: I(<path d="M8 12V3.8l2.6 2.6L12 5 8 1 4 5l1.4 1.4L8 3.8V12zM3 13h10v2H3z" />),
  play: I(<path d="M4 2.5v11l9-5.5z" />),
  pause: I(<path d="M3.5 2h3v12h-3zM9.5 2h3v12h-3z" />),
  last: I(<path d="M11 2h2v12h-2zM3 2.5v11L10 8z" />),
};

export function Transport(p: Props) {
  const last = p.count;
  return (
    <div className="transport" role="toolbar" aria-label="Execution controls">
      <div className="tbtns">
        <button className="tbtn" disabled={p.disabled || p.step <= 0} onClick={p.onFirst} title="Back to the start (Home)" aria-label="Restart">{icons.first}</button>
        <button className="tbtn" disabled={p.disabled || p.step <= 0} onClick={p.onBack} title="Step back (←)" aria-label="Step back">{icons.back}<span className="label">Back</span></button>
        <button className="tbtn" disabled={p.disabled || p.atEnd} onClick={p.onInto} title="Step to the next line, entering calls (→ or F11)" aria-label="Step into">{icons.into}<span className="label">Step</span></button>
        <button className="tbtn" disabled={p.disabled || p.atEnd} onClick={p.onOver} title="Run the next line, skipping over calls (F10)" aria-label="Step over">{icons.over}<span className="label">Over</span></button>
        <button className="tbtn" disabled={p.disabled || p.atEnd} onClick={p.onOut} title="Run until this function returns (Shift+F11)" aria-label="Step out">{icons.out}<span className="label">Out</span></button>
        <button className="tbtn play" disabled={p.disabled || p.atEnd} onClick={p.onPlay} title={p.playing ? 'Pause (Space)' : 'Play (Space)'} aria-label={p.playing ? 'Pause' : 'Play'}>{p.playing ? icons.pause : icons.play}</button>
        <button className="tbtn" disabled={p.disabled || p.atEnd} onClick={p.onLast} title="Jump to the end (End)" aria-label="Jump to end">{icons.last}</button>
      </div>
      <div className="scrub">
        <input
          type="range" min={0} max={last} value={Math.min(p.step, last)} disabled={p.disabled}
          onChange={(e) => p.onScrub(Number(e.target.value))} aria-label="Timeline" aria-valuetext={p.atEnd ? 'finished' : `step ${p.step + 1} of ${p.count}`}
        />
        <div className="scrub-info">
          <span>{p.disabled ? 'Run the program to start' : p.atEnd ? 'Finished' : `Step ${p.step + 1} of ${p.count} · next: line ${p.line}`}</span>
          <span>{p.disabled ? '' : 'drag to travel through time'}</span>
        </div>
      </div>
      <label className="speed">Speed
        <select value={p.speed} onChange={(e) => p.onSpeed(Number(e.target.value))} aria-label="Playback speed">
          <option value={1100}>Slow</option><option value={550}>Normal</option><option value={220}>Fast</option><option value={60}>Very fast</option>
        </select>
      </label>
    </div>
  );
}
