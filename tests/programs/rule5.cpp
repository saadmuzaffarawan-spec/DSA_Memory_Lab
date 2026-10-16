#include <iostream>
#include <cstring>
using namespace std;
class Str {
    char* p; int n;
public:
    Str(const char* s = "") : n(strlen(s)) { p = new char[n + 1]; strcpy(p, s); cout << "ctor(" << p << ") "; }
    Str(const Str& o) : n(o.n) { p = new char[n + 1]; strcpy(p, o.p); cout << "copy(" << p << ") "; }
    Str(Str&& o) noexcept : p(o.p), n(o.n) { o.p = nullptr; o.n = 0; cout << "move "; }
    Str& operator=(const Str& o) { if (this != &o) { delete[] p; n = o.n; p = new char[n + 1]; strcpy(p, o.p); } cout << "assign "; return *this; }
    Str& operator=(Str&& o) noexcept { if (this != &o) { delete[] p; p = o.p; n = o.n; o.p = nullptr; o.n = 0; } cout << "massign "; return *this; }
    ~Str() { cout << "dtor(" << (p ? p : "null") << ") "; delete[] p; }
    const char* c_str() const { return p ? p : ""; }
};
Str make() { return Str("tmp"); }
int main() {
    Str a("hello");
    Str b = a;
    Str c = move(a);
    b = c;
    c = make();
    cout << endl << b.c_str() << " " << c.c_str() << "|" << a.c_str() << endl;
    return 0;
}
