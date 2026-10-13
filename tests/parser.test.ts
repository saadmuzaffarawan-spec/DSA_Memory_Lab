import { describe, expect, it } from 'vitest';
import { lex } from '../src/engine/lexer';
import { preprocess } from '../src/engine/preproc';
import { newParseCtx, Parser } from '../src/engine/parser';
import { WINDOWS } from '../src/engine/platform';

function parse(src: string) {
  const pp = preprocess(src, WINDOWS.macros);
  const ctx = newParseCtx();
  // minimal std knowledge for the parser tests
  for (const n of ['string', 'ostream', 'istream']) ctx.typeNames.add(n);
  for (const n of ['vector', 'map', 'unique_ptr', 'pair']) { ctx.typeNames.add(n); ctx.templNames.add(n); }
  return new Parser(pp.tokens, ctx).parseProgram();
}

describe('lexer', () => {
  it('lexes numbers, strings and operators', () => {
    const t = lex(`int x = 0x1F + 1'000 + 3.5e2f; auto s = "a\\n"; c = 'x'; a->b <<= 2;`);
    expect(t.find((x) => x.s === '0x1F')!.big).toBe(31n);
    expect(t.find((x) => x.s === "1000")!.big).toBe(1000n);
    expect(t.some((x) => x.k === 'op' && x.s === '<<=')).toBe(true);
    expect(t.find((x) => x.k === 'str')!.s).toBe('a\n');
  });
});

describe('preprocessor', () => {
  it('expands macros and handles conditionals', () => {
    const r = preprocess(`#define SQ(x) ((x)*(x))\n#define N 4\n#ifdef _WIN32\nint a = SQ(N);\n#else\nint a = 0;\n#endif\n#if N > 3 && !defined(FOO)\nint b;\n#endif\n`, WINDOWS.macros);
    const text = r.tokens.map((t) => t.s).join(' ');
    expect(text).toContain('int a = ( ( 4 ) * ( 4 ) ) ;');
    expect(text).toContain('int b ;');
  });
  it('rejects unknown headers with a helpful message', () => {
    expect(() => preprocess('#include <nonexistent.h>', {})).toThrow(/No such file/);
  });
});

describe('parser', () => {
  it('parses declarations, classes and functions', () => {
    const d = parse(`
      struct Node { int val; Node* next; Node(int v) : val(v), next(nullptr) {} ~Node() {} };
      class A { public: virtual void f() const = 0; static int count; int arr[3][4]; };
      int add(int a, int b = 2) { return a + b; }
      int main() {
        int x = 5, *p = &x;
        Node* n = new Node(3);
        std::vector<int> v{1, 2, 3};
        std::map<std::string, std::vector<int>> m;
        for (auto& e : v) x += e;
        for (int i = 0; i < 3; i++) { x = x << 1 >> 1; }
        int (*fp)(int, int) = add;
        auto l = [&](int q) { return q + x; };
        delete n;
        return (int)3.5 + static_cast<int>(2.5);
      }`);
    expect(d.length).toBe(4);
    const main = d[3] as any;
    expect(main.k).toBe('func');
    expect(main.body.body.length).toBe(10);
  });
  it('parses templates', () => {
    const d = parse(`
      template <typename T, int N = 3> class Arr { T data[N]; public: T& operator[](int i) { return data[i]; } int size() const { return N; } };
      template <typename T> T maxOf(T a, T b) { return a > b ? a : b; }
      template <class T> struct W { void f(); };
      template <class T> void W<T>::f() {}
      int main() { Arr<int, 4> a; int m = maxOf<int>(1, 2); std::vector<std::vector<int>> g; return a.size() + m; }`);
    expect(d.length).toBe(5);
  });
  it('reports readable errors', () => {
    expect(() => parse('int main() { int x = ; }')).toThrow(/expected expression/);
    expect(() => parse('int main() { return 0 }')).toThrow(/expected ';'/);
  });
});
