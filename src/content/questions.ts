// Tricky questions. Every program prints exactly ONE line: the answer. The answer shown to the student is produced by running the
// program on the platform they chose, so it can never disagree with what the visualiser shows. A test checks that the answer is
// always one of the listed options, and that the Linux answer matches a real g++.
import type { PlatformId } from '../engine/platform';

export type Topic = 'Types and sizes' | 'Arithmetic and operators' | 'Arrays and pointers' | 'Structs and classes' | 'Heap and containers' | 'Lifetime and the stack';

export interface Question {
  id: string;
  topic: Topic;
  /** 1 = warm-up, 2 = tricky, 3 = nasty */
  level: 1 | 2 | 3;
  title: string;
  /** what the student is asked, in one sentence */
  ask: string;
  code: string;
  /** possible answers, as the program would print them */
  options: string[];
  /** platform-independent explanation, shown after the reveal */
  why: string;
  /** where the platforms differ (or why they agree) */
  platforms?: Partial<Record<PlatformId, string>>;
  /** true when the answer can differ between platforms */
  varies?: boolean;
}

const main = (body: string, inc = '#include <iostream>\nusing namespace std;\n') => `${inc}\nint main() {\n${body}\n  return 0;\n}\n`;

export const QUESTIONS: Question[] = [
  // ---------------------------------------------------------------------------------------------------------- types and sizes
  {
    id: 'sizeof-long', topic: 'Types and sizes', level: 1, varies: true,
    title: 'How big is a long?', ask: 'What does this print?',
    code: main('  cout << sizeof(long) << "\\n";'),
    options: ['2', '4', '8', '16'],
    why: 'The C++ standard only promises that long is at least as big as int and at least 32 bits. How many bytes it really takes is a choice each platform made, called its data model.',
    platforms: {
      windows: 'Windows uses the LLP64 model: long stays at 4 bytes (only long long and pointers are 8). That keeps old Win32 code working.',
      linux: 'Linux uses LP64: long and pointers are 8 bytes.',
      macos: 'macOS also uses LP64: long and pointers are 8 bytes.',
    },
  },
  {
    id: 'sizeof-longdouble', topic: 'Types and sizes', level: 2, varies: true,
    title: 'long double', ask: 'What does this print?',
    code: main('  cout << sizeof(long double) << "\\n";'),
    options: ['8', '10', '12', '16'],
    why: 'long double means whatever the compiler wants. On x86 Linux and macOS it is the 80-bit x87 format padded to 16 bytes. MSVC makes it identical to double.',
    platforms: {
      windows: 'MSVC treats long double as a plain 64-bit double: 8 bytes.',
      linux: 'GCC on x86-64 uses the 80-bit x87 type, padded to 16 bytes for alignment.',
      macos: 'Clang on x86-64 macOS also uses the padded 80-bit type: 16 bytes.',
    },
  },
  {
    id: 'sizeof-wchar', topic: 'Types and sizes', level: 2, varies: true,
    title: 'wchar_t', ask: 'What does this print?',
    code: main('  cout << sizeof(wchar_t) << "\\n";'),
    options: ['1', '2', '4', '8'],
    why: 'wchar_t was meant for "wide characters", but how wide differs. Windows chose UTF-16 code units, Unix systems chose UTF-32.',
    platforms: { windows: 'Windows: 2 bytes (UTF-16 code unit).', linux: 'Linux: 4 bytes (UTF-32).', macos: 'macOS: 4 bytes (UTF-32).' },
  },
  {
    id: 'padding-order', topic: 'Types and sizes', level: 1,
    title: 'Unlucky field order', ask: 'What is sizeof(S)?',
    code: main('  struct S { char a; int b; char c; };\n  cout << sizeof(S) << "\\n";'),
    options: ['6', '8', '9', '12'],
    why: 'Each field must start at a multiple of its own size. a sits at 0, then three padding bytes so b can start at 4, then c at 8, then three more bytes so that an array of S keeps every b aligned. Total 12. Putting the int first would give 8.',
  },
  {
    id: 'padding-sorted', topic: 'Types and sizes', level: 1,
    title: 'Lucky field order', ask: 'What is sizeof(S)?',
    code: main('  struct S { int b; char a; char c; };\n  cout << sizeof(S) << "\\n";'),
    options: ['6', '8', '10', '12'],
    why: 'b takes bytes 0 to 3, a and c follow at 4 and 5, then two bytes of tail padding bring the size to a multiple of 4. Same fields as before, 4 bytes smaller.',
  },
  {
    id: 'sizeof-empty', topic: 'Types and sizes', level: 2,
    title: 'An empty struct', ask: 'What is sizeof(E)?',
    code: main('  struct E {};\n  cout << sizeof(E) << "\\n";'),
    options: ['0', '1', '4', '8'],
    why: 'Two different objects must have different addresses, so even an object with no data occupies at least one byte. (A base class subobject can be empty for free: the empty base optimisation.)',
  },
  {
    id: 'ebo', topic: 'Types and sizes', level: 3,
    title: 'Empty base versus empty member', ask: 'What does this print, as "sizeof(Base2) sizeof(Member2)"?',
    code: main('  struct E {};\n  struct Base2 : E { int x; };\n  struct Member2 { E e; int x; };\n  cout << sizeof(Base2) << " " << sizeof(Member2) << "\\n";'),
    options: ['4 4', '4 8', '8 8', '1 5'],
    why: 'An empty base class may share an address with the first member, so it costs nothing. An empty member must be a real object with its own address, so it takes a byte, which padding then grows to a full 4.',
  },
  {
    id: 'array-param', topic: 'Types and sizes', level: 2,
    title: 'sizeof an array parameter', ask: 'What does this print?',
    code: `#include <iostream>\nusing namespace std;\nvoid f(int a[10]) { cout << sizeof(a) << "\\n"; }\nint main() {\n  int arr[10];\n  f(arr);\n  return 0;\n}\n`,
    options: ['4', '8', '10', '40'],
    why: 'An array cannot be passed to a function. The parameter int a[10] is silently rewritten as int* a, so sizeof(a) is the size of a pointer. Inside main, sizeof(arr) would be 40.',
  },
  {
    id: 'sizeof-literal', topic: 'Types and sizes', level: 1,
    title: 'A string literal', ask: 'What does this print?',
    code: main('  cout << sizeof("hello") << "\\n";'),
    options: ['4', '5', '6', '8'],
    why: 'A string literal is a char array that includes the terminating zero byte: h e l l o \\0 is 6 bytes. strlen("hello") would be 5.',
  },
  {
    id: 'bitfield', topic: 'Types and sizes', level: 3, varies: true,
    title: 'Bit-fields of different types', ask: 'What is sizeof(B)?',
    code: main('  struct B { char a : 3; int b : 5; };\n  cout << sizeof(B) << "\\n";'),
    options: ['1', '2', '4', '8'],
    why: 'How bit-fields are packed is up to the ABI. The Itanium ABI (Linux, macOS) lets b share the first byte with a, then rounds up to the alignment of int. MSVC starts a new storage unit whenever the declared type changes.',
    platforms: { windows: 'MSVC: a lives in a char unit, b starts a fresh int unit, so the struct is 8 bytes.', linux: 'Itanium ABI: both fields fit in the first byte; the int alignment rounds the size up to 4.', macos: 'Same Itanium rules as Linux: 4.' },
  },
  // ------------------------------------------------------------------------------------------------ arithmetic and operators
  {
    id: 'signed-char', topic: 'Arithmetic and operators', level: 2,
    title: 'A big char', ask: 'What does this print?',
    code: main('  char c = 200;\n  cout << (int)c << "\\n";'),
    options: ['200', '-56', '56', '0'],
    why: 'Plain char is signed on x86. 200 does not fit in a signed byte, so it wraps to 200 - 256 = -56. (On some ARM Linux systems plain char is unsigned and the answer would be 200.)',
  },
  {
    id: 'promotion', topic: 'Arithmetic and operators', level: 2,
    title: 'Integer promotion', ask: 'What does this print?',
    code: main('  unsigned char a = 200, b = 100;\n  cout << a + b << "\\n";'),
    options: ['44', '300', '200', '-212'],
    why: 'Before arithmetic, small types are promoted to int. 200 + 100 is computed as int 300 and printed as such. Only if you stored it back into an unsigned char would it wrap to 44.',
  },
  {
    id: 'signed-compare', topic: 'Arithmetic and operators', level: 3,
    title: 'Signed versus unsigned', ask: 'What does this print?',
    code: main('  int a = -1;\n  unsigned b = 1;\n  cout << (a < b) << "\\n";'),
    options: ['0', '1', '-1', 'it does not compile'],
    why: 'When a signed and an unsigned int are compared, the signed one is converted to unsigned. -1 becomes 4294967295, which is not less than 1.',
  },
  {
    id: 'int-div', topic: 'Arithmetic and operators', level: 1,
    title: 'Division and remainder of negatives', ask: 'What does this print, as "quotient remainder"?',
    code: main('  cout << -7 / 2 << " " << -7 % 2 << "\\n";'),
    options: ['-4 1', '-3 -1', '-3 1', '-4 -1'],
    why: 'Since C++11, integer division truncates toward zero, and the remainder always takes the sign of the dividend: -7 = 2 * (-3) + (-1).',
  },
  {
    id: 'shift-right-neg', topic: 'Arithmetic and operators', level: 3,
    title: 'Shifting a negative number', ask: 'What does this print?',
    code: main('  int x = -5;\n  cout << (x >> 1) << "\\n";'),
    options: ['-3', '-2', '2147483645', '2'],
    why: 'On every mainstream compiler, >> on a negative signed value is an arithmetic shift (the sign bit is copied), which rounds toward minus infinity: -5 >> 1 is -3. Division by two would give -2.',
  },
  {
    id: 'unsigned-wrap', topic: 'Arithmetic and operators', level: 1,
    title: 'Going below zero', ask: 'What does this print?',
    code: main('  unsigned u = 0;\n  u--;\n  cout << u << "\\n";'),
    options: ['-1', '0', '4294967295', '2147483647'],
    why: 'Unsigned arithmetic wraps around modulo 2^32. Zero minus one is the largest unsigned int.',
  },
  {
    id: 'short-circuit', topic: 'Arithmetic and operators', level: 2,
    title: 'Short-circuit evaluation', ask: 'What does this print, as "x y"?',
    code: main('  int x = 0, y = 0;\n  if (x && ++y) {}\n  if (x || ++y) {}\n  cout << x << " " << y << "\\n";'),
    options: ['0 0', '0 1', '0 2', '1 2'],
    why: '&& stops as soon as the left side is false, so ++y never runs in the first test. || must look at its right side when the left is false, so the second test increments y once.',
  },
  {
    id: 'comma', topic: 'Arithmetic and operators', level: 2,
    title: 'The comma operator', ask: 'What does this print?',
    code: main('  int a = (1, 2, 3);\n  cout << a << "\\n";'),
    options: ['1', '2', '3', '6'],
    why: 'The comma operator evaluates its left operand, throws the result away, and yields the right operand. The last value, 3, wins. (In a declaration list like int a = 1, b = 2 the comma means something else.)',
  },
  {
    id: 'ternary-type', topic: 'Arithmetic and operators', level: 3,
    title: 'The type of ?:', ask: 'What does this print?',
    code: main('  cout << (true ? 1 : 2.5) << "\\n";'),
    options: ['1', '1.0', '2.5', '1.00000'],
    why: 'Both branches are converted to a common type, here double, even though only the first is evaluated. The double 1.0 prints as 1 because cout drops a trailing .0 by default.',
  },
  {
    id: 'char-arith', topic: 'Arithmetic and operators', level: 2,
    title: 'Adding to a char', ask: 'What does this print?',
    code: main("  cout << 'A' + 1 << \"\\n\";"),
    options: ['B', '66', 'A1', '65'],
    why: "'A' + 1 is arithmetic, so the char is promoted to int: 65 + 1 = 66. To print B you would convert back: (char)('A' + 1).",
  },
  {
    id: 'precedence', topic: 'Arithmetic and operators', level: 2,
    title: 'Shift versus plus', ask: 'What does this print?',
    code: main('  cout << (1 + 2 << 3) << "\\n";'),
    options: ['7', '9', '17', '24'],
    why: 'Addition binds tighter than a shift, so this is (1 + 2) << 3 = 3 * 8 = 24. Many people read << as binding tighter.',
  },
  {
    id: 'float-eq', topic: 'Arithmetic and operators', level: 2,
    title: 'Is 0.1 + 0.2 equal to 0.3?', ask: 'What does this print?',
    code: main('  double x = 0.1 + 0.2;\n  cout << (x == 0.3) << "\\n";'),
    options: ['0', '1'],
    why: '0.1, 0.2 and 0.3 cannot be stored exactly in binary. The sum is 0.30000000000000004, one bit away from the double nearest to 0.3. Compare with a tolerance instead.',
  },
  {
    id: 'float-cast', topic: 'Arithmetic and operators', level: 2,
    title: 'Float to int', ask: 'What does this print?',
    code: main('  cout << (int)-2.7 << " " << (int)2.7 << "\\n";'),
    options: ['-3 2', '-2 2', '-3 3', '-2 3'],
    why: 'Converting a floating-point number to an integer truncates toward zero, it does not round or floor.',
  },
  // --------------------------------------------------------------------------------------------------------- arrays and pointers
  {
    id: 'ptr-diff', topic: 'Arrays and pointers', level: 2,
    title: 'Pointer difference', ask: 'What does this print, as "elements bytes"?',
    code: main('  int a[5];\n  cout << (&a[3] - &a[0]) << " " << ((char*)&a[3] - (char*)&a[0]) << "\\n";'),
    options: ['3 3', '3 12', '12 3', '12 12'],
    why: 'Subtracting two int pointers counts elements, not bytes. Cast to char* first and you count bytes: 3 elements of 4 bytes is 12.',
  },
  {
    id: 'array-addr', topic: 'Arrays and pointers', level: 3,
    title: 'a + 1 versus &a + 1', ask: 'What does this print, as "x y"?',
    code: main('  int a[3] = {1, 2, 3};\n  cout << ((char*)(a + 1) - (char*)a) << " " << ((char*)(&a + 1) - (char*)a) << "\\n";'),
    options: ['4 4', '4 12', '12 4', '12 12'],
    why: 'a decays to a pointer to int, so a + 1 moves by one int (4 bytes). &a is a pointer to the whole int[3], so &a + 1 moves past the entire array (12 bytes).',
  },
  {
    id: 'sizeof-2d', topic: 'Arrays and pointers', level: 2,
    title: 'Sizes inside a 2D array', ask: 'What does this print, as "whole row element"?',
    code: main('  int a[2][3];\n  cout << sizeof(a) << " " << sizeof(a[0]) << " " << sizeof(a[0][0]) << "\\n";'),
    options: ['24 12 4', '24 3 4', '6 3 1', '24 24 4'],
    why: 'A 2D array is an array of arrays: two rows, each an int[3] of 12 bytes. All 24 bytes sit in one block, row after row.',
  },
  {
    id: 'row-major', topic: 'Arrays and pointers', level: 2,
    title: 'Where does a[1][0] live?', ask: 'How many bytes after a[0][0] is a[1][0]?',
    code: main('  int a[2][3];\n  cout << ((char*)&a[1][0] - (char*)&a[0][0]) << "\\n";'),
    options: ['4', '8', '12', '24'],
    why: 'Rows are stored one after another ("row-major"). The first row has 3 ints = 12 bytes, so the second row starts right after it.',
  },
  {
    id: 'flat-3d', topic: 'Arrays and pointers', level: 3,
    title: 'A 3D array as one long row', ask: 'What does this print?',
    code: main('  int c[2][2][3] = {{{1,2,3},{4,5,6}},{{7,8,9},{10,11,12}}};\n  int* p = &c[0][0][0];\n  cout << p[7] << " " << c[1][0][1] << "\\n";'),
    options: ['7 7', '8 8', '8 7', '7 8'],
    why: 'The 12 ints sit in a single block in order. Index 7 counts 1,2,3,4,5,6,7,8: the eighth value is 8. And c[1][0][1] is layer 1 (offset 6), row 0, column 1: element 7 of the block, also 8.',
  },
  {
    id: 'ptr-incr', topic: 'Arrays and pointers', level: 3,
    title: 'Increment through a pointer', ask: 'What does this print, as "value index"?',
    code: main('  int a[3] = {10, 20, 30};\n  int* p = a;\n  int v = *p++ + 1;\n  cout << v << " " << (p - a) << "\\n";'),
    options: ['11 1', '21 1', '11 0', '21 0'],
    why: '*p++ means *(p++): read the old target (10), then advance the pointer. So v is 10 + 1 = 11 and p now points at element 1.',
  },
  {
    id: 'ref-alias', topic: 'Arrays and pointers', level: 1,
    title: 'References are aliases', ask: 'What does this print?',
    code: main('  int x = 5;\n  int& r = x;\n  r++;\n  int y = r;\n  y++;\n  cout << x << " " << y << "\\n";'),
    options: ['5 6', '6 6', '6 7', '5 7'],
    why: 'r is another name for x, so r++ changes x. But y is a fresh copy: incrementing it leaves x alone.',
  },
  {
    id: 'string-sizeof', topic: 'Arrays and pointers', level: 2,
    title: 'Array versus pointer to a string', ask: 'What does this print, as "a b"?',
    code: main('  char arr[] = "hi";\n  const char* ptr = "hi";\n  cout << sizeof(arr) << " " << sizeof(ptr) << "\\n";'),
    options: ['2 2', '3 8', '3 4', '2 8'],
    why: 'arr is a real array holding h, i and the terminating zero: 3 bytes. ptr is just a pointer, 8 bytes on a 64-bit machine, aimed at a literal stored elsewhere.',
  },
  // ----------------------------------------------------------------------------------------------------------- structs and classes
  {
    id: 'vptr-size', topic: 'Structs and classes', level: 2,
    title: 'The hidden pointer', ask: 'What is sizeof(V)?',
    code: main('  struct V { int x; virtual void f() {} };\n  cout << sizeof(V) << "\\n";'),
    options: ['4', '8', '12', '16'],
    why: 'A class with a virtual function carries a hidden pointer (the vptr) to its table of virtual functions. It takes 8 bytes at the start, then x takes 4, and 4 bytes of padding make the size a multiple of 8.',
  },
  {
    id: 'derived-size', topic: 'Structs and classes', level: 2,
    title: 'A derived class', ask: 'What is sizeof(B)?',
    code: main('  struct A { int a; };\n  struct B : A { char c; };\n  cout << sizeof(B) << "\\n";'),
    options: ['5', '8', '9', '12'],
    why: 'B contains an A (4 bytes) followed by its own char (1 byte). Alignment of 4 pads the total to 8. A real compiler may even put the char into A\'s tail padding if A had any.',
  },
  {
    id: 'ctor-order', topic: 'Structs and classes', level: 2,
    title: 'Construction and destruction order', ask: 'What does this print?',
    code: `#include <iostream>\nusing namespace std;\nstruct A { A() { cout << "A"; } ~A() { cout << "a"; } };\nstruct B : A { B() { cout << "B"; } ~B() { cout << "b"; } };\nstruct C { A x; B y; C() { cout << "C"; } ~C() { cout << "c"; } };\nint main() {\n  { C c; }\n  cout << "\\n";\n  return 0;\n}\n`,
    
    options: ['ABCcba', 'AABCcbaa', 'CABBAc', 'AABCcaba'],
    why: 'Members are built in declaration order before the constructor body runs: x prints A; y first builds its base (A) then itself (B); then C\'s own body prints C. Destruction runs in exactly the reverse order: c, then y (b, then its base a), then x (a). The full line is AABCcbaa.',
  },
  {
    id: 'slicing', topic: 'Structs and classes', level: 3,
    title: 'Object slicing', ask: 'What does this print?',
    code: `#include <iostream>\nusing namespace std;\nstruct B { virtual const char* name() const { return "B"; } };\nstruct D : B { const char* name() const override { return "D"; } };\nvoid show(B b) { cout << b.name() << "\\n"; }\nint main() {\n  D d;\n  show(d);\n  return 0;\n}\n`,
    options: ['B', 'D', 'BD', 'it does not compile'],
    why: 'show takes a B by value, so only the B part of d is copied: the D part, including the vptr that selects D::name, is sliced off. The copy is a genuine B. Pass by reference or pointer to keep polymorphism.',
  },
  {
    id: 'virtual-in-ctor', topic: 'Structs and classes', level: 3,
    title: 'A virtual call inside a constructor', ask: 'What does this print?',
    code: `#include <iostream>\nusing namespace std;\nstruct B { B() { who(); } virtual void who() { cout << "B\\n"; } };\nstruct D : B { void who() override { cout << "D\\n"; } };\nint main() {\n  D d;\n  return 0;\n}\n`,
    options: ['B', 'D', 'BD', 'nothing'],
    why: 'While B\'s constructor runs, the object is only a B: the D part does not exist yet and the vptr points at B\'s table. So the call resolves to B::who. The same applies in destructors.',
  },
  {
    id: 'copies', topic: 'Structs and classes', level: 3,
    title: 'Counting copies', ask: 'How many times does the copy constructor run?',
    code: `#include <iostream>\nusing namespace std;\nint copies = 0;\nstruct T { T() {} T(const T&) { copies++; } };\nT make() { return T(); }\nvoid take(T) {}\nint main() {\n  T a = make();\n  take(a);\n  T b = a;\n  cout << copies << "\\n";\n  return 0;\n}\n`,
    options: ['0', '1', '2', '3'],
    why: 'Since C++17, returning a temporary builds it directly in the destination: no copy for make(). Passing a by value copies once, and T b = a copies once more. Total 2. (Before C++17 compilers were allowed, and usually chose, to skip the first copy as well.)',
  },
  // ------------------------------------------------------------------------------------------------------------ heap and containers
  {
    id: 'vector-capacity', topic: 'Heap and containers', level: 2, varies: true,
    title: 'Vector growth', ask: 'What is the capacity after five push_back calls on an empty vector<int>?',
    code: `#include <iostream>\n#include <vector>\nusing namespace std;\nint main() {\n  vector<int> v;\n  for (int i = 0; i < 5; i++) v.push_back(i);\n  cout << v.capacity() << "\\n";\n  return 0;\n}\n`,
    options: ['5', '6', '8', '10'],
    why: 'When a vector is full, push_back allocates a bigger block and moves every element over. The growth factor is the library\'s choice.',
    platforms: {
      windows: 'MSVC grows by 1.5x: capacities go 1, 2, 3, 4, 6. After five pushes it is 6.',
      linux: 'libstdc++ doubles: 1, 2, 4, 8. After five pushes it is 8.',
      macos: 'libc++ doubles as well: 1, 2, 4, 8. After five pushes it is 8.',
    },
  },
  {
    id: 'sizeof-string', topic: 'Heap and containers', level: 2, varies: true,
    title: 'How big is a std::string?', ask: 'What does this print?',
    code: `#include <iostream>\n#include <string>\nusing namespace std;\nint main() {\n  cout << sizeof(string) << "\\n";\n  return 0;\n}\n`,
    options: ['8', '16', '24', '32', '40'],
    why: 'A string object holds a pointer, a size, and either a capacity or a small inline buffer for short strings. Each standard library lays that out differently.',
    platforms: {
      windows: 'MSVC STL: 32 bytes in a release build. A Debug build adds a pointer for iterator checking, which this simulator models: 40.',
      linux: 'libstdc++: 32 bytes (pointer, size, and a 16-byte union of capacity and inline buffer).',
      macos: 'libc++: 24 bytes, using clever packing so that strings up to 22 characters live inside the object.',
    },
  },
  {
    id: 'sso', topic: 'Heap and containers', level: 3, varies: true,
    title: 'The inline buffer of an empty string', ask: 'What is std::string().capacity()?',
    code: `#include <iostream>\n#include <string>\nusing namespace std;\nint main() {\n  string s;\n  cout << s.capacity() << "\\n";\n  return 0;\n}\n`,
    options: ['0', '15', '22', '31'],
    why: 'Short strings are stored inside the string object itself (the small-string optimisation), so no heap allocation is needed. The capacity of an empty string is the size of that inline buffer minus the terminator.',
    platforms: { windows: 'MSVC STL: 15.', linux: 'libstdc++: 15.', macos: 'libc++: 22 (the 24-byte object has 23 usable bytes, one is the terminator).' },
  },
  {
    id: 'reserve', topic: 'Heap and containers', level: 2,
    title: 'Does reserve prevent a move?', ask: 'What does this print?',
    code: `#include <iostream>\n#include <vector>\nusing namespace std;\nint main() {\n  vector<int> v;\n  v.reserve(10);\n  int* first = v.data();\n  for (int i = 0; i < 10; i++) v.push_back(i);\n  cout << (v.data() == first) << "\\n";\n  return 0;\n}\n`,
    options: ['1', '0'],
    why: 'reserve(10) allocates room for ten elements up front, so the ten push_back calls never reallocate and the data pointer never changes.',
  },
  {
    id: 'invalidate', topic: 'Heap and containers', level: 3,
    title: 'Iterator invalidation', ask: 'After this code, does the old pointer still equal the vector\'s data?',
    code: `#include <iostream>\n#include <vector>\nusing namespace std;\nint main() {\n  vector<int> v(4, 7);\n  int* p = v.data();\n  v.push_back(1);\n  cout << (p == v.data()) << "\\n";\n  return 0;\n}\n`,
    options: ['1', '0'],
    why: 'The vector was exactly full (size 4, capacity 4). push_back had to allocate a new, larger block and move the elements, so p now points into freed memory. Using it would be undefined behaviour.',
  },
  {
    id: 'new-zero', topic: 'Heap and containers', level: 2,
    title: 'new with and without parentheses', ask: 'What does this print?',
    code: main('  int* a = new int[3]();\n  int sum = a[0] + a[1] + a[2];\n  cout << sum << "\\n";\n  delete[] a;'),
    options: ['0', 'unpredictable', '3', 'it crashes'],
    why: 'new int[3]() value-initialises every element to zero. Without the () (new int[3]) the ints would be uninitialised garbage. A one-character difference.',
  },
  // ------------------------------------------------------------------------------------------------------ lifetime and the stack
  {
    id: 'static-local', topic: 'Lifetime and the stack', level: 2,
    title: 'A static local', ask: 'What does this print?',
    code: `#include <iostream>\nusing namespace std;\nint next() { static int n = 0; return ++n; }\nint main() {\n  next(); next();\n  cout << next() << "\\n";\n  return 0;\n}\n`,
    options: ['1', '2', '3', '0'],
    why: 'A static local lives for the whole program, not just one call, and its initialiser runs only the first time. Three calls give 1, 2, 3.',
  },
  {
    id: 'scope-reuse', topic: 'Lifetime and the stack', level: 3,
    title: 'Does a finished scope free its stack slot?', ask: 'Do x and y share an address?',
    code: main('  int* px;\n  { int x = 1; px = &x; }\n  int y = 2;\n  cout << (px == &y) << "\\n";'),
    options: ['1', '0'],
    why: 'x\'s lifetime ended at the closing brace, so *px would be a dangling read. Whether y reuses the same slot is up to the compiler: GCC and Clang at -O0 give each variable its own slot for the whole function, MSVC Debug does the same, so the answer is 0 everywhere here. Optimised builds often reuse the slot.',
  },

  // ------------------------------------------------------------------------------------------------ more: sizes of library types
  {
    id: 'sizeof-vector', topic: 'Heap and containers', level: 2, varies: true,
    title: 'How big is a vector object?', ask: 'What is sizeof(vector<int>), with ten million elements or none?',
    code: `#include <iostream>\n#include <vector>\nusing namespace std;\nint main() {\n  vector<int> v(1000);\n  cout << sizeof(v) << "\\n";\n  return 0;\n}\n`,
    options: ['8', '16', '24', '32', '4000'],
    why: 'The vector object is only a small handle: three pointers to the heap block (start, end of data, end of capacity). The thousand ints live elsewhere and do not count in sizeof.',
    platforms: { windows: 'MSVC Debug adds a fourth pointer for iterator checking: 32 bytes.', linux: 'libstdc++: three pointers, 24 bytes.', macos: 'libc++: three pointers, 24 bytes.' },
  },
  {
    id: 'sizeof-smart', topic: 'Heap and containers', level: 2,
    title: 'Smart pointer sizes', ask: 'What does this print, as "unique shared"?',
    code: `#include <iostream>\n#include <memory>\nusing namespace std;\nint main() {\n  cout << sizeof(unique_ptr<int>) << " " << sizeof(shared_ptr<int>) << "\\n";\n  return 0;\n}\n`,
    options: ['8 8', '8 16', '16 16', '8 24'],
    why: 'A unique_ptr is exactly one raw pointer (the empty default deleter takes no space). A shared_ptr needs two pointers: one to the object and one to a separate control block that holds the reference counts.',
  },
  {
    id: 'sizeof-optional', topic: 'Heap and containers', level: 2,
    title: 'An optional int', ask: 'What is sizeof(optional<int>)?',
    code: `#include <iostream>\n#include <optional>\nusing namespace std;\nint main() {\n  cout << sizeof(optional<int>) << "\\n";\n  return 0;\n}\n`,
    options: ['4', '5', '8', '16'],
    why: 'optional<int> holds an int plus a bool that says whether the int is there. The bool takes one byte, but the struct is padded so its size is a multiple of 4: 8 bytes.',
  },
  {
    id: 'padding-double', topic: 'Types and sizes', level: 2,
    title: 'A double in the middle', ask: 'What does this print, as "first second"?',
    code: main('  struct A { char a; double b; char c; };\n  struct B { double b; char a; char c; };\n  cout << sizeof(A) << " " << sizeof(B) << "\\n";'),
    options: ['10 10', '16 16', '24 16', '24 24'],
    why: 'A double must sit at an address divisible by 8. In A the double is pushed to offset 8 (7 bytes of padding), then c, then 7 more bytes of tail padding: 24. In B the two chars tuck in right behind the double and 6 bytes of tail padding finish it: 16.',
  },
  {
    id: 'multi-inherit', topic: 'Structs and classes', level: 2,
    title: 'Two base classes', ask: 'What is sizeof(C)?',
    code: main('  struct A { int a; };\n  struct B { int b; };\n  struct C : A, B { int c; };\n  cout << sizeof(C) << "\\n";'),
    options: ['4', '8', '12', '16'],
    why: 'A derived object simply contains each base subobject, one after the other, followed by its own members: 4 + 4 + 4 = 12. There is no hidden overhead until virtual functions or virtual bases are involved.',
  },
  {
    id: 'static-member', topic: 'Structs and classes', level: 2,
    title: 'Static members', ask: 'What is sizeof(S)?',
    code: `#include <iostream>\nusing namespace std;\nstruct S { static int count; int value; };\nint S::count = 0;\nint main() {\n  cout << sizeof(S) << "\\n";\n  return 0;\n}\n`,
    options: ['4', '8', '12', '0'],
    why: 'A static member belongs to the class, not to each object: it lives once in global memory. Only the non-static int is part of every S.',
  },
  {
    id: 'sizeof-char-lit', topic: 'Types and sizes', level: 3,
    title: 'The size of a character literal', ask: 'What does this print?',
    code: main("  cout << sizeof('a') << \"\\n\";"),
    options: ['1', '2', '4', '8'],
    why: "In C++ a character literal like 'a' has type char, so sizeof is 1. In C it has type int and the answer would be 4: one of the places where the two languages really differ.",
  },
  // ---------------------------------------------------------------------------------------------------- more: arithmetic
  {
    id: 'uchar-wrap', topic: 'Arithmetic and operators', level: 1,
    title: 'Counting past 255', ask: 'What does this print?',
    code: main('  unsigned char c = 255;\n  c++;\n  cout << (int)c << "\\n";'),
    options: ['256', '0', '-1', '255'],
    why: 'An unsigned char holds 0 to 255. Adding one wraps back to 0 (arithmetic modulo 256). Unsigned overflow is well defined; signed overflow is not.',
  },
  {
    id: 'float-int-limit', topic: 'Arithmetic and operators', level: 3,
    title: 'A float cannot count that high', ask: 'What does this print?',
    code: main('  float f = 16777217;\n  cout << (int)f << "\\n";'),
    options: ['16777217', '16777216', '16777218', '2147483647'],
    why: 'A float has a 24-bit significand, so above 2^24 = 16777216 it can only represent every second integer. 16777217 is rounded to the nearest even neighbour, 16777216.',
  },
  {
    id: 'pre-inc-deref', topic: 'Arithmetic and operators', level: 2,
    title: 'Increment the pointee', ask: 'What does this print, as "a[0] offset"?',
    code: main('  int a[2] = {1, 2};\n  int* p = a;\n  ++*p;\n  cout << a[0] << " " << (p - a) << "\\n";'),
    options: ['1 1', '2 0', '2 1', '1 0'],
    why: '++*p increments the value p points at (the * binds first), not the pointer. a[0] becomes 2 and p still points at the first element.',
  },
  {
    id: 'zero-global', topic: 'Lifetime and the stack', level: 1,
    title: 'Globals start at zero', ask: 'What does this print?',
    code: `#include <iostream>\nusing namespace std;\nint g[3];\nint main() {\n  cout << g[0] + g[1] + g[2] << "\\n";\n  return 0;\n}\n`,
    options: ['0', 'unpredictable', '3', 'it does not compile'],
    why: 'Objects with static storage (globals and statics) are zero-initialised before the program starts. A local array like int a[3] inside main would hold garbage.',
  },
  // ----------------------------------------------------------------------------------------------- more: pointers and copies
  {
    id: 'ptr-to-ptr', topic: 'Arrays and pointers', level: 2,
    title: 'A pointer to a pointer', ask: 'What does this print?',
    code: main('  int x = 5;\n  int* p = &x;\n  int** pp = &p;\n  **pp = 7;\n  cout << x << "\\n";'),
    options: ['5', '7', 'the address of x', 'it crashes'],
    why: '*pp is p, and **pp is what p points at: x itself. Assigning through two levels of pointer changes x.',
  },
  {
    id: 'strlen-sizeof', topic: 'Arrays and pointers', level: 1,
    title: 'Length versus size', ask: 'What does this print, as "sizeof strlen"?',
    code: `#include <iostream>\n#include <cstring>\nusing namespace std;\nint main() {\n  char s[] = "abc";\n  cout << sizeof(s) << " " << strlen(s) << "\\n";\n  return 0;\n}\n`,
    options: ['3 3', '4 3', '4 4', '3 4'],
    why: 'sizeof counts the bytes of the array, including the terminating zero: 4. strlen counts characters up to (not including) the zero: 3.',
  },
  {
    id: 'shallow-copy', topic: 'Structs and classes', level: 3,
    title: 'Copying a struct that holds a pointer', ask: 'What does this print?',
    code: `#include <iostream>\nusing namespace std;\nstruct Box { int* p; };\nint main() {\n  Box a;\n  a.p = new int(1);\n  Box b = a;\n  *b.p = 9;\n  cout << *a.p << "\\n";\n  delete a.p;\n  return 0;\n}\n`,
    options: ['1', '9', '0', 'it crashes'],
    why: 'The default copy copies the pointer value, not what it points at. Both boxes now point at the same int, so a change through b is visible through a. (Delete it twice and you have a double free.)',
  },
  {
    id: 'string-copy', topic: 'Heap and containers', level: 1,
    title: 'Is a string copy deep?', ask: 'What does this print?',
    code: `#include <iostream>\n#include <string>\nusing namespace std;\nint main() {\n  string a = "hi";\n  string b = a;\n  b[0] = 'X';\n  cout << a << "\\n";\n  return 0;\n}\n`,
    options: ['hi', 'Xi', 'X', 'hiXi'],
    why: 'std::string owns its characters and copying it copies them too (a deep copy). Changing b leaves a alone.',
  },
  {
    id: 'moved-from', topic: 'Heap and containers', level: 3,
    title: 'After std::move', ask: 'What is the size of the moved-from string?',
    code: `#include <iostream>\n#include <string>\n#include <utility>\nusing namespace std;\nint main() {\n  string a = "a string that is long enough to live on the heap";\n  string b = move(a);\n  cout << a.size() << "\\n";\n  return 0;\n}\n`,
    options: ['0', '48', 'it is undefined', 'it crashes'],
    why: 'Moving steals the heap buffer: b now owns it and a is left empty. The standard only promises a "valid but unspecified" state, but every mainstream library leaves a with size 0.',
  },
  {
    id: 'reserve-size', topic: 'Heap and containers', level: 1,
    title: 'Reserve is not resize', ask: 'What does this print, as "size capacity"?',
    code: `#include <iostream>\n#include <vector>\nusing namespace std;\nint main() {\n  vector<int> v;\n  v.reserve(100);\n  cout << v.size() << " " << v.capacity() << "\\n";\n  return 0;\n}\n`,
    options: ['0 0', '0 100', '100 100', '100 0'],
    why: 'reserve(100) asks for room for 100 elements but creates none: the size stays 0 and the capacity becomes 100. resize(100) would create 100 elements.',
  },
  {
    id: 'erase-iter', topic: 'Heap and containers', level: 3,
    title: 'Erasing while you hold an iterator', ask: 'What does this print?',
    code: `#include <iostream>\n#include <vector>\nusing namespace std;\nint main() {\n  vector<int> v = {1, 2, 3, 4};\n  auto it = v.begin() + 1;\n  it = v.erase(it);\n  cout << *it << " " << v.size() << "\\n";\n  return 0;\n}\n`,
    options: ['2 3', '3 3', '3 4', '1 3'],
    why: 'erase shifts the later elements down by one and returns an iterator to the element that now sits where the erased one was: the 3. The old iterator would be invalid; reassigning it from the return value is the correct pattern.',
  },
  {
    id: 'use-count', topic: 'Heap and containers', level: 2,
    title: 'Counting owners', ask: 'What does this print?',
    code: `#include <iostream>\n#include <memory>\nusing namespace std;\nint main() {\n  auto a = make_shared<int>(5);\n  auto b = a;\n  {\n    auto c = a;\n  }\n  cout << a.use_count() << "\\n";\n  return 0;\n}\n`,
    options: ['1', '2', '3', '0'],
    why: 'a and b share one object, so the count is 2. c briefly made it 3, but it was destroyed at the closing brace and the count dropped back.',
  },
  {
    id: 'sizeof-map', topic: 'Heap and containers', level: 3, varies: true,
    title: 'How big is a map object?', ask: 'What is sizeof(map<int, int>)?',
    code: `#include <iostream>\n#include <map>\nusing namespace std;\nint main() {\n  cout << sizeof(map<int, int>) << "\\n";\n  return 0;\n}\n`,
    options: ['8', '16', '24', '32', '48', '56'],
    why: 'A map object holds the bookkeeping of its red-black tree (a header node, a node count and the comparison object) while the elements live in separate heap nodes. How much bookkeeping depends on the library.',
    platforms: { windows: 'MSVC Debug: a proxy pointer, the head pointer and the size: 24 bytes (the sentinel node lives on the heap).', linux: 'libstdc++: the comparator plus a header node embedded in the object, and the count: 48 bytes.', macos: 'libc++: a begin pointer, an end node and the size: 24 bytes.' },
  },
];

export const TOPICS: Topic[] = ['Types and sizes', 'Arithmetic and operators', 'Arrays and pointers', 'Structs and classes', 'Heap and containers', 'Lifetime and the stack'];
