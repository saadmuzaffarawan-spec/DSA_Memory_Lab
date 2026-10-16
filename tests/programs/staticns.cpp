#include <iostream>
using namespace std;
int g = 10;
static int sg = 20;
const int K = 5;
namespace geo { const double PI = 3.14; int sq(int x) { return x * x; } namespace inner { int cube(int x) { return x * x * x; } } }
int counter() { static int c = 0; return ++c; }
void ref(const int& x, int& y) { y += x; }
int main() {
    cout << g << sg << K << geo::sq(4) << geo::inner::cube(3) << " " << geo::PI << endl;
    counter(); counter();
    cout << counter() << endl;
    int a = 3, b = 4; ref(a, b); cout << b << endl;
    int& r = a; r = 50; cout << a << endl;
    const int* cp = &a; int* const pc = &b; *pc = 1; cp = &b;
    cout << *cp << endl;
    typedef unsigned long long ull; using u8 = unsigned char;
    ull big = 1ULL << 40; u8 small = 300;
    cout << big << " " << (int)small << endl;
    int x = 5; { int x = 6; cout << x; } cout << x << endl;
    return 0;
}
