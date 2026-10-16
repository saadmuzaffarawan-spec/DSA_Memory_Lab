// <list>: doubly linked list. Node field order and the sentinel follow each platform's library.
namespace std {
struct __list_node_base {
#if defined(__APPLE__)
  __list_node_base* _prev;
  __list_node_base* _next;
#else
  __list_node_base* _next;
  __list_node_base* _prev;
#endif
};
template <class T> struct __list_node : __list_node_base { T _val; };

template <class T, class Ref, class Ptr> struct __list_iter {
  typedef bidirectional_iterator_tag iterator_category;
  typedef T value_type; typedef ptrdiff_t difference_type; typedef Ptr pointer; typedef Ref reference;
  __list_node_base* _n;
  __list_iter() : _n(0) {}
  explicit __list_iter(__list_node_base* n) : _n(n) {}
  template <class R2, class P2> __list_iter(const __list_iter<T, R2, P2>& o) : _n(o._n) {}
  reference operator*() const { return static_cast<__list_node<T>*>(_n)->_val; }
  pointer operator->() const { return &static_cast<__list_node<T>*>(_n)->_val; }
  __list_iter& operator++() { _n = _n->_next; return *this; }
  __list_iter operator++(int) { __list_iter t = *this; _n = _n->_next; return t; }
  __list_iter& operator--() { _n = _n->_prev; return *this; }
  __list_iter operator--(int) { __list_iter t = *this; _n = _n->_prev; return t; }
  bool operator==(const __list_iter& o) const { return _n == o._n; }
  bool operator!=(const __list_iter& o) const { return _n != o._n; }
};

template <class T>
class list {
 public:
  typedef T value_type;
  typedef T& reference;
  typedef const T& const_reference;
  typedef size_t size_type;
  typedef ptrdiff_t difference_type;
  typedef __list_iter<T, T&, T*> iterator;
  typedef __list_iter<T, const T&, const T*> const_iterator;
  typedef std::reverse_iterator<iterator> reverse_iterator;
  typedef std::reverse_iterator<const_iterator> const_reverse_iterator;
  typedef __list_node<T> _Node;

#if defined(_WIN32)
  void* _Myproxy;            // debug-iterator bookkeeping
  __list_node_base* _Myhead; // the sentinel lives on the heap
  size_t _Mysize;
  __list_node_base* _hd() const { return _Myhead; }
  size_t& _sz() { return _Mysize; }
  size_t _sz() const { return _Mysize; }
  void _init() {
    _Myproxy = __typed_new<_Container_proxy>(1);
    _Myhead = static_cast<__list_node_base*>(static_cast<void*>(__typed_new<_Node>(1)));
    _Myhead->_next = _Myhead; _Myhead->_prev = _Myhead; _Mysize = 0;
  }
  void _release() { ::operator delete(_Myhead); ::operator delete(_Myproxy); }
#else
  __list_node_base _M_node;  // the sentinel is part of the list object
  size_t _M_size;
  __list_node_base* _hd() const { return const_cast<__list_node_base*>(&_M_node); }
  size_t& _sz() { return _M_size; }
  size_t _sz() const { return _M_size; }
  void _init() { _M_node._next = &_M_node; _M_node._prev = &_M_node; _M_size = 0; }
  void _release() {}
#endif

  __list_node_base* _link(__list_node_base* pos, _Node* n) {
    n->_next = pos; n->_prev = pos->_prev; pos->_prev->_next = n; pos->_prev = n;
    ++_sz();
    return n;
  }
  template <class... A> __list_node_base* _make(__list_node_base* pos, A&&... a) {
    _Node* n = __typed_new<_Node>(1);
    ::new (static_cast<void*>(&n->_val)) T(std::forward<A>(a)...);
    return _link(pos, n);
  }
  void _unlink_destroy(__list_node_base* n) {
    n->_prev->_next = n->_next; n->_next->_prev = n->_prev;
    --_sz();
    _Node* x = static_cast<_Node*>(n);
    x->_val.~T();
    ::operator delete(x);
  }

  list() { _init(); }
  explicit list(size_type n) { _init(); for (size_type i = 0; i < n; ++i) _make(_hd()); }
  list(size_type n, const T& v) { _init(); for (size_type i = 0; i < n; ++i) _make(_hd(), v); }
  list(initializer_list<T> il) { _init(); for (const T* p = il.begin(); p != il.end(); ++p) _make(_hd(), *p); }
  list(const list& o) { _init(); for (const_iterator it = o.begin(); it != o.end(); ++it) _make(_hd(), *it); }
  list(list&& o) { _init(); swap(o); }
  template <class It, class = typename enable_if<!is_integral<It>::value>::type> list(It first, It last) { _init(); for (; first != last; ++first) _make(_hd(), *first); }
  ~list() { clear(); _release(); }
  list& operator=(const list& o) {
    if (this != &o) { iterator a = begin(); const_iterator b = o.begin(); for (; a != end() && b != o.end(); ++a, ++b) *a = *b; if (b == o.end()) erase(a, end()); else for (; b != o.end(); ++b) _make(_hd(), *b); }
    return *this;
  }
  list& operator=(list&& o) { if (this != &o) { clear(); swap(o); } return *this; }
  list& operator=(initializer_list<T> il) { clear(); for (const T* p = il.begin(); p != il.end(); ++p) _make(_hd(), *p); return *this; }
  void swap(list& o) {
    // exchange contents by relinking (sentinels are distinct objects on Linux/macOS)
#if defined(_WIN32)
    __list_node_base* h = _Myhead; _Myhead = o._Myhead; o._Myhead = h;
    size_t s = _Mysize; _Mysize = o._Mysize; o._Mysize = s;
#else
    __list_node_base* a1 = _M_node._next == &_M_node ? 0 : _M_node._next; __list_node_base* a2 = _M_node._prev;
    __list_node_base* b1 = o._M_node._next == &o._M_node ? 0 : o._M_node._next; __list_node_base* b2 = o._M_node._prev;
    size_t s = _M_size; _M_size = o._M_size; o._M_size = s;
    if (b1) { _M_node._next = b1; _M_node._prev = b2; b1->_prev = &_M_node; b2->_next = &_M_node; } else { _M_node._next = &_M_node; _M_node._prev = &_M_node; }
    if (a1) { o._M_node._next = a1; o._M_node._prev = a2; a1->_prev = &o._M_node; a2->_next = &o._M_node; } else { o._M_node._next = &o._M_node; o._M_node._prev = &o._M_node; }
#endif
  }

  iterator begin() { return iterator(_hd()->_next); }
  const_iterator begin() const { return const_iterator(_hd()->_next); }
  const_iterator cbegin() const { return const_iterator(_hd()->_next); }
  iterator end() { return iterator(_hd()); }
  const_iterator end() const { return const_iterator(_hd()); }
  const_iterator cend() const { return const_iterator(_hd()); }
  reverse_iterator rbegin() { return reverse_iterator(end()); }
  const_reverse_iterator rbegin() const { return const_reverse_iterator(end()); }
  reverse_iterator rend() { return reverse_iterator(begin()); }
  const_reverse_iterator rend() const { return const_reverse_iterator(begin()); }
  bool empty() const { return _sz() == 0; }
  size_type size() const { return _sz(); }
  size_type max_size() const { return 768614336404564650ul; }
  reference front() { return *begin(); }
  const_reference front() const { return *begin(); }
  reference back() { iterator e = end(); --e; return *e; }
  const_reference back() const { const_iterator e = end(); --e; return *e; }

  void push_back(const T& v) { _make(_hd(), v); }
  void push_back(T&& v) { _make(_hd(), std::move(v)); }
  void push_front(const T& v) { _make(_hd()->_next, v); }
  void push_front(T&& v) { _make(_hd()->_next, std::move(v)); }
  template <class... A> reference emplace_back(A&&... a) { __list_node_base* n = _make(_hd(), std::forward<A>(a)...); return *iterator(n); }
  template <class... A> reference emplace_front(A&&... a) { __list_node_base* n = _make(_hd()->_next, std::forward<A>(a)...); return *iterator(n); }
  template <class... A> iterator emplace(const_iterator pos, A&&... a) { return iterator(_make(pos._n, std::forward<A>(a)...)); }
  void pop_back() { _unlink_destroy(_hd()->_prev); }
  void pop_front() { _unlink_destroy(_hd()->_next); }
  iterator insert(const_iterator pos, const T& v) { return iterator(_make(pos._n, v)); }
  iterator insert(const_iterator pos, T&& v) { return iterator(_make(pos._n, std::move(v))); }
  iterator insert(const_iterator pos, size_type n, const T& v) { iterator r(pos._n); for (size_type i = 0; i < n; ++i) { iterator x(_make(pos._n, v)); if (i == 0) r = x; } return r; }
  template <class It, class = typename enable_if<!is_integral<It>::value>::type> iterator insert(const_iterator pos, It first, It last) { iterator r(pos._n); bool f = true; for (; first != last; ++first) { iterator x(_make(pos._n, *first)); if (f) { r = x; f = false; } } return r; }
  iterator insert(const_iterator pos, initializer_list<T> il) { return insert(pos, il.begin(), il.end()); }
  iterator erase(const_iterator pos) { __list_node_base* nx = pos._n->_next; _unlink_destroy(pos._n); return iterator(nx); }
  iterator erase(const_iterator first, const_iterator last) { while (first != last) { __list_node_base* n = first._n; ++first; _unlink_destroy(n); } return iterator(last._n); }
  void clear() { while (_sz() != 0) _unlink_destroy(_hd()->_next); }
  void resize(size_type n) { while (_sz() > n) pop_back(); while (_sz() < n) _make(_hd()); }
  void resize(size_type n, const T& v) { while (_sz() > n) pop_back(); while (_sz() < n) _make(_hd(), v); }
  void assign(size_type n, const T& v) { clear(); for (size_type i = 0; i < n; ++i) _make(_hd(), v); }
  template <class It, class = typename enable_if<!is_integral<It>::value>::type> void assign(It first, It last) { clear(); for (; first != last; ++first) _make(_hd(), *first); }

  // moves nodes [first, last) of `o` in front of `pos` without touching the elements
  void _transfer(__list_node_base* pos, __list_node_base* first, __list_node_base* last) {
    if (first == last) return;
    __list_node_base* before = first->_prev;
    __list_node_base* lastIn = last->_prev;
    before->_next = last; last->_prev = before;
    first->_prev = pos->_prev; pos->_prev->_next = first;
    lastIn->_next = pos; pos->_prev = lastIn;
  }
  void splice(const_iterator pos, list& o) { size_t n = o._sz(); _transfer(pos._n, o._hd()->_next, o._hd()); _sz() += n; o._sz() = 0; }
  void splice(const_iterator pos, list& o, const_iterator it) { __list_node_base* n = it._n; __list_node_base* nx = n->_next; _transfer(pos._n, n, nx); ++_sz(); --o._sz(); }
  void splice(const_iterator pos, list& o, const_iterator first, const_iterator last) { size_t n = 0; for (const_iterator i = first; i != last; ++i) ++n; _transfer(pos._n, first._n, last._n); _sz() += n; o._sz() -= n; }
  void remove(const T& v) { iterator it = begin(); while (it != end()) { if (*it == v) it = erase(it); else ++it; } }
  template <class P> void remove_if(P p) { iterator it = begin(); while (it != end()) { if (p(*it)) it = erase(it); else ++it; } }
  void unique() { iterator it = begin(); if (it == end()) return; iterator nx = it; ++nx; while (nx != end()) { if (*it == *nx) nx = erase(nx); else { it = nx; ++nx; } } }
  template <class P> void unique(P p) { iterator it = begin(); if (it == end()) return; iterator nx = it; ++nx; while (nx != end()) { if (p(*it, *nx)) nx = erase(nx); else { it = nx; ++nx; } } }
  void reverse() {
    __list_node_base* h = _hd(); __list_node_base* n = h;
    do { __list_node_base* t = n->_next; n->_next = n->_prev; n->_prev = t; n = t; } while (n != h);
  }
  template <class C> void merge(list& o, C comp) {
    if (this == &o) return;
    __list_node_base* a = _hd()->_next; __list_node_base* b = o._hd()->_next;
    size_t moved = o._sz();
    while (a != _hd() && b != o._hd()) {
      if (comp(static_cast<_Node*>(b)->_val, static_cast<_Node*>(a)->_val)) { __list_node_base* nb = b->_next; _transfer(a, b, nb); b = nb; }
      else a = a->_next;
    }
    if (b != o._hd()) _transfer(_hd(), b, o._hd());
    _sz() += moved; o._sz() = 0;
  }
  void merge(list& o) { merge(o, less<T>()); }
  template <class C> void sort(C comp) {
    if (_sz() < 2) return;
    list carry; list tmp[64]; int fill = 0;
    while (!empty()) {
      carry.splice(carry.begin(), *this, begin());
      int i = 0;
      while (i < fill && !tmp[i].empty()) { tmp[i].merge(carry, comp); carry.swap(tmp[i]); ++i; }
      carry.swap(tmp[i]);
      if (i == fill) ++fill;
    }
    for (int i = 1; i < fill; ++i) tmp[i].merge(tmp[i - 1], comp);
    swap(tmp[fill - 1]);
  }
  void sort() { sort(less<T>()); }
};
template <class T> bool operator==(const list<T>& a, const list<T>& b) { return a.size() == b.size() && equal(a.begin(), a.end(), b.begin()); }
template <class T> bool operator!=(const list<T>& a, const list<T>& b) { return !(a == b); }
}
