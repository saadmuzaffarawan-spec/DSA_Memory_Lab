#include <iostream>
using namespace std;
class Vec {
    int d[3];
public:
    Vec(int a = 0, int b = 0, int c = 0) { d[0] = a; d[1] = b; d[2] = c; }
    int& operator[](int i) { return d[i]; }
    Vec operator-() const { return Vec(-d[0], -d[1], -d[2]); }
    Vec& operator++() { for (int& x : d) x++; return *this; }
    Vec operator++(int) { Vec t = *this; ++*this; return t; }
    int operator()(int i) const { return d[i] * 2; }
    friend ostream& operator<<(ostream& o, const Vec& v) { return o << v.d[0] << ',' << v.d[1] << ',' << v.d[2]; }
    explicit operator bool() const { return d[0] || d[1] || d[2]; }
};
struct Fn { int k; int operator()(int x) const { return x + k; } };
int main() {
    Vec v(1, 2, 3);
    v[1] = 20;
    cout << v << " " << -v << " " << v(2) << endl;
    Vec w = v++; cout << w << " " << v << " " << ++v << endl;
    cout << (bool)Vec() << (bool)v << endl;
    Fn f{10}; cout << f(5) << endl;
    return 0;
}
