// <unordered_map>, <unordered_set>: libstdc++'s _Hashtable (singly linked node list, bucket array of "node before", prime bucket counts).
// Bucket counts, insertion points and iteration order reproduce libstdc++ exactly. Windows and macOS use the same algorithm here,
// so their iteration order is an approximation of MSVC's and libc++'s.
namespace std {
inline size_t __hash_bytes(const void* ptr, size_t len, size_t seed) {
  const size_t mul = (((size_t)0xc6a4a793UL) << 32UL) + (size_t)0x5bd1e995UL;
  const unsigned char* buf = static_cast<const unsigned char*>(ptr);
  size_t hash = seed ^ (len * mul);
  size_t aligned = len & ~(size_t)0x7;
  size_t i = 0;
  for (; i < aligned; i += 8) {
    size_t d = 0;
    for (int k = 7; k >= 0; --k) d = (d << 8) + buf[i + k];
    d *= mul; d ^= d >> 47; d *= mul;
    hash ^= d; hash *= mul;
  }
  if ((len & 0x7) != 0) {
    size_t d = 0; size_t n = len & 0x7;
    for (size_t k = n; k > 0; --k) d = (d << 8) + buf[aligned + k - 1];
    hash ^= d; hash *= mul;
  }
  hash ^= hash >> 47; hash *= mul; hash ^= hash >> 47;
  return hash;
}

template <class T> struct hash;
#define __HASH_INT(T) template <> struct hash<T> { size_t operator()(T v) const { return static_cast<size_t>(v); } };
__HASH_INT(bool) __HASH_INT(char) __HASH_INT(signed char) __HASH_INT(unsigned char) __HASH_INT(short) __HASH_INT(unsigned short)
__HASH_INT(int) __HASH_INT(unsigned int) __HASH_INT(long) __HASH_INT(unsigned long) __HASH_INT(long long) __HASH_INT(unsigned long long)
template <> struct hash<double> { size_t operator()(double v) const { return v == 0.0 ? 0 : __hash_bytes(&v, sizeof(v), 0xc70f6907UL); } };
template <> struct hash<float> { size_t operator()(float v) const { return v == 0.0f ? 0 : __hash_bytes(&v, sizeof(v), 0xc70f6907UL); } };
template <class T> struct hash<T*> { size_t operator()(T* p) const { return reinterpret_cast<size_t>(p); } };
template <> struct hash<string> { size_t operator()(const string& s) const { return __hash_bytes(s.data(), s.length(), 0xc70f6907UL); } };

static const unsigned long __ht_primes[] = {17,19,23,29,31,37,41,43,47,53,59,61,67,71,73,79,83,89,97,103,109,113,127,137,139,149,157,167,179,193,199,211,227,241,257,277,293,313,337,359,383,409,439,467,503,541,577,619,661,709,761,823,887,953,1031,1109,1193,1289,1381,1493,1613,1741,1879,2029,2179,2357,2549,2753,2971,3209,3469,3739,4027,4349,4703,5087,5503,5953,6427,6949,7517,8123,8783,9497,10273,11113,12011,12983,14033,15173,16411,17749,19183,20753,22447,24281,26267,28411,30727,33223,35933,38873,42043,45481,49201,53201,57557,62233,67307,72817,78779,85229,92203,99733,107897,116731,126271,136607,147793,159871,172933,187091,202409,218971,236897,256279,277261,299951,324503,351061,379787,410857,444487,480881,520241,562841,608903,658753,712697,771049,834181,902483,976369,1056323,1142821,1236397,1337629,1447153,1565659,1693859,1832561,1982627,2144977,2320627,2510653,2716249,2938679,3179303,3439651,3721303,4026031,4355707,4712381,5098259,5515729,5967347,6456007,6984629,7556579,8175383,8844859,9569143,10352717,11200489,12117689,13109983,14183539,15345007,16601593,17961079};
static const int __ht_nprimes = sizeof(__ht_primes) / sizeof(__ht_primes[0]);
static const unsigned char __ht_fast_bkt[] = {2, 2, 2, 3, 5, 5, 7, 7, 11, 11, 11, 11, 13, 13};

struct __ht_node_base { __ht_node_base* _M_nxt; };
template <class V, bool Cached> struct __ht_node;
template <class V> struct __ht_node<V, false> : __ht_node_base { V _M_v; };
template <class V> struct __ht_node<V, true> : __ht_node_base { V _M_v; size_t _M_hash; };

template <class V, class Ref, class Ptr, bool C> struct __ht_iter {
  typedef forward_iterator_tag iterator_category;
  typedef V value_type; typedef ptrdiff_t difference_type; typedef Ptr pointer; typedef Ref reference;
  __ht_node_base* _M_cur;
  __ht_iter() : _M_cur(0) {}
  explicit __ht_iter(__ht_node_base* n) : _M_cur(n) {}
  template <class R2, class P2> __ht_iter(const __ht_iter<V, R2, P2, C>& o) : _M_cur(o._M_cur) {}
  reference operator*() const { return static_cast<__ht_node<V, C>*>(_M_cur)->_M_v; }
  pointer operator->() const { return &static_cast<__ht_node<V, C>*>(_M_cur)->_M_v; }
  __ht_iter& operator++() { _M_cur = _M_cur->_M_nxt; return *this; }
  __ht_iter operator++(int) { __ht_iter t = *this; _M_cur = _M_cur->_M_nxt; return t; }
  bool operator==(const __ht_iter& o) const { return _M_cur == o._M_cur; }
  bool operator!=(const __ht_iter& o) const { return _M_cur != o._M_cur; }
};

template <class K, class V, class KeyOf, class Hash, class Eq>
class __hashtable : private Hash, private Eq {
 public:
  static constexpr bool _Cached = !(is_same<K, int>::value || is_same<K, unsigned>::value || is_same<K, long>::value || is_same<K, unsigned long>::value
    || is_same<K, long long>::value || is_same<K, unsigned long long>::value || is_same<K, char>::value || is_same<K, short>::value
    || is_same<K, unsigned char>::value || is_same<K, bool>::value || is_pointer<K>::value);
  typedef __ht_node<V, _Cached> _Node;
  typedef __ht_iter<V, V&, V*, _Cached> iterator;
  typedef __ht_iter<V, const V&, const V*, _Cached> const_iterator;
  typedef K key_type;
  typedef V value_type;
  typedef size_t size_type;

  __ht_node_base** _M_buckets;
  size_t _M_bucket_count;
  __ht_node_base _M_before_begin;
  size_t _M_element_count;
  float _M_max_load_factor;
  size_t _M_next_resize;
  __ht_node_base* _M_single_bucket;
  size_t _hf(const K& k) const { return static_cast<const Hash&>(*this)(k); }
  bool _eqf(const K& a, const K& b) const { return static_cast<const Eq&>(*this)(a, b); }

  void _init() { _M_single_bucket = 0; _M_buckets = &_M_single_bucket; _M_bucket_count = 1; _M_before_begin._M_nxt = 0; _M_element_count = 0; _M_max_load_factor = 1.0f; _M_next_resize = 0; }
  __hashtable() : Hash(), Eq() { _init(); }
  explicit __hashtable(size_t n) : Hash(), Eq() { _init(); if (n > _M_bucket_count) { size_t b = _next_bkt(n); if (b != _M_bucket_count) _rehash(b); } }
  __hashtable(const __hashtable& o) : Hash(o), Eq(o) {
    _init();
    if (o._M_bucket_count != 1) _rehash(o._M_bucket_count);
    for (const_iterator it = o.begin(); it != o.end(); ++it) _insert_node(_make_node(*it));
  }
  __hashtable& operator=(const __hashtable& o) { if (this != &o) { clear(); for (const_iterator it = o.begin(); it != o.end(); ++it) _insert_node(_make_node(*it)); } return *this; }
  ~__hashtable() { clear(); _deallocate_buckets(); }

  size_t _code(const K& k) const { return _hf(k); }
  size_t _code_of(__ht_node_base* n) const { return _code_node(static_cast<_Node*>(n)); }
  size_t _code_node(_Node* n) const { return _node_code(n, integral_constant<bool, _Cached>()); }
  size_t _node_code(_Node* n, true_type) const { return n->_M_hash; }
  size_t _node_code(_Node* n, false_type) const { return _hf(KeyOf()(n->_M_v)); }
  void _store_code(_Node* n, size_t c) { _store_code2(n, c, integral_constant<bool, _Cached>()); }
  void _store_code2(_Node* n, size_t c, true_type) { n->_M_hash = c; }
  void _store_code2(_Node*, size_t, false_type) {}
  size_t _bkt(size_t code) const { return code % _M_bucket_count; }
  size_t _bkt_of(__ht_node_base* n) const { return _code_of(n) % _M_bucket_count; }

  template <class... A> _Node* _make_node(A&&... a) {
    _Node* n = __typed_new<_Node>(1);
    n->_M_nxt = 0;
    ::new (static_cast<void*>(&n->_M_v)) V(std::forward<A>(a)...);
    return n;
  }
  void _drop_node(_Node* n) { n->_M_v.~V(); ::operator delete(n); }

  size_t _next_bkt(size_t n) {
    if (n < sizeof(__ht_fast_bkt)) {
      if (n == 0) return 1;
      _M_next_resize = static_cast<size_t>(__ht_fast_bkt[n] * (double)_M_max_load_factor);
      return __ht_fast_bkt[n];
    }
    int i = 0;
    while (i < __ht_nprimes - 1 && __ht_primes[i] < n) ++i;
    _M_next_resize = static_cast<size_t>(__ht_primes[i] * (double)_M_max_load_factor);
    return __ht_primes[i];
  }
  // returns true and sets `want` when the table must grow before inserting `ins` more elements
  bool _need_rehash(size_t bkts, size_t elts, size_t ins, size_t& want) {
    if (elts + ins > _M_next_resize) {
      size_t base = elts + ins;
      if (_M_next_resize == 0 && base < 11) base = 11;
      double min_bkts = base / (double)_M_max_load_factor;
      if (min_bkts >= bkts) {
        size_t f = static_cast<size_t>(min_bkts) + 1;
        if (bkts * 2 > f) f = bkts * 2;
        want = _next_bkt(f);
        return true;
      }
      _M_next_resize = static_cast<size_t>(bkts * (double)_M_max_load_factor);
    }
    return false;
  }
  void _deallocate_buckets() { if (_M_buckets != &_M_single_bucket) ::operator delete(_M_buckets); }
  void _rehash(size_t n) {
    __ht_node_base** nb;
    if (n == 1) { _M_single_bucket = 0; nb = &_M_single_bucket; }
    else { nb = __typed_new<__ht_node_base*>(n); for (size_t i = 0; i < n; ++i) nb[i] = 0; }
    __ht_node_base* p = _M_before_begin._M_nxt;
    _M_before_begin._M_nxt = 0;
    size_t bbegin = 0;
    while (p) {
      __ht_node_base* next = p->_M_nxt;
      size_t b = _code_of(p) % n;
      if (!nb[b]) { p->_M_nxt = _M_before_begin._M_nxt; _M_before_begin._M_nxt = p; nb[b] = &_M_before_begin; if (p->_M_nxt) nb[bbegin] = p; bbegin = b; }
      else { p->_M_nxt = nb[b]->_M_nxt; nb[b]->_M_nxt = p; }
      p = next;
    }
    _deallocate_buckets();
    _M_bucket_count = n;
    _M_buckets = nb;
  }
  __ht_node_base* _find_before(size_t bkt, const K& k, size_t code) const {
    __ht_node_base* prev = _M_buckets[bkt];
    if (!prev) return 0;
    for (__ht_node_base* p = prev->_M_nxt;; p = p->_M_nxt) {
      if (_code_of(p) == code && _eqf(k, KeyOf()(static_cast<_Node*>(p)->_M_v))) return prev;
      if (!p->_M_nxt || _bkt_of(p->_M_nxt) != bkt) break;
      prev = p;
    }
    return 0;
  }
  iterator _insert_node(_Node* n) {
    const K& k = KeyOf()(n->_M_v);
    size_t code = _code(k);
    _store_code(n, code);
    size_t bkt = _bkt(code);
    size_t want = 0;
    if (_need_rehash(_M_bucket_count, _M_element_count, 1, want)) { _rehash(want); bkt = _bkt(code); }
    if (_M_buckets[bkt]) { n->_M_nxt = _M_buckets[bkt]->_M_nxt; _M_buckets[bkt]->_M_nxt = n; }
    else {
      n->_M_nxt = _M_before_begin._M_nxt; _M_before_begin._M_nxt = n;
      if (n->_M_nxt) _M_buckets[_bkt_of(n->_M_nxt)] = n;
      _M_buckets[bkt] = &_M_before_begin;
    }
    ++_M_element_count;
    return iterator(n);
  }
  // inserts `n` unless its key is present; the node is destroyed when the key was already there
  pair<iterator, bool> _insert_unique(_Node* n) {
    const K& k = KeyOf()(n->_M_v);
    size_t code = _code(k);
    size_t bkt = _bkt(code);
    __ht_node_base* prev = _find_before(bkt, k, code);
    if (prev) { iterator ex(prev->_M_nxt); _drop_node(n); return pair<iterator, bool>(ex, false); }
    return pair<iterator, bool>(_insert_node(n), true);
  }
  iterator find(const K& k) { size_t c = _code(k); __ht_node_base* b = _find_before(_bkt(c), k, c); return b ? iterator(b->_M_nxt) : end(); }
  const_iterator find(const K& k) const { size_t c = _code(k); __ht_node_base* b = _find_before(_bkt(c), k, c); return b ? const_iterator(b->_M_nxt) : end(); }
  size_t count(const K& k) const { return find(k) != end() ? 1 : 0; }
  bool contains(const K& k) const { return find(k) != end(); }
  iterator _erase_node(size_t bkt, __ht_node_base* prev, _Node* n) {
    __ht_node_base* nx = n->_M_nxt;
    if (prev == _M_buckets[bkt]) {
      size_t nbkt = nx ? _bkt_of(nx) : 0;
      if (!nx || nbkt != bkt) {
        if (nx) _M_buckets[nbkt] = _M_buckets[bkt];
        if (&_M_before_begin == _M_buckets[bkt]) _M_before_begin._M_nxt = nx;
        _M_buckets[bkt] = 0;
      }
    } else if (nx) {
      size_t nbkt = _bkt_of(nx);
      if (nbkt != bkt) _M_buckets[nbkt] = prev;
    }
    prev->_M_nxt = n->_M_nxt;
    _drop_node(n);
    --_M_element_count;
    return iterator(nx);
  }
  size_t erase(const K& k) {
    size_t c = _code(k); size_t bkt = _bkt(c);
    __ht_node_base* prev = _find_before(bkt, k, c);
    if (!prev) return 0;
    _erase_node(bkt, prev, static_cast<_Node*>(prev->_M_nxt));
    return 1;
  }
  iterator erase(const_iterator pos) {
    _Node* n = static_cast<_Node*>(pos._M_cur);
    size_t bkt = _bkt_of(n);
    __ht_node_base* prev = _M_buckets[bkt];
    while (prev->_M_nxt != n) prev = prev->_M_nxt;
    return _erase_node(bkt, prev, n);
  }
  iterator erase(const_iterator first, const_iterator last) { while (first != last) first = const_iterator(erase(first)._M_cur); return iterator(last._M_cur); }
  void clear() {
    __ht_node_base* p = _M_before_begin._M_nxt;
    while (p) { __ht_node_base* nx = p->_M_nxt; _drop_node(static_cast<_Node*>(p)); p = nx; }
    for (size_t i = 0; i < _M_bucket_count; ++i) _M_buckets[i] = 0;
    _M_element_count = 0; _M_before_begin._M_nxt = 0;
  }
  iterator begin() { return iterator(_M_before_begin._M_nxt); }
  const_iterator begin() const { return const_iterator(_M_before_begin._M_nxt); }
  const_iterator cbegin() const { return const_iterator(_M_before_begin._M_nxt); }
  iterator end() { return iterator(0); }
  const_iterator end() const { return const_iterator(0); }
  const_iterator cend() const { return const_iterator(0); }
  size_t size() const { return _M_element_count; }
  bool empty() const { return _M_element_count == 0; }
  size_t bucket_count() const { return _M_bucket_count; }
  size_t bucket(const K& k) const { return _bkt(_code(k)); }
  size_t bucket_size(size_t b) const { size_t n = 0; __ht_node_base* p = _M_buckets[b]; if (!p) return 0; for (p = p->_M_nxt; p && _bkt_of(p) == b; p = p->_M_nxt) ++n; return n; }
  float load_factor() const { return (float)_M_element_count / (float)_M_bucket_count; }
  float max_load_factor() const { return _M_max_load_factor; }
  void max_load_factor(float f) { _M_max_load_factor = f; }
  void rehash(size_t n) {
    size_t need = static_cast<size_t>((_M_element_count + 1) / (double)_M_max_load_factor) + 1;
    size_t b = _next_bkt(n > need ? n : need);
    if (b != _M_bucket_count) _rehash(b);
  }
  void reserve(size_t n) { rehash(static_cast<size_t>(n / (double)_M_max_load_factor) + 1); }
  void swap(__hashtable& o) {
    __hashtable t(*this); *this = o; o = t;
  }
};

template <class K> struct __identity_key { const K& operator()(const K& k) const { return k; } };
template <class P> struct __first_key { const typename P::first_type& operator()(const P& p) const { return p.first; } };

template <class K, class T, class H = hash<K>, class E = equal_to<K>>
class unordered_map {
 public:
  typedef K key_type; typedef T mapped_type; typedef pair<const K, T> value_type;
  typedef size_t size_type; typedef ptrdiff_t difference_type;
  typedef H hasher; typedef E key_equal;
  typedef __hashtable<K, value_type, __first_key<value_type>, H, E> _Tab;
  typedef typename _Tab::iterator iterator;
  typedef typename _Tab::const_iterator const_iterator;
  _Tab _t;
  unordered_map() {}
  explicit unordered_map(size_t n) : _t(n) {}
  unordered_map(initializer_list<value_type> il) { for (const value_type* p = il.begin(); p != il.end(); ++p) insert(*p); }
  template <class It, class = typename enable_if<!is_integral<It>::value>::type> unordered_map(It f, It l) { for (; f != l; ++f) insert(*f); }
  unordered_map(const unordered_map& o) : _t(o._t) {}
  unordered_map(unordered_map&& o) { _t.swap(o._t); }
  unordered_map& operator=(const unordered_map& o) { _t = o._t; return *this; }
  unordered_map& operator=(unordered_map&& o) { _t.clear(); _t.swap(o._t); return *this; }
  unordered_map& operator=(initializer_list<value_type> il) { _t.clear(); for (const value_type* p = il.begin(); p != il.end(); ++p) insert(*p); return *this; }
  iterator begin() { return _t.begin(); }
  const_iterator begin() const { return _t.begin(); }
  const_iterator cbegin() const { return _t.begin(); }
  iterator end() { return _t.end(); }
  const_iterator end() const { return _t.end(); }
  const_iterator cend() const { return _t.end(); }
  bool empty() const { return _t.empty(); }
  size_t size() const { return _t.size(); }
  pair<iterator, bool> insert(const value_type& v) { size_t c = _t._code(v.first); __ht_node_base* p = _t._find_before(_t._bkt(c), v.first, c); if (p) return pair<iterator, bool>(iterator(p->_M_nxt), false); return pair<iterator, bool>(_t._insert_node(_t._make_node(v)), true); }
  pair<iterator, bool> insert(value_type&& v) { size_t c = _t._code(v.first); __ht_node_base* p = _t._find_before(_t._bkt(c), v.first, c); if (p) return pair<iterator, bool>(iterator(p->_M_nxt), false); return pair<iterator, bool>(_t._insert_node(_t._make_node(std::move(v))), true); }
  template <class P, class = typename enable_if<!is_same<typename remove_reference<P>::type, value_type>::value>::type> pair<iterator, bool> insert(P&& v) { return emplace(std::forward<P>(v)); }
  template <class It, class = typename enable_if<!is_integral<It>::value>::type> void insert(It f, It l) { for (; f != l; ++f) insert(*f); }
  void insert(initializer_list<value_type> il) { for (const value_type* p = il.begin(); p != il.end(); ++p) insert(*p); }
  template <class... A> pair<iterator, bool> emplace(A&&... a) { return _t._insert_unique(_t._make_node(std::forward<A>(a)...)); }
  template <class... A> pair<iterator, bool> try_emplace(const K& k, A&&... a) {
    size_t c = _t._code(k); __ht_node_base* p = _t._find_before(_t._bkt(c), k, c);
    if (p) return pair<iterator, bool>(iterator(p->_M_nxt), false);
    return pair<iterator, bool>(_t._insert_node(_t._make_node(piecewise_construct_t(), k, std::forward<A>(a)...)), true);
  }
  template <class M> pair<iterator, bool> insert_or_assign(const K& k, M&& m) {
    iterator it = find(k);
    if (it != end()) { it->second = std::forward<M>(m); return pair<iterator, bool>(it, false); }
    return emplace(k, std::forward<M>(m));
  }
  T& operator[](const K& k) {
    size_t c = _t._code(k); __ht_node_base* p = _t._find_before(_t._bkt(c), k, c);
    if (p) return static_cast<typename _Tab::_Node*>(p->_M_nxt)->_M_v.second;
    iterator it = _t._insert_node(_t._make_node(piecewise_construct_t(), k));
    return it->second;
  }
  T& operator[](K&& k) {
    size_t c = _t._code(k); __ht_node_base* p = _t._find_before(_t._bkt(c), k, c);
    if (p) return static_cast<typename _Tab::_Node*>(p->_M_nxt)->_M_v.second;
    iterator it = _t._insert_node(_t._make_node(piecewise_construct_t(), std::move(k)));
    return it->second;
  }
  T& at(const K& k) { iterator it = find(k); if (it == end()) throw out_of_range("unordered_map::at"); return it->second; }
  const T& at(const K& k) const { const_iterator it = find(k); if (it == end()) throw out_of_range("unordered_map::at"); return it->second; }
  iterator find(const K& k) { return _t.find(k); }
  const_iterator find(const K& k) const { return _t.find(k); }
  size_t count(const K& k) const { return _t.count(k); }
  bool contains(const K& k) const { return _t.contains(k); }
  size_t erase(const K& k) { return _t.erase(k); }
  iterator erase(const_iterator p) { return _t.erase(p); }
  iterator erase(iterator p) { return _t.erase(const_iterator(p)); }
  iterator erase(const_iterator f, const_iterator l) { return _t.erase(f, l); }
  void clear() { _t.clear(); }
  void swap(unordered_map& o) { _t.swap(o._t); }
  size_t bucket_count() const { return _t.bucket_count(); }
  size_t bucket(const K& k) const { return _t.bucket(k); }
  size_t bucket_size(size_t b) const { return _t.bucket_size(b); }
  float load_factor() const { return _t.load_factor(); }
  float max_load_factor() const { return _t.max_load_factor(); }
  void max_load_factor(float f) { _t.max_load_factor(f); }
  void rehash(size_t n) { _t.rehash(n); }
  void reserve(size_t n) { _t.reserve(n); }
};

template <class K, class H = hash<K>, class E = equal_to<K>>
class unordered_set {
 public:
  typedef K key_type; typedef K value_type;
  typedef size_t size_type; typedef ptrdiff_t difference_type;
  typedef H hasher; typedef E key_equal;
  typedef __hashtable<K, K, __identity_key<K>, H, E> _Tab;
  typedef typename _Tab::iterator iterator;
  typedef typename _Tab::const_iterator const_iterator;
  _Tab _t;
  unordered_set() {}
  explicit unordered_set(size_t n) : _t(n) {}
  unordered_set(initializer_list<K> il) { for (const K* p = il.begin(); p != il.end(); ++p) insert(*p); }
  template <class It, class = typename enable_if<!is_integral<It>::value>::type> unordered_set(It f, It l) { for (; f != l; ++f) insert(*f); }
  unordered_set(const unordered_set& o) : _t(o._t) {}
  unordered_set(unordered_set&& o) { _t.swap(o._t); }
  unordered_set& operator=(const unordered_set& o) { _t = o._t; return *this; }
  unordered_set& operator=(unordered_set&& o) { _t.clear(); _t.swap(o._t); return *this; }
  unordered_set& operator=(initializer_list<K> il) { _t.clear(); for (const K* p = il.begin(); p != il.end(); ++p) insert(*p); return *this; }
  iterator begin() { return _t.begin(); }
  const_iterator begin() const { return _t.begin(); }
  const_iterator cbegin() const { return _t.begin(); }
  iterator end() { return _t.end(); }
  const_iterator end() const { return _t.end(); }
  const_iterator cend() const { return _t.end(); }
  bool empty() const { return _t.empty(); }
  size_t size() const { return _t.size(); }
  pair<iterator, bool> insert(const K& v) { size_t c = _t._code(v); __ht_node_base* p = _t._find_before(_t._bkt(c), v, c); if (p) return pair<iterator, bool>(iterator(p->_M_nxt), false); return pair<iterator, bool>(_t._insert_node(_t._make_node(v)), true); }
  pair<iterator, bool> insert(K&& v) { size_t c = _t._code(v); __ht_node_base* p = _t._find_before(_t._bkt(c), v, c); if (p) return pair<iterator, bool>(iterator(p->_M_nxt), false); return pair<iterator, bool>(_t._insert_node(_t._make_node(std::move(v))), true); }
  template <class It, class = typename enable_if<!is_integral<It>::value>::type> void insert(It f, It l) { for (; f != l; ++f) insert(*f); }
  void insert(initializer_list<K> il) { for (const K* p = il.begin(); p != il.end(); ++p) insert(*p); }
  template <class... A> pair<iterator, bool> emplace(A&&... a) { return _t._insert_unique(_t._make_node(std::forward<A>(a)...)); }
  iterator find(const K& k) { return _t.find(k); }
  const_iterator find(const K& k) const { return _t.find(k); }
  size_t count(const K& k) const { return _t.count(k); }
  bool contains(const K& k) const { return _t.contains(k); }
  size_t erase(const K& k) { return _t.erase(k); }
  iterator erase(const_iterator p) { return _t.erase(p); }
  iterator erase(iterator p) { return _t.erase(const_iterator(p)); }
  iterator erase(const_iterator f, const_iterator l) { return _t.erase(f, l); }
  void clear() { _t.clear(); }
  void swap(unordered_set& o) { _t.swap(o._t); }
  size_t bucket_count() const { return _t.bucket_count(); }
  size_t bucket(const K& k) const { return _t.bucket(k); }
  size_t bucket_size(size_t b) const { return _t.bucket_size(b); }
  float load_factor() const { return _t.load_factor(); }
  float max_load_factor() const { return _t.max_load_factor(); }
  void max_load_factor(float f) { _t.max_load_factor(f); }
  void rehash(size_t n) { _t.rehash(n); }
  void reserve(size_t n) { _t.reserve(n); }
};
}
