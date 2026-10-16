// <vector>: object layout, growth policy and element relocation order follow each platform's standard library.
namespace std {
template <class T, class... Args> inline void __construct(T* p, Args&&... args) { ::new (static_cast<void*>(p)) T(std::forward<Args>(args)...); }
template <class T> inline void __destroy_at(T* p) { p->~T(); }
template <class T> inline void __destroy_range(T* first, T* last) { if (!__is_trivially_destructible(T)) for (; first != last; ++first) first->~T(); }

template <class T>
class vector {
 public:
  typedef T value_type;
  typedef T* pointer;
  typedef const T* const_pointer;
  typedef T& reference;
  typedef const T& const_reference;
  typedef T* iterator;
  typedef const T* const_iterator;
  typedef std::reverse_iterator<T*> reverse_iterator;
  typedef std::reverse_iterator<const T*> const_reverse_iterator;
  typedef size_t size_type;
  typedef ptrdiff_t difference_type;

 private:
#if defined(_WIN32)
  void* _Myproxy;       // debug-iterator bookkeeping (_ITERATOR_DEBUG_LEVEL=2)
  T* _Myfirst;
  T* _Mylast;
  T* _Myend;
#define SY_B _Myfirst
#define SY_E _Mylast
#define SY_C _Myend
#elif defined(__APPLE__)
  T* __begin_;
  T* __end_;
  T* __end_cap_;
#define SY_B __begin_
#define SY_E __end_
#define SY_C __end_cap_
#else
  T* _M_start;
  T* _M_finish;
  T* _M_end_of_storage;
#define SY_B _M_start
#define SY_E _M_finish
#define SY_C _M_end_of_storage
#endif

  void _init_empty() {
#if defined(_WIN32)
    _Myproxy = ::operator new(16);
#endif
    SY_B = 0; SY_E = 0; SY_C = 0;
  }
  static T* _alloc(size_t n) { return n ? static_cast<T*>(::operator new(n * sizeof(T))) : static_cast<T*>(0); }
  void _release() { if (SY_B) { ::operator delete(SY_B); } SY_B = 0; SY_E = 0; SY_C = 0; }
  void _fail_length(const char* where) const { throw length_error(where); }

  // the capacity a reallocation to hold `add` more elements should use
  size_t _next_capacity(size_t add) const {
    size_t sz = size(), cap = capacity();
    size_t need = sz + add;
    if (need > max_size()) _fail_length("vector");
#if defined(_WIN32)
    size_t geo = cap + cap / 2;
    return geo < need ? need : geo;
#elif defined(__APPLE__)
    size_t dbl = 2 * cap;
    return dbl < need ? need : dbl;
#else
    size_t len = sz + (sz > add ? sz : add);
    return len;
#endif
  }

  // ---- relocating the old elements into new storage ----
  // phase 1: build the elements [first,last) at dest;  phase 2: destroy the old ones (some libraries interleave the two)
  static bool _interleaved() {
#if defined(_WIN32) || defined(__APPLE__)
    return false;
#else
    return __is_nothrow_move_constructible(T) && __is_nothrow_destructible(T) && !__is_trivially_copyable(T);
#endif
  }
  static void _phase1(T* first, T* last, T* dest, bool at_back) {
    if (first == last) return;
    if (__is_trivially_copyable(T)) { memmove(static_cast<void*>(dest), static_cast<const void*>(first), (last - first) * sizeof(T)); return; }
#if defined(_WIN32)
    bool mv = !at_back || __is_nothrow_move_constructible(T) || !__is_copy_constructible(T);
    for (; first != last; ++first, ++dest) { if (mv) __construct(dest, std::move(*first)); else __construct(dest, static_cast<const T&>(*first)); }
#elif defined(__APPLE__)
    bool mv = __is_nothrow_move_constructible(T) || !__is_copy_constructible(T);
    T* d = dest + (last - first);
    while (last != first) { --last; --d; if (mv) __construct(d, std::move(*last)); else __construct(d, static_cast<const T&>(*last)); }
#else
    if (_interleaved()) { for (; first != last; ++first, ++dest) { __construct(dest, std::move(*first)); first->~T(); } }
    else {
      bool mv = __is_nothrow_move_constructible(T) || !__is_copy_constructible(T);
      for (; first != last; ++first, ++dest) { if (mv) __construct(dest, std::move(*first)); else __construct(dest, static_cast<const T&>(*first)); }
    }
#endif
  }
  static void _phase2(T* first, T* last) {
    if (__is_trivially_copyable(T) || _interleaved()) return;
#if defined(__APPLE__)
    while (last != first) { --last; last->~T(); }
#else
    __destroy_range(first, last);
#endif
  }

  template <class... Args> T* _realloc_insert(T* pos, Args&&... args) {
    size_t before = pos - SY_B;
    size_t cap = _next_capacity(1);
    T* nb = _alloc(cap);
    __construct(nb + before, std::forward<Args>(args)...);
    bool at_back = (pos == SY_E);
    _phase1(SY_B, pos, nb, at_back);
    _phase1(pos, SY_E, nb + before + 1, at_back);
    size_t count = size();
    _phase2(SY_B, SY_E);
    if (SY_B) ::operator delete(SY_B);
    SY_B = nb; SY_E = nb + count + 1; SY_C = nb + cap;
    return nb + before;
  }
  void _realloc_to(size_t cap) {
    T* nb = _alloc(cap);
    size_t count = size();
    _phase1(SY_B, SY_E, nb, true);
    _phase2(SY_B, SY_E);
    if (SY_B) ::operator delete(SY_B);
    SY_B = nb; SY_E = nb + count; SY_C = nb + cap;
  }
  void _check_index(size_t i) const {
#if defined(_WIN32)
    if (i >= size()) __debug_assert("vector subscript out of range");
#endif
    (void)i;
  }

 public:
  vector() noexcept { _init_empty(); }
  explicit vector(size_t n) {
    _init_empty();
    if (n > max_size()) _fail_length("cannot create std::vector larger than max_size()");
    SY_B = _alloc(n); SY_C = SY_B + n; SY_E = SY_B;
    for (size_t i = 0; i < n; ++i, ++SY_E) __construct(SY_E);
  }
  vector(size_t n, const T& v) {
    _init_empty();
    if (n > max_size()) _fail_length("cannot create std::vector larger than max_size()");
    SY_B = _alloc(n); SY_C = SY_B + n; SY_E = SY_B;
    for (size_t i = 0; i < n; ++i, ++SY_E) __construct(SY_E, v);
  }
  vector(const vector& o) {
    _init_empty();
    size_t n = o.size();
    SY_B = _alloc(n); SY_C = SY_B + n; SY_E = SY_B;
    if (__is_trivially_copyable(T)) { if (n) memmove(static_cast<void*>(SY_B), static_cast<const void*>(o.SY_B), n * sizeof(T)); SY_E = SY_B + n; }
    else for (const T* p = o.SY_B; p != o.SY_E; ++p, ++SY_E) __construct(SY_E, *p);
  }
  vector(vector&& o) noexcept {
    _init_empty();
    SY_B = o.SY_B; SY_E = o.SY_E; SY_C = o.SY_C;
    o.SY_B = 0; o.SY_E = 0; o.SY_C = 0;
  }
  vector(initializer_list<T> il) {
    _init_empty();
    size_t n = il.size();
    SY_B = _alloc(n); SY_C = SY_B + n; SY_E = SY_B;
    for (const T* p = il.begin(); p != il.end(); ++p, ++SY_E) __construct(SY_E, *p);
  }
  template <class It, class = typename enable_if<!is_integral<It>::value>::type> vector(It first, It last) {
    _init_empty();
    size_t n = distance(first, last);
    SY_B = _alloc(n); SY_C = SY_B + n; SY_E = SY_B;
    for (; first != last; ++first, ++SY_E) __construct(SY_E, *first);
  }
  ~vector() {
    __destroy_range(SY_B, SY_E);
    if (SY_B) ::operator delete(SY_B);
#if defined(_WIN32)
    if (_Myproxy) ::operator delete(_Myproxy);
#endif
  }
  vector& operator=(const vector& o) {
    if (this == &o) return *this;
    size_t n = o.size();
    if (n > capacity()) {
      T* nb = _alloc(n);
      T* e = nb;
      for (const T* p = o.SY_B; p != o.SY_E; ++p, ++e) __construct(e, *p);
      __destroy_range(SY_B, SY_E);
      if (SY_B) ::operator delete(SY_B);
      SY_B = nb; SY_E = e; SY_C = nb + n;
    } else if (size() >= n) {
      T* d = SY_B;
      for (const T* p = o.SY_B; p != o.SY_E; ++p, ++d) *d = *p;
      __destroy_range(d, SY_E);
      SY_E = SY_B + n;
    } else {
      size_t k = size();
      T* d = SY_B; const T* p = o.SY_B;
      for (size_t i = 0; i < k; ++i, ++d, ++p) *d = *p;
      for (; p != o.SY_E; ++p, ++SY_E) __construct(SY_E, *p);
    }
    return *this;
  }
  vector& operator=(vector&& o) noexcept {
    if (this == &o) return *this;
    __destroy_range(SY_B, SY_E);
    if (SY_B) ::operator delete(SY_B);
    SY_B = o.SY_B; SY_E = o.SY_E; SY_C = o.SY_C;
    o.SY_B = 0; o.SY_E = 0; o.SY_C = 0;
    return *this;
  }
  vector& operator=(initializer_list<T> il) { assign(il.begin(), il.end()); return *this; }

  size_t size() const noexcept { return SY_E - SY_B; }
  size_t capacity() const noexcept { return SY_C - SY_B; }
  size_t max_size() const noexcept { return static_cast<size_t>(0x7fffffffffffffffLL) / sizeof(T); }
  bool empty() const noexcept { return SY_B == SY_E; }
  T* data() noexcept { return SY_B; }
  const T* data() const noexcept { return SY_B; }
  iterator begin() noexcept { return SY_B; }
  const_iterator begin() const noexcept { return SY_B; }
  const_iterator cbegin() const noexcept { return SY_B; }
  iterator end() noexcept { return SY_E; }
  const_iterator end() const noexcept { return SY_E; }
  const_iterator cend() const noexcept { return SY_E; }
  reverse_iterator rbegin() noexcept { return reverse_iterator(SY_E); }
  reverse_iterator rend() noexcept { return reverse_iterator(SY_B); }
  const_reverse_iterator rbegin() const noexcept { return const_reverse_iterator(SY_E); }
  const_reverse_iterator rend() const noexcept { return const_reverse_iterator(SY_B); }

  T& operator[](size_t i) { _check_index(i); return SY_B[i]; }
  const T& operator[](size_t i) const { _check_index(i); return SY_B[i]; }
  T& at(size_t i) {
    if (i >= size()) {
#if defined(_WIN32)
      throw out_of_range("invalid vector subscript");
#elif defined(__APPLE__)
      throw out_of_range("vector");
#else
      char buf[128];
      snprintf(buf, 128, "vector::_M_range_check: __n (which is %zu) >= this->size() (which is %zu)", i, size());
      throw out_of_range(buf);
#endif
    }
    return SY_B[i];
  }
  const T& at(size_t i) const { return const_cast<vector*>(this)->at(i); }
  T& front() {
#if defined(_WIN32)
    if (empty()) __debug_assert("front() called on empty vector");
#endif
    return *SY_B;
  }
  const T& front() const { return *SY_B; }
  T& back() {
#if defined(_WIN32)
    if (empty()) __debug_assert("back() called on empty vector");
#endif
    return *(SY_E - 1);
  }
  const T& back() const { return *(SY_E - 1); }

  void reserve(size_t n) {
    if (n > max_size()) throw length_error("vector::reserve");
    if (n > capacity()) _realloc_to(n);
  }
  void shrink_to_fit() { if (capacity() > size()) _realloc_to(size()); }
  void clear() noexcept { __destroy_range(SY_B, SY_E); SY_E = SY_B; }

  void push_back(const T& v) {
    if (SY_E != SY_C) { __construct(SY_E, v); ++SY_E; }
    else _realloc_insert(SY_E, v);
  }
  void push_back(T&& v) {
    if (SY_E != SY_C) { __construct(SY_E, std::move(v)); ++SY_E; }
    else _realloc_insert(SY_E, std::move(v));
  }
  template <class... Args> T& emplace_back(Args&&... args) {
    if (SY_E != SY_C) { __construct(SY_E, std::forward<Args>(args)...); ++SY_E; }
    else _realloc_insert(SY_E, std::forward<Args>(args)...);
    return *(SY_E - 1);
  }
  void pop_back() {
#if defined(_WIN32)
    if (empty()) __debug_assert("pop_back() called on empty vector");
#endif
    --SY_E; SY_E->~T();
  }

  template <class... Args> iterator emplace(const_iterator cpos, Args&&... args) {
    T* pos = SY_B + (cpos - SY_B);
    if (SY_E == SY_C) return _realloc_insert(pos, std::forward<Args>(args)...);
    if (pos == SY_E) { __construct(SY_E, std::forward<Args>(args)...); ++SY_E; return pos; }
    T tmp(std::forward<Args>(args)...);
    __construct(SY_E, std::move(*(SY_E - 1)));
    ++SY_E;
    std::move_backward(pos, SY_E - 2, SY_E - 1);
    *pos = std::move(tmp);
    return pos;
  }
  iterator insert(const_iterator cpos, const T& v) {
    T* pos = SY_B + (cpos - SY_B);
    if (SY_E == SY_C) return _realloc_insert(pos, v);
    if (pos == SY_E) { __construct(SY_E, v); ++SY_E; return pos; }
    T tmp(v);
    __construct(SY_E, std::move(*(SY_E - 1)));
    ++SY_E;
    std::move_backward(pos, SY_E - 2, SY_E - 1);
    *pos = std::move(tmp);
    return pos;
  }
  iterator insert(const_iterator cpos, T&& v) { return emplace(cpos, std::move(v)); }
  iterator insert(const_iterator cpos, size_t n, const T& v) {
    T* pos = SY_B + (cpos - SY_B);
    size_t off = pos - SY_B;
    if (n == 0) return pos;
    if (size() + n > capacity()) {
      size_t cap = _next_capacity(n);
      T* nb = _alloc(cap);
      T* e = nb + off;
      for (size_t i = 0; i < n; ++i, ++e) __construct(e, v);
      bool at_back = (pos == SY_E);
      _phase1(SY_B, pos, nb, at_back);
      _phase1(pos, SY_E, nb + off + n, at_back);
      size_t count = size();
      _phase2(SY_B, SY_E);
      if (SY_B) ::operator delete(SY_B);
      SY_B = nb; SY_E = nb + count + n; SY_C = nb + cap;
      return SY_B + off;
    }
    T tmp(v);
    T* old_end = SY_E;
    size_t after = old_end - pos;
    if (after > n) {
      for (T* s = old_end - n; s != old_end; ++s, ++SY_E) __construct(SY_E, std::move(*s));
      std::move_backward(pos, old_end - n, old_end);
      for (size_t i = 0; i < n; ++i) pos[i] = tmp;
    } else {
      for (size_t i = 0; i < n - after; ++i, ++SY_E) __construct(SY_E, tmp);
      for (T* s = pos; s != old_end; ++s, ++SY_E) __construct(SY_E, std::move(*s));
      for (T* s = pos; s != old_end; ++s) *s = tmp;
    }
    return SY_B + off;
  }
  template <class It, class = typename enable_if<!is_integral<It>::value>::type> iterator insert(const_iterator cpos, It first, It last) {
    size_t off = cpos - SY_B;
    size_t n = distance(first, last);
    if (n == 0) return SY_B + off;
    if (size() + n > capacity()) {
      T* pos = SY_B + off;
      size_t cap = _next_capacity(n);
      T* nb = _alloc(cap);
      T* e = nb + off;
      for (It it = first; it != last; ++it, ++e) __construct(e, *it);
      bool at_back = (pos == SY_E);
      _phase1(SY_B, pos, nb, at_back);
      _phase1(pos, SY_E, nb + off + n, at_back);
      size_t count = size();
      _phase2(SY_B, SY_E);
      if (SY_B) ::operator delete(SY_B);
      SY_B = nb; SY_E = nb + count + n; SY_C = nb + cap;
      return SY_B + off;
    }
    // enough room: append the new elements, then rotate them into place
    size_t old = size();
    for (It it = first; it != last; ++it, ++SY_E) __construct(SY_E, *it);
    std::rotate(SY_B + off, SY_B + old, SY_E);
    return SY_B + off;
  }
  iterator insert(const_iterator cpos, initializer_list<T> il) { return insert(cpos, il.begin(), il.end()); }

  iterator erase(const_iterator cpos) {
    T* pos = SY_B + (cpos - SY_B);
    if (pos + 1 != SY_E) std::move(pos + 1, SY_E, pos);
    --SY_E; SY_E->~T();
    return pos;
  }
  iterator erase(const_iterator cfirst, const_iterator clast) {
    T* first = SY_B + (cfirst - SY_B);
    T* last = SY_B + (clast - SY_B);
    if (first != last) {
      if (last != SY_E) std::move(last, SY_E, first);
      T* ne = SY_E - (last - first);
      __destroy_range(ne, SY_E);
      SY_E = ne;
    }
    return first;
  }

  void resize(size_t n) {
    if (n < size()) { T* ne = SY_B + n; __destroy_range(ne, SY_E); SY_E = ne; }
    else if (n > size()) {
      size_t add = n - size();
      if (add <= static_cast<size_t>(SY_C - SY_E)) { for (size_t i = 0; i < add; ++i, ++SY_E) __construct(SY_E); }
      else {
        size_t cap = _next_capacity(add);
        T* nb = _alloc(cap);
        size_t count = size();
        T* e = nb + count;
        for (size_t i = 0; i < add; ++i, ++e) __construct(e);
        _phase1(SY_B, SY_E, nb, true);
        _phase2(SY_B, SY_E);
        if (SY_B) ::operator delete(SY_B);
        SY_B = nb; SY_E = nb + n; SY_C = nb + cap;
      }
    }
  }
  void resize(size_t n, const T& v) {
    if (n < size()) { T* ne = SY_B + n; __destroy_range(ne, SY_E); SY_E = ne; }
    else if (n > size()) insert(end(), n - size(), v);
  }
  void assign(size_t n, const T& v) {
    T tmp(v);
    clear();
    if (n > capacity()) { _release(); SY_B = _alloc(n); SY_C = SY_B + n; SY_E = SY_B; }
    for (size_t i = 0; i < n; ++i, ++SY_E) __construct(SY_E, tmp);
  }
  template <class It, class = typename enable_if<!is_integral<It>::value>::type> void assign(It first, It last) {
    size_t n = distance(first, last);
    __destroy_range(SY_B, SY_E); SY_E = SY_B;
    if (n > capacity()) { _release(); SY_B = _alloc(n); SY_C = SY_B + n; SY_E = SY_B; }
    for (; first != last; ++first, ++SY_E) __construct(SY_E, *first);
  }
  void assign(initializer_list<T> il) { assign(il.begin(), il.end()); }
  void swap(vector& o) noexcept {
    T* a = SY_B; T* b = SY_E; T* c = SY_C;
    SY_B = o.SY_B; SY_E = o.SY_E; SY_C = o.SY_C;
    o.SY_B = a; o.SY_E = b; o.SY_C = c;
  }
};
#undef SY_B
#undef SY_E
#undef SY_C

template <class T> inline bool operator==(const vector<T>& a, const vector<T>& b) { return a.size() == b.size() && std::equal(a.begin(), a.end(), b.begin()); }
template <class T> inline bool operator!=(const vector<T>& a, const vector<T>& b) { return !(a == b); }
template <class T> inline bool operator<(const vector<T>& a, const vector<T>& b) { return std::lexicographical_compare(a.begin(), a.end(), b.begin(), b.end()); }
template <class T> inline bool operator>(const vector<T>& a, const vector<T>& b) { return b < a; }
template <class T> inline bool operator<=(const vector<T>& a, const vector<T>& b) { return !(b < a); }
template <class T> inline bool operator>=(const vector<T>& a, const vector<T>& b) { return !(a < b); }
template <class T> inline void swap(vector<T>& a, vector<T>& b) noexcept { a.swap(b); }
}
