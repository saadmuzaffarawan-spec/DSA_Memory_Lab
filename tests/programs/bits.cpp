#include <iostream>
using namespace std;
int popcount(unsigned x) { int c = 0; while (x) { c += x & 1; x >>= 1; } return c; }
int main() {
    unsigned x = 0b10110100;
    cout << popcount(x) << " " << (x & -x) << " " << (x & (x - 1)) << " " << (x >> 2) << " " << (1u << 31) << endl;
    int n = -8; cout << (n >> 1) << " " << (unsigned)n << " " << (n & 0xff) << endl;
    unsigned char c = 200; c += 100; cout << (int)c << endl;
    int a = 5, b = 9; a ^= b; b ^= a; a ^= b; cout << a << b << endl;
    long long big = 1LL << 40; int trunc = (int)big; cout << big << " " << trunc << endl;
    cout << (char)65 << (int)'a' << (float)7 / 2 << (int)3.99 << (int)-3.99 << endl;
    unsigned u = 3; int i = -5; cout << (u > i) << endl;
    float f = 0.1f; double d = 0.1; cout << (f == d) << (f == 0.1f) << endl;
    cout << 5 / 2 * 2.0 << " " << 5 / 2.0 * 2 << endl;
    return 0;
}
