// E2: where things live. Globals, stack locals, heap, literals, 1D vs 3D arrays, jagged
#include <cstdio>
#include <cstdlib>
#include <cstdint>
#include <malloc.h>
#include <new>
#include <vector>
#include <string>

int g_init = 5; int g_zero; static int g_static = 7; const int g_const = 9;

#define ADDR(x) std::printf("%-14s %p\n", #x, (void*)&(x))

__attribute__((noinline)) void frame_demo(int depth) {
    volatile int local = depth;
    void* fa = __builtin_frame_address(0);
    void* ra = __builtin_return_address(0);
    std::printf("depth=%d &local=%p frame_addr=%p retaddr=%p\n", depth, (void*)&local, fa, ra);
    if (depth < 3) frame_demo(depth + 1);
}

int main() {
    std::puts("== locals in declaration order ==");
    int a = 1; int b = 2; int c = 3; char ch = 'x'; double d = 1.5; int arr[4] = {1,2,3,4};
    ADDR(a); ADDR(b); ADDR(c); ADDR(ch); ADDR(d); ADDR(arr);
    std::puts("== three separate 1D arrays vs one 3D array ==");
    int x1[4], x2[4], x3[4];
    std::printf("x1=%p x2=%p x3=%p\n", (void*)x1, (void*)x2, (void*)x3);
    int cube[2][3][4];
    std::printf("cube=%p &cube[0][0][1]=%p &cube[0][1][0]=%p &cube[1][0][0]=%p last=%p\n",
        (void*)cube, (void*)&cube[0][0][1], (void*)&cube[0][1][0], (void*)&cube[1][0][0], (void*)&cube[1][2][3]);
    std::printf("sizeof(cube)=%zu  (= 2*3*4*4)\n", sizeof(cube));
    std::puts("== jagged int** (separate heap blocks) ==");
    int** jag = new int*[3];
    for (int i = 0; i < 3; i++) jag[i] = new int[4];
    std::printf("jag=%p rows: %p %p %p\n", (void*)jag, (void*)jag[0], (void*)jag[1], (void*)jag[2]);
    std::puts("== globals / literals / code ==");
    ADDR(g_init); ADDR(g_zero); ADDR(g_static); ADDR(g_const);
    const char* lit = "hello"; const char lit2[] = "hello";
    std::printf("literal=%p  array-copy=%p  main=%p  frame_demo=%p\n", (void*)lit, (void*)lit2, (void*)&main, (void*)&frame_demo);
    std::puts("== heap: malloc/new chunk behaviour ==");
    for (size_t n : {1,8,16,24,25,32,40,48,100,1000}) {
        void* p = malloc(n);
        std::printf("malloc(%-4zu) -> %p usable=%zu\n", n, p, malloc_usable_size(p));
        free(p);
    }
    void* p1 = malloc(24); void* p2 = malloc(24); void* p3 = malloc(24);
    std::printf("three malloc(24): %p %p %p  (stride %td, %td)\n", p1, p2, p3, (char*)p2-(char*)p1, (char*)p3-(char*)p2);
    free(p2);
    void* p4 = malloc(24);
    std::printf("after free(p2), malloc(24) -> %p  reused p2? %d\n", p4, p4 == p2);
    unsigned long long hdr = *((unsigned long long*)p1 - 1);
    std::printf("chunk header word before p1 = 0x%llx (size|flags)\n", hdr);
    int* n1 = new int(1); int* n2 = new int(2);
    std::printf("new int x2: %p %p stride=%td\n", (void*)n1, (void*)n2, (char*)n2-(char*)n1);
    std::puts("== stack frames (recursion) ==");
    frame_demo(0);
    return 0;
}
