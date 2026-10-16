#include <iostream>
using namespace std;
template <typename T> T maxof(T a, T b) { return a > b ? a : b; }
template <typename T, int N> struct Arr {
    T d[N];
    T& operator[](int i) { return d[i]; }
    int size() const { return N; }
};
template <typename T> class Box {
    T v;
public:
    Box(T x) : v(x) {}
    T get() const { return v; }
};
template <typename T> T sum(T x) { return x; }
template <typename T, typename... R> T sum(T x, R... r) { return x + sum(r...); }
int main() {
    cout << maxof(3, 9) << " " << maxof(2.5, 1.5) << " " << maxof<char>('a', 'z') << endl;
    Arr<int, 4> a;
    for (int i = 0; i < a.size(); i++) a[i] = i * 10;
    cout << a[3] << " " << sizeof(a) << endl;
    Box<double> b(2.5);
    Box c(7);
    cout << b.get() << " " << c.get() << endl;
    cout << sum(1, 2, 3, 4) << endl;
    auto sq = [](int x) { return x * x; };
    int k = 5;
    auto addk = [k](int x) { return x + k; };
    auto byref = [&k]() { k++; };
    byref();
    cout << sq(7) << " " << addk(1) << " " << k << endl;
    return 0;
}
