# Contributing

Thanks for helping. The most useful contributions are **examples**, **quiz questions** and **faithfulness fixes** (a place where Stackyard disagrees with a real compiler).

## Setup
```bash
npm install
npm test
npm run dev
```

## Add a quiz question
Edit `src/content/questions.ts`. A question's program must print exactly one line, and that line must be one of `options`. Run `npm test`: `tests/questions.test.ts` runs every question on all three platforms. If the answer is the same everywhere, leave `varies` off (the test then checks that all platforms agree). If you have `g++`, compile the program yourself and make sure the Linux answer matches.

## Add an example
Edit `src/content/examples.ts`. Keep comments short and aimed at what the picture shows. `tests/examples.test.ts` runs every example on every platform.

## Fix a divergence from real C++
1. Put a small program in `tests/programs/name.cpp` (optionally `name.in` for stdin).
2. Run `tools/gen-expected.sh` on a machine with `g++` to create `name.expected`.
3. `npm test` compares Stackyard's Linux output with it byte for byte.

## Style
TypeScript strict, no new runtime dependencies without discussion, English only in the UI, and be honest in the UI about what is verified and what is approximate.
