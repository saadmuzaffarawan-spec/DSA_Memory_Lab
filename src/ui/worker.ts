// Runs the C++ interpreter off the main thread so the page stays responsive while a program executes.
import { runProgram } from '../engine/run';
import type { PlatformId } from '../engine/platform';

interface Req { id: number; source: string; platform: PlatformId; stdin?: string }

self.onmessage = (e: MessageEvent<Req>) => {
  const { id, source, platform, stdin } = e.data;
  try {
    const result = runProgram(source, { platform, stdin });
    (self as unknown as Worker).postMessage({ id, result });
  } catch (err) {
    (self as unknown as Worker).postMessage({ id, error: err instanceof Error ? `${err.name}: ${err.message}` : String(err) });
  }
};
