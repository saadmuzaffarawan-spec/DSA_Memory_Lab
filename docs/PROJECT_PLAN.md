# MemLens — Project Plan

*A visual C++ memory lab: type real C++, watch it run on a virtual machine whose memory you can see byte by byte.*

*"MemLens" is a working name. Check that it is free on GitHub and as a domain before publishing.*

**Status:** plan v1, for review before any build work starts
**Date:** 14 Oct 2026
**How to read the evidence tags:**
- **[Verified]** means I ran it on a real compiler in this session (g++ 13.3.0, Ubuntu 24.04, x86-64). Raw results are in Appendix A.
- **[Source]** means it comes from a cited page or book.
- **[Estimate]** means my own analytical judgement. It has not been measured.

---

## 1. Summary

**What it is.** A web app. The student types real C++ in an editor and presses Run. The program executes on a simulated machine with a few MB of virtual memory. Every variable, array, struct, object and heap block appears at a real-looking address. The student can step forward and backward through the run and watch bytes change.

**The one idea that makes it work.** The interpreter keeps no hidden variables. Every object lives in the virtual memory, and the screen shows that memory. What the student sees is what the program is using.

**Recommended stack.**
- TypeScript, with a purpose-built C++ interpreter that runs in a Web Worker in the browser.
- No server, so it is free to host (GitHub Pages) and safe for a classroom.
- React with Vite for the UI, CodeMirror 6 for the editor, and a custom Canvas renderer for memory.

**How "exactly like real" is kept honest.** The simulator models one specific, common machine: x86-64 System V ABI, glibc `malloc`, libstdc++ containers. Every layout and allocator claim is checked automatically against real `g++` output (see §10). Where real compilers differ or the C++ standard leaves behavior undefined, the tool says so on screen instead of pretending.

**What you get first.** M0–M3 (§12) deliver a public alpha covering types, operators, pointers, arrays (1D/2D/3D), structs, functions and the call stack, `new`/`delete`, and `malloc`/`free`. Your "three arrays vs one 3D array" example works end to end at that point. Classes, inheritance, `vector.push_back` and the STL arrive in M4–M5.

**Decisions I need from you:** §14.

---

## 2. Goals, audience and success criteria

**Audience.** You and your fellow students. Beginner to intermediate C++, learning memory and DSA. Secondary audience: anyone on GitHub who wants a free, self-hostable teaching tool.

**Success criteria.** A student can:
1. Predict, then confirm visually, the answer to each question in the tricky-question bank (§8).
2. Declare any variable, array, struct or object and see the exact bytes it occupies, with padding and alignment visible.
3. Step backward as well as forward through any run.
4. Open the tool on a laptop or a school lab PC with no install and no account.

**Performance targets [Estimate, not yet measured].**
- A typical teaching program (under 200 000 interpreted steps) finishes in under 1 second.
- Pan and zoom on the memory canvas holds 60 fps with 6 MB mapped.
- First load is under 2 seconds on broadband, and the app works offline after the first visit.

**Out of scope for v1.** Threads, file I/O, networking, full `<iostream>` formatting, locales, regex, coroutines, modules, template metaprogramming. Reasons are in §5.

---

## 3. Prior art and positioning

**Python Tutor** has a C/C++ visualizer. According to its own article it shows globals, stack, heap and read-only memory, pointers, uninitialized memory, out-of-bounds marks, nested structs/unions, C++ objects with copy constructors and `this`, and a byte-level view. It is built on Valgrind [Source: [pythontutor.com/articles/c-cpp-visualizer.html](https://pythontutor.com/articles/c-cpp-visualizer.html)]. That article does not mention STL support. I have not tested it, so spend ten minutes on it before we commit, to confirm the gap I'm assuming.

**Where MemLens aims to be different [Estimate, based on the above]:**

| Gap | MemLens answer |
|---|---|
| Valgrind needs native execution, so it most likely runs server-side | Fully client-side. Self-hostable. Safe to run untrusted student code |
| Uses the real machine, so layout can vary run to run | A configurable virtual machine (LP64 / LLP64 / 32-bit, selectable allocator) with a stable, documented layout |
| Allocator internals are not the focus | Heap chunks, headers, free lists and fragmentation are first-class |
| Not a designed lesson system | Predict-then-reveal challenges, curated tricky questions, share links, exportable diagrams |
| Closed hosted service | Open source |

**Why not just use `gdb`?** It is the real thing and it is hard for beginners. MemLens is a teaching instrument, not a debugger.

---

## 4. Architecture decision

| Option | How it works | Pros | Cons | Verdict |
|---|---|---|---|---|
| **A. Real compile + trace** | Compile with g++, run under ptrace/Valgrind on a server, send the trace back | 100% real behavior | Needs a server; arbitrary code execution is a security risk; addresses change every run (ASLR, which E2 shows); no control over the machine model | Rejected for the product; **used as the test oracle** |
| **B. Clang to WebAssembly in the browser** | Compile in-browser, run the WASM | Real compiler semantics | Compiler download is large [Estimate: tens of MB]; WASM memory is not stack/heap/globals as C++ sees them; mapping variables to bytes needs debug-info plumbing; no way to teach "what if the allocator differed" | Rejected |
| **C. Custom interpreter on a virtual machine** | Parse a C++ subset, interpret it over a byte-addressable simulated memory | Full control, deterministic, step-back is cheap, runs anywhere, a student can change the machine | You must implement C++ yourself, so it is a subset and fidelity depends on testing | **Chosen** |

**Why C is acceptable despite the subset problem.** Teaching programs use a bounded slice of C++. Option A, run on the same programs, becomes an automatic correctness check on C (§10).

**Stack.**

| Layer | Choice | Reason |
|---|---|---|
| Language | TypeScript, strict | One language across core, UI and tests. Contributors need only Node |
| Core | `packages/core`, no DOM dependency | Runs in Node for tests and the oracle, in a Worker for the app |
| UI | React 19 + Vite | Largest contributor pool. Fast builds. Verified on npm this session: React 19.3.0, Playwright 1.64.0, Vitest 5.0.4 |
| Editor | CodeMirror 6 | Lighter than Monaco and fully themeable. Supports gutter markers and inline decorations |
| Memory view | Custom Canvas 2D with semantic zoom | DOM cannot draw 6 MB of cells. Needs a custom renderer |
| State | Zustand | Small. The timeline is a pure function of the trace index |
| Tests | Vitest, fast-check, Playwright, axe-core | See §10 |
| Hosting | GitHub Pages via GitHub Actions | Free, static, no backend |

**Alternative I considered: Rust compiled to WASM for the core.** It would be faster and stricter. It adds a second toolchain for contributors, and the speed is not needed for teaching programs. I'd revisit it only if profiling shows a real problem.

**Alternative I considered: your usual C++ with Raylib.** It would run natively but could not be shared by link, and I could not reach the polish you asked for with an immediate-mode UI. The web gives better typography, accessibility and distribution.

---

## 5. Language scope

The interpreter implements a **teaching subset of C++17**. The line is drawn by one question: *does it change what is in memory, or how a student reasons about it?*

| In scope (v1) | Notes |
|---|---|
| All fundamental types, `sizeof`, `alignof`, casts (C-style, `static_`, `reinterpret_`, `const_`) | Integer promotion, wraparound and IEEE-754 are modeled |
| All operators, with precedence and evaluation order | Includes bitwise, shifts, comma, ternary, `sizeof`, `new`/`delete`, pointer arithmetic |
| Control flow, functions, recursion, overloading, default arguments, `inline` | |
| Pointers, references, function pointers, N-dimensional arrays, C strings | Array-to-pointer decay is visible |
| `struct`, `union`, `enum`, `enum class`, bitfields, `typedef`/`using` | |
| Classes: constructors, destructors, copy/move, `this`, `static`, `const`, `friend`, operator overloading | |
| Inheritance, `virtual`, vtables, multiple and virtual inheritance, `dynamic_cast` | |
| Exceptions with stack unwinding | Destructors run in order |
| Templates: function and class, type and non-type parameters, simple specialization | Needed anyway to run the STL prelude |
| Lambdas and closures | Capture storage is shown as an object |
| `malloc`/`free`/`calloc`/`realloc`, `new`/`delete`/`new[]`/`delete[]`, placement `new` | |
| `std::vector`, `string`, `array`, `pair`, `unique_ptr`, `shared_ptr`, `weak_ptr`, `list`, `stack`, `queue` | v1.0 |
| `std::map`, `set`, `deque`, `unordered_map` | Later milestone (M8) |
| `cout`/`cin`/`printf`/`scanf` basics, common `<algorithm>` and `<cmath>` | |
| Preprocessor: `#include` (built-in headers), simple `#define`, `#if`/`#ifdef` | |

| Out of scope (v1) | Why |
|---|---|
| Threads, atomics, mutexes | Needs a scheduler model. Possible later |
| File I/O, networking | Nothing to see in memory |
| `<regex>`, `<locale>`, `<filesystem>`, coroutines, modules | Cost far exceeds teaching value |
| SFINAE, variadic-template tricks, `constexpr` evaluation | `constexpr` treated as `const`; metaprogramming deferred |

If a student uses something out of scope, the error says exactly which feature is unsupported and links to the limits page. It never fails silently.

**Reference material.** I mapped the curriculum to the two books you attached (§8, Appendix B). Note that the first file is named "The C Programming Language 4th Edition" but is Stroustrup's *The C++ Programming Language, 4th ed.* (C++11). The Schildt book is the 3rd edition from 1998, so it predates C++11. Use it for fundamentals and the C-compatible subset. Use Stroustrup, the standard, and the real-compiler oracle for anything modern, such as move semantics or smart pointers.

---

## 6. The virtual machine (memory model specification)

### 6.1 Address space

Memory is **segmented, with realistic 64-bit addresses**, backed by plain byte arrays. Gaps between segments are unmapped, so touching them raises a segmentation fault.

```
High   0x7ffc_0000_0000 ┌───────────────┐  STACK  (grows down, default 1 MB)
                        │   ...unmapped │
                        ├───────────────┤  HEAP   (grows up, default 4 MB)
                        │   .bss        │  zero-initialized globals/statics
                        │   .data       │  initialized globals/statics
                        │   .rodata     │  string literals, const globals
Low    0x0040_0000      └───────────────┘  .text  (functions get addresses)
       0x0000_0000      null page, unmapped
```

Segment sizes are configurable up to a cap. Defaults are a 4 MB heap and a 1 MB stack, which covers the "few MB" you asked for. A 1 MB stack means a runaway recursion overflows in a reasonable number of frames, so students can see a stack overflow happen.

**Segment order matches a real run [Verified, E2].** Addresses rose in the order `.text` (functions), `.rodata`, `.data`, `.bss`, heap, stack. `g_const` and the literal `"hello"` sat together in `.rodata`, `g_init` and `g_static` were adjacent in `.data`, and `g_zero` followed in `.bss`.

### 6.2 Shadow memory

Beside every data byte the VM keeps a shadow record: **state** (unmapped, uninitialized, initialized, padding, freed, red zone) and **owner object ID**. This is the same idea as AddressSanitizer plus Valgrind's definedness tracking, built into the simulator. It is what lets the canvas color bytes by object, hatch padding, and flag use-after-free, uninitialized reads and overflows.

### 6.3 Data models

The student can switch the target:

| Model | `int` | `long` | pointer | Typical platform |
|---|---|---|---|---|
| LP64 (default) | 4 | 8 | 8 | Linux, macOS |
| LLP64 | 4 | 4 | 8 | Windows 64-bit |
| ILP32 | 4 | 4 | 4 | 32-bit systems |

`sizeof(long)` differing between models is a classic trick question, and the switch makes it visible. All sizes in the LP64 column are **[Verified, E1]**. Little-endian is the default **[Verified, E1: `0x11223344` stores as `44 33 22 11`]**. Plain `char` is signed on x86 **[Verified, E1]**.

### 6.4 Struct and class layout

The layout engine follows the Itanium C++ ABI rules used by g++/clang on Linux. Each rule below matches what real g++ produced:

| Rule | Evidence [Verified, E1] |
|---|---|
| Members are aligned to their type, struct padded to its max alignment | `struct {char; int; char}` → size 12. Reordered to `{int; char; char}` → size 8 |
| `char, double, char` | size 24, `double` at offset 8, second `char` at offset 16 |
| Empty class has size 1 | `sizeof(Empty) == 1` |
| Empty base optimization | `struct : Empty { int x; }` → size 4, not 8 |
| Polymorphic class starts with an 8-byte vptr | `struct V { virtual f(); int x; }` → size 16. The first 8 bytes of two objects hold the same vtable address |
| Multiple inheritance shifts the base pointer | `M : P, Q` → converting `M*` to `Q*` adds 4 bytes |
| Virtual inheritance adds a vptr | `VB1 : virtual P { int q; }` → size 16 |
| Union is as big as its largest member, rounded up for alignment | `union {int; char[5]; double}` → size 8 |
| `alignas` is honored | `alignas(32)` struct → size 32 |

### 6.5 The stack frame

Each call pushes a frame laid out like x86-64 System V at `-O0`: **return address (8 bytes), saved frame pointer (8 bytes), then locals**, with 16-byte alignment. Real frames are visible in E2: four nested calls of a tiny function sat exactly 0x40 (64) bytes apart, growing downward **[Verified, E2]**.

**Local variable order is not fixed by the standard, and I checked that.** In E2 the three `int` locals rose in address in declaration order. In E4, compiled with different flags, the three locals fell in address in declaration order, the opposite direction. In E2 the array also sat far above the scalars, probably because of the stack protector that Ubuntu enables by default, though I did not isolate the cause **[Verified, E2, E4]**. So MemLens uses **one documented policy** (first-declared local at the highest address, matching the E4 run), and labels it as "a typical `-O0` layout, not guaranteed by C++". Predicting real local addresses is not something any tool can promise.

### 6.6 The heap allocator

The default allocator is a **teaching model of glibc's `malloc`**, validated against real behavior:

| Behavior | Evidence [Verified, E2] |
|---|---|
| Each chunk has an 8-byte header word holding size and flags | Word before a 24-byte allocation read `0x21`, which is size `0x20` plus a "previous in use" flag |
| Returned pointer is 16-byte aligned | All observed pointers end in `0` |
| Chunk size = request + 8, rounded up to a multiple of 16, minimum 32 | `malloc(1..24)` → usable 24. `malloc(25..40)` → usable 40. `malloc(48)` → usable 56. `malloc(100)` → usable 104 |
| Back-to-back small allocations are 32 bytes apart | `new int` twice → addresses differ by 32, so **a 4-byte `int` costs 32 bytes of heap** |
| A freed block is reused first (LIFO) | `free(p2); malloc(24)` returned `p2` |

Students can also switch to other strategies to study DSA ideas: **first-fit, best-fit, next-fit, buddy system, bump/arena, and free-list with coalescing**. The allocator panel shows chunk headers, free lists, the largest free block and a fragmentation score.

### 6.7 Undefined behavior policy

C++ leaves many things undefined, and real outcomes vary by compiler and optimization level. I tested this:

- **Buffer overflow into a neighbor** at `-O0` with no stack protector: `memset` of 12 bytes into an 8-byte buffer overwrote the adjacent `guard` variable with `0x41414141` **[Verified, E4]**.
- The same program at `-O2` **aborted** with "buffer overflow detected" **[Verified, E4]**. This is consistent with `_FORTIFY_SOURCE`, which Ubuntu enables by default at `-O2`. I did not confirm that flag directly.
- `x + 1 > x` with `x = INT_MAX` returned **true even at `-O0`**, because the compiler folded it, not because anything wrapped **[Verified, E4]**. I had predicted the opposite while writing the test, which is a good illustration of why this policy matters.
- An uninitialized local held garbage (`32756`) **[Verified, E4]**.

**Policy.** MemLens simulates the machine honestly: bytes really get overwritten, uninitialized reads show a visible `??` pattern, hardware-level faults (null/unmapped access, stack overflow, divide by zero) stop the program like a real SIGSEGV or SIGFPE would. Each undefined operation also raises a **diagnostic card**: "This is undefined behavior. On this simulated machine it did X. A real compiler may do something else, and here is why." Students learn the effect and the caveat together.

---

## 7. The experience (UI/UX)

### 7.1 Principles ("designed, not generated")

1. **The memory canvas is the hero.** Everything else supports it.
2. **Color carries meaning, never decoration.** A restrained palette of about five hues plus neutrals encodes segment, ownership and state. Checked for color-blind safety and WCAG AA contrast.
3. **One typographic system.** A neutral UI sans plus a monospace for bytes and code, both self-hosted so it works offline.
4. **Purposeful motion only.** Writes pulse, allocations grow into place, frees fade to a hatch. All of it respects `prefers-reduced-motion`.
5. **IDE-grade density.** Compact, aligned, keyboard-first. No gradient blobs, glass cards, emoji icons or stock illustrations. One consistent line-icon set.
6. **Accessible by default.** Full keyboard navigation, screen-reader narration of each step through a live region, light/dark/high-contrast themes.
7. **Honest by default.** Every approximation is labeled where it appears, not buried in docs.

### 7.2 Main screen

```
┌──────────────────────────────────────────────────────────────────────────┐
│ MemLens   ▸ Run  ⏮ ⏪ ▶ ⏩ ⏭   Step 42 / 318 ━━━━●━━━━━━━   LP64 · 4MB heap │
├────────────────────────┬─────────────────────────────────────────────────┤
│ main.cpp               │  MEMORY                                          │
│ 1 #include <iostream>  │  ┌ STACK ───────────────────────────────────┐   │
│ 2 int main() {         │  │ 0x7ffc..e0  main()                        │   │
│ 3   int a[3] = {1,2,3};│  │  ├ a   int[3]  [01 00 00 00|02 00..|03..] │   │
│ 4 ▶ int* p = a;        │  │  └ p   int*    0x7ffc..e0 ───────────┐    │   │
│ 5   p++;               │  ├ HEAP ────────────────────────────────┼───┤   │
│ 6 }                    │  │ chunk 0x55..2a0  32B  [hdr|data|pad]  │   │   │
│                        │  └ GLOBALS · RODATA · CODE ──────────────┘   │
├────────────────────────┼─────────────────────────────────────────────────┤
│ Console / stdin        │  Inspector: p  int*  =0x7ffc..e0 → a[0]         │
│ Diagnostics            │  Types · Layout · Allocator · Cache · Operators │
└────────────────────────┴─────────────────────────────────────────────────┘
```

### 7.3 Memory canvas

- **Semantic zoom.** Overview (the whole address space as a minimap, objects as blocks), object level, and byte level (hex plus decoded value).
- **Ownership coloring.** Each object is one color. Padding is hatched. Uninitialized is dim `??`. Freed is red-hatched. Red zones and unmapped gaps are marked.
- **Pointer arrows.** Curved connectors from pointer to target, labeled (`p → a[2]`). Dangling pointers are dashed red. `p+1` previews show the jump of `sizeof(T)` bytes.
- **Read and write pulses.** Reads flash one color, writes another, so a loop's access pattern is visible.
- **Hover inspector.** Address, offset within object, type, and the same bytes decoded as `int`, `uint`, hex, binary, `char` and `float`.
- **Array views.** A 1D strip, and for 2D/3D arrays a logical grid next to the physical linear strip, with the index math (`base + ((i*D2 + j)*D3 + k) * sizeof(T)`) highlighted as the student hovers.

### 7.4 Time travel

All state lives in virtual memory, so the run is recorded as a **trace**: an ordered list of events (allocate, write with old and new bytes, free, call, return, constructor, destructor, output, diagnostic). The UI shows the state at trace position *n*. Stepping backward is a lookup, not a re-execution. Keyframe snapshots every N steps keep scrubbing instant. Step granularity is selectable: **statement**, **expression** (shows every sub-expression and its value), or **instruction-level** (individual memory reads and writes).

### 7.5 Labs (focused views)

| Lab | What it answers |
|---|---|
| **Operator lab** | Evaluation tree with type and value at each node. Integer promotion. 32-bit binary view that highlights changed bits for `&`, `|`, `^`, `~`, `<<`, `>>`. Overflow and conversion cases |
| **Layout lab** | Pick any struct or class: see offsets, padding, `sizeof`, `alignof`, vptr, base subobjects. Drag members to reorder and watch `sizeof` shrink. Compare two layouts side by side |
| **Allocator lab** | Heap chunk map, free lists, strategy selector, fragmentation score, allocation timeline |
| **Cache lens** | 64-byte cache-line grid over memory with a simple cache simulator. Row-major vs column-major traversal shows the hit/miss difference |
| **Bug gallery** | Buffer overflow, stack smash, use-after-free, double free, leak, dangling reference, iterator invalidation, slicing, uninitialized read |
| **Container lab** | `vector` as three pointers on the stack plus a heap buffer, with growth and reallocation animated |

### 7.6 Classroom features

- **Predict, then reveal.** The student answers before running. The tool shows what happened, then explains.
- **Share by link.** The program and settings are compressed into the URL. No accounts, no backend.
- **Export** a memory diagram as SVG or PNG, which works directly in slide decks. Export the trace as JSON.
- **Offline mode** (installable PWA) for labs with poor connectivity.

### 7.7 Visual design deliverable

M0 produces a high-fidelity, clickable prototype with a canned trace, before any interpreter exists. You judge look, density and flow first. Design tokens (color, type, spacing, elevation) become the real design system.

---

## 8. Curriculum and the tricky-question bank

### 8.1 Units

Each unit has examples, a layout/memory lens, and a set of challenges. Book references are chapter level, from the contents pages [Source: the two PDFs you attached].

| # | Unit | Stroustrup 4th | Schildt 3rd |
|---|---|---|---|
| 0 | Bytes, addresses, endianness | 6 | 2 |
| 1 | Types, `sizeof`, integer limits, floats, casts | 6, 10 | 2 |
| 2 | Operators and expressions | 10, 11 | 2 |
| 3 | Pointers and references | 7 | 5, 13 |
| 4 | Arrays: 1D, 2D, 3D, C strings, decay | 7 | 4, 13 |
| 5 | Functions and the call stack | 12 | 6 |
| 6 | Structs, unions, enums, bitfields, padding | 8 | 7 |
| 7 | Dynamic memory: `new`/`delete`, `malloc`/`free` | 11, 34 | 13, 29 |
| 8 | Classes: constructors, destructors, copy, move | 16, 17 | 12, 14 |
| 9 | Inheritance, virtual functions, vtables | 20, 21 | 16, 17 |
| 10 | Templates and STL containers | 23, 24, 31, 33 | 18, 24, 33–36 |
| 11 | Smart pointers and ownership | 34 | none (the 1998 edition predates `unique_ptr` and `shared_ptr`) |
| 12 | DSA through memory: linked list, stack/queue, BST, hash table, dynamic array growth, adjacency list vs matrix | 31 | n/a |
| 13 | Memory bugs and undefined behavior | throughout | throughout |

### 8.2 Seed tricky questions

These are the starting set. Items marked **[Verified]** have a real-g++ result I captured this session. The rest will be added to the oracle suite (§10) before shipping.

| Question | Answer to show visually | Status |
|---|---|---|
| Three `int[4]` arrays vs one `int[2][3][4]`: contiguous? | The 3D array is guaranteed contiguous (`sizeof` 96, last element at `base + 92`). Three separate arrays happened to sit 16 bytes apart in my run, but the standard does not promise that | **[Verified, E2]** |
| `int**` jagged array from `new int[4]` rows | Row blocks 32 bytes apart (16 bytes data + header and padding). Not contiguous | **[Verified, E2]** |
| `void f(int a[10]) { sizeof(a) }` | 8, because `a` is a pointer | **[Verified, E4]** |
| `int m[3][4]`: `sizeof(m)`, `sizeof(m[0])`, `&m + 1` | 48, 16, and `&m + 1` is 48 bytes past `&m` | **[Verified, E4]** |
| `sizeof` of a struct after reordering members | 12 → 8 | **[Verified, E1]** |
| `sizeof(Empty)`, and with an empty base | 1, then 4 | **[Verified, E1]** |
| Cost of `new int` | 32 bytes of heap on glibc | **[Verified, E2]** |
| Does `free` then `malloc` reuse the block? | Yes, same size class, same address | **[Verified, E2]** |
| `vector<int>` capacity after 1, 2, 3, 5, 9, 17, 33 pushes | 1, 2, 4, 8, 16, 32, 64 (libstdc++ doubling). Data pointer moves each time | **[Verified, E3]** |
| `sizeof(vector)`, `sizeof(string)` | 24 (three pointers), 32 | **[Verified, E1, E3]** |
| Short-string optimization | Up to 15 chars live inside the `std::string` object. Length 16 moves to the heap | **[Verified, E3]** |
| `push_back` on a full `vector<T>`: copy or move? | Move if the move constructor is `noexcept`. Copy if not | **[Verified, E3 with `noexcept`, E4 without]** |
| Order of operations on reallocation | New element is placed in the new buffer first. Then each old element is moved and its old copy destroyed, one at a time. The temporary passed to `push_back` dies last | **[Verified, E3]** |
| Pointer into a vector after `reserve` | Dangles. Old address ≠ new `data()` | **[Verified, E3]** |
| `M*` to `Q*` under multiple inheritance | Pointer value changes by 4 | **[Verified, E1]** |
| Does a polymorphic object share its vptr with others of the same class? | Yes | **[Verified, E1]** |
| `x + 1 > x` for `INT_MAX` | Result `1`: compiler folded it. Not wraparound | **[Verified, E4]** |
| Overflowing a local `char[8]` by 4 bytes | Corrupts the adjacent variable | **[Verified, E4]** |
| `long` on Windows vs Linux | 4 vs 8 | Linux value **[Verified, E1]**. The Windows value is the well-known platform convention. I could not test it on this Linux machine, so the oracle needs a Windows-targeting compiler for it |
| Row-major vs column-major traversal speed | Cache simulation shows the miss ratio | Planned, **[Estimate]** until the simulator is built |
| `*p++`, `(*p)++`, `*++p` | Step-by-step operator lab | Planned |
| `i++ + i++`, sequence points and C++17 ordering | Order shown, with an "unspecified/UB" card | Planned |
| String literal vs `char[]` modification | `.rodata` write → fault, array copy → fine | Planned |
| Slicing a derived object into a base | Extra bytes dropped, vptr changes | Planned |
| Shallow copy then double free | Two objects pointing to one block, then a double-free report | Planned |

Target for v1.0: at least 60 curated items.

---

## 9. Your two examples, answered concretely

**"Three 1D arrays vs one 3D array."** The 3D array `int cube[2][3][4]` is one object of 96 bytes. Element `cube[i][j][k]` is at `base + ((i*3 + j)*4 + k) * 4`. I confirmed that `&cube[1][0][0]` is exactly 48 bytes after `cube`, and the last element is at offset 92. The canvas shows one colored block with the index math on hover. Three separate arrays are three objects. In my real run they were 16 bytes apart because the compiler placed them next to each other, so a naive demo would suggest they are "also contiguous". The tool will show them as three objects with a visible boundary, then change one array's size to 3 elements to make padding appear and show that adjacency is a layout choice, not a rule. The honest lesson is that **only the array type guarantees contiguity**.

**"push_back and dynamic arrays."** `vector<int>` is a 24-byte object on the stack holding `begin`, `end` and `end_of_storage` pointers **[Verified, E3]**, plus a heap buffer. Each growth allocates a new buffer (capacity doubles), moves or copies the elements, and frees the old buffer. The student sees the pointer jump, the old chunk go red, and (for a class type) the constructor/move/destructor log in the order I captured in E3.

---

## 10. How I will keep it correct (testing)

The central risk is that an interpreter is wrong in ways that look plausible. The defense is automatic comparison against a real compiler.

1. **Layout oracle.** A generator writes programs that print `sizeof`, `alignof` and `offsetof` for hundreds of types. They are compiled with g++ and clang++ and compared to the simulator's layout engine. E1 is the prototype of this.
2. **Allocator oracle.** A table of `malloc_usable_size` for sizes 1–2000 and the observed reuse behavior, compared to the model. E2 is the prototype.
3. **Differential execution.** A corpus of deterministic programs (no undefined behavior) is compiled with g++ at `-O0` and `-O2` and run. Output is compared with the simulator's. The corpus grows with every bug found.
4. **Property-based tests** (fast-check) for integer promotion, overflow, shifts, conversions and float formatting, against values produced by a compiled C reference.
5. **Golden traces** for each lesson, so a regression in the visualization or the model shows up as a diff.
6. **Parser fuzzing.** Garbage input must always yield a diagnostic. It must never hang or crash.
7. **UI tests.** Playwright end-to-end flows, visual regression screenshots, and axe-core accessibility checks in CI.
8. **Sandboxing.** The interpreter runs in a Web Worker with a step budget and a wall-clock limit. An infinite loop is stopped, explained, and cannot freeze the page.

All of this gives a statement I can defend: *"For the supported subset, MemLens matches g++ on layout, allocator behavior and program output across this test suite."* It does not give "MemLens equals C++."

---

## 11. Repository and publishing

```
memlens/
├─ packages/
│  ├─ core/        lexer · preprocessor · parser · semantic analysis
│  │               ABI layout · memory + shadow · allocator models
│  │               interpreter · trace recorder
│  ├─ prelude/     std library subset written in C++ (vector, string, …)
│  ├─ lessons/     units, examples, challenges, expected outputs
│  └─ web/         React app · Canvas renderer · design system
├─ tools/oracle/   g++/clang differential harness
├─ docs/           ARCHITECTURE · MEMORY_MODEL · LIMITS · CONTRIBUTING
├─ .github/        CI (lint, unit, oracle, e2e, deploy) · issue templates
└─ README.md       GIF demo, quick start, honest limits
```

- **License:** MIT (recommended for a teaching tool; see §14).
- **CI** (GitHub Actions): lint and typecheck, unit tests, the g++ oracle on `ubuntu-latest`, Playwright, then deploy to GitHub Pages.
- **Docs for the GitHub page:** a README with a short demo GIF, a `LIMITS.md` that lists every approximation, `CONTRIBUTING.md`, a code of conduct, and issue templates for "wrong memory behavior" reports that ask for a g++ comparison.

### The STL strategy (the biggest technical bet)

The standard containers will be written **in C++ inside the `prelude` package** and executed by the interpreter, using libstdc++'s real object layouts (`vector` = three pointers, `string` with 15-byte SSO, `shared_ptr` with a control block, and so on). The benefits:

- The memory layout is correct by construction and checked by `sizeof` oracles.
- A student can **step into `push_back`** and see the reallocation code run.
- The same machinery (templates, move semantics, placement `new`) is what a student needs to write their own `vector`.

The cost is that the interpreter must be good enough to run template-heavy code, and interpreted containers are slower. **Fallback:** implement hot paths (`sort`, `find`) as native intrinsics, and if templates prove too costly in time, ship intrinsic containers that still use the same layouts. This decision is checkpointed at the end of M5.

---

## 12. Roadmap

Sizes are relative effort **[Estimate]**: S small, M medium, L large, XL very large. I am not giving calendar dates. They would be guesses, and the order matters more than the dates.

| Milestone | Scope | Size | You can see and try |
|---|---|---|---|
| **M0 Design foundation** | Design tokens, main-screen hi-fi prototype with a canned trace, empty repo with CI | S | The look and feel, before the engine exists |
| **M1 Machine core** | Segmented memory, shadow memory, ABI layout engine, glibc-model allocator, trace format. Layout and allocator oracles passing | M | Test reports comparing the simulator with real g++ |
| **M2 C-subset interpreter** | Lexer, preprocessor, parser, semantic analysis, interpreter for types, operators, control flow, functions, pointers, N-d arrays, structs/unions/enums, strings, `malloc`/`free`, `new`/`delete`, basic I/O, UB diagnostics | L | Run real code in Node and see memory traces |
| **M3 Visualizer v1** | Editor, memory canvas, stack and heap panels, timeline with step back, inspectors, 20 examples | L | **Public alpha v0.1.** Your three-arrays vs 3D example |
| **M4 C++ classes** | Constructors, destructors, copy/move, `this`, `static`, references, operator overloading, inheritance, virtual and vtables, exceptions, casts | L | v0.2 |
| **M5 Templates and STL prelude** | Templates, lambdas, `vector`, `string`, `array`, `pair`, smart pointers, `list`, `stack`, `queue` | XL | v0.3: `push_back` growth. Checkpoint on the STL strategy |
| **M6 Labs** | Operator lab, layout lab, allocator lab with strategy selector, bug gallery | M | v0.4 |
| **M7 Learning layer** | Predict-then-reveal, 60+ curated challenges, share links, SVG/PNG export | M–L | v0.5: ready for your fellows |
| **M8 Advanced containers** | `map`, `set`, `deque`, `unordered_map`, cache lens, DSA gallery | L | v0.6 |
| **M9 Hardening and 1.0** | Performance, accessibility audit, offline PWA, docs, release | M | **v1.0** |

**First deliverable I'd propose:** M0 through M3. It is the smallest set that shows the idea working end to end.

---

## 13. Risks and counterarguments

| Risk | Why it matters | Mitigation |
|---|---|---|
| **A C++ interpreter is a large project, and full C++ is unreachable** | The language is huge and template semantics are intricate | A defined subset, loud "unsupported" errors, the oracle suite, and a staged roadmap where every stage ships |
| **"Exactly like real" cannot be literal** | Real layout depends on the compiler, flags, ASLR and OS. E2 and E4 showed two different local orderings and different behavior at `-O0` vs `-O2` | The honesty contract (§1, §6.7): one documented machine, labeled approximations, UB cards |
| **Students may over-trust the simulator** | A wrong mental model learned here would transfer | Show model labels (LP64, glibc-model) in the UI, include "compare with real g++" instructions in lessons |
| **Interpreted STL may be slow** | Template-heavy containers add overhead | Step budget, native fast paths, checkpoint at M5 |
| **Scope creep** | Your list is long and good | Roadmap order, with threads, files, and metaprogramming explicitly deferred |
| **Existing tools overlap** | Python Tutor already covers much of the C/C++ basics | Differentiators in §3. Test it for ten minutes before we commit, to be sure the gap is real |
| **Name collision** | "MemLens" may already be in use | Check before publishing |

**The strongest counterargument to this plan** is that a simpler version, a visualizer for C-style memory only (no classes, no STL), would reach students sooner and teach 80% of the memory concepts. That is what M0–M3 deliver on purpose. Everything after is optional, and you can stop at any milestone with something useful.

---

## 14. Decisions needed from you

1. **Go-ahead for M0 → M3** as the first deliverable?
2. **Default data model.** LP64 (Linux/macOS) or LLP64 (Windows)? It changes `sizeof(long)`. Which do your fellows use? The toggle is planned either way.
3. **Name.** Keep "MemLens" or choose another?
4. **License.** MIT (my recommendation) or something else?
5. **Language.** English-only UI for v1, or do you want a second language (for example Urdu) planned in from the start? It is cheap to plan for now and costly to retrofit.

### A side note on your ethical hacking work

The stack frame model (return address and saved frame pointer above the locals) plus the buffer-overflow behavior from E4 means the Bug gallery can show a classic stack smash visually. That could be a ready-made demo for your hacking course and book, and the SVG/PNG export would feed your slide decks. This is optional, but it costs little extra once M1–M3 exist.

---

## Appendix A — Experiment results (real g++ 13.3.0, Ubuntu 24.04, x86-64)

Source files: `e1_layout.cpp`, `e2_addresses.cpp`, `e3_stl.cpp`, `e4_ub.cpp`. These will move to `tools/oracle/` as the first oracle tests.

**E1: sizes and layout**

| Type | sizeof | alignof |
|---|---|---|
| bool / char / short / int | 1 / 1 / 2 / 4 | same |
| long / long long / pointer / size_t | 8 / 8 / 8 / 8 | 8 |
| float / double / long double | 4 / 8 / 16 | 4 / 8 / 16 |
| `string` / `vector<int>` / `unique_ptr` / `shared_ptr` | 32 / 24 / 8 / 16 | 8 |
| `array<int,5>` | 20 | 4 |
| `map<int,int>` / `set<int>` | 48 / 48 | 8 |
| `list<int>` / `deque<int>` / `unordered_map<int,int>` | 24 / 80 / 56 | 8 |
| struct `{char,int,char}` / `{int,char,char}` / `{char,double,char}` | 12 / 8 / 24 | 4 / 4 / 8 |
| `Empty` / `: Empty{int}` / member `Empty` + int | 1 / 4 / 8 | |
| virtual class `{vptr,int}` | 16 | 8 |
| `M : P, Q {int}` | 12 | 4 |
| `VB1 : virtual P {int}` | 16 | 8 |
| `union {int; char[5]; double}` | 8 | 8 |
| bitfields `{3,5,8 bits}` | 4 | 4 |
| `alignas(32) struct {char}` | 32 | 32 |

**E2: addresses and heap**

- Segments ordered `.rodata` < `.data` < `.bss` < heap < stack. Binary was position-independent, so base addresses were randomized.
- `malloc(1..24)` usable 24, `25..40` usable 40, `48` usable 56, `100` usable 104, `1000` usable 1000.
- Chunk header word before a 24-byte allocation: `0x21`.
- `free(p2)` then `malloc(24)` returned `p2`.
- Two `new int`: addresses 32 apart.
- `int cube[2][3][4]`: `sizeof` 96, `&cube[1][0][0]` at +48 bytes, last element at +92.
- Three `int[4]` arrays: adjacent at 16-byte steps (not guaranteed).
- Jagged `int**`: rows 32 bytes apart.
- Recursion frames 64 bytes apart, descending.

**E3: STL behavior**

- `vector<int>` growth: capacity 1, 2, 4, 8, 16, 32, 64. Data pointer moved at every growth.
- `vector` object: `begin`, `end`, `end_of_storage` pointers.
- `string`: capacity 15 inline, heap from length 16.
- `vector<Noisy>` with `noexcept` move: on growth, the new element is move-constructed into the new buffer first. Then each old element is moved and immediately destroyed, in turn. The caller's temporary is destroyed last.
- After `reserve(1000)`, a saved pointer into the old buffer no longer equals `data()`.
- `shared_ptr` is 16 bytes (pointer plus control-block pointer).

**E4: undefined behavior and tricky cases**

- Array parameter `sizeof` = 8.
- `int m[3][4]`: `sizeof(m)` 48, `sizeof(m[0])` 16, `&m+1` is 48 bytes on.
- `x + 1 > x` at `INT_MAX` returned 1 at `-O0`.
- Non-`noexcept` move constructor: `vector` copied on growth (`COPY(1)`).
- `-O0` stack overflow demo: `memset` 12 bytes into `char[8]` → neighbor became `0x41414141`.
- `-O2` with fortify: aborted with "buffer overflow detected".
- Uninitialized `int`: `32756`.

## Appendix B — Sources

- Python Tutor, C/C++ visualizer article: <https://pythontutor.com/articles/c-cpp-visualizer.html>
- Stroustrup, *The C++ Programming Language*, 4th ed. (attached; chapter titles from the contents pages)
- Schildt, *C++: The Complete Reference*, 3rd ed., 1998 (attached; chapter titles from the contents pages)
- Experiments E1–E4: run in this session on g++ 13.3.0 and clang++ 18.1.3 toolchain, Ubuntu 24.04 (g++ used for all results above)
