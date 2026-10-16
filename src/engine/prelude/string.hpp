// <string>: std::string with the object layout, small-string optimisation and growth policy of each platform's standard library.
namespace std {
void __debug_assert(const char*);
class string {
 public:
  typedef char value_type;
  typedef size_t size_type;
  typedef ptrdiff_t difference_type;
  typedef char& reference;
  typedef const char& const_reference;
  typedef char* pointer;
  typedef const char* const_pointer;
  typedef char* iterator;
  typedef const char* const_iterator;
  typedef std::reverse_iterator<char*> reverse_iterator;
  typedef std::reverse_iterator<const char*> const_reverse_iterator;
  static const size_t npos = static_cast<size_t>(-1);

 private:
#if defined(_WIN32)
  // MSVC Debug: _Container_base12 (proxy pointer) + _String_val { union{_Buf[16], _Ptr}, _Mysize, _Myres }
  void* _Myproxy;
  union { char _Buf[16]; char* _Ptr; } _Bx;
  size_t _Mysize;
  size_t _Myres;
  bool _local() const { return _Myres < 16; }
  char* _ptr() { return _local() ? _Bx._Buf : _Bx._Ptr; }
  const char* _ptr() const { return _local() ? _Bx._Buf : _Bx._Ptr; }
  size_t _len() const { return _Mysize; }
  size_t _cap() const { return _Myres; }
  void _setlen(size_t n) { _Mysize = n; _ptr()[n] = '\0'; }
  void _init() { _Myproxy = ::operator new(16); _Mysize = 0; _Myres = 15; _Bx._Buf[0] = '\0'; }
  static size_t _grown(size_t req, size_t old) {
    size_t masked = req | 15;
    size_t geo = old + old / 2;
    return masked > geo ? masked : geo;
  }
  static size_t _ctor_cap(size_t n) { return _grown(n, 15); }
  static size_t _local_cap() { return 15; }
  static size_t _shrink_cap(size_t n) { return n | 15; }
  void _adopt(char* p, size_t cap) { _Bx._Ptr = p; _Myres = cap; }
  void _release_proxy() { if (_Myproxy) { ::operator delete(_Myproxy); _Myproxy = 0; } }
  void _free_heap() { if (!_local()) ::operator delete(_Bx._Ptr); }
  void _reset_local() { _Myres = 15; }
#elif defined(__APPLE__)
  // libc++ (macOS): 24 bytes; short strings keep 22 characters, size<<1 in the first byte
  union {
    struct { size_t _cap_; size_t _size_; char* _data_; } _l;
    struct { unsigned char _sz; char _d[23]; } _s;
  } _r;
  bool _local() const { return (_r._s._sz & 1) == 0; }
  char* _ptr() { return _local() ? _r._s._d : _r._l._data_; }
  const char* _ptr() const { return _local() ? _r._s._d : _r._l._data_; }
  size_t _len() const { return _local() ? (_r._s._sz >> 1) : _r._l._size_; }
  size_t _cap() const { return _local() ? 22 : (_r._l._cap_ & ~static_cast<size_t>(1)) - 1; }
  void _setlen(size_t n) { if (_local()) _r._s._sz = static_cast<unsigned char>(n << 1); else _r._l._size_ = n; _ptr()[n] = '\0'; }
  void _init() { _r._l._cap_ = 0; _r._l._size_ = 0; _r._l._data_ = 0; _r._s._sz = 0; _r._s._d[0] = '\0'; }
  static size_t _recommend(size_t s) { return s < 23 ? 22 : (((s + 1) + 15) & ~static_cast<size_t>(15)) - 1; }
  static size_t _grown(size_t req, size_t old) { size_t a = old + (req - old); size_t b = 2 * old; return _recommend(a > b ? a : b); }
  static size_t _ctor_cap(size_t n) { return _recommend(n); }
  static size_t _local_cap() { return 22; }
  static size_t _shrink_cap(size_t n) { return _recommend(n); }
  void _adopt(char* p, size_t cap) { _r._l._data_ = p; _r._l._cap_ = (cap + 1) | 1; }
  void _release_proxy() {}
  void _free_heap() { if (!_local()) ::operator delete(_r._l._data_); }
  void _reset_local() { _r._s._sz = 0; }
#else
  // libstdc++ (C++11 ABI): 32 bytes; _M_p, length, then a 16-byte union of the local buffer / allocated capacity
  char* _M_p;
  size_t _M_string_length;
  union { char _M_local_buf[16]; size_t _M_allocated_capacity; };
  bool _local() const { return _M_p == _M_local_buf; }
  char* _ptr() { return _M_p; }
  const char* _ptr() const { return _M_p; }
  size_t _len() const { return _M_string_length; }
  size_t _cap() const { return _local() ? 15 : _M_allocated_capacity; }
  void _setlen(size_t n) { _M_string_length = n; _M_p[n] = '\0'; }
  void _init() { _M_p = _M_local_buf; _M_string_length = 0; _M_local_buf[0] = '\0'; }
  static size_t _grown(size_t req, size_t old) { return (req > old && req < 2 * old) ? 2 * old : req; }
  static size_t _ctor_cap(size_t n) { return n; }
  static size_t _local_cap() { return 15; }
  static size_t _shrink_cap(size_t n) { return n; }
  void _adopt(char* p, size_t cap) { _M_p = p; _M_allocated_capacity = cap; }
  void _release_proxy() {}
  void _free_heap() { if (!_local()) ::operator delete(_M_p); }
  void _reset_local() { _M_p = _M_local_buf; }
#endif

  // make room for `cap` characters (+ terminator) while keeping the first `keep` characters
  void _reserve_keep(size_t cap, size_t keep) {
    char* np = static_cast<char*>(::operator new(cap + 1));
    if (keep) memcpy(np, _ptr(), keep);
    np[keep] = '\0';
    _free_heap();
    _adopt(np, cap);
  }
  void _construct(const char* s, size_t n) {
    _init();
    if (n > _cap()) {
      size_t cap = _ctor_cap(n);
      char* np = static_cast<char*>(::operator new(cap + 1));
      _adopt(np, cap);
    }
    if (n) memcpy(_ptr(), s, n);
    _setlen(n);
  }
  // replace [pos, pos+len1) by s[0,len2)
  void _mutate(size_t pos, size_t len1, const char* s, size_t len2) {
    size_t old = _len();
    size_t nl = old - len1 + len2;
    size_t tail = old - pos - len1;
    if (nl <= _cap()) {
      char* p = _ptr();
      if (s >= p && s <= p + old) {
        // the source lives inside this string: take a private copy first
        string tmp(s, len2);
        if (len1 != len2 && tail) memmove(p + pos + len2, p + pos + len1, tail);
        if (len2) memcpy(p + pos, tmp._ptr(), len2);
      } else {
        if (len1 != len2 && tail) memmove(p + pos + len2, p + pos + len1, tail);
        if (len2) memcpy(p + pos, s, len2);
      }
      _setlen(nl);
    } else {
      size_t cap = _grown(nl, _cap());
      char* np = static_cast<char*>(::operator new(cap + 1));
      if (pos) memcpy(np, _ptr(), pos);
      if (len2) memcpy(np + pos, s, len2);
      if (tail) memcpy(np + pos + len2, _ptr() + pos + len1, tail);
      np[nl] = '\0';
      _free_heap();
      _adopt(np, cap);
      _setlen(nl);
    }
  }
  void _range_check(size_t pos, const char* what) const {
    if (pos > _len()) {
#if defined(_WIN32)
      throw out_of_range("invalid string position");
#elif defined(__APPLE__)
      throw out_of_range("basic_string");
#else
      char buf[128];
      snprintf(buf, 128, "%s: __pos (which is %zu) > this->size() (which is %zu)", what, pos, _len());
      throw out_of_range(buf);
#endif
    }
  }

 public:
  string() { _init(); }
  string(const char* s) { _construct(s, strlen(s)); }
  string(const char* s, size_t n) { _construct(s, n); }
  string(size_t n, char c) { _init(); if (n > _cap()) { size_t cap = _ctor_cap(n); _adopt(static_cast<char*>(::operator new(cap + 1)), cap); } memset(_ptr(), c, n); _setlen(n); }
  string(const string& o) { _construct(o._ptr(), o._len()); }
  string(const string& o, size_t pos, size_t n = npos) { o._range_check(pos, "basic_string::basic_string"); size_t m = o._len() - pos; if (n < m) m = n; _construct(o._ptr() + pos, m); }
  string(string&& o) noexcept {
    _init();
    if (o._local()) { memcpy(_ptr(), o._ptr(), o._len() + 1); _setlen(o._len()); }
    else {
      char* p = o._ptr(); size_t n = o._len(); size_t c = o._cap();
      _adopt(p, c); _setlen(n);
      o._reset_local();
    }
    o._setlen(0);
  }
  string(initializer_list<char> il) { _construct(il.begin(), il.size()); }
  template <class It, class = typename enable_if<!is_integral<It>::value>::type> string(It first, It last) {
    size_t n = 0; for (It i = first; i != last; ++i) ++n;
    _init();
    if (n > _cap()) { size_t cap = _ctor_cap(n); _adopt(static_cast<char*>(::operator new(cap + 1)), cap); }
    size_t k = 0; for (; first != last; ++first) _ptr()[k++] = *first;
    _setlen(n);
  }
  ~string() { _free_heap(); _release_proxy(); }

  string& operator=(const string& o) { if (this != &o) assign(o._ptr(), o._len()); return *this; }
  string& operator=(string&& o) noexcept {
    if (this == &o) return *this;
    if (o._local()) { assign(o._ptr(), o._len()); }
    else {
      _free_heap();
      char* p = o._ptr(); size_t n = o._len(); size_t c = o._cap();
      _adopt(p, c); _setlen(n);
      o._reset_local();
    }
    o._setlen(0);
    return *this;
  }
  string& operator=(const char* s) { return assign(s, strlen(s)); }
  string& operator=(char c) { return assign(&c, 1); }
  string& operator=(initializer_list<char> il) { return assign(il.begin(), il.size()); }

  size_t size() const noexcept { return _len(); }
  size_t length() const noexcept { return _len(); }
  size_t capacity() const noexcept { return _cap(); }
  size_t max_size() const noexcept { return static_cast<size_t>(-1) / 2 - 1; }
  bool empty() const noexcept { return _len() == 0; }
  void clear() noexcept { _setlen(0); }
  void reserve(size_t n = 0) {
    if (n > _cap()) { size_t cap = _grown(n, _cap()); size_t keep = _len(); _reserve_keep(cap, keep); _setlen(keep); }
  }
  void shrink_to_fit() {
    if (_local()) return;
    size_t n = _len();
    if (n <= _local_cap()) {
      string tmp(_ptr(), n);
      _free_heap(); _reset_local();
      memcpy(_ptr(), tmp._ptr(), n + 1); _setlen(n);
    } else if (_shrink_cap(n) < _cap()) {
      string tmp(*this);
      swap(tmp);
    }
  }
  void resize(size_t n, char c = '\0') {
    size_t s = _len();
    if (n <= s) { _setlen(n); return; }
    append(n - s, c);
  }

  char& operator[](size_t i) {
#if defined(_WIN32)
    if (i > _len()) __debug_assert("string subscript out of range");
#endif
    return _ptr()[i];
  }
  const char& operator[](size_t i) const {
#if defined(_WIN32)
    if (i > _len()) __debug_assert("string subscript out of range");
#endif
    return _ptr()[i];
  }
  char& at(size_t i) {
    if (i >= _len()) {
#if defined(_WIN32)
      throw out_of_range("invalid string position");
#elif defined(__APPLE__)
      throw out_of_range("basic_string");
#else
      char buf[128];
      snprintf(buf, 128, "basic_string::at: __n (which is %zu) >= this->size() (which is %zu)", i, _len());
      throw out_of_range(buf);
#endif
    }
    return _ptr()[i];
  }
  const char& at(size_t i) const { return const_cast<string*>(this)->at(i); }
  char& front() { return _ptr()[0]; }
  const char& front() const { return _ptr()[0]; }
  char& back() { return _ptr()[_len() - 1]; }
  const char& back() const { return _ptr()[_len() - 1]; }
  const char* c_str() const noexcept { return _ptr(); }
  const char* data() const noexcept { return _ptr(); }
  char* data() noexcept { return _ptr(); }

  iterator begin() noexcept { return _ptr(); }
  const_iterator begin() const noexcept { return _ptr(); }
  const_iterator cbegin() const noexcept { return _ptr(); }
  iterator end() noexcept { return _ptr() + _len(); }
  const_iterator end() const noexcept { return _ptr() + _len(); }
  const_iterator cend() const noexcept { return _ptr() + _len(); }
  reverse_iterator rbegin() noexcept { return reverse_iterator(end()); }
  reverse_iterator rend() noexcept { return reverse_iterator(begin()); }
  const_reverse_iterator rbegin() const noexcept { return const_reverse_iterator(end()); }
  const_reverse_iterator rend() const noexcept { return const_reverse_iterator(begin()); }

  string& assign(const char* s, size_t n) { _mutate(0, _len(), s, n); return *this; }
  string& assign(const char* s) { return assign(s, strlen(s)); }
  string& assign(const string& o) { return *this = o; }
  string& assign(const string& o, size_t pos, size_t n = npos) { o._range_check(pos, "basic_string::assign"); size_t m = o._len() - pos; if (n < m) m = n; return assign(o._ptr() + pos, m); }
  string& assign(size_t n, char c) { clear(); return append(n, c); }
  string& assign(string&& o) { return *this = std::move(o); }

  string& append(const char* s, size_t n) { _mutate(_len(), 0, s, n); return *this; }
  string& append(const char* s) { return append(s, strlen(s)); }
  string& append(const string& o) { return append(o._ptr(), o._len()); }
  string& append(const string& o, size_t pos, size_t n = npos) { o._range_check(pos, "basic_string::append"); size_t m = o._len() - pos; if (n < m) m = n; return append(o._ptr() + pos, m); }
  string& append(size_t n, char c) {
    size_t old = _len();
    if (old + n > _cap()) { size_t cap = _grown(old + n, _cap()); _reserve_keep(cap, old); }
    memset(_ptr() + old, c, n);
    _setlen(old + n);
    return *this;
  }
  string& append(initializer_list<char> il) { return append(il.begin(), il.size()); }
  void push_back(char c) {
    size_t old = _len();
    if (old + 1 > _cap()) { size_t cap = _grown(old + 1, _cap()); _reserve_keep(cap, old); }
    _ptr()[old] = c;
    _setlen(old + 1);
  }
  void pop_back() { _setlen(_len() - 1); }
  string& operator+=(const string& o) { return append(o); }
  string& operator+=(const char* s) { return append(s); }
  string& operator+=(char c) { push_back(c); return *this; }
  string& operator+=(initializer_list<char> il) { return append(il); }

  string& insert(size_t pos, const char* s, size_t n) { _range_check(pos, "basic_string::insert"); _mutate(pos, 0, s, n); return *this; }
  string& insert(size_t pos, const char* s) { return insert(pos, s, strlen(s)); }
  string& insert(size_t pos, const string& o) { return insert(pos, o._ptr(), o._len()); }
  string& insert(size_t pos, size_t n, char c) { string t(n, c); return insert(pos, t._ptr(), n); }
  iterator insert(const_iterator p, char c) { size_t pos = p - _ptr(); insert(pos, &c, 1); return _ptr() + pos; }
  iterator insert(const_iterator p, size_t n, char c) { size_t pos = p - _ptr(); string t(n, c); insert(pos, t._ptr(), n); return _ptr() + pos; }
  string& erase(size_t pos = 0, size_t n = npos) {
    _range_check(pos, "basic_string::erase");
    size_t m = _len() - pos; if (n < m) m = n;
    _mutate(pos, m, "", 0);
    return *this;
  }
  iterator erase(const_iterator p) { size_t pos = p - _ptr(); erase(pos, 1); return _ptr() + pos; }
  iterator erase(const_iterator a, const_iterator b) { size_t pos = a - _ptr(); erase(pos, b - a); return _ptr() + pos; }
  string& replace(size_t pos, size_t n, const char* s, size_t m) { _range_check(pos, "basic_string::replace"); size_t k = _len() - pos; if (n < k) k = n; _mutate(pos, k, s, m); return *this; }
  string& replace(size_t pos, size_t n, const char* s) { return replace(pos, n, s, strlen(s)); }
  string& replace(size_t pos, size_t n, const string& o) { return replace(pos, n, o._ptr(), o._len()); }
  string& replace(size_t pos, size_t n, size_t m, char c) { string t(m, c); return replace(pos, n, t._ptr(), m); }
  string& replace(const_iterator a, const_iterator b, const string& o) { return replace(a - _ptr(), b - a, o._ptr(), o._len()); }
  string& replace(const_iterator a, const_iterator b, const char* s) { return replace(a - _ptr(), b - a, s, strlen(s)); }

  size_t copy(char* dst, size_t n, size_t pos = 0) const { _range_check(pos, "basic_string::copy"); size_t m = _len() - pos; if (n < m) m = n; if (m) memcpy(dst, _ptr() + pos, m); return m; }
  string substr(size_t pos = 0, size_t n = npos) const { _range_check(pos, "basic_string::substr"); size_t m = _len() - pos; if (n < m) m = n; return string(_ptr() + pos, m); }
  void swap(string& o) noexcept { string t(std::move(o)); o = std::move(*this); *this = std::move(t); }

  size_t find(const char* s, size_t pos, size_t n) const {
    size_t sz = _len();
    if (n == 0) return pos <= sz ? pos : npos;
    if (n > sz) return npos;
    const char* p = _ptr();
    for (; pos + n <= sz; ++pos) if (p[pos] == s[0] && memcmp(p + pos, s, n) == 0) return pos;
    return npos;
  }
  size_t find(const string& o, size_t pos = 0) const noexcept { return find(o._ptr(), pos, o._len()); }
  size_t find(const char* s, size_t pos = 0) const { return find(s, pos, strlen(s)); }
  size_t find(char c, size_t pos = 0) const noexcept {
    size_t sz = _len(); const char* p = _ptr();
    for (; pos < sz; ++pos) if (p[pos] == c) return pos;
    return npos;
  }
  size_t rfind(const char* s, size_t pos, size_t n) const {
    size_t sz = _len();
    if (n > sz) return npos;
    size_t i = sz - n; if (pos < i) i = pos;
    const char* p = _ptr();
    for (;; --i) { if (memcmp(p + i, s, n) == 0) return i; if (i == 0) break; }
    return npos;
  }
  size_t rfind(const string& o, size_t pos = npos) const noexcept { return rfind(o._ptr(), pos, o._len()); }
  size_t rfind(const char* s, size_t pos = npos) const { return rfind(s, pos, strlen(s)); }
  size_t rfind(char c, size_t pos = npos) const noexcept {
    size_t sz = _len();
    if (sz == 0) return npos;
    size_t i = sz - 1; if (pos < i) i = pos;
    const char* p = _ptr();
    for (;; --i) { if (p[i] == c) return i; if (i == 0) break; }
    return npos;
  }
  size_t find_first_of(const char* s, size_t pos, size_t n) const {
    const char* p = _ptr();
    for (; pos < _len(); ++pos) for (size_t k = 0; k < n; ++k) if (p[pos] == s[k]) return pos;
    return npos;
  }
  size_t find_first_of(const string& o, size_t pos = 0) const noexcept { return find_first_of(o._ptr(), pos, o._len()); }
  size_t find_first_of(const char* s, size_t pos = 0) const { return find_first_of(s, pos, strlen(s)); }
  size_t find_first_of(char c, size_t pos = 0) const noexcept { return find(c, pos); }
  size_t find_last_of(const char* s, size_t pos, size_t n) const {
    size_t sz = _len();
    if (sz == 0 || n == 0) return npos;
    size_t i = sz - 1; if (pos < i) i = pos;
    const char* p = _ptr();
    for (;; --i) { for (size_t k = 0; k < n; ++k) if (p[i] == s[k]) return i; if (i == 0) break; }
    return npos;
  }
  size_t find_last_of(const string& o, size_t pos = npos) const noexcept { return find_last_of(o._ptr(), pos, o._len()); }
  size_t find_last_of(const char* s, size_t pos = npos) const { return find_last_of(s, pos, strlen(s)); }
  size_t find_last_of(char c, size_t pos = npos) const noexcept { return rfind(c, pos); }
  size_t find_first_not_of(const char* s, size_t pos, size_t n) const {
    const char* p = _ptr();
    for (; pos < _len(); ++pos) { bool in = false; for (size_t k = 0; k < n; ++k) if (p[pos] == s[k]) { in = true; break; } if (!in) return pos; }
    return npos;
  }
  size_t find_first_not_of(const string& o, size_t pos = 0) const noexcept { return find_first_not_of(o._ptr(), pos, o._len()); }
  size_t find_first_not_of(const char* s, size_t pos = 0) const { return find_first_not_of(s, pos, strlen(s)); }
  size_t find_first_not_of(char c, size_t pos = 0) const noexcept { for (; pos < _len(); ++pos) if (_ptr()[pos] != c) return pos; return npos; }
  size_t find_last_not_of(const char* s, size_t pos, size_t n) const {
    size_t sz = _len();
    if (sz == 0) return npos;
    size_t i = sz - 1; if (pos < i) i = pos;
    const char* p = _ptr();
    for (;; --i) { bool in = false; for (size_t k = 0; k < n; ++k) if (p[i] == s[k]) { in = true; break; } if (!in) return i; if (i == 0) break; }
    return npos;
  }
  size_t find_last_not_of(const string& o, size_t pos = npos) const noexcept { return find_last_not_of(o._ptr(), pos, o._len()); }
  size_t find_last_not_of(const char* s, size_t pos = npos) const { return find_last_not_of(s, pos, strlen(s)); }
  size_t find_last_not_of(char c, size_t pos = npos) const noexcept {
    size_t sz = _len(); if (sz == 0) return npos;
    size_t i = sz - 1; if (pos < i) i = pos;
    for (;; --i) { if (_ptr()[i] != c) return i; if (i == 0) break; }
    return npos;
  }

  int compare(const string& o) const noexcept { return compare(0, _len(), o._ptr(), o._len()); }
  int compare(const char* s) const { return compare(0, _len(), s, strlen(s)); }
  int compare(size_t pos, size_t n, const string& o) const { return compare(pos, n, o._ptr(), o._len()); }
  int compare(size_t pos, size_t n, const char* s, size_t m) const {
    _range_check(pos, "basic_string::compare");
    size_t k = _len() - pos; if (n < k) k = n;
    size_t l = k < m ? k : m;
    int r = l ? memcmp(_ptr() + pos, s, l) : 0;
#if defined(__linux__) || (!defined(_WIN32) && !defined(__APPLE__))
    if (r == 0) { ptrdiff_t d = static_cast<ptrdiff_t>(k) - static_cast<ptrdiff_t>(m); r = d > 2147483647 ? 2147483647 : (d < -2147483647 - 1 ? -2147483647 - 1 : static_cast<int>(d)); }
#else
    if (r == 0) { if (k < m) r = -1; else if (k > m) r = 1; }
    else r = r < 0 ? -1 : 1;
#endif
    return r;
  }
  bool starts_with(const string& o) const noexcept { return _len() >= o._len() && memcmp(_ptr(), o._ptr(), o._len()) == 0; }
  bool starts_with(const char* s) const { size_t n = strlen(s); return _len() >= n && memcmp(_ptr(), s, n) == 0; }
  bool starts_with(char c) const noexcept { return _len() > 0 && _ptr()[0] == c; }
  bool ends_with(const string& o) const noexcept { return _len() >= o._len() && memcmp(_ptr() + _len() - o._len(), o._ptr(), o._len()) == 0; }
  bool ends_with(const char* s) const { size_t n = strlen(s); return _len() >= n && memcmp(_ptr() + _len() - n, s, n) == 0; }
  bool ends_with(char c) const noexcept { return _len() > 0 && _ptr()[_len() - 1] == c; }
  bool contains(const string& o) const noexcept { return find(o) != npos; }
  bool contains(const char* s) const { return find(s) != npos; }
  bool contains(char c) const noexcept { return find(c) != npos; }
};

inline string operator+(const string& a, const string& b) { string r; r.reserve(a.size() + b.size()); r.append(a); r.append(b); return r; }
inline string operator+(const string& a, const char* b) { string r; size_t n = strlen(b); r.reserve(a.size() + n); r.append(a); r.append(b, n); return r; }
inline string operator+(const char* a, const string& b) { string r; size_t n = strlen(a); r.reserve(n + b.size()); r.append(a, n); r.append(b); return r; }
inline string operator+(const string& a, char b) { string r; r.reserve(a.size() + 1); r.append(a); r.push_back(b); return r; }
inline string operator+(char a, const string& b) { string r; r.reserve(1 + b.size()); r.push_back(a); r.append(b); return r; }
inline string operator+(string&& a, const string& b) { a.append(b); return std::move(a); }
inline string operator+(string&& a, const char* b) { a.append(b); return std::move(a); }
inline string operator+(string&& a, char b) { a.push_back(b); return std::move(a); }
inline string operator+(const string& a, string&& b) { b.insert(0, a); return std::move(b); }
inline string operator+(string&& a, string&& b) { a.append(b); return std::move(a); }
inline bool operator==(const string& a, const string& b) noexcept { return a.size() == b.size() && memcmp(a.data(), b.data(), a.size()) == 0; }
inline bool operator==(const string& a, const char* b) { return a.compare(b) == 0; }
inline bool operator==(const char* a, const string& b) { return b.compare(a) == 0; }
inline bool operator!=(const string& a, const string& b) noexcept { return !(a == b); }
inline bool operator!=(const string& a, const char* b) { return !(a == b); }
inline bool operator!=(const char* a, const string& b) { return !(a == b); }
inline bool operator<(const string& a, const string& b) noexcept { return a.compare(b) < 0; }
inline bool operator<(const string& a, const char* b) { return a.compare(b) < 0; }
inline bool operator<(const char* a, const string& b) { return b.compare(a) > 0; }
inline bool operator>(const string& a, const string& b) noexcept { return a.compare(b) > 0; }
inline bool operator>(const string& a, const char* b) { return a.compare(b) > 0; }
inline bool operator>(const char* a, const string& b) { return b.compare(a) < 0; }
inline bool operator<=(const string& a, const string& b) noexcept { return a.compare(b) <= 0; }
inline bool operator<=(const string& a, const char* b) { return a.compare(b) <= 0; }
inline bool operator<=(const char* a, const string& b) { return b.compare(a) >= 0; }
inline bool operator>=(const string& a, const string& b) noexcept { return a.compare(b) >= 0; }
inline bool operator>=(const string& a, const char* b) { return a.compare(b) >= 0; }
inline bool operator>=(const char* a, const string& b) { return b.compare(a) <= 0; }
inline void swap(string& a, string& b) noexcept { a.swap(b); }

inline string to_string(int v) { char b[16]; int n = snprintf(b, 16, "%d", v); return string(b, n); }
inline string to_string(unsigned v) { char b[16]; int n = snprintf(b, 16, "%u", v); return string(b, n); }
inline string to_string(long v) { char b[32]; int n = snprintf(b, 32, "%ld", v); return string(b, n); }
inline string to_string(unsigned long v) { char b[32]; int n = snprintf(b, 32, "%lu", v); return string(b, n); }
inline string to_string(long long v) { char b[32]; int n = snprintf(b, 32, "%lld", v); return string(b, n); }
inline string to_string(unsigned long long v) { char b[32]; int n = snprintf(b, 32, "%llu", v); return string(b, n); }
inline string to_string(float v) { char b[400]; int n = snprintf(b, 400, "%f", static_cast<double>(v)); return string(b, n); }
inline string to_string(double v) { char b[400]; int n = snprintf(b, 400, "%f", v); return string(b, n); }
inline string to_string(long double v) { char b[400]; int n = snprintf(b, 400, "%f", static_cast<double>(v)); return string(b, n); }

long long __strtoll(const char* s, size_t* idx, int base, int* err);
unsigned long long __strtoull(const char* s, size_t* idx, int base, int* err);
double __strtod(const char* s, size_t* idx, int* err);
inline void __stox_fail(const char* fn, int err) {
  if (err == 1) throw invalid_argument(fn);
  throw out_of_range(fn);
}
inline int stoi(const string& s, size_t* idx = 0, int base = 10) { int e = 0; long long v = __strtoll(s.c_str(), idx, base, &e); if (e == 0 && (v < -2147483647 - 1 || v > 2147483647)) e = 2; if (e) __stox_fail("stoi", e); return static_cast<int>(v); }
inline long stol(const string& s, size_t* idx = 0, int base = 10) { int e = 0; long long v = __strtoll(s.c_str(), idx, base, &e); if (e) __stox_fail("stol", e); return static_cast<long>(v); }
inline long long stoll(const string& s, size_t* idx = 0, int base = 10) { int e = 0; long long v = __strtoll(s.c_str(), idx, base, &e); if (e) __stox_fail("stoll", e); return v; }
inline unsigned long stoul(const string& s, size_t* idx = 0, int base = 10) { int e = 0; unsigned long long v = __strtoull(s.c_str(), idx, base, &e); if (e) __stox_fail("stoul", e); return static_cast<unsigned long>(v); }
inline unsigned long long stoull(const string& s, size_t* idx = 0, int base = 10) { int e = 0; unsigned long long v = __strtoull(s.c_str(), idx, base, &e); if (e) __stox_fail("stoull", e); return v; }
inline double stod(const string& s, size_t* idx = 0) { int e = 0; double v = __strtod(s.c_str(), idx, &e); if (e) __stox_fail("stod", e); return v; }
inline float stof(const string& s, size_t* idx = 0) { int e = 0; double v = __strtod(s.c_str(), idx, &e); if (e) __stox_fail("stof", e); return static_cast<float>(v); }
inline long double stold(const string& s, size_t* idx = 0) { int e = 0; double v = __strtod(s.c_str(), idx, &e); if (e) __stox_fail("stold", e); return v; }
}
