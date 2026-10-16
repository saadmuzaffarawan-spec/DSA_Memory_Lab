# Limits and honest caveats

Stackyard simulates a machine; it is not a compiler or a debugger. This page lists what is **not** faithful so you never have to guess.

## Accuracy by platform

- **Linux (GCC + glibc):** type sizes, class layout, standard-library behaviour and the heap allocator are checked against a real `g++` and real glibc by the test suite. Stack addresses are simulated and fixed, so they are *documented*, not verified.
- **Windows (MSVC Debug):** sizes and layouts follow the published ABI (LLP64, 1 MB stack, `0xCC` and `0xDD` fill patterns). The Windows heap and the MSVC STL internals are **approximate**: the shapes are right, exact byte counts and addresses may not match a real machine. `std::deque` layout is an estimate.
- **macOS (Apple Clang + libc++):** same status as Windows. Sizes follow the ABI; the allocator and library internals are approximate.

## Language and library

- C++17 subset: no threads, atomics, coroutines, modules, filesystem, network, or locale support.
- Implemented library: `iostream`, `string`, `vector`, `array`, `deque`, `stack`, `queue`, `map`, `set` (and multi-variants), `unique_ptr`, `shared_ptr`, `weak_ptr`, `algorithm`, `numeric`, `functional` (partial), C `stdio`/`string`/`math`/`ctype`, exceptions. Not yet: `list`, `unordered_*`, `optional`, `tuple`, `variant`, `std::function`, `sstream`, `bitset`, `random`, `chrono`.
- `long double` is a 64-bit double in the simulator's arithmetic (its size is still reported as the platform reports it). NaN sign bits are a best guess.
- `stable_sort` uses insertion sort and `inplace_merge` is O(n²): results are right, speed and exact move counts differ from a real library.
- Exception `what()` text on Windows and macOS is approximate.
- Stateful, non-assignable comparators in Windows/macOS `map` are not supported.

## Execution

- A run records at most 600,000 events; longer programs stop with a note. Deep recursion is limited by the browser's JavaScript stack and stops before a real stack overflow would on some programs.
- Programs that read input use the stdin box; there is no interactive console.
- Undefined behaviour is modelled where it is useful for teaching (use after free, overflow, uninitialised reads, null dereference). Beyond that the result is whatever the simulator does; it is not a promise about any real compiler.

## Quiz

Answers come from running the question's program on the selected platform in the simulator. Questions that depend on the machine are labelled, and each platform's reason is explained. Linux answers are re-checked against real `g++` whenever the tests run.
