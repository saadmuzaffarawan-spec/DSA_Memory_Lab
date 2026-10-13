// E4: tricky cases and undefined behaviour: what a real compiler does at -O0 vs -O2
#include <cstdio>
#include <climits>
#include <cstring>
#include <vector>

struct Throwy {                        // move ctor NOT noexcept -> vector copies on growth
    int id;
    Throwy(int i) : id(i) {}
    Throwy(const Throwy& o) : id(o.id) { std::printf("  COPY(%d)\n", id); }
    Throwy(Throwy&& o) : id(o.id) { std::printf("  MOVE(%d)\n", id); }
};

void takes_array(int a[10]) { std::printf("sizeof(param a[10]) = %zu (it is a pointer!)\n", sizeof(a)); }

__attribute__((noinline)) bool overflow_check(int x) { return x + 1 > x; }

__attribute__((noinline)) void smash() {
    int guard = 0x11111111;
    char buf[8];
    int after = 0x22222222;
    std::printf("&guard=%p &buf=%p &after=%p\n", (void*)&guard, (void*)buf, (void*)&after);
    std::memset(buf, 'A', 12);         // 4 bytes past the end (deliberate UB for the demo)
    std::printf("guard=0x%x after=0x%x\n", guard, after);
}

int main() {
    int arr[10]; takes_array(arr);
    int m[3][4]; std::printf("sizeof(m)=%zu sizeof(m[0])=%zu  &m+1 - &m = %td bytes\n", sizeof(m), sizeof(m[0]), (char*)(&m + 1) - (char*)&m);
    std::printf("INT_MAX+1 check (x+1>x) for INT_MAX -> %d  (UB: -O0 usually 0 via wraparound, -O2 may fold to 1)\n", overflow_check(INT_MAX));
    std::puts("== vector growth with a non-noexcept move ctor ==");
    { std::vector<Throwy> v; v.reserve(1); v.emplace_back(1); v.emplace_back(2); }
    std::puts("== uninitialised local (indeterminate) ==");
    int u; std::printf("u = %d (garbage, differs by run/opt level)\n", u);
    std::puts("== neighbour overwrite ==");
    smash();
    std::puts("== string literal vs array ==");
    const char* lit = "abc"; char arr2[] = "abc";
    std::printf("sizeof(lit)=%zu (pointer)  sizeof(arr2)=%zu (4 incl NUL)\n", sizeof(lit), sizeof(arr2));
    int i = 5; int r = i++ + i++ * 0;     // (sequenced differently in C++17 for some ops, not for + )
    std::printf("i=%d r=%d\n", i, r);
    return 0;
}
