#include <iostream>
#include <cstddef>
using namespace std;
struct A { char c; int i; char d; };
struct B { int i; char c; char d; };
struct C { char c; double d; char e; };
union U { int i; char c[4]; float f; };
enum Color { RED, GREEN = 5, BLUE };
enum class Mode : char { On = 1, Off };
struct Bits { unsigned a : 3; unsigned b : 5; unsigned c : 8; };
struct Pt { int x, y; };
Pt make(int x, int y) { Pt p; p.x = x; p.y = y; return p; }
int main() {
    cout << sizeof(A) << sizeof(B) << sizeof(C) << sizeof(U) << sizeof(Bits) << endl;
    U u; u.i = 0x01020304;
    cout << (int)u.c[0] << (int)u.c[3] << endl;
    cout << RED << GREEN << BLUE << " " << (int)Mode::Off << endl;
    Bits b; b.a = 5; b.b = 31; b.c = 200;
    cout << b.a << " " << b.b << " " << b.c << endl;
    Pt p = make(3, 4);
    Pt q = p; q.x = 9;
    Pt* pp = &q;
    pp->y = 7;
    cout << p.x << p.y << " " << q.x << q.y << endl;
    Pt arr[3] = {{1, 2}, {3, 4}, {5, 6}};
    int s = 0; for (auto& e : arr) s += e.x * e.y;
    cout << s << endl;
    cout << offsetof(A, i) << endl;
    return 0;
}
