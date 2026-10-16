// The driver: source text -> compile (parse + declare) -> run main() on the simulated machine -> RunResult trace.
import { CompileError } from './lexer';
import { preprocess } from './preproc';
import { newParseCtx, parseTokens } from './parser';
import { Fault } from './memory';
import { Interp, type RunOptions } from './interp';
import { registerNatives } from './natives';
import { buildPrelude, PRELUDE_LINE_BASE } from './prelude';
import { PLATFORMS, type Platform, type PlatformId } from './platform';
import { declareProgram } from './decls';
import { callFnValue, destroyObj, fmtScalar } from './call';
import { CxxThrow, newScope, type Frame } from './env';
import { S, type Diag, type RunResult } from './trace';
import { lookupQName } from './typeres';
import { typeStr } from './types';

export interface RunInput extends RunOptions {
  platform: PlatformId | Platform;
  /** extra stack/heap sizes etc. can be passed through withOverrides() before calling */
}

const LIB_LINE = PRELUDE_LINE_BASE;
export const isLibLine = (line: number) => line >= LIB_LINE;

function rootFrame(I: Interp): Frame {
  const P = I.plat;
  const top = P.stack.top - 0x600;
  const cur = Math.floor(top / 16) * 16;
  return {
    id: I.newId(), fn: null, thisV: null, cfa: cur, low: cur, cursor: cur, upCursor: 0, upLimit: 0, slotMap: new Map(), retSlot: undefined,
    line: 0, tmpMark: 0, depth: 0, nrvo: null, nrvoAddr: 0, retType: null, varsIds: [], scope: I.global, catches: 0,
    rbp: 0, retValue: 0, minCursor: cur, planned: 0, paramSlots: [],
  } as Frame;
}

function compileError(source: string, plat: Platform, e: CompileError): RunResult {
  return {
    platform: plat.id, events: [], types: {}, source, truncated: false, exitCode: null, stdout: '', diagnostics: [],
    compileError: { message: e.message, line: e.line >= LIB_LINE && !(globalThis as any).__STACKYARD_DEV ? 0 : e.line, col: e.col },
    reason: 'abort',
  };
}

export function runProgram(source: string, input: RunInput): RunResult {
  const plat = typeof input.platform === 'string' ? PLATFORMS[input.platform] : input.platform;
  let I: Interp | null = null;
  try {
    const prelude = buildPrelude(source);
    const text = `#line ${LIB_LINE}\n${prelude}\n#line 1\n${source}`;
    const pp = preprocess(text, plat.macros);
    const ctx = newParseCtx();
    const decls = parseTokens(pp.tokens, ctx);
    I = new Interp(plat, input);
    I.sourceLines = source.split('\n');
    registerNatives(I);
    const root = rootFrame(I);
    I.frames.push(root);
    return execute(I, source, decls);
  } catch (e) {
    if (e instanceof CompileError) {
      // a semantic error found while running: a real compiler would have refused to build the program
      return compileError(source, plat, e);
    }
    throw e;
  }
}

function execute(I: Interp, source: string, decls: ReturnType<typeof parseTokens>): RunResult {
  const plat = I.plat;
  let exitCode: number | null = null;
  let reason: RunResult['reason'] = 'return';
  let endMessage: string | undefined;
  const finish = (): RunResult => {
    const mem = I.mem;
    mem.emit({ t: 'end', code: exitCode ?? 0, reason: reason ?? 'return', msg: endMessage });
    return {
      platform: plat.id, events: mem.events, types: I.typeInfo, source, truncated: mem.truncated, exitCode, stdout: I.out, stderr: I.errOut,
      diagnostics: mem.diags, reason, endMessage, allocator: I.heap.describe(), steps: I.steps,
    };
  };
  const bumpEnd = () => { try { I.mem.eventLimit += 10; } catch { /* ignore */ } };

  try {
    // 1. process image + static initialisation
    const std = newScope('ns', I.global, 'std');
    void std;
    declareProgram(I, decls, I.global);
    const stdEnt = I.global.names.get('std')?.find((e) => e.k === 'ns');
    if (stdEnt && stdEnt.k === 'ns' && !stdEnt.scope.usings.includes(I.global)) stdEnt.scope.usings.push(I.global);
    I.startedMain = true;
    // 2. main
    const mainEnt = I.global.names.get('main')?.find((e) => e.k === 'fns');
    if (!mainEnt || mainEnt.k !== 'fns' || !mainEnt.fns.length) {
      throw new CompileError(plat.id === 'windows' ? "unresolved external symbol main referenced in function invoke_main" : "undefined reference to `main'", 1, 0);
    }
    const mainFn = mainEnt.fns[0];
    const args = [];
    const np = mainFn.decl?.params.length ?? 0;
    if (np >= 2) {
      const top = I.plat.stack.top;
      const nameStr = plat.id === 'windows' ? 'C:\\Users\\student\\source\\repos\\Project\\x64\\Debug\\Project.exe' : plat.id === 'macos' ? '/Users/student/a.out' : '/home/student/a.out';
      const bytes = new TextEncoder().encode(nameStr + '\0');
      const strAddr = top - 0x300;
      I.mem.loadImage(strAddr, bytes, S.Init);
      const vec = top - 0x200;
      const b = new Uint8Array(16);
      new DataView(b.buffer).setBigUint64(0, BigInt(strAddr), true);
      I.mem.loadImage(vec, b, S.Init);
      args.push(I.mkInt(I.T.int, 1n), I.mkPtr({ k: 'ptr', to: I.T.char }, vec));
    }
    I.curLine = mainFn.decl?.pos.line ?? 0;
    const r = callFnValue(I, { k: 'fn', name: 'main', cands: [mainFn], qualified: true }, args);
    const rv = I.rv(r);
    exitCode = rv.k === 'i' ? Number(rv.v) : 0;
    I.mainDone = true;
    runExitHandlers(I);
    if (plat.id !== 'windows') exitCode &= 0xff;
  } catch (e: any) {
    ({ exitCode, reason, endMessage } = handleStop(I, e, exitCode, reason, endMessage));
    const rs = reason as string;
    if (rs !== 'return' && rs !== 'exit') bumpEnd();
    else if (rs === 'exit') { try { runExitHandlers(I); } catch { /* ignore */ } }
  }
  try { leakReport(I); } catch { /* ignore */ }
  if (reason === 'return' || reason === 'exit') {
    if (exitCode !== null && plat.id !== 'windows') exitCode &= 0xff;
  }
  return finish();
}

function runExitHandlers(I: Interp) {
  while (I.atExit.length) {
    const f = I.atExit.pop()!;
    callFnValue(I, { k: 'fn', name: f.name, cands: [f], qualified: true }, []);
  }
  I.mem.line = 0;
  // static destructors run in reverse order of construction
  while (I.staticDtors.length) {
    const d = I.staticDtors.pop()!;
    destroyObj(I, d.type, d.addr, false);
  }
}

function handleStop(I: Interp, e: any, exitCode: number | null, reason: RunResult['reason'], endMessage: string | undefined) {
  if ((globalThis as any).__STACKYARD_DEV && process.env.TRACE) console.error(e?.stack);
  const plat = I.plat;
  if (e instanceof Fault) {
    if (e.kind === 'exit') return { exitCode: e.code, reason: 'exit' as const, endMessage };
    I.fatalPending = true;
    const win = plat.id === 'windows';
    if (e.kind === 'limit') return { exitCode: null, reason: 'limit' as const, endMessage: e.message };
    let msg = e.message;
    if (e.kind === 'segv' || e.kind === 'stack-overflow') {
      I.mem.diag('null-deref', 'error', e.kind === 'stack-overflow' ? 'Stack overflow' : 'Crash: invalid memory access', msg, e.addr, 1, false);
    }
    if (e.kind === 'abort' || e.kind === 'assert' || e.kind === 'oom') {
      I.mem.diag('ub-other', 'error', win ? 'Program aborted' : 'Program aborted (SIGABRT)', msg, undefined, undefined, false);
    }
    if (e.kind === 'div-zero') I.mem.diag('div-zero', 'error', 'Arithmetic exception', msg, undefined, undefined, false);
    return { exitCode: e.code, reason: (e.kind === 'abort' || e.kind === 'assert' ? 'abort' : 'fault') as 'abort' | 'fault', endMessage: msg };
  }
  if (e instanceof CxxThrow) {
    I.fatalPending = true;
    let name = typeStr(e.type);
    let what = '';
    try {
      if (e.type.k === 'cls') {
        const hit = I.findMemberPublic(e.type.c, 'what');
        if (hit) {
          const r = callFnValue(I, { k: 'fn', name: 'what', cands: hit.fns, self: { k: 'l', t: e.type, a: e.addr + hit.baseOffset }, qualified: false }, []);
          const p = I.rv(r);
          if (p.k === 'i') what = I.cstr(Number(p.v));
        }
      } else if (e.type.k === 'ptr') what = '';
    } catch { /* ignore */ }
    const win = plat.id === 'windows';
    const msg = win
      ? `Unhandled exception: ${name}${what ? ' — ' + what : ''}\n(terminate → abort() has been called)`
      : `terminate called after throwing an instance of '${name}'${what ? `\n  what():  ${what}` : ''}`;
    I.print(msg + '\n', true);
    I.mem.diag('ub-other', 'error', 'Uncaught exception', `An exception of type ${name} reached the top of main() with no matching catch, so std::terminate() called abort().`, undefined, undefined, false);
    return { exitCode: 134, reason: 'abort' as const, endMessage: win ? 'abort() has been called' : 'Aborted (core dumped)' };
  }
  if (e instanceof RangeError && /call stack/i.test(String(e.message))) {
    I.fatalPending = true;
    const win = plat.id === 'windows';
    const depth = I.frames.length;
    const msg = win ? 'Stack overflow (0xC00000FD): too many nested calls' : `${plat.faultName} — stack overflow: the call stack is exhausted`;
    I.mem.diag('stack-overflow-write', 'error', 'Stack overflow', `The recursion went ${depth} calls deep without ending. Every call uses stack memory, and a real machine runs out after a few thousand frames.`, undefined, undefined, false);
    return { exitCode: win ? 0xC00000FD : 139, reason: 'fault' as const, endMessage: msg };
  }
  void exitCode; void reason; void endMessage;
  throw e;
}

function leakReport(I: Interp) {
  if (I.fatalPending) return;
  const live = [...I.heap.live.values()].filter((r) => !/exception/.test(r.how));
  const total = live.reduce((s, r) => s + r.req, 0);
  for (const r of live.slice(0, 20)) {
    const d: Diag = {
      code: 'leak', severity: 'warn', title: 'Memory leak',
      body: `${r.req} byte${r.req === 1 ? '' : 's'} at 0x${r.user.toString(16)} allocated by ${r.how}${r.line && !isLibLine(r.line) ? ' on line ' + r.line : ''} were never freed.`,
      addr: r.user, len: r.req, line: r.line,
    };
    I.mem.diags.push(d);
    I.mem.emit({ t: 'diag', d });
  }
  if (live.length > 20) I.mem.emit({ t: 'note', msg: `…and ${live.length - 20} more leaked allocations (${total} bytes in total).` });
  void lookupQName; void fmtScalar;
}
