// Assembles the C++ prelude (our "standard library written in C++") for the headers a program includes.
import core from './core.hpp?raw';
import cstdio from './cstdio.hpp?raw';
import cstdlib from './cstdlib.hpp?raw';
import cstring from './cstring.hpp?raw';
import cmath from './cmath.hpp?raw';
import cctype from './cctype.hpp?raw';
import cassert from './cassert.hpp?raw';
import utility from './utility.hpp?raw';
import algorithm from './algorithm.hpp?raw';
import exception from './exception.hpp?raw';
import string from './string.hpp?raw';
import iostream from './iostream.hpp?raw';

interface Chunk { src: string; deps: string[] }

const CHUNKS: Record<string, Chunk> = {
  core: { src: core, deps: [] },
  cstdio: { src: cstdio, deps: ['core'] },
  cstdlib: { src: cstdlib, deps: ['core'] },
  cstring: { src: cstring, deps: ['core'] },
  cmath: { src: cmath, deps: ['core'] },
  cctype: { src: cctype, deps: ['core'] },
  cassert: { src: cassert, deps: ['core'] },
  utility: { src: utility, deps: ['core'] },
  algorithm: { src: algorithm, deps: ['core', 'utility'] },
  exception: { src: exception, deps: ['core', 'cstring'] },
  string: { src: string, deps: ['core', 'cstdio', 'cstring', 'utility', 'exception', 'algorithm'] },
  iostream: { src: iostream, deps: ['string', 'core', 'utility', 'exception', 'cstdio', 'cstdlib', 'cstring', 'cmath', 'cctype'] },
};

/** header name -> chunk */
const HEADERS: Record<string, string> = {
  algorithm: 'algorithm', numeric: 'algorithm', iterator: 'algorithm', utility: 'utility', type_traits: 'utility', functional: 'utility',
  iostream: 'iostream', istream: 'iostream', ostream: 'iostream', iomanip: 'iostream',
  cstdio: 'cstdio', 'stdio.h': 'cstdio', cstdlib: 'cstdlib', 'stdlib.h': 'cstdlib', cstring: 'cstring', 'string.h': 'cstring',
  cmath: 'cmath', 'math.h': 'cmath', cctype: 'cctype', 'ctype.h': 'cctype', cassert: 'cassert', 'assert.h': 'cassert',
};

export const PRELUDE_LINE_BASE = 1_000_000;

export function includesOf(source: string): string[] {
  const out: string[] = [];
  const re = /^[ \t]*#[ \t]*include[ \t]*[<"]([^>"\n]+)[>"]/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(source))) out.push(m[1].trim());
  return out;
}

export function buildPrelude(source: string): string {
  const want = new Set<string>(['core']);
  const add = (name: string) => {
    if (want.has(name)) return;
    for (const d of CHUNKS[name].deps) add(d);
    want.add(name);
  };
  for (const h of includesOf(source)) {
    if (h === 'bits/stdc++.h') { Object.keys(CHUNKS).forEach(add); continue; }
    const c = HEADERS[h];
    if (c) add(c);
  }
  // keep dependency order: core first, then the C library, then everything else in registration order
  const order = Object.keys(CHUNKS).filter((k) => want.has(k));
  return order.map((k) => CHUNKS[k].src).join('\n');
}
