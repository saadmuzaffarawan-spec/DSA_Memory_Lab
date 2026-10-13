// E1: type sizes, alignment, struct padding, class layout, vtable pointers
#include <cstdio>
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>
#include <memory>
#include <map>
#include <list>
#include <set>
#include <deque>
#include <unordered_map>
#include <array>

struct A { char c; int i; char d; };                 // padding demo
struct B { int i; char c; char d; };                 // reordered -> smaller
struct C { char c; double d; char e; };
struct Empty {};
struct EmptyBase : Empty { int x; };                 // empty base optimisation
struct HasEmptyMember { Empty e; int x; };
struct V { virtual void f() {} int x; };
struct P { int a; }; struct Q { int b; };
struct M : P, Q { int c; };                          // multiple inheritance
struct VB1 : virtual P { int q; };
union U { int i; char c[5]; double d; };
struct Bits { unsigned a:3; unsigned b:5; unsigned c:8; };
struct alignas(32) Over { char c; };

#define PR(...) std::printf("%-34s sizeof=%-3zu alignof=%zu\n", #__VA_ARGS__, sizeof(__VA_ARGS__), alignof(__VA_ARGS__))
#define OFF(T,m) std::printf("  offsetof(%s,%s) = %zu\n", #T, #m, offsetof(T,m))

int main() {
    std::puts("== fundamental types (x86-64 Linux, LP64) ==");
    PR(bool); PR(char); PR(short); PR(int); PR(long); PR(long long);
    PR(float); PR(double); PR(long double); PR(void*); PR(wchar_t); PR(size_t);
    std::puts("== structs ==");
    PR(A); OFF(A,c); OFF(A,i); OFF(A,d);
    PR(B); PR(C); OFF(C,d); OFF(C,e);
    PR(Empty); PR(EmptyBase); PR(HasEmptyMember);
    PR(V); PR(M); PR(VB1); PR(U); PR(Bits); PR(Over);
    std::puts("== std types (libstdc++) ==");
    PR(std::string); PR(std::vector<int>); PR(std::unique_ptr<int>);
    PR(std::shared_ptr<int>); PR(std::array<int,5>);
    PR(std::map<int,int>); PR(std::list<int>); PR(std::deque<int>);
    PR(std::set<int>); PR(std::unordered_map<int,int>);
    std::puts("== pointer adjustment under multiple inheritance ==");
    M m; M* pm = &m; P* pp = pm; Q* pq = pm;
    std::printf("M*=%p P*=%p Q*=%p  (Q* - M* = %td)\n", (void*)pm, (void*)pp, (void*)pq,
                (char*)pq - (char*)pm);
    std::puts("== vptr: first 8 bytes of polymorphic object ==");
    V v1, v2; V* a = &v1; V* b = &v2;
    std::printf("vptr(v1)=%p vptr(v2)=%p same=%d\n", *(void**)a, *(void**)b, *(void**)a == *(void**)b);
    std::puts("== endianness / char signedness ==");
    uint32_t x = 0x11223344; unsigned char* bp = (unsigned char*)&x;
    std::printf("bytes of 0x11223344: %02x %02x %02x %02x\n", bp[0], bp[1], bp[2], bp[3]);
    std::printf("char is %s\n", (char)-1 < 0 ? "signed" : "unsigned");
    float f = 1.0f; uint32_t fb; __builtin_memcpy(&fb, &f, 4);
    std::printf("1.0f bits = 0x%08x\n", fb);
    return 0;
}
