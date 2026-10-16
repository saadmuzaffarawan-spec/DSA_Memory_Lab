// <map>, <set>: a red-black tree with each platform's node layout (libstdc++ _Rb_tree, MSVC _Tree with a heap-allocated sentinel, libc++ __tree).
namespace std {
#if defined(_WIN32)
// MSVC: left, parent, right, colour (char), isnil (char); null children are the sentinel node itself
struct __rb_base {
  __rb_base* left; __rb_base* parent; __rb_base* right; char color; char isnil;
};
template <class V> struct __rb_node {
  __rb_node* left; __rb_node* parent; __rb_node* right; char color; char isnil;
  V value;
};
#elif defined(__APPLE__)
// libc++: left, right, parent, is_black
struct __rb_base {
  __rb_base* left; __rb_base* right; __rb_base* parent; bool is_black;
};
template <class V> struct __rb_node : __rb_base { V value; };
#else
// libstdc++: colour (int, red = 0), parent, left, right
struct __rb_base {
  int color; __rb_base* parent; __rb_base* left; __rb_base* right;
};
template <class V> struct __rb_node : __rb_base { V value; };
#endif

template <class K, class V, class KeyOf, class Cmp, bool Unique>
class __rb_tree
#if defined(_WIN32) || defined(__APPLE__)
    : private Cmp   // empty-base optimisation: the comparator costs no bytes (MSVC/libc++ compress it)
#endif
{
 public:
  typedef V value_type;
  typedef __rb_node<V> node_type;
  typedef __rb_base* link_type;
 private:
#if defined(_WIN32)
  void* _Myproxy;
  link_type _Myhead;
  size_t _Mysize;
  link_type _nil() const { return _Myhead; }
  link_type _hdr() const { return _Myhead; }
  link_type _root() const { return _Myhead->parent; }
  void _set_root(link_type x) { _Myhead->parent = x; }
  link_type _leftmost() const { return _Myhead->left; }
  void _set_leftmost(link_type x) { _Myhead->left = x; }
  link_type _rightmost() const { return _Myhead->right; }
  void _set_rightmost(link_type x) { _Myhead->right = x; }
  static bool _red(link_type x) { return x->color == 0; }
  static void _set_red(link_type x) { x->color = 0; }
  static void _set_black(link_type x) { x->color = 1; }
  static void _copy_color(link_type to, link_type from) { to->color = from->color; }
  static bool _isnil(link_type x) { return x->isnil != 0; }
  static link_type _null(link_type) { return 0; }
#elif defined(__APPLE__)
  link_type _begin_node;
  link_type _end_left;     // libc++'s end node is just a `left` pointer; &_end_left doubles as the end() node
  size_t _size;
  link_type _nil() const { return 0; }
  link_type _hdr() const { return reinterpret_cast<link_type>(const_cast<link_type*>(&_end_left)); }
  link_type _root() const { return _end_left; }
  void _set_root(link_type x) { _end_left = x; }
  link_type _leftmost() const { return _begin_node; }
  void _set_leftmost(link_type x) { _begin_node = x; }
  link_type _rightmost() const { link_type x = _end_left; while (x && x->right) x = x->right; return x; }
  void _set_rightmost(link_type) {}
  static bool _red(link_type x) { return !x->is_black; }
  static void _set_red(link_type x) { x->is_black = false; }
  static void _set_black(link_type x) { x->is_black = true; }
  static void _copy_color(link_type to, link_type from) { to->is_black = from->is_black; }
  static bool _isnil(link_type x) { return x == 0; }
#else
  Cmp _M_key_compare;
  __rb_base _M_header;
  size_t _M_node_count;
  link_type _nil() const { return 0; }
  link_type _hdr() const { return const_cast<link_type>(&_M_header); }
  link_type _root() const { return _M_header.parent; }
  void _set_root(link_type x) { _M_header.parent = x; }
  link_type _leftmost() const { return _M_header.left; }
  void _set_leftmost(link_type x) { _M_header.left = x; }
  link_type _rightmost() const { return _M_header.right; }
  void _set_rightmost(link_type x) { _M_header.right = x; }
  static bool _red(link_type x) { return x->color == 0; }
  static void _set_red(link_type x) { x->color = 0; }
  static void _set_black(link_type x) { x->color = 1; }
  static void _copy_color(link_type to, link_type from) { to->color = from->color; }
  static bool _isnil(link_type x) { return x == 0; }
#endif
  size_t& _count() {
#if defined(_WIN32)
    return _Mysize;
#elif defined(__APPLE__)
    return _size;
#else
    return _M_node_count;
#endif
  }
  size_t _count() const {
#if defined(_WIN32)
    return _Mysize;
#elif defined(__APPLE__)
    return _size;
#else
    return _M_node_count;
#endif
  }
  const Cmp& _key_cmp() const {
#if defined(_WIN32) || defined(__APPLE__)
    return static_cast<const Cmp&>(*this);
#else
    return _M_key_compare;
#endif
  }
  static const K& _key(link_type x) { return KeyOf()(static_cast<node_type*>(static_cast<void*>(x))->value); }
  static V& _val(link_type x) { return static_cast<node_type*>(static_cast<void*>(x))->value; }
  bool _isleaf_null(link_type x) const { return x == _nil(); }

 public:
  // ---- iteration helpers (also used by the iterator class) ----
  static link_type _next(link_type x) {
#if defined(__APPLE__)
    if (x->right) { x = x->right; while (x->left) x = x->left; return x; }
    while (x != x->parent->left) x = x->parent;
    return x->parent;
#else
    if (!_isnil(x->right)) { x = x->right; while (!_isnil(x->left)) x = x->left; return x; }
    while (!_isnil(x->parent) && x == x->parent->right) x = x->parent;
    return x->parent;
#endif
  }
  static link_type _prev(link_type x) {
#if defined(__APPLE__)
    if (x->left) { x = x->left; while (x->right) x = x->right; return x; }
    while (x == x->parent->left) x = x->parent;
    return x->parent;
#elif defined(_WIN32)
    if (_isnil(x)) return x->right;
    if (!_isnil(x->left)) { x = x->left; while (!_isnil(x->right)) x = x->right; return x; }
    while (!_isnil(x->parent) && x == x->parent->left) x = x->parent;
    return _isnil(x->parent) ? x : x->parent;
#else
    if (x->color == 0 && x->parent->parent == x) return x->right;   // end() -> rightmost
    if (x->left) { x = x->left; while (x->right) x = x->right; return x; }
    link_type y = x->parent;
    while (x == y->left) { x = y; y = y->parent; }
    return y;
#endif
  }

  struct iterator {
    typedef bidirectional_iterator_tag iterator_category;
    typedef V value_type; typedef ptrdiff_t difference_type; typedef V* pointer; typedef V& reference;
    link_type _node;
    iterator() : _node(0) {}
    explicit iterator(link_type n) : _node(n) {}
    V& operator*() const { return __rb_tree<K, V, KeyOf, Cmp, Unique>::_val(_node); }
    V* operator->() const { return &__rb_tree<K, V, KeyOf, Cmp, Unique>::_val(_node); }
    iterator& operator++() { _node = __rb_tree<K, V, KeyOf, Cmp, Unique>::_next(_node); return *this; }
    iterator operator++(int) { iterator t = *this; _node = __rb_tree<K, V, KeyOf, Cmp, Unique>::_next(_node); return t; }
    iterator& operator--() { _node = __rb_tree<K, V, KeyOf, Cmp, Unique>::_prev(_node); return *this; }
    iterator operator--(int) { iterator t = *this; _node = __rb_tree<K, V, KeyOf, Cmp, Unique>::_prev(_node); return t; }
    bool operator==(const iterator& o) const { return _node == o._node; }
    bool operator!=(const iterator& o) const { return _node != o._node; }
  };
  struct const_iterator {
    typedef bidirectional_iterator_tag iterator_category;
    typedef V value_type; typedef ptrdiff_t difference_type; typedef const V* pointer; typedef const V& reference;
    link_type _node;
    const_iterator() : _node(0) {}
    explicit const_iterator(link_type n) : _node(n) {}
    const_iterator(const iterator& it) : _node(it._node) {}
    const V& operator*() const { return __rb_tree<K, V, KeyOf, Cmp, Unique>::_val(_node); }
    const V* operator->() const { return &__rb_tree<K, V, KeyOf, Cmp, Unique>::_val(_node); }
    const_iterator& operator++() { _node = __rb_tree<K, V, KeyOf, Cmp, Unique>::_next(_node); return *this; }
    const_iterator operator++(int) { const_iterator t = *this; _node = __rb_tree<K, V, KeyOf, Cmp, Unique>::_next(_node); return t; }
    const_iterator& operator--() { _node = __rb_tree<K, V, KeyOf, Cmp, Unique>::_prev(_node); return *this; }
    const_iterator operator--(int) { const_iterator t = *this; _node = __rb_tree<K, V, KeyOf, Cmp, Unique>::_prev(_node); return t; }
    bool operator==(const const_iterator& o) const { return _node == o._node; }
    bool operator!=(const const_iterator& o) const { return _node != o._node; }
  };
  typedef std::reverse_iterator<iterator> reverse_iterator;
  typedef std::reverse_iterator<const_iterator> const_reverse_iterator;

 private:
  void _rotate_left(link_type x) {
    link_type y = x->right;
    x->right = y->left;
    if (!_isnil(y->left)) y->left->parent = x;
    y->parent = x->parent;
    if (x == _root()) _set_root(y);
    else if (x == x->parent->left) x->parent->left = y;
    else x->parent->right = y;
    y->left = x;
    x->parent = y;
  }
  void _rotate_right(link_type x) {
    link_type y = x->left;
    x->left = y->right;
    if (!_isnil(y->right)) y->right->parent = x;
    y->parent = x->parent;
    if (x == _root()) _set_root(y);
    else if (x == x->parent->right) x->parent->right = y;
    else x->parent->left = y;
    y->right = x;
    x->parent = y;
  }
  void _insert_and_rebalance(bool insert_left, link_type x, link_type p) {
    link_type nil = _nil();
    x->parent = p;
    x->left = nil;
    x->right = nil;
    _set_red(x);
#if defined(_WIN32)
    x->isnil = 0;
#endif
    if (insert_left) {
      p->left = x;
      if (p == _hdr()) { _set_root(x); _set_rightmost(x); _set_leftmost(x); }
      else if (p == _leftmost()) _set_leftmost(x);
    } else {
      p->right = x;
      if (p == _rightmost()) _set_rightmost(x);
    }
    while (x != _root() && _red(x->parent)) {
      link_type xpp = x->parent->parent;
      if (x->parent == xpp->left) {
        link_type y = xpp->right;
        if (!_isnil(y) && _red(y)) { _set_black(x->parent); _set_black(y); _set_red(xpp); x = xpp; }
        else {
          if (x == x->parent->right) { x = x->parent; _rotate_left(x); }
          _set_black(x->parent); _set_red(xpp); _rotate_right(xpp);
        }
      } else {
        link_type y = xpp->left;
        if (!_isnil(y) && _red(y)) { _set_black(x->parent); _set_black(y); _set_red(xpp); x = xpp; }
        else {
          if (x == x->parent->left) { x = x->parent; _rotate_right(x); }
          _set_black(x->parent); _set_red(xpp); _rotate_left(xpp);
        }
      }
    }
    _set_black(_root());
  }
  static link_type _minimum(link_type x) { while (!_isnil(x->left)) x = x->left; return x; }
  static link_type _maximum(link_type x) { while (!_isnil(x->right)) x = x->right; return x; }
  bool _is_black_or_nil(link_type x) const { return _isnil(x) || !_red(x); }
  void _swap_colors(link_type a, link_type b) {
    bool ra = _red(a), rb = _red(b);
    if (rb) _set_red(a); else _set_black(a);
    if (ra) _set_red(b); else _set_black(b);
  }
  // returns the node to unlink (z)
  link_type _rebalance_for_erase(link_type z) {
    link_type nil = _nil();
    link_type root = _root();
    link_type leftmost = _leftmost();
    link_type rightmost = _rightmost();
    link_type y = z;
    link_type x = nil;
    link_type x_parent = nil;
    if (_isnil(y->left)) x = y->right;
    else if (_isnil(y->right)) x = y->left;
    else { y = y->right; while (!_isnil(y->left)) y = y->left; x = y->right; }
    if (y != z) {
      z->left->parent = y;
      y->left = z->left;
      if (y != z->right) {
        x_parent = y->parent;
        if (!_isnil(x)) x->parent = y->parent;
        y->parent->left = x;
        y->right = z->right;
        z->right->parent = y;
      } else x_parent = y;
      if (root == z) root = y;
      else if (z->parent->left == z) z->parent->left = y;
      else z->parent->right = y;
      y->parent = z->parent;
      _swap_colors(y, z);
      y = z;
    } else {
      x_parent = y->parent;
      if (!_isnil(x)) x->parent = y->parent;
      if (root == z) root = x;
      else if (z->parent->left == z) z->parent->left = x;
      else z->parent->right = x;
      if (leftmost == z) { if (_isnil(z->right)) leftmost = z->parent; else leftmost = _minimum(x); }
      if (rightmost == z) { if (_isnil(z->left)) rightmost = z->parent; else rightmost = _maximum(x); }
    }
    if (!_red(y)) {
      while (x != root && _is_black_or_nil(x)) {
        if (x == x_parent->left) {
          link_type w = x_parent->right;
          if (_red(w)) { _set_black(w); _set_red(x_parent); _set_root(root); _rotate_left(x_parent); root = _root(); w = x_parent->right; }
          if (_is_black_or_nil(w->left) && _is_black_or_nil(w->right)) { _set_red(w); x = x_parent; x_parent = x_parent->parent; }
          else {
            if (_is_black_or_nil(w->right)) { _set_black(w->left); _set_red(w); _set_root(root); _rotate_right(w); root = _root(); w = x_parent->right; }
            _copy_color(w, x_parent); _set_black(x_parent);
            if (!_isnil(w->right)) _set_black(w->right);
            _set_root(root); _rotate_left(x_parent); root = _root();
            break;
          }
        } else {
          link_type w = x_parent->left;
          if (_red(w)) { _set_black(w); _set_red(x_parent); _set_root(root); _rotate_right(x_parent); root = _root(); w = x_parent->left; }
          if (_is_black_or_nil(w->right) && _is_black_or_nil(w->left)) { _set_red(w); x = x_parent; x_parent = x_parent->parent; }
          else {
            if (_is_black_or_nil(w->left)) { _set_black(w->right); _set_red(w); _set_root(root); _rotate_left(w); root = _root(); w = x_parent->left; }
            _copy_color(w, x_parent); _set_black(x_parent);
            if (!_isnil(w->left)) _set_black(w->left);
            _set_root(root); _rotate_right(x_parent); root = _root();
            break;
          }
        }
      }
      if (!_isnil(x)) _set_black(x);
    }
    _set_root(root);
    _set_leftmost(leftmost);
    _set_rightmost(rightmost);
    return y;
  }

  link_type _new_node_raw() { return static_cast<link_type>(static_cast<void*>(__typed_new<node_type>(1))); }
  template <class... Args> link_type _create_node(Args&&... args) {
    link_type n = _new_node_raw();
#if defined(_WIN32)
    n->isnil = 0;
#endif
    __construct(&_val(n), std::forward<Args>(args)...);
    return n;
  }
  void _drop_node(link_type n) { _val(n).~V(); ::operator delete(static_cast<void*>(n)); }

  void _init() {
#if defined(_WIN32)
    _Myproxy = __typed_new<_Container_proxy>(1);
    _Myhead = _new_node_raw();
    _Myhead->left = _Myhead; _Myhead->parent = _Myhead; _Myhead->right = _Myhead;
    _Myhead->color = 1; _Myhead->isnil = 1;
    _Mysize = 0;
#elif defined(__APPLE__)
    _end_left = 0;
    _begin_node = _hdr();
    _size = 0;
#else
    _M_header.color = 0;
    _M_header.parent = 0;
    _M_header.left = &_M_header;
    _M_header.right = &_M_header;
    _M_node_count = 0;
#endif
  }
  // libstdc++/MSVC: right subtree first, then the node, then loop left;  libc++: left, right, node
  void _erase_subtree(link_type x) {
#if defined(__APPLE__)
    if (x) { _erase_subtree(x->left); _erase_subtree(x->right); _drop_node(x); }
#else
    while (!_isnil(x)) {
      _erase_subtree(x->right);
      link_type y = x->left;
      _drop_node(x);
      x = y;
    }
#endif
  }
  link_type _clone(link_type x, link_type p) {
    link_type top = _create_node(_val(x));
    _copy_color(top, x);
    top->parent = p;
    top->left = _nil(); top->right = _nil();
    if (!_isnil(x->right)) top->right = _clone(x->right, top);
    p = top;
    x = x->left;
    while (!_isnil(x)) {
      link_type y = _create_node(_val(x));
      _copy_color(y, x);
      p->left = y;
      y->parent = p;
      y->left = _nil(); y->right = _nil();
      if (!_isnil(x->right)) y->right = _clone(x->right, y);
      p = y;
      x = x->left;
    }
    return top;
  }

 public:
  __rb_tree() { _init(); }
  explicit __rb_tree(const Cmp& c) {
    _init();
#if defined(_WIN32) || defined(__APPLE__)
    static_cast<Cmp&>(*this) = c;
#else
    _M_key_compare = c;
#endif
  }
  __rb_tree(const __rb_tree& o) {
    _init();
#if defined(_WIN32) || defined(__APPLE__)
    static_cast<Cmp&>(*this) = static_cast<const Cmp&>(o);
#else
    _M_key_compare = o._M_key_compare;
#endif
    if (!_isnil(o._root())) {
      link_type r = _clone(o._root(), _hdr());
      _set_root(r);
      _set_leftmost(_minimum(r));
      _set_rightmost(_maximum(r));
      _count() = o._count();
    }
  }
  __rb_tree(__rb_tree&& o) noexcept { _init(); swap(o); }
  ~__rb_tree() {
    _erase_subtree(_root());
#if defined(_WIN32)
    ::operator delete(static_cast<void*>(_Myhead));
    ::operator delete(_Myproxy);
#endif
  }
  __rb_tree& operator=(const __rb_tree& o) {
    if (this != &o) {
      clear();
      if (!_isnil(o._root())) {
        link_type r = _clone(o._root(), _hdr());
        _set_root(r);
        _set_leftmost(_minimum(r));
        _set_rightmost(_maximum(r));
        _count() = o._count();
      }
    }
    return *this;
  }
  __rb_tree& operator=(__rb_tree&& o) noexcept { if (this != &o) { clear(); swap(o); } return *this; }

  void swap(__rb_tree& o) noexcept {
    // exchange contents by moving the node graphs
    link_type r1 = _root(), r2 = o._root();
    size_t c1 = _count(), c2 = o._count();
    link_type l1 = _leftmost(), l2 = o._leftmost(), m1 = _rightmost(), m2 = o._rightmost();
    bool e1 = _isnil(r1), e2 = _isnil(r2);
#if defined(_WIN32)
    link_type h = _Myhead; _Myhead = o._Myhead; o._Myhead = h;
#else
    _adopt(e2 ? _nil() : r2, l2, m2, c2, e2);
    o._adopt(e1 ? o._nil() : r1, l1, m1, c1, e1);
#endif
    (void)l1; (void)l2; (void)m1; (void)m2; (void)c1; (void)c2; (void)e1; (void)e2;
  }
 private:
  void _adopt(link_type r, link_type l, link_type m, size_t c, bool empty) {
#if !defined(_WIN32)
    if (empty) {
      _set_root(_nil());
#if defined(__APPLE__)
      _begin_node = _hdr();
#else
      _M_header.left = &_M_header; _M_header.right = &_M_header;
#endif
    } else {
      _set_root(r); r->parent = _hdr();
      _set_leftmost(l); _set_rightmost(m);
    }
    _count() = c;
#endif
    (void)r; (void)l; (void)m; (void)c; (void)empty;
  }
 public:
  void clear() {
    _erase_subtree(_root());
#if defined(_WIN32)
    _Myhead->parent = _Myhead; _Myhead->left = _Myhead; _Myhead->right = _Myhead;
    _Mysize = 0;
#elif defined(__APPLE__)
    _end_left = 0; _begin_node = _hdr(); _size = 0;
#else
    _M_header.parent = 0; _M_header.left = &_M_header; _M_header.right = &_M_header; _M_node_count = 0;
#endif
  }
  size_t size() const { return _count(); }
  bool empty() const { return _count() == 0; }
  size_t max_size() const { return static_cast<size_t>(0x7fffffffffffffffLL) / sizeof(node_type); }
  const Cmp& key_comp() const { return _key_cmp(); }

  iterator begin() { return iterator(_leftmost()); }
  const_iterator begin() const { return const_iterator(_leftmost()); }
  iterator end() { return iterator(_hdr()); }
  const_iterator end() const { return const_iterator(_hdr()); }

  iterator lower_bound(const K& k) {
    link_type x = _root(), y = _hdr();
    while (!_isnil(x)) { if (!_key_cmp()(_key(x), k)) { y = x; x = x->left; } else x = x->right; }
    return iterator(y);
  }
  const_iterator lower_bound(const K& k) const { return const_iterator(const_cast<__rb_tree*>(this)->lower_bound(k)); }
  iterator upper_bound(const K& k) {
    link_type x = _root(), y = _hdr();
    while (!_isnil(x)) { if (_key_cmp()(k, _key(x))) { y = x; x = x->left; } else x = x->right; }
    return iterator(y);
  }
  const_iterator upper_bound(const K& k) const { return const_iterator(const_cast<__rb_tree*>(this)->upper_bound(k)); }
  iterator find(const K& k) {
    iterator j = lower_bound(k);
    return (j == end() || _key_cmp()(k, _key(j._node))) ? end() : j;
  }
  const_iterator find(const K& k) const { return const_iterator(const_cast<__rb_tree*>(this)->find(k)); }
  size_t count(const K& k) const {
    const_iterator a = lower_bound(k), b = upper_bound(k);
    size_t n = 0; for (; a != b; ++a) ++n;
    return n;
  }

  // insertion; for unique trees returns (position, inserted)
  template <class... Args> pair<iterator, bool> emplace_unique(Args&&... args) {
    link_type z = _create_node(std::forward<Args>(args)...);
    const K& k = _key(z);
    link_type x = _root(), y = _hdr();
    bool comp = true;
    while (!_isnil(x)) { y = x; comp = _key_cmp()(k, _key(x)); x = comp ? x->left : x->right; }
    iterator j(y);
    if (comp) {
      if (j == begin()) return _do_insert(x, y, z);
      --j;
    }
    if (_key_cmp()(_key(j._node), k)) return _do_insert(x, y, z);
    _drop_node(z);
    return pair<iterator, bool>(j, false);
  }
  template <class... Args> iterator emplace_equal(Args&&... args) {
    link_type z = _create_node(std::forward<Args>(args)...);
    const K& k = _key(z);
    link_type x = _root(), y = _hdr();
    while (!_isnil(x)) { y = x; x = _key_cmp()(k, _key(x)) ? x->left : x->right; }
    bool left = (y == _hdr()) || _key_cmp()(k, _key(y));
    _insert_and_rebalance(left, z, y);
    ++_count();
    return iterator(z);
  }
  // create the node only if the key is absent (try_emplace / operator[])
  template <class... Args> pair<iterator, bool> emplace_unique_key(const K& k, Args&&... args) {
    link_type x = _root(), y = _hdr();
    bool comp = true;
    while (!_isnil(x)) { y = x; comp = _key_cmp()(k, _key(x)); x = comp ? x->left : x->right; }
    iterator j(y);
    if (comp) {
      if (j != begin()) --j;
      else { link_type z = _create_node(std::forward<Args>(args)...); return _do_insert(x, y, z); }
    }
    if (_key_cmp()(_key(j._node), k)) { link_type z = _create_node(std::forward<Args>(args)...); return _do_insert(x, y, z); }
    return pair<iterator, bool>(j, false);
  }
 private:
  pair<iterator, bool> _do_insert(link_type x, link_type p, link_type z) {
    bool left = (!_isnil(x)) || (p == _hdr()) || _key_cmp()(_key(z), _key(p));
    _insert_and_rebalance(left, z, p);
    ++_count();
    return pair<iterator, bool>(iterator(z), true);
  }
 public:
  iterator erase(const_iterator pos) {
    link_type n = pos._node;
    link_type nx = _next(n);
    link_type y = _rebalance_for_erase(n);
    _drop_node(y);
    --_count();
    return iterator(nx);
  }
  size_t erase(const K& k) {
    const_iterator a = lower_bound(k), b = upper_bound(k);
    size_t n = 0;
    while (a != b) { const_iterator t = a; ++a; erase(t); ++n; }
    return n;
  }
  iterator erase(const_iterator a, const_iterator b) {
    if (a == begin() && b == end()) { clear(); return end(); }
    while (a != b) { const_iterator t = a; ++a; erase(t); }
    return iterator(b._node);
  }
};

template <class T> struct __identity_key { const T& operator()(const T& x) const { return x; } };
template <class P> struct __select1st { const typename P::first_type& operator()(const P& x) const { return x.first; } };

// -------------------------------------------------------------------------------------------------------------------------------
template <class K, class T, class Cmp = less<K>>
class map {
 public:
  typedef K key_type; typedef T mapped_type; typedef pair<const K, T> value_type; typedef Cmp key_compare;
  typedef size_t size_type; typedef ptrdiff_t difference_type;
  typedef value_type& reference; typedef const value_type& const_reference;
 private:
  typedef __rb_tree<K, value_type, __select1st<value_type>, Cmp, true> tree_type;
  tree_type _t;
 public:
  typedef typename tree_type::iterator iterator;
  typedef typename tree_type::const_iterator const_iterator;
  typedef typename tree_type::reverse_iterator reverse_iterator;
  typedef typename tree_type::const_reverse_iterator const_reverse_iterator;
  map() : _t() {}
  explicit map(const Cmp& c) : _t(c) {}
  map(const map& o) : _t(o._t) {}
  map(map&& o) noexcept : _t(std::move(o._t)) {}
  map(initializer_list<value_type> il) : _t() { for (const value_type* p = il.begin(); p != il.end(); ++p) _t.emplace_unique(*p); }
  template <class It, class = typename enable_if<!is_integral<It>::value>::type> map(It a, It b) : _t() { for (; a != b; ++a) _t.emplace_unique(*a); }
  map& operator=(const map& o) { _t = o._t; return *this; }
  map& operator=(map&& o) noexcept { _t = std::move(o._t); return *this; }
  map& operator=(initializer_list<value_type> il) { _t.clear(); for (const value_type* p = il.begin(); p != il.end(); ++p) _t.emplace_unique(*p); return *this; }
  iterator begin() { return _t.begin(); }
  const_iterator begin() const { return _t.begin(); }
  const_iterator cbegin() const { return _t.begin(); }
  iterator end() { return _t.end(); }
  const_iterator end() const { return _t.end(); }
  const_iterator cend() const { return _t.end(); }
  reverse_iterator rbegin() { return reverse_iterator(end()); }
  reverse_iterator rend() { return reverse_iterator(begin()); }
  const_reverse_iterator rbegin() const { return const_reverse_iterator(end()); }
  const_reverse_iterator rend() const { return const_reverse_iterator(begin()); }
  bool empty() const { return _t.empty(); }
  size_t size() const { return _t.size(); }
  size_t max_size() const { return _t.max_size(); }
  T& operator[](const K& k) {
    pair<iterator, bool> r = _t.emplace_unique_key(k, piecewise_construct_t(), k);
    return r.first->second;
  }
  T& operator[](K&& k) {
    pair<iterator, bool> r = _t.emplace_unique_key(k, piecewise_construct_t(), std::move(k));
    return r.first->second;
  }
  T& at(const K& k) {
    iterator i = _t.find(k);
    if (i == _t.end()) {
#if defined(_WIN32)
      throw out_of_range("invalid map<K, T> key");
#elif defined(__APPLE__)
      throw out_of_range("map::at:  key not found");
#else
      throw out_of_range("map::at");
#endif
    }
    return i->second;
  }
  const T& at(const K& k) const { return const_cast<map*>(this)->at(k); }
  pair<iterator, bool> insert(const value_type& v) { return _t.emplace_unique(v); }
  pair<iterator, bool> insert(value_type&& v) { return _t.emplace_unique(std::move(v)); }
  template <class P, class = typename enable_if<!is_same<typename remove_cv<typename remove_reference<P>::type>::type, value_type>::value>::type> pair<iterator, bool> insert(P&& v) { return _t.emplace_unique(std::forward<P>(v)); }
  iterator insert(const_iterator, const value_type& v) { return _t.emplace_unique(v).first; }
  void insert(initializer_list<value_type> il) { for (const value_type* p = il.begin(); p != il.end(); ++p) _t.emplace_unique(*p); }
  template <class It, class = typename enable_if<!is_integral<It>::value>::type> void insert(It a, It b) { for (; a != b; ++a) _t.emplace_unique(*a); }
  template <class... Args> pair<iterator, bool> emplace(Args&&... args) { return _t.emplace_unique(std::forward<Args>(args)...); }
  template <class... Args> pair<iterator, bool> try_emplace(const K& k, Args&&... args) { return _t.emplace_unique_key(k, piecewise_construct_t(), k, std::forward<Args>(args)...); }
  template <class M> pair<iterator, bool> insert_or_assign(const K& k, M&& m) {
    pair<iterator, bool> r = _t.emplace_unique_key(k, k, std::forward<M>(m));
    if (!r.second) r.first->second = std::forward<M>(m);
    return r;
  }
  iterator erase(const_iterator p) { return _t.erase(p); }
  iterator erase(iterator p) { return _t.erase(const_iterator(p)); }
  size_t erase(const K& k) { return _t.erase(k); }
  iterator erase(const_iterator a, const_iterator b) { return _t.erase(a, b); }
  void clear() { _t.clear(); }
  void swap(map& o) { _t.swap(o._t); }
  iterator find(const K& k) { return _t.find(k); }
  const_iterator find(const K& k) const { return _t.find(k); }
  size_t count(const K& k) const { return _t.find(k) == _t.end() ? 0 : 1; }
  bool contains(const K& k) const { return _t.find(k) != _t.end(); }
  iterator lower_bound(const K& k) { return _t.lower_bound(k); }
  const_iterator lower_bound(const K& k) const { return _t.lower_bound(k); }
  iterator upper_bound(const K& k) { return _t.upper_bound(k); }
  const_iterator upper_bound(const K& k) const { return _t.upper_bound(k); }
  pair<iterator, iterator> equal_range(const K& k) { return pair<iterator, iterator>(_t.lower_bound(k), _t.upper_bound(k)); }
  Cmp key_comp() const { return _t.key_comp(); }
};
template <class K, class T, class C> bool operator==(const map<K, T, C>& a, const map<K, T, C>& b) { return a.size() == b.size() && std::equal(a.begin(), a.end(), b.begin()); }
template <class K, class T, class C> bool operator!=(const map<K, T, C>& a, const map<K, T, C>& b) { return !(a == b); }

template <class K, class T, class Cmp = less<K>>
class multimap {
 public:
  typedef K key_type; typedef T mapped_type; typedef pair<const K, T> value_type; typedef Cmp key_compare;
 private:
  typedef __rb_tree<K, value_type, __select1st<value_type>, Cmp, false> tree_type;
  tree_type _t;
 public:
  typedef typename tree_type::iterator iterator;
  typedef typename tree_type::const_iterator const_iterator;
  typedef typename tree_type::reverse_iterator reverse_iterator;
  multimap() : _t() {}
  multimap(initializer_list<value_type> il) : _t() { for (const value_type* p = il.begin(); p != il.end(); ++p) _t.emplace_equal(*p); }
  iterator begin() { return _t.begin(); }
  const_iterator begin() const { return _t.begin(); }
  iterator end() { return _t.end(); }
  const_iterator end() const { return _t.end(); }
  reverse_iterator rbegin() { return reverse_iterator(end()); }
  reverse_iterator rend() { return reverse_iterator(begin()); }
  bool empty() const { return _t.empty(); }
  size_t size() const { return _t.size(); }
  iterator insert(const value_type& v) { return _t.emplace_equal(v); }
  template <class... Args> iterator emplace(Args&&... args) { return _t.emplace_equal(std::forward<Args>(args)...); }
  iterator erase(const_iterator p) { return _t.erase(p); }
  size_t erase(const K& k) { return _t.erase(k); }
  void clear() { _t.clear(); }
  iterator find(const K& k) { return _t.find(k); }
  const_iterator find(const K& k) const { return _t.find(k); }
  size_t count(const K& k) const { return _t.count(k); }
  iterator lower_bound(const K& k) { return _t.lower_bound(k); }
  iterator upper_bound(const K& k) { return _t.upper_bound(k); }
  pair<iterator, iterator> equal_range(const K& k) { return pair<iterator, iterator>(_t.lower_bound(k), _t.upper_bound(k)); }
};

template <class K, class Cmp = less<K>>
class set {
 public:
  typedef K key_type; typedef K value_type; typedef Cmp key_compare;
  typedef size_t size_type; typedef ptrdiff_t difference_type;
 private:
  typedef __rb_tree<K, K, __identity_key<K>, Cmp, true> tree_type;
  tree_type _t;
 public:
  typedef typename tree_type::const_iterator iterator;
  typedef typename tree_type::const_iterator const_iterator;
  typedef std::reverse_iterator<const_iterator> reverse_iterator;
  typedef std::reverse_iterator<const_iterator> const_reverse_iterator;
  set() : _t() {}
  explicit set(const Cmp& c) : _t(c) {}
  set(const set& o) : _t(o._t) {}
  set(set&& o) noexcept : _t(std::move(o._t)) {}
  set(initializer_list<K> il) : _t() { for (const K* p = il.begin(); p != il.end(); ++p) _t.emplace_unique(*p); }
  template <class It, class = typename enable_if<!is_integral<It>::value>::type> set(It a, It b) : _t() { for (; a != b; ++a) _t.emplace_unique(*a); }
  set& operator=(const set& o) { _t = o._t; return *this; }
  set& operator=(set&& o) noexcept { _t = std::move(o._t); return *this; }
  set& operator=(initializer_list<K> il) { _t.clear(); for (const K* p = il.begin(); p != il.end(); ++p) _t.emplace_unique(*p); return *this; }
  const_iterator begin() const { return _t.begin(); }
  const_iterator cbegin() const { return _t.begin(); }
  const_iterator end() const { return _t.end(); }
  const_iterator cend() const { return _t.end(); }
  reverse_iterator rbegin() const { return reverse_iterator(end()); }
  reverse_iterator rend() const { return reverse_iterator(begin()); }
  bool empty() const { return _t.empty(); }
  size_t size() const { return _t.size(); }
  size_t max_size() const { return _t.max_size(); }
  pair<iterator, bool> insert(const K& v) { pair<typename tree_type::iterator, bool> r = _t.emplace_unique(v); return pair<iterator, bool>(const_iterator(r.first), r.second); }
  pair<iterator, bool> insert(K&& v) { pair<typename tree_type::iterator, bool> r = _t.emplace_unique(std::move(v)); return pair<iterator, bool>(const_iterator(r.first), r.second); }
  iterator insert(const_iterator, const K& v) { return const_iterator(_t.emplace_unique(v).first); }
  void insert(initializer_list<K> il) { for (const K* p = il.begin(); p != il.end(); ++p) _t.emplace_unique(*p); }
  template <class It, class = typename enable_if<!is_integral<It>::value>::type> void insert(It a, It b) { for (; a != b; ++a) _t.emplace_unique(*a); }
  template <class... Args> pair<iterator, bool> emplace(Args&&... args) { pair<typename tree_type::iterator, bool> r = _t.emplace_unique(std::forward<Args>(args)...); return pair<iterator, bool>(const_iterator(r.first), r.second); }
  iterator erase(const_iterator p) { return const_iterator(_t.erase(p)); }
  size_t erase(const K& k) { return _t.erase(k); }
  iterator erase(const_iterator a, const_iterator b) { return const_iterator(_t.erase(a, b)); }
  void clear() { _t.clear(); }
  void swap(set& o) { _t.swap(o._t); }
  const_iterator find(const K& k) const { return _t.find(k); }
  size_t count(const K& k) const { return _t.find(k) == _t.end() ? 0 : 1; }
  bool contains(const K& k) const { return _t.find(k) != _t.end(); }
  const_iterator lower_bound(const K& k) const { return _t.lower_bound(k); }
  const_iterator upper_bound(const K& k) const { return _t.upper_bound(k); }
  pair<iterator, iterator> equal_range(const K& k) const { return pair<iterator, iterator>(_t.lower_bound(k), _t.upper_bound(k)); }
  Cmp key_comp() const { return _t.key_comp(); }
};
template <class K, class C> bool operator==(const set<K, C>& a, const set<K, C>& b) { return a.size() == b.size() && std::equal(a.begin(), a.end(), b.begin()); }
template <class K, class C> bool operator!=(const set<K, C>& a, const set<K, C>& b) { return !(a == b); }

template <class K, class Cmp = less<K>>
class multiset {
 public:
  typedef K key_type; typedef K value_type; typedef Cmp key_compare;
 private:
  typedef __rb_tree<K, K, __identity_key<K>, Cmp, false> tree_type;
  tree_type _t;
 public:
  typedef typename tree_type::const_iterator iterator;
  typedef typename tree_type::const_iterator const_iterator;
  multiset() : _t() {}
  multiset(initializer_list<K> il) : _t() { for (const K* p = il.begin(); p != il.end(); ++p) _t.emplace_equal(*p); }
  const_iterator begin() const { return _t.begin(); }
  const_iterator end() const { return _t.end(); }
  bool empty() const { return _t.empty(); }
  size_t size() const { return _t.size(); }
  iterator insert(const K& v) { return const_iterator(_t.emplace_equal(v)); }
  iterator erase(const_iterator p) { return const_iterator(_t.erase(p)); }
  size_t erase(const K& k) { return _t.erase(k); }
  void clear() { _t.clear(); }
  const_iterator find(const K& k) const { return _t.find(k); }
  size_t count(const K& k) const { return _t.count(k); }
  const_iterator lower_bound(const K& k) const { return _t.lower_bound(k); }
  const_iterator upper_bound(const K& k) const { return _t.upper_bound(k); }
  pair<iterator, iterator> equal_range(const K& k) const { return pair<iterator, iterator>(_t.lower_bound(k), _t.upper_bound(k)); }
};
}
