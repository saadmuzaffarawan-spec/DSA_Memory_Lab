#include <iostream>
using namespace std;
struct R { const char* n; R(const char* x) : n(x) { cout << "+" << n << " "; } ~R() { cout << "-" << n << " "; } };
int thrower(int x) { R r("t"); if (x > 2) throw x; return x; }
int main() {
    try { R a("a"); thrower(1); thrower(5); cout << "no"; }
    catch (int e) { cout << "caught " << e << endl; }
    try { throw 3.5; } catch (double d) { cout << d << endl; } catch (...) { cout << "other"; }
    try { try { throw 1; } catch (int) { cout << "inner "; throw; } } catch (int e) { cout << "outer" << e << endl; }
    return 0;
}
