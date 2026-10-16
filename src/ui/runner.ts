import RunWorker from './worker?worker&inline';
import type { RunResult } from '../engine/trace';
import type { PlatformId } from '../engine/platform';

let worker: Worker | null = null;
let seq = 0;

/** Run a program in the worker. A new run cancels the previous one; a run that takes too long is stopped. */
export function runInWorker(source: string, platform: PlatformId, stdin?: string, timeoutMs = 20000): Promise<RunResult> {
  if (worker) worker.terminate();
  worker = new RunWorker();
  const w = worker;
  const id = ++seq;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { w.terminate(); if (worker === w) worker = null; reject(new Error('The run took longer than ' + timeoutMs / 1000 + ' seconds and was stopped. Does your program have an endless loop?')); }, timeoutMs);
    w.onmessage = (e: MessageEvent<{ id: number; result?: RunResult; error?: string }>) => {
      if (e.data.id !== id) return;
      clearTimeout(timer);
      if (e.data.error) reject(new Error(e.data.error)); else resolve(e.data.result!);
    };
    w.onerror = (e) => { clearTimeout(timer); reject(new Error(e.message || 'The simulator crashed')); };
    w.postMessage({ id, source, platform, stdin });
  });
}
