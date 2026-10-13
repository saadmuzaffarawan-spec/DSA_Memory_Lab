// E3: STL internals - vector growth, SSO, realloc moves, iterator invalidation, map/list node cost
#include <cstdio>
#include <vector>
#include <string>
#include <map>
#include <list>
#include <memory>
#include <cstdint>
#include <malloc.h>

struct Noisy {
    int id;
    Noisy(int i) : id(i) { std::printf("  ctor(%d)\n", id); }
    Noisy(const Noisy& o) : id(o.id) { std::printf("  copy(%d)\n", id); }
    Noisy(Noisy&& o) noexcept : id(o.id) { std::printf("  move(%d)\n", id); }
    ~Noisy() { std::printf("  dtor(%d)\n", id); }
};

int main() {
    std::puts("== vector<int> growth ==");
    std::vector<int> v;
    size_t last = 999;
    for (int i = 0; i < 40; i++) {
        const int* before = v.data();
        v.push_back(i);
        if (v.capacity() != last) {
            std::printf("size=%-3zu capacity=%-3zu data=%p (moved=%d)\n", v.size(), v.capacity(), (void*)v.data(), before != v.data());
            last = v.capacity();
        }
    }
    std::puts("== vector object itself is 3 pointers ==");
    std::vector<int> w; w.reserve(10); w.push_back(1); w.push_back(2);
    uintptr_t* raw = (uintptr_t*)&w;
    std::printf("begin=%p end=%p end_of_storage=%p  (end-begin=%td bytes, eos-begin=%td bytes)\n",
        (void*)raw[0], (void*)raw[1], (void*)raw[2], (char*)raw[1]-(char*)raw[0], (char*)raw[2]-(char*)raw[0]);
    std::puts("== string SSO ==");
    std::string s;
    std::printf("empty: capacity=%zu data=%p &s=%p inline=%d\n", s.capacity(), (void*)s.data(), (void*)&s, s.data() >= (char*)&s && s.data() < (char*)&s + sizeof(s));
    for (int len : {5, 15, 16, 17, 31, 32, 33}) {
        std::string t(len, 'a');
        std::printf("len=%-2d capacity=%-3zu inline=%d\n", len, t.capacity(), t.data() >= (char*)&t && t.data() < (char*)&t + sizeof(t));
    }
    std::puts("== vector<Noisy> push_back reallocation (copy vs move) ==");
    {
        std::vector<Noisy> nv;
        for (int i = 1; i <= 3; i++) { std::printf("push_back(%d)\n", i); nv.push_back(Noisy(i)); }
        std::puts("emplace_back(4)"); nv.emplace_back(4);
        std::puts("-- leaving scope --");
    }
    std::puts("== iterator invalidation ==");
    std::vector<int> iv = {1,2,3}; int* first = &iv[0];
    iv.reserve(1000);
    std::printf("old pointer %p, new data %p -> dangling=%d\n", (void*)first, (void*)iv.data(), first != iv.data());
    std::puts("== node cost: malloc_usable_size of a single node ==");
    std::map<int,int> m; m[1] = 1;
    std::list<int> l; l.push_back(1);
    std::printf("map<int,int>: 1 node, bytes allocated ~ (see sizeof RB node 32 header + 8 payload = 40 -> 48 chunk)\n");
    std::puts("== shared_ptr control block ==");
    auto sp = std::make_shared<int>(42); auto sp2 = sp;
    std::printf("sp.get()=%p use_count=%ld sizeof(sp)=%zu\n", (void*)sp.get(), sp.use_count(), sizeof(sp));
    return 0;
}
