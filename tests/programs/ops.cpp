#include <iostream>
#include <cstdio>
using namespace std;
int main() {
    int a = 7, b = 3;
    cout << a + b << " " << a - b << " " << a * b << " " << a / b << " " << a % b << endl;
    cout << -7 / 2 << " " << -7 % 2 << " " << 7 / -2 << " " << 7 % -2 << endl;
    cout << (a & b) << " " << (a | b) << " " << (a ^ b) << " " << (~a) << " " << (a << 2) << " " << (a >> 1) << endl;
    cout << (a > b) << (a < b) << (a == b) << (a != b) << (a >= b) << (a <= b) << endl;
    cout << (a && b) << (a || 0) << (!a) << endl;
    int c = a++ + ++b;
    cout << c << " " << a << " " << b << endl;
    c = (a > b) ? 100 : 200;
    cout << c << endl;
    unsigned u = 0; u--;
    cout << u << endl;
    short s = 32767; s++;
    cout << s << endl;
    char ch = 'A'; ch += 2;
    cout << ch << " " << (int)ch << endl;
    double d = 7 / 2; cout << d << " " << 7 / 2.0 << endl;
    float f = 1.0f / 3; cout << f << endl;
    cout << 5 + 3 * 2 - 8 / 4 << endl;
    int x = 10; x += 5; x -= 3; x *= 2; x /= 4; x %= 4; x <<= 3; x >>= 1; x |= 1; x &= 7; x ^= 2;
    cout << x << endl;
    cout << (1, 2, 3) << endl;
    cout << sizeof(int) << sizeof(long) << sizeof(char) << sizeof(double) << sizeof(void*) << endl;
    printf("%5d|%-5d|%05d|%x|%X|%o|%c|%s|%.2f|%e|%g\n", 42, 42, 42, 255, 255, 8, 'q', "str", 3.14159, 12345.678, 0.0001234);
    printf("%lld %u %ld %5.1f%%\n", 123456789012LL, 4000000000u, 5L, 99.5);
    cout << 07 << " " << 0x1F << " " << 0b101 << " " << 1'000 << endl;
    cout << 10 / 3.0f << " " << 1e10 << " " << 123456789.0 << " " << 0.1 + 0.2 << endl;
    return 0;
}
