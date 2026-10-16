# Stackyard: Project Plan (v2)

*A visual C++ memory lab. Type real C++, run it on a simulated Windows, Linux or macOS machine, and watch every byte.*

**Status:** v2. This version replaces the v1 plan ("MemLens", kept as `PLAN_v1_original.md`) after a cross-check. The build follows v2. **Author:** Saad Muzaffar Awan. **Licence:** MIT.

Evidence tags: **[Verified]** = automatically compared with real `g++`/glibc in the test suite. **[Documented]** = follows a published ABI or vendor document. **[Approximate]** = right shape, exact numbers may differ.

## 1. Change log: what the cross-check found in v1

| # | v1 said | Problem | v2 decision |
|---|---|---|---|
| 1 | Name "MemLens" | Generic, likely taken; "Lens" is an overused tool name | **Stackyard**: the stack and the heap, in one place. Short, unique, pronounceable |
| 2 | One machine model: x86-64 System V / glibc / libstdc++ | Contradicts the request that tricky questions cover Linux, macOS **and** Windows with Windows as default | Three platform profiles. **Windows (MSVC Debug, LLP64) is the default.** Each profile has its own sizes, layouts, fills, stack, allocator and library layout |
| 3 | "Every layout and allocator claim is verified against g++" | Only true for Linux. Claiming it for Windows/macOS would be false | Per-platform confidence labels shown in the UI. Only the Linux data model, class layout, library and heap are **[Verified]** |
| 4 | Custom Canvas renderer | Poor accessibility, hard to select/copy, costly to build | DOM/SVG rendering with React; pointer arrows computed after layout. Keyboard and screen-reader friendly |
| 5 | Interpreter keeps "no hidden state" and also "supports step-back" | Step-back needs history, which is hidden state | The run records a journal of events (writes with old and new bytes). The replay machine rebuilds memory at any step from the journal, so the picture is still exactly the memory |
| 6 | Standard library "imported" from libstdc++ | Not feasible: real headers need a full compiler and use features out of scope | A small standard library **written in C++** (`src/engine/prelude`) that runs on the same interpreter. Containers are genuinely made of bytes on the simulated heap |
| 7 | Stack of "a few MB" | Windows default is 1 MB, Linux 8 MB: one number was wrong for one of them | Per-platform: Windows 1 MB, Linux 8 MB, macOS 8 MB main thread |
| 8 | M0–M3 "public alpha" before classes/STL | The tricky questions need classes, vectors and strings from the start | Ship order changed: language core and classes first, then STL, then quiz |
| 9 | Quiz answers written by hand | A hand-written answer can disagree with the picture | The answer is **whatever the simulator prints** on the chosen platform. A test checks that every answer is one of the options and that Linux matches real `g++` |
| 10 | Licence undecided | The repository had none | MIT |
| 11 | Course content "later" | Out of scope for the tool; risks the tool never shipping | Out of scope for v1 of the tool. Examples, quiz and docs ship in the repo |

## 3. Scope

**In:** variables and sizes; operators and overflow; 1D/2D/3D arrays; pointers and references; pointer arithmetic; structs, padding, alignment; classes, constructors/destructors, inheritance, virtual functions and vptr; `new`/`delete`, `malloc`/`free`; call stack and recursion; `string` (small-string optimisation), `vector`, `array`, `deque`, `stack`, `queue`, `map`/`set`, `unique_ptr`/`shared_ptr`/`weak_ptr`; common algorithms; bugs (use after free, leaks, overruns, uninitialised reads, crashes) explained at the line that caused them.

**Out:** threads, filesystem, network, coroutines, modules; running other people's large programs; optimised-build behaviour (the model is a debug build); a server.

## 4. Architecture

1. **Front end.** Lexer, preprocessor, parser, templates, overload resolution (TypeScript).
2. **Interpreter.** Tree-walking; every value is bytes in a simulated address space with per-byte state (uninitialised, initialised, padding, allocator metadata, freed, out of scope, unallocated).
3. **Prelude.** The standard library in C++, assembled per `#include`.
4. **Platform model.** Data model, class layout, stack, fills, allocator (a faithful glibc malloc for Linux; documented approximations for Windows and macOS).
5. **Trace.** Events: write, read, line, push, pop, var, unvar, alloc, free, brk, output, diagnostic, note, end.
6. **Replay machine.** Seeks forwards and backwards through events; steps are user-source lines with call depth.
7. **UI.** React 19, CodeMirror 6, Web Worker (inline), no backend. Panels: Memory, Bytes, Address space, Output (with stdin), Problems; Quiz dialog.

## 5. Verification strategy

- **Differential corpus:** `tests/programs/*.cpp` run through the simulator and real `g++`; stdout must match byte for byte.
- **Allocator oracle:** random malloc/free/realloc sequences replayed on real glibc; returned pointers must match.
- **Examples** run on all three platforms; **quiz** questions run on all three platforms.
- **Replay tests:** forward/backward seeking gives identical state.
- Honest labels in the UI for anything not verified.

## 6. Milestones (status)

| Milestone | Content | Status |
|---|---|---|
| M0 | Lexer, parser, preprocessor | Done |
| M1 | Types, memory model, expressions, statements | Done |
| M2 | Functions, pointers, arrays, structs, heap, glibc allocator | Done |
| M3 | Classes, inheritance, virtual, templates, exceptions | Done |
| M4 | Prelude: string, vector, array, deque, algorithms | Done |
| M5 | map/set (red-black tree), smart pointers | Done |
| M6 | Platform profiles for Windows and macOS | Done (approximate heaps) |
| M7 | UI: editor, memory/bytes/address-space panels, replay, problems | Done |
| M8 | Quiz, examples, share-by-URL, light/dark, stdin | Done |
| M9 | Packaging: GitHub Pages, single-file HTML, CI, docs | Done |
| M10 | More library (list, unordered_*, sstream, optional, tuple), labs | Ongoing; see LIMITS.md |

## 7. Risks and honest counterarguments

- **Windows/macOS fidelity.** The default platform is the one with the weakest verification. Mitigation: visible labels and LIMITS.md. A contributor with a Windows machine can add a differential harness.
- **Interpreter speed.** A tree-walking interpreter with bigint is slow; the event cap (600k) bounds runs. Fine for teaching programs, not for benchmarks.
- **Debug-build model.** Optimised code often has different layouts. The tool says it models a debug build.
- **Scope creep.** The standard library is huge; each new header costs real work. LIMITS.md lists what is missing.

## 8. Quiz design

45 questions across six topics (types and sizes, operators, arrays and pointers, structs and classes, heap and containers, lifetime). Each has a level (warm-up, tricky, nasty), an explanation, and per-platform notes where behaviour differs. Predict first, then reveal, then open the same program in the visualiser.
