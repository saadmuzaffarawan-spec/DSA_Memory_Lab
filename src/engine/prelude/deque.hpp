// <deque>, <stack>, <queue>: libstdc++'s chunk-map model on Linux, a ring of fixed-size blocks (MSVC / libc++ style) elsewhere.
namespace std {
#if defined(_WIN32) || defined(__APPLE__)
template <class T> class deque;
template <class T, class Ref, class Ptr> struct __dq_iter {
  typedef random_access_iterator_tag iterator_category;
  typedef T value_type; typedef ptrdiff_t difference_type; typedef Ptr pointer; typedef Ref reference;
#if defined(_WIN32)
  const void* _Myproxy;
#endif
  const deque<T>* _Mycont;
  size_t _Myoff;
  __dq_iter() : _Mycont(0), _Myoff(0) {
#if defined(_WIN32)
    _Myproxy = 0;
#endif
  }
  __dq_iter(const deque<T>* c, size_t off) : _Mycont(c), _Myoff(off) {
#if defined(_WIN32)
    _Myproxy = 0;
#endif
  }
  template <class R2, class P2> __dq_iter(const __dq_iter<T, R2, P2>& o) : _Mycont(o._Mycont), _Myoff(o._Myoff) {
#if defined(_WIN32)
    _Myproxy = 0;
#endif
  }
  reference operator*() const { return _Mycont->_slot(_Myoff); }
  pointer operator->() const { return &_Mycont->_slot(_Myoff); }
  __dq_iter& operator++() { ++_Myoff; return *this; }
  __dq_iter operator++(int) { __dq_iter t = *this; ++_Myoff; return t; }
  __dq_iter& operator--() { --_Myoff; return *this; }
  __dq_iter operator--(int) { __dq_iter t = *this; --_Myoff; return t; }
  __dq_iter& operator+=(ptrdiff_t n) { _Myoff += n; return *this; }
  __dq_iter& operator-=(ptrdiff_t n) { _Myoff -= n; return *this; }
  __dq_iter operator+(ptrdiff_t n) const { __dq_iter t = *this; t._Myoff += n; return t; }
  __dq_iter operator-(ptrdiff_t n) const { __dq_iter t = *this; t._Myoff -= n; return t; }
  ptrdiff_t operator-(const __dq_iter& o) const { return static_cast<ptrdiff_t>(_Myoff) - static_cast<ptrdiff_t>(o._Myoff); }
  reference operator[](ptrdiff_t n) const { return _Mycont->_slot(_Myoff + n); }
  bool operator==(const __dq_iter& o) const { return _Myoff == o._Myoff; }
  bool operator!=(const __dq_iter& o) const { return _Myoff != o._Myoff; }
  bool operator<(const __dq_iter& o) const { return _Myoff < o._Myoff; }
  bool operator>(const __dq_iter& o) const { return _Myoff > o._Myoff; }
  bool operator<=(const __dq_iter& o) const { return _Myoff <= o._Myoff; }
  bool operator>=(const __dq_iter& o) const { return _Myoff >= o._Myoff; }
};

template <class T>
class deque {
 public:
  typedef T value_type;
  typedef T& reference;
  typedef const T& const_reference;
  typedef size_t size_type;
  typedef ptrdiff_t difference_type;
  typedef __dq_iter<T, T&, T*> iterator;
  typedef __dq_iter<T, const T&, const T*> const_iterator;
  typedef std::reverse_iterator<iterator> reverse_iterator;
  typedef std::reverse_iterator<const_iterator> const_reverse_iterator;
 private:
#if defined(_WIN32)
  void* _Myproxy;
  T** _Map;
  size_t _Mapsize;
  size_t _Myoff;
  size_t _Mysize;
  static size_t _bs() { return sizeof(T) <= 1 ? 16 : sizeof(T) <= 2 ? 8 : sizeof(T) <= 4 ? 4 : sizeof(T) <= 8 ? 2 : 1; }
#else
  // libc++: split-buffer of block pointers; modelled as a ring as well
  T** _Map;
  size_t _Mapsize;
  size_t _Myoff;
  size_t _Mysize;
  size_t _pad; size_t _pad2;
  static size_t _bs() { return sizeof(T) < 256 ? 4096 / sizeof(T) : 16; }
#endif
  T** _alloc_map(size_t n) { T** m = static_cast<T**>(::operator new(n * sizeof(T*))); for (size_t i = 0; i < n; ++i) m[i] = 0; return m; }
  static T* _alloc_block() { return static_cast<T*>(::operator new(_bs() * sizeof(T))); }
  void _grow_map() {
    size_t inc = _Mapsize == 0 ? 8 : _Mapsize;
    size_t nsz = _Mapsize + inc;
    T** nm = _alloc_map(nsz);
    if (_Mapsize) {
      size_t b0 = _Myoff / _bs();
      size_t nblocks = _Mysize ? ((_Myoff + _Mysize - 1) / _bs() - b0 + 1) : 0;
      for (size_t k = 0; k < nblocks; ++k) { size_t b = b0 + k; nm[b & (nsz - 1)] = _Map[b & (_Mapsize - 1)]; }
      ::operator delete(_Map);
    }
    _Map = nm; _Mapsize = nsz;
  }
  void _init() {
#if defined(_WIN32)
    _Myproxy = ::operator new(16);
#endif
    _Map = 0; _Mapsize = 0; _Myoff = 0; _Mysize = 0;
  }
 public:
  T& _slot(size_t off) const {
    size_t o = off & (_Mapsize * _bs() - 1);
    return _Map[o / _bs()][o % _bs()];
  }
 private:
  void _release_blocks() {
    if (_Mapsize) {
      size_t total = _Mapsize;
      for (size_t i = 0; i < total; ++i) if (_Map[i]) ::operator delete(_Map[i]);
      ::operator delete(_Map);
    }
    _Map = 0; _Mapsize = 0; _Myoff = 0; _Mysize = 0;
  }
  template <class... Args> void _emplace_back_impl(Args&&... args) {
    if ((_Myoff + _Mysize) % _bs() == 0 && _Mapsize <= (_Mysize + _bs()) / _bs()) _grow_map();
    _Myoff &= _Mapsize * _bs() - 1;
    size_t nw = _Myoff + _Mysize;
    size_t blk = (nw / _bs()) & (_Mapsize - 1);
    if (!_Map[blk]) _Map[blk] = _alloc_block();
    __construct(&_Map[blk][nw % _bs()], std::forward<Args>(args)...);
    ++_Mysize;
  }
  template <class... Args> void _emplace_front_impl(Args&&... args) {
    if (_Myoff % _bs() == 0 && _Mapsize <= (_Mysize + _bs()) / _bs()) _grow_map();
    _Myoff &= _Mapsize * _bs() - 1;
    size_t nw = _Myoff != 0 ? _Myoff : _Mapsize * _bs();
    size_t blk = ((nw - 1) / _bs()) & (_Mapsize - 1);
    if (!_Map[blk]) _Map[blk] = _alloc_block();
    __construct(&_Map[blk][(nw - 1) % _bs()], std::forward<Args>(args)...);
    _Myoff = nw - 1;
    ++_Mysize;
  }
 public:
  deque() { _init(); }
  explicit deque(size_t n) { _init(); for (size_t i = 0; i < n; ++i) _emplace_back_impl(); }
  deque(size_t n, const T& v) { _init(); for (size_t i = 0; i < n; ++i) _emplace_back_impl(v); }
  deque(const deque& o) { _init(); for (size_t i = 0; i < o._Mysize; ++i) _emplace_back_impl(o._slot(o._Myoff + i)); }
  deque(deque&& o) noexcept { _init(); swap(o); }
  deque(initializer_list<T> il) { _init(); for (const T* p = il.begin(); p != il.end(); ++p) _emplace_back_impl(*p); }
  template <class It, class = typename enable_if<!is_integral<It>::value>::type> deque(It a, It b) { _init(); for (; a != b; ++a) _emplace_back_impl(*a); }
  ~deque() { clear(); _release_blocks();
#if defined(_WIN32)
    if (_Myproxy) ::operator delete(_Myproxy);
#endif
  }
  deque& operator=(const deque& o) { if (this != &o) { clear(); for (size_t i = 0; i < o._Mysize; ++i) _emplace_back_impl(o._slot(o._Myoff + i)); } return *this; }
  deque& operator=(deque&& o) noexcept { if (this != &o) { clear(); _release_blocks(); swap(o); } return *this; }
  deque& operator=(initializer_list<T> il) { clear(); for (const T* p = il.begin(); p != il.end(); ++p) _emplace_back_impl(*p); return *this; }
  size_t size() const noexcept { return _Mysize; }
  bool empty() const noexcept { return _Mysize == 0; }
  size_t max_size() const noexcept { return static_cast<size_t>(0x7fffffffffffffffLL) / sizeof(T); }
  iterator begin() noexcept { return iterator(this, _Myoff); }
  const_iterator begin() const noexcept { return const_iterator(this, _Myoff); }
  const_iterator cbegin() const noexcept { return const_iterator(this, _Myoff); }
  iterator end() noexcept { return iterator(this, _Myoff + _Mysize); }
  const_iterator end() const noexcept { return const_iterator(this, _Myoff + _Mysize); }
  const_iterator cend() const noexcept { return const_iterator(this, _Myoff + _Mysize); }
  reverse_iterator rbegin() noexcept { return reverse_iterator(end()); }
  reverse_iterator rend() noexcept { return reverse_iterator(begin()); }
  const_reverse_iterator rbegin() const noexcept { return const_reverse_iterator(end()); }
  const_reverse_iterator rend() const noexcept { return const_reverse_iterator(begin()); }
  T& operator[](size_t i) {
#if defined(_WIN32)
    if (i >= _Mysize) __debug_assert("deque subscript out of range");
#endif
    return _slot(_Myoff + i);
  }
  const T& operator[](size_t i) const { return _slot(_Myoff + i); }
  T& at(size_t i) {
    if (i >= _Mysize) {
#if defined(_WIN32)
      throw out_of_range("invalid deque subscript");
#else
      throw out_of_range("deque");
#endif
    }
    return _slot(_Myoff + i);
  }
  const T& at(size_t i) const { return const_cast<deque*>(this)->at(i); }
  T& front() { return _slot(_Myoff); }
  const T& front() const { return _slot(_Myoff); }
  T& back() { return _slot(_Myoff + _Mysize - 1); }
  const T& back() const { return _slot(_Myoff + _Mysize - 1); }
  void push_back(const T& v) { _emplace_back_impl(v); }
  void push_back(T&& v) { _emplace_back_impl(std::move(v)); }
  void push_front(const T& v) { _emplace_front_impl(v); }
  void push_front(T&& v) { _emplace_front_impl(std::move(v)); }
  template <class... Args> T& emplace_back(Args&&... a) { _emplace_back_impl(std::forward<Args>(a)...); return back(); }
  template <class... Args> T& emplace_front(Args&&... a) { _emplace_front_impl(std::forward<Args>(a)...); return front(); }
  void pop_back() {
    size_t last = _Myoff + _Mysize - 1;
    _slot(last).~T();
    --_Mysize;
    if (_Mysize == 0) { /* keep blocks until clear/destroy, as MSVC does for the last one */ }
    if ((_Myoff + _Mysize) % _bs() == 0 && _Mysize != 0) {
      size_t blk = ((_Myoff + _Mysize) / _bs()) & (_Mapsize - 1);
      if (_Map[blk]) { ::operator delete(_Map[blk]); _Map[blk] = 0; }
    }
    if (_Mysize == 0) _Myoff = 0;
  }
  void pop_front() {
    _slot(_Myoff).~T();
    ++_Myoff; --_Mysize;
    if (_Myoff % _bs() == 0) {
      size_t blk = ((_Myoff - 1) / _bs()) & (_Mapsize - 1);
      if (_Map[blk] && (_Mysize != 0 || true)) { ::operator delete(_Map[blk]); _Map[blk] = 0; }
    }
    if (_Mysize == 0) _Myoff = 0;
  }
  void clear() noexcept {
    for (size_t i = 0; i < _Mysize; ++i) _slot(_Myoff + i).~T();
    if (_Mapsize) { for (size_t i = 0; i < _Mapsize; ++i) if (_Map[i]) { ::operator delete(_Map[i]); _Map[i] = 0; } }
    _Mysize = 0; _Myoff = 0;
  }
  void resize(size_t n) { while (_Mysize > n) pop_back(); while (_Mysize < n) _emplace_back_impl(); }
  void resize(size_t n, const T& v) { while (_Mysize > n) pop_back(); while (_Mysize < n) _emplace_back_impl(v); }
  void shrink_to_fit() {}
  void swap(deque& o) noexcept {
    T** m = _Map; _Map = o._Map; o._Map = m;
    size_t a = _Mapsize; _Mapsize = o._Mapsize; o._Mapsize = a;
    a = _Myoff; _Myoff = o._Myoff; o._Myoff = a;
    a = _Mysize; _Mysize = o._Mysize; o._Mysize = a;
  }
  iterator insert(const_iterator pos, const T& v) {
    size_t idx = pos._Myoff - _Myoff;
    push_back(v);
    for (size_t i = _Mysize - 1; i > idx; --i) std::swap(_slot(_Myoff + i), _slot(_Myoff + i - 1));
    return begin() + idx;
  }
  iterator erase(const_iterator pos) {
    size_t idx = pos._Myoff - _Myoff;
    for (size_t i = idx; i + 1 < _Mysize; ++i) _slot(_Myoff + i) = std::move(_slot(_Myoff + i + 1));
    pop_back();
    return begin() + idx;
  }
  void assign(size_t n, const T& v) { clear(); for (size_t i = 0; i < n; ++i) _emplace_back_impl(v); }
};

#else
// ---------------- libstdc++ model: a map of 512-byte nodes, iterators carry (cur, first, last, node) ----------------
template <class T> class deque;
template <class T, class Ref, class Ptr> struct __dq_iter {
  typedef random_access_iterator_tag iterator_category;
  typedef T value_type; typedef ptrdiff_t difference_type; typedef Ptr pointer; typedef Ref reference;
  T* _M_cur; T* _M_first; T* _M_last; T** _M_node;
  static size_t _bufsz() { return sizeof(T) < 512 ? 512 / sizeof(T) : 1; }
  __dq_iter() : _M_cur(0), _M_first(0), _M_last(0), _M_node(0) {}
  __dq_iter(T* x, T** y) : _M_cur(x), _M_first(*y), _M_last(*y + _bufsz()), _M_node(y) {}
  template <class R2, class P2> __dq_iter(const __dq_iter<T, R2, P2>& o) : _M_cur(o._M_cur), _M_first(o._M_first), _M_last(o._M_last), _M_node(o._M_node) {}
  void _set_node(T** n) { _M_node = n; _M_first = *n; _M_last = _M_first + static_cast<ptrdiff_t>(_bufsz()); }
  reference operator*() const { return *_M_cur; }
  pointer operator->() const { return _M_cur; }
  __dq_iter& operator++() { ++_M_cur; if (_M_cur == _M_last) { _set_node(_M_node + 1); _M_cur = _M_first; } return *this; }
  __dq_iter operator++(int) { __dq_iter t = *this; ++*this; return t; }
  __dq_iter& operator--() { if (_M_cur == _M_first) { _set_node(_M_node - 1); _M_cur = _M_last; } --_M_cur; return *this; }
  __dq_iter operator--(int) { __dq_iter t = *this; --*this; return t; }
  __dq_iter& operator+=(ptrdiff_t n) {
    ptrdiff_t off = n + (_M_cur - _M_first);
    ptrdiff_t bs = static_cast<ptrdiff_t>(_bufsz());
    if (off >= 0 && off < bs) _M_cur += n;
    else {
      ptrdiff_t nodeoff = off > 0 ? off / bs : -((-off - 1) / bs) - 1;
      _set_node(_M_node + nodeoff);
      _M_cur = _M_first + (off - nodeoff * bs);
    }
    return *this;
  }
  __dq_iter& operator-=(ptrdiff_t n) { return *this += -n; }
  __dq_iter operator+(ptrdiff_t n) const { __dq_iter t = *this; t += n; return t; }
  __dq_iter operator-(ptrdiff_t n) const { __dq_iter t = *this; t += -n; return t; }
  ptrdiff_t operator-(const __dq_iter& o) const {
    return static_cast<ptrdiff_t>(_bufsz()) * (_M_node - o._M_node - 1) + (_M_cur - _M_first) + (o._M_last - o._M_cur);
  }
  reference operator[](ptrdiff_t n) const { return *(*this + n); }
  bool operator==(const __dq_iter& o) const { return _M_cur == o._M_cur; }
  bool operator!=(const __dq_iter& o) const { return _M_cur != o._M_cur; }
  bool operator<(const __dq_iter& o) const { return (_M_node == o._M_node) ? (_M_cur < o._M_cur) : (_M_node < o._M_node); }
  bool operator>(const __dq_iter& o) const { return o < *this; }
  bool operator<=(const __dq_iter& o) const { return !(o < *this); }
  bool operator>=(const __dq_iter& o) const { return !(*this < o); }
};

template <class T>
class deque {
 public:
  typedef T value_type;
  typedef T& reference;
  typedef const T& const_reference;
  typedef size_t size_type;
  typedef ptrdiff_t difference_type;
  typedef __dq_iter<T, T&, T*> iterator;
  typedef __dq_iter<T, const T&, const T*> const_iterator;
  typedef std::reverse_iterator<iterator> reverse_iterator;
  typedef std::reverse_iterator<const_iterator> const_reverse_iterator;
 private:
  T** _M_map;
  size_t _M_map_size;
  iterator _M_start;
  iterator _M_finish;
  static size_t _bufsz() { return sizeof(T) < 512 ? 512 / sizeof(T) : 1; }
  static T* _alloc_node() { return static_cast<T*>(::operator new(_bufsz() * sizeof(T))); }
  static T** _alloc_map(size_t n) { return static_cast<T**>(::operator new(n * sizeof(T*))); }
  void _init_map(size_t num_elements) {
    size_t num_nodes = num_elements / _bufsz() + 1;
    _M_map_size = 8 > num_nodes + 2 ? 8 : num_nodes + 2;
    _M_map = _alloc_map(_M_map_size);
    T** nstart = _M_map + (_M_map_size - num_nodes) / 2;
    T** nfinish = nstart + num_nodes;
    for (T** cur = nstart; cur < nfinish; ++cur) *cur = _alloc_node();
    _M_start._set_node(nstart);
    _M_finish._set_node(nfinish - 1);
    _M_start._M_cur = _M_start._M_first;
    _M_finish._M_cur = _M_finish._M_first + num_elements % _bufsz();
  }
  void _reallocate_map(size_t nodes_to_add, bool add_at_front) {
    size_t old_num_nodes = _M_finish._M_node - _M_start._M_node + 1;
    size_t new_num_nodes = old_num_nodes + nodes_to_add;
    T** new_nstart;
    if (_M_map_size > 2 * new_num_nodes) {
      new_nstart = _M_map + (_M_map_size - new_num_nodes) / 2 + (add_at_front ? nodes_to_add : 0);
      if (new_nstart < _M_start._M_node) std::copy(_M_start._M_node, _M_finish._M_node + 1, new_nstart);
      else std::copy_backward(_M_start._M_node, _M_finish._M_node + 1, new_nstart + old_num_nodes);
    } else {
      size_t new_map_size = _M_map_size + (_M_map_size > nodes_to_add ? _M_map_size : nodes_to_add) + 2;
      T** new_map = _alloc_map(new_map_size);
      new_nstart = new_map + (new_map_size - new_num_nodes) / 2 + (add_at_front ? nodes_to_add : 0);
      std::copy(_M_start._M_node, _M_finish._M_node + 1, new_nstart);
      ::operator delete(_M_map);
      _M_map = new_map;
      _M_map_size = new_map_size;
    }
    _M_start._set_node(new_nstart);
    _M_finish._set_node(new_nstart + old_num_nodes - 1);
  }
  template <class... Args> void _push_back_aux(Args&&... args) {
    if (1 + 1 > _M_map_size - (_M_finish._M_node - _M_map)) _reallocate_map(1, false);
    *(_M_finish._M_node + 1) = _alloc_node();
    __construct(_M_finish._M_cur, std::forward<Args>(args)...);
    _M_finish._set_node(_M_finish._M_node + 1);
    _M_finish._M_cur = _M_finish._M_first;
  }
  template <class... Args> void _push_front_aux(Args&&... args) {
    if (1 > static_cast<size_t>(_M_start._M_node - _M_map)) _reallocate_map(1, true);
    *(_M_start._M_node - 1) = _alloc_node();
    _M_start._set_node(_M_start._M_node - 1);
    _M_start._M_cur = _M_start._M_last - 1;
    __construct(_M_start._M_cur, std::forward<Args>(args)...);
  }
  void _destroy_nodes_and_map() {
    for (T** n = _M_start._M_node; n < _M_finish._M_node + 1; ++n) ::operator delete(*n);
    ::operator delete(_M_map);
  }
 public:
  deque() { _init_map(0); }
  explicit deque(size_t n) { _init_map(n); for (size_t i = 0; i < n; ++i) emplace_back(); }
  deque(size_t n, const T& v) { _init_map(0); for (size_t i = 0; i < n; ++i) push_back(v); }
  deque(const deque& o) { _init_map(o.size()); iterator d = begin(); (void)d; _M_finish = _M_start; for (size_t i = 0; i < o.size(); ++i) push_back(o[i]); }
  deque(deque&& o) noexcept { _init_map(0); swap(o); }
  deque(initializer_list<T> il) { _init_map(0); for (const T* p = il.begin(); p != il.end(); ++p) push_back(*p); }
  template <class It, class = typename enable_if<!is_integral<It>::value>::type> deque(It a, It b) { _init_map(0); for (; a != b; ++a) push_back(*a); }
  ~deque() { clear(); _destroy_nodes_and_map(); }
  deque& operator=(const deque& o) { if (this != &o) { clear(); for (size_t i = 0; i < o.size(); ++i) push_back(o[i]); } return *this; }
  deque& operator=(deque&& o) noexcept { if (this != &o) { clear(); swap(o); } return *this; }
  deque& operator=(initializer_list<T> il) { clear(); for (const T* p = il.begin(); p != il.end(); ++p) push_back(*p); return *this; }
  size_t size() const noexcept { return _M_finish - _M_start; }
  bool empty() const noexcept { return _M_finish._M_cur == _M_start._M_cur; }
  size_t max_size() const noexcept { return static_cast<size_t>(0x7fffffffffffffffLL) / sizeof(T); }
  iterator begin() noexcept { return _M_start; }
  const_iterator begin() const noexcept { return const_iterator(_M_start); }
  const_iterator cbegin() const noexcept { return const_iterator(_M_start); }
  iterator end() noexcept { return _M_finish; }
  const_iterator end() const noexcept { return const_iterator(_M_finish); }
  const_iterator cend() const noexcept { return const_iterator(_M_finish); }
  reverse_iterator rbegin() noexcept { return reverse_iterator(end()); }
  reverse_iterator rend() noexcept { return reverse_iterator(begin()); }
  const_reverse_iterator rbegin() const noexcept { return const_reverse_iterator(end()); }
  const_reverse_iterator rend() const noexcept { return const_reverse_iterator(begin()); }
  T& operator[](size_t i) { return _M_start[static_cast<ptrdiff_t>(i)]; }
  const T& operator[](size_t i) const { return _M_start[static_cast<ptrdiff_t>(i)]; }
  T& at(size_t i) {
    if (i >= size()) {
      char buf[128];
      snprintf(buf, 128, "deque::_M_range_check: __n (which is %zu)>= this->size() (which is %zu)", i, size());
      throw out_of_range(buf);
    }
    return (*this)[i];
  }
  const T& at(size_t i) const { return const_cast<deque*>(this)->at(i); }
  T& front() { return *_M_start; }
  const T& front() const { return *_M_start; }
  T& back() { iterator t = _M_finish; --t; return *t; }
  const T& back() const { const_iterator t(_M_finish); --t; return *t; }
  void push_back(const T& v) {
    if (_M_finish._M_cur != _M_finish._M_last - 1) { __construct(_M_finish._M_cur, v); ++_M_finish._M_cur; }
    else _push_back_aux(v);
  }
  void push_back(T&& v) {
    if (_M_finish._M_cur != _M_finish._M_last - 1) { __construct(_M_finish._M_cur, std::move(v)); ++_M_finish._M_cur; }
    else _push_back_aux(std::move(v));
  }
  void push_front(const T& v) {
    if (_M_start._M_cur != _M_start._M_first) { __construct(_M_start._M_cur - 1, v); --_M_start._M_cur; }
    else _push_front_aux(v);
  }
  void push_front(T&& v) {
    if (_M_start._M_cur != _M_start._M_first) { __construct(_M_start._M_cur - 1, std::move(v)); --_M_start._M_cur; }
    else _push_front_aux(std::move(v));
  }
  template <class... Args> T& emplace_back(Args&&... args) {
    if (_M_finish._M_cur != _M_finish._M_last - 1) { __construct(_M_finish._M_cur, std::forward<Args>(args)...); ++_M_finish._M_cur; }
    else _push_back_aux(std::forward<Args>(args)...);
    return back();
  }
  template <class... Args> T& emplace_front(Args&&... args) {
    if (_M_start._M_cur != _M_start._M_first) { __construct(_M_start._M_cur - 1, std::forward<Args>(args)...); --_M_start._M_cur; }
    else _push_front_aux(std::forward<Args>(args)...);
    return front();
  }
  void pop_back() {
    if (_M_finish._M_cur != _M_finish._M_first) { --_M_finish._M_cur; _M_finish._M_cur->~T(); }
    else {
      ::operator delete(_M_finish._M_first);
      _M_finish._set_node(_M_finish._M_node - 1);
      _M_finish._M_cur = _M_finish._M_last - 1;
      _M_finish._M_cur->~T();
    }
  }
  void pop_front() {
    if (_M_start._M_cur != _M_start._M_last - 1) { _M_start._M_cur->~T(); ++_M_start._M_cur; }
    else {
      _M_start._M_cur->~T();
      ::operator delete(_M_start._M_first);
      _M_start._set_node(_M_start._M_node + 1);
      _M_start._M_cur = _M_start._M_first;
    }
  }
  void clear() noexcept {
    for (iterator it = _M_start; it != _M_finish; ++it) it._M_cur->~T();
    for (T** n = _M_start._M_node + 1; n < _M_finish._M_node + 1; ++n) ::operator delete(*n);
    if (_M_start._M_node != _M_finish._M_node) { _M_finish._M_first = _M_start._M_first; }
    _M_finish = _M_start;
  }
  void resize(size_t n) { while (size() > n) pop_back(); while (size() < n) emplace_back(); }
  void resize(size_t n, const T& v) { while (size() > n) pop_back(); while (size() < n) push_back(v); }
  void shrink_to_fit() {}
  void swap(deque& o) noexcept {
    T** m = _M_map; _M_map = o._M_map; o._M_map = m;
    size_t s = _M_map_size; _M_map_size = o._M_map_size; o._M_map_size = s;
    iterator a = _M_start; _M_start = o._M_start; o._M_start = a;
    iterator b = _M_finish; _M_finish = o._M_finish; o._M_finish = b;
  }
  iterator insert(const_iterator pos, const T& v) {
    ptrdiff_t idx = pos - const_iterator(_M_start);
    push_back(v);
    for (size_t i = size() - 1; i > static_cast<size_t>(idx); --i) std::swap((*this)[i], (*this)[i - 1]);
    return begin() + idx;
  }
  iterator erase(const_iterator pos) {
    ptrdiff_t idx = pos - const_iterator(_M_start);
    for (size_t i = idx; i + 1 < size(); ++i) (*this)[i] = std::move((*this)[i + 1]);
    pop_back();
    return begin() + idx;
  }
  void assign(size_t n, const T& v) { clear(); for (size_t i = 0; i < n; ++i) push_back(v); }
};
#endif

template <class T> inline bool operator==(const deque<T>& a, const deque<T>& b) { return a.size() == b.size() && std::equal(a.begin(), a.end(), b.begin()); }
template <class T> inline bool operator!=(const deque<T>& a, const deque<T>& b) { return !(a == b); }
template <class T> inline void swap(deque<T>& a, deque<T>& b) noexcept { a.swap(b); }

// ---- container adaptors ----
template <class T, class C = deque<T>>
class stack {
 public:
  typedef T value_type; typedef size_t size_type; typedef C container_type;
 protected:
  C c;
 public:
  stack() : c() {}
  explicit stack(const C& x) : c(x) {}
  bool empty() const { return c.empty(); }
  size_t size() const { return c.size(); }
  T& top() { return c.back(); }
  const T& top() const { return c.back(); }
  void push(const T& v) { c.push_back(v); }
  void push(T&& v) { c.push_back(std::move(v)); }
  template <class... A> void emplace(A&&... a) { c.emplace_back(std::forward<A>(a)...); }
  void pop() { c.pop_back(); }
  void swap(stack& o) { c.swap(o.c); }
};
template <class T, class C = deque<T>>
class queue {
 public:
  typedef T value_type; typedef size_t size_type; typedef C container_type;
 protected:
  C c;
 public:
  queue() : c() {}
  explicit queue(const C& x) : c(x) {}
  bool empty() const { return c.empty(); }
  size_t size() const { return c.size(); }
  T& front() { return c.front(); }
  const T& front() const { return c.front(); }
  T& back() { return c.back(); }
  const T& back() const { return c.back(); }
  void push(const T& v) { c.push_back(v); }
  void push(T&& v) { c.push_back(std::move(v)); }
  template <class... A> void emplace(A&&... a) { c.emplace_back(std::forward<A>(a)...); }
  void pop() { c.pop_front(); }
  void swap(queue& o) { c.swap(o.c); }
};

template <class T, class C = vector<T>, class Cmp = less<typename C::value_type>>
class priority_queue {
 public:
  typedef T value_type; typedef size_t size_type; typedef C container_type;
 protected:
  C c;
  Cmp comp;
 public:
  priority_queue() : c(), comp() {}
  explicit priority_queue(const Cmp& x) : c(), comp(x) {}
  priority_queue(const Cmp& x, const C& cc) : c(cc), comp(x) { std::make_heap(c.begin(), c.end(), comp); }
  template <class It> priority_queue(It a, It b) : c(a, b), comp() { std::make_heap(c.begin(), c.end(), comp); }
  template <class It> priority_queue(It a, It b, const Cmp& x) : c(a, b), comp(x) { std::make_heap(c.begin(), c.end(), comp); }
  bool empty() const { return c.empty(); }
  size_t size() const { return c.size(); }
  const T& top() const { return c.front(); }
  void push(const T& v) { c.push_back(v); std::push_heap(c.begin(), c.end(), comp); }
  void push(T&& v) { c.push_back(std::move(v)); std::push_heap(c.begin(), c.end(), comp); }
  template <class... A> void emplace(A&&... a) { c.emplace_back(std::forward<A>(a)...); std::push_heap(c.begin(), c.end(), comp); }
  void pop() { std::pop_heap(c.begin(), c.end(), comp); c.pop_back(); }
  void swap(priority_queue& o) { c.swap(o.c); std::swap(comp, o.comp); }
};
}
