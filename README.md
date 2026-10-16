# Stackyard

**See your C++ memory.** Type real C++, run it on a simulated Windows, Linux or macOS machine, and watch every byte: the stack, the heap, pointers, arrays, objects, and the allocator's own bookkeeping. Step forwards *and backwards*.

Created by **Saad Muzaffar Awan** · MIT licence · no backend, no account, runs entirely in your browser.

## What it is for

Most C++ courses say "a pointer holds an address" and move on. Stackyard shows the address, the bytes behind it, the padding the compiler inserted, the hidden header the allocator wrote in front of your `new`, and what is left behind after `delete`.

- **Memory view** – stack frames and heap blocks with every variable drawn as the bytes it really occupies; pointer arrows connect pointers to what they point at (including dangling ones).
- **Bytes view** – a hex dump with byte states: uninitialised, initialised, padding, allocator metadata, freed, out of scope.
- **Address space** – where globals, code, heap and stack live on the chosen platform, with zoomed stack and heap strips.
- **Time travel** – step into / over / out, scrub a timeline, or go back. Library internals can be shown or hidden.
- **Problems** – use after free, leaks, buffer overruns, uninitialised reads and crashes are explained in plain English, at the line that caused them.
- **Quiz** – 45 tricky questions (sizes, padding, promotion, pointers, slicing, vector growth…). Predict first, then reveal. The "right answer" is whatever the simulator prints for the platform you chose, and every question is also checked against a real `g++` in the test suite.
- **Three machines** – Windows x64 (MSVC Debug, the default), Linux x86-64 (GCC, glibc) and macOS (Apple Clang, libc++). Flip the switch and the same program shows different sizes, layouts and growth policies.

## Run it

```bash
npm install
npm run dev            # http://localhost:5173
npm test               # engine, corpus, examples, replay, quiz, allocator oracle
npm run build          # static site in dist/ (GitHub Pages ready)
npm run build:single   # ONE self-contained file: dist-single/index.html (works from file://)
```

Node 20 or newer. The allocator oracle test and `tools/gen-expected.sh` call a real `g++`; everything else is pure TypeScript.

## How it works

1. A **C++ front end** (lexer, preprocessor, parser, templates, overload resolution) written in TypeScript.
2. A **tree-walking interpreter** that stores every value as bytes in a simulated address space and records every read, write, allocation and call as an event.
3. A **standard library written in C++** (`src/engine/prelude/*.hpp`: `string`, `vector`, `map`, `unique_ptr`, …) that runs on the same interpreter, so containers really are made of bytes on the simulated heap, laid out the way each platform's library lays them out.
4. A **platform model** per OS: data model (LP64 or LLP64), stack size, heap allocator (a faithful glibc malloc on Linux), fill patterns, class layout rules.
5. A **replay machine** that moves the recorded event list backwards and forwards, and a React UI that draws the machine state at any step.

Everything executes in a Web Worker so an endless loop cannot freeze the page.

## How accurate is it?

Honest summary; the full list is in [LIMITS.md](LIMITS.md) and in the app's About dialog.

| | Windows | Linux | macOS |
|---|---|---|---|
| Type sizes and class layout | documented ABI | **verified against g++** | documented ABI |
| Standard library behaviour | approximate | **verified against g++** | approximate |
| Heap allocator | approximate | **verified against real glibc** | approximate |
| Stack and addresses | approximate | documented | approximate |

*verified* means an automated test compares against real output; *documented* means it follows the ABI or vendor documentation; *approximate* means the shape is right but exact numbers can differ from a real machine. Addresses are simulated and repeatable (like a debugger with ASLR off).

## Project layout

```
src/engine/      C++ front end, interpreter, memory, allocators, platform models
src/engine/prelude/   the C++ standard library, written in C++
src/ui/          React app: editor, replay machine, memory/bytes/address-space panels, quiz
src/content/     example programs and the tricky-question bank
tests/           parser, corpus (vs g++), examples, replay, quiz, allocator oracle
tools/           gen-expected.sh (refresh g++ expectations), shot.mjs (screenshots)
docs/            project plan and design notes
```

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). New example programs and quiz questions are the easiest way to help.

## Licence

MIT. See [LICENSE](LICENSE).
