// <iterator>, <algorithm>, <numeric>: sort/heap/partition follow libstdc++ step by step so equal elements end up where g++ puts them.
namespace std {
struct input_iterator_tag {};
struct output_iterator_tag {};
struct forward_iterator_tag : input_iterator_tag {};
struct bidirectional_iterator_tag : forward_iterator_tag {};
struct random_access_iterator_tag : bidirectional_iterator_tag {};

template <class It> struct iterator_traits {
  typedef typename It::iterator_category iterator_category;
  typedef typename It::value_type value_type;
  typedef typename It::difference_type difference_type;
  typedef typename It::pointer pointer;
  typedef typename It::reference reference;
};
template <class T> struct iterator_traits<T*> {
  typedef random_access_iterator_tag iterator_category;
  typedef T value_type;
  typedef ptrdiff_t difference_type;
  typedef T* pointer;
  typedef T& reference;
};
template <class T> struct iterator_traits<const T*> {
  typedef random_access_iterator_tag iterator_category;
  typedef T value_type;
  typedef ptrdiff_t difference_type;
  typedef const T* pointer;
  typedef const T& reference;
};

template <class It, class D> void __advance(It& it, D n, random_access_iterator_tag) { it += n; }
template <class It, class D> void __advance(It& it, D n, bidirectional_iterator_tag) { if (n >= 0) while (n--) ++it; else while (n++) --it; }
template <class It, class D> void __advance(It& it, D n, input_iterator_tag) { while (n--) ++it; }
template <class It, class D> void advance(It& it, D n) { __advance(it, n, typename iterator_traits<It>::iterator_category()); }
template <class It> ptrdiff_t __distance(It a, It b, random_access_iterator_tag) { return b - a; }
template <class It> ptrdiff_t __distance(It a, It b, input_iterator_tag) { ptrdiff_t n = 0; while (a != b) { ++a; ++n; } return n; }
template <class It> ptrdiff_t distance(It a, It b) { return __distance(a, b, typename iterator_traits<It>::iterator_category()); }
template <class It> It next(It it, ptrdiff_t n = 1) { advance(it, n); return it; }
template <class It> It prev(It it, ptrdiff_t n = 1) { advance(it, -n); return it; }

template <class C> auto begin(C& c) -> decltype(c.begin()) { return c.begin(); }
template <class C> auto begin(const C& c) -> decltype(c.begin()) { return c.begin(); }
template <class C> auto end(C& c) -> decltype(c.end()) { return c.end(); }
template <class C> auto end(const C& c) -> decltype(c.end()) { return c.end(); }
template <class T, size_t N> T* begin(T (&a)[N]) { return a; }
template <class T, size_t N> T* end(T (&a)[N]) { return a + N; }
template <class C> auto size(const C& c) -> decltype(c.size()) { return c.size(); }
template <class T, size_t N> constexpr size_t size(const T (&)[N]) noexcept { return N; }

template <class It> struct reverse_iterator {
  typedef typename iterator_traits<It>::iterator_category iterator_category;
  typedef typename iterator_traits<It>::value_type value_type;
  typedef typename iterator_traits<It>::difference_type difference_type;
  typedef typename iterator_traits<It>::pointer pointer;
  typedef typename iterator_traits<It>::reference reference;
  It current;
  reverse_iterator() : current() {}
  explicit reverse_iterator(It x) : current(x) {}
  template <class U> reverse_iterator(const reverse_iterator<U>& o) : current(o.base()) {}
  It base() const { return current; }
  reference operator*() const { It t = current; --t; return *t; }
  pointer operator->() const { It t = current; --t; return &*t; }
  reverse_iterator& operator++() { --current; return *this; }
  reverse_iterator operator++(int) { reverse_iterator t = *this; --current; return t; }
  reverse_iterator& operator--() { ++current; return *this; }
  reverse_iterator operator--(int) { reverse_iterator t = *this; ++current; return t; }
  reverse_iterator operator+(difference_type n) const { return reverse_iterator(current - n); }
  reverse_iterator operator-(difference_type n) const { return reverse_iterator(current + n); }
  reverse_iterator& operator+=(difference_type n) { current -= n; return *this; }
  reverse_iterator& operator-=(difference_type n) { current += n; return *this; }
  reference operator[](difference_type n) const { return *(*this + n); }
};
template <class A, class B> bool operator==(const reverse_iterator<A>& x, const reverse_iterator<B>& y) { return x.base() == y.base(); }
template <class A, class B> bool operator!=(const reverse_iterator<A>& x, const reverse_iterator<B>& y) { return x.base() != y.base(); }
template <class A, class B> bool operator<(const reverse_iterator<A>& x, const reverse_iterator<B>& y) { return y.base() < x.base(); }
template <class A, class B> ptrdiff_t operator-(const reverse_iterator<A>& x, const reverse_iterator<B>& y) { return y.base() - x.base(); }

// ---- non-modifying ------------------------------------------------------------------------------------------------------------
template <class It, class F> F for_each(It first, It last, F f) { for (; first != last; ++first) f(*first); return f; }
template <class It, class T> It find(It first, It last, const T& v) { for (; first != last; ++first) if (*first == v) return first; return last; }
template <class It, class P> It find_if(It first, It last, P p) { for (; first != last; ++first) if (p(*first)) return first; return last; }
template <class It, class P> It find_if_not(It first, It last, P p) { for (; first != last; ++first) if (!p(*first)) return first; return last; }
template <class It, class T> ptrdiff_t count(It first, It last, const T& v) { ptrdiff_t n = 0; for (; first != last; ++first) if (*first == v) ++n; return n; }
template <class It, class P> ptrdiff_t count_if(It first, It last, P p) { ptrdiff_t n = 0; for (; first != last; ++first) if (p(*first)) ++n; return n; }
template <class It, class P> bool all_of(It first, It last, P p) { for (; first != last; ++first) if (!p(*first)) return false; return true; }
template <class It, class P> bool any_of(It first, It last, P p) { for (; first != last; ++first) if (p(*first)) return true; return false; }
template <class It, class P> bool none_of(It first, It last, P p) { for (; first != last; ++first) if (p(*first)) return false; return true; }
template <class A, class B> bool equal(A f1, A l1, B f2) { for (; f1 != l1; ++f1, ++f2) if (!(*f1 == *f2)) return false; return true; }
template <class A, class B> bool equal(A f1, A l1, B f2, B l2) { for (; f1 != l1 && f2 != l2; ++f1, ++f2) if (!(*f1 == *f2)) return false; return f1 == l1 && f2 == l2; }
template <class A, class B> pair<A, B> mismatch(A f1, A l1, B f2) { while (f1 != l1 && *f1 == *f2) { ++f1; ++f2; } return pair<A, B>(f1, f2); }
template <class It> It adjacent_find(It first, It last) { if (first == last) return last; It nx = first; ++nx; for (; nx != last; ++nx, ++first) if (*first == *nx) return first; return last; }
template <class A, class B> A search(A f1, A l1, B f2, B l2) {
  if (f2 == l2) return f1;
  for (; f1 != l1; ++f1) { A i = f1; B j = f2; while (i != l1 && j != l2 && *i == *j) { ++i; ++j; } if (j == l2) return f1; }
  return l1;
}
template <class A, class B> bool lexicographical_compare(A f1, A l1, B f2, B l2) {
  for (; f1 != l1 && f2 != l2; ++f1, ++f2) { if (*f1 < *f2) return true; if (*f2 < *f1) return false; }
  return f1 == l1 && f2 != l2;
}
template <class It> It min_element(It first, It last) { if (first == last) return last; It r = first; while (++first != last) if (*first < *r) r = first; return r; }
template <class It, class C> It min_element(It first, It last, C comp) { if (first == last) return last; It r = first; while (++first != last) if (comp(*first, *r)) r = first; return r; }
template <class It> It max_element(It first, It last) { if (first == last) return last; It r = first; while (++first != last) if (*r < *first) r = first; return r; }
template <class It, class C> It max_element(It first, It last, C comp) { if (first == last) return last; It r = first; while (++first != last) if (comp(*r, *first)) r = first; return r; }
template <class T> constexpr const T& clamp(const T& v, const T& lo, const T& hi) { return v < lo ? lo : (hi < v ? hi : v); }

// ---- modifying ----------------------------------------------------------------------------------------------------------------
template <class A, class B> void iter_swap(A a, B b) { swap(*a, *b); }
template <class A, class B> B copy(A first, A last, B out) { for (; first != last; ++first, ++out) *out = *first; return out; }
template <class A, class N, class B> B copy_n(A first, N n, B out) { for (N i = 0; i < n; ++i, ++first, ++out) *out = *first; return out; }
template <class A, class B, class P> B copy_if(A first, A last, B out, P p) { for (; first != last; ++first) if (p(*first)) { *out = *first; ++out; } return out; }
template <class A, class B> B copy_backward(A first, A last, B out) { while (first != last) { --last; --out; *out = *last; } return out; }
template <class A, class B> B move(A first, A last, B out) { for (; first != last; ++first, ++out) *out = std::move(*first); return out; }
template <class A, class B> B move_backward(A first, A last, B out) { while (first != last) { --last; --out; *out = std::move(*last); } return out; }
template <class It, class T> void fill(It first, It last, const T& v) { for (; first != last; ++first) *first = v; }
template <class It, class N, class T> It fill_n(It first, N n, const T& v) { for (N i = 0; i < n; ++i, ++first) *first = v; return first; }
template <class It, class G> void generate(It first, It last, G g) { for (; first != last; ++first) *first = g(); }
template <class A, class B, class F> B transform(A first, A last, B out, F f) { for (; first != last; ++first, ++out) *out = f(*first); return out; }
template <class A, class B, class C, class F> C transform(A f1, A l1, B f2, C out, F f) { for (; f1 != l1; ++f1, ++f2, ++out) *out = f(*f1, *f2); return out; }
template <class It, class T> void replace(It first, It last, const T& a, const T& b) { for (; first != last; ++first) if (*first == a) *first = b; }
template <class It, class P, class T> void replace_if(It first, It last, P p, const T& b) { for (; first != last; ++first) if (p(*first)) *first = b; }
template <class A, class B> B swap_ranges(A f1, A l1, B f2) { for (; f1 != l1; ++f1, ++f2) iter_swap(f1, f2); return f2; }
template <class It> void reverse(It first, It last) {
  while (first != last && first != --last) { iter_swap(first, last); ++first; }
}
template <class It, class T> It remove(It first, It last, const T& v) {
  It out = first;
  for (; first != last; ++first) if (!(*first == v)) { if (out != first) *out = std::move(*first); ++out; }
  return out;
}
template <class It, class P> It remove_if(It first, It last, P p) {
  It out = first;
  for (; first != last; ++first) if (!p(*first)) { if (out != first) *out = std::move(*first); ++out; }
  return out;
}
template <class It> It unique(It first, It last) {
  if (first == last) return last;
  It out = first;
  while (++first != last) if (!(*out == *first)) { ++out; if (out != first) *out = std::move(*first); }
  return ++out;
}
template <class It, class P> It unique(It first, It last, P p) {
  if (first == last) return last;
  It out = first;
  while (++first != last) if (!p(*out, *first)) { ++out; if (out != first) *out = std::move(*first); }
  return ++out;
}
template <class It> It rotate(It first, It mid, It last) {
  if (first == mid) return last;
  if (mid == last) return first;
  It next = mid;
  It ret = first;
  // three reversals: the classic, simple left rotation
  reverse(first, mid); reverse(mid, last); reverse(first, last);
  ret = first; advance(ret, distance(mid, last));
  (void)next;
  return ret;
}
template <class It, class P> It partition(It first, It last, P p) {
  first = find_if_not(first, last, p);
  if (first == last) return first;
  It i = first; ++i;
  for (; i != last; ++i) if (p(*i)) { iter_swap(i, first); ++first; }
  return first;
}
template <class It, class P> It stable_partition(It first, It last, P p) {
  // simple, stable, in-place: bubble the "true" elements forward using rotations
  It out = first;
  for (It i = first; i != last; ++i) if (p(*i)) { It j = i; while (j != out) { It k = j; --k; iter_swap(j, k); j = k; } ++out; }
  return out;
}
template <class It, class P> bool is_partitioned(It first, It last, P p) {
  first = find_if_not(first, last, p);
  for (; first != last; ++first) if (p(*first)) return false;
  return true;
}

// ---- heaps and sorting (libstdc++ algorithms) ----------------------------------------------------------------------------------
struct __less_ { template <class A, class B> bool operator()(const A& a, const B& b) const { return a < b; } };

template <class It, class T, class C> void __push_heap(It first, ptrdiff_t hole, ptrdiff_t top, T value, C comp) {
  ptrdiff_t parent = (hole - 1) / 2;
  while (hole > top && comp(*(first + parent), value)) { *(first + hole) = std::move(*(first + parent)); hole = parent; parent = (hole - 1) / 2; }
  *(first + hole) = std::move(value);
}
template <class It, class T, class C> void __adjust_heap(It first, ptrdiff_t hole, ptrdiff_t len, T value, C comp) {
  const ptrdiff_t top = hole;
  ptrdiff_t second = hole;
  while (second < (len - 1) / 2) {
    second = 2 * (second + 1);
    if (comp(*(first + second), *(first + (second - 1)))) second--;
    *(first + hole) = std::move(*(first + second));
    hole = second;
  }
  if ((len & 1) == 0 && second == (len - 2) / 2) {
    second = 2 * (second + 1);
    *(first + hole) = std::move(*(first + (second - 1)));
    hole = second - 1;
  }
  __push_heap(first, hole, top, std::move(value), comp);
}
template <class It, class C> void __make_heap(It first, It last, C comp) {
  if (last - first < 2) return;
  const ptrdiff_t len = last - first;
  ptrdiff_t parent = (len - 2) / 2;
  while (true) {
    auto value = std::move(*(first + parent));
    __adjust_heap(first, parent, len, std::move(value), comp);
    if (parent == 0) return;
    parent--;
  }
}
template <class It, class C> void __pop_heap(It first, It last, It result, C comp) {
  auto value = std::move(*result);
  *result = std::move(*first);
  __adjust_heap(first, ptrdiff_t(0), last - first, std::move(value), comp);
}
template <class It, class C> void __sort_heap(It first, It last, C comp) {
  while (last - first > 1) { --last; __pop_heap(first, last, last, comp); }
}
template <class It, class C> void __heap_select(It first, It middle, It last, C comp) {
  __make_heap(first, middle, comp);
  for (It i = middle; i < last; ++i) if (comp(*i, *first)) __pop_heap(first, middle, i, comp);
}
template <class It> void make_heap(It first, It last) { __make_heap(first, last, __less_()); }
template <class It, class C> void make_heap(It first, It last, C comp) { __make_heap(first, last, comp); }
template <class It> void push_heap(It first, It last) { auto v = std::move(*(last - 1)); __push_heap(first, (last - first) - 1, ptrdiff_t(0), std::move(v), __less_()); }
template <class It, class C> void push_heap(It first, It last, C comp) { auto v = std::move(*(last - 1)); __push_heap(first, (last - first) - 1, ptrdiff_t(0), std::move(v), comp); }
template <class It> void pop_heap(It first, It last) { if (last - first > 1) { --last; __pop_heap(first, last, last, __less_()); } }
template <class It, class C> void pop_heap(It first, It last, C comp) { if (last - first > 1) { --last; __pop_heap(first, last, last, comp); } }
template <class It> void sort_heap(It first, It last) { __sort_heap(first, last, __less_()); }
template <class It, class C> void sort_heap(It first, It last, C comp) { __sort_heap(first, last, comp); }
template <class It> bool is_heap(It first, It last) { ptrdiff_t n = last - first; for (ptrdiff_t i = 1; i < n; ++i) if (*(first + (i - 1) / 2) < *(first + i)) return false; return true; }

template <class It, class C> void __unguarded_linear_insert(It last, C comp) {
  auto val = std::move(*last);
  It next = last; --next;
  while (comp(val, *next)) { *last = std::move(*next); last = next; --next; }
  *last = std::move(val);
}
template <class It, class C> void __insertion_sort(It first, It last, C comp) {
  if (first == last) return;
  for (It i = first + 1; i != last; ++i) {
    if (comp(*i, *first)) {
      auto val = std::move(*i);
      std::move_backward(first, i, i + 1);
      *first = std::move(val);
    } else __unguarded_linear_insert(i, comp);
  }
}
template <class It, class C> void __unguarded_insertion_sort(It first, It last, C comp) { for (It i = first; i != last; ++i) __unguarded_linear_insert(i, comp); }
template <class It, class C> void __final_insertion_sort(It first, It last, C comp) {
  if (last - first > 16) { __insertion_sort(first, first + 16, comp); __unguarded_insertion_sort(first + 16, last, comp); }
  else __insertion_sort(first, last, comp);
}
template <class It, class C> void __move_median_to_first(It result, It a, It b, It c, C comp) {
  if (comp(*a, *b)) {
    if (comp(*b, *c)) iter_swap(result, b);
    else if (comp(*a, *c)) iter_swap(result, c);
    else iter_swap(result, a);
  } else if (comp(*a, *c)) iter_swap(result, a);
  else if (comp(*b, *c)) iter_swap(result, c);
  else iter_swap(result, b);
}
template <class It, class C> It __unguarded_partition(It first, It last, It pivot, C comp) {
  while (true) {
    while (comp(*first, *pivot)) ++first;
    --last;
    while (comp(*pivot, *last)) --last;
    if (!(first < last)) return first;
    iter_swap(first, last);
    ++first;
  }
}
template <class It, class C> It __unguarded_partition_pivot(It first, It last, C comp) {
  It mid = first + (last - first) / 2;
  __move_median_to_first(first, first + 1, mid, last - 1, comp);
  return __unguarded_partition(first + 1, last, first, comp);
}
inline int __lg(ptrdiff_t n) { int k = 0; for (; n > 1; n >>= 1) ++k; return k; }
template <class It, class C> void __partial_sort(It first, It middle, It last, C comp) { __heap_select(first, middle, last, comp); __sort_heap(first, middle, comp); }
template <class It, class C> void __introsort_loop(It first, It last, int depth, C comp) {
  while (last - first > 16) {
    if (depth == 0) { __partial_sort(first, last, last, comp); return; }
    --depth;
    It cut = __unguarded_partition_pivot(first, last, comp);
    __introsort_loop(cut, last, depth, comp);
    last = cut;
  }
}
template <class It> void sort(It first, It last) {
  if (first != last) { __introsort_loop(first, last, __lg(last - first) * 2, __less_()); __final_insertion_sort(first, last, __less_()); }
}
template <class It, class C> void sort(It first, It last, C comp) {
  if (first != last) { __introsort_loop(first, last, __lg(last - first) * 2, comp); __final_insertion_sort(first, last, comp); }
}
template <class It> void partial_sort(It first, It middle, It last) { __partial_sort(first, middle, last, __less_()); }
template <class It, class C> void partial_sort(It first, It middle, It last, C comp) { __partial_sort(first, middle, last, comp); }
template <class It, class C> void __introselect(It first, It nth, It last, int depth, C comp) {
  while (last - first > 3) {
    if (depth == 0) { __heap_select(first, nth + 1, last, comp); iter_swap(first, nth); return; }
    --depth;
    It cut = __unguarded_partition_pivot(first, last, comp);
    if (cut <= nth) first = cut; else last = cut;
  }
  __insertion_sort(first, last, comp);
}
template <class It> void nth_element(It first, It nth, It last) { if (first == last || nth == last) return; __introselect(first, nth, last, __lg(last - first) * 2, __less_()); }
template <class It, class C> void nth_element(It first, It nth, It last, C comp) { if (first == last || nth == last) return; __introselect(first, nth, last, __lg(last - first) * 2, comp); }
template <class It, class C> void __inplace_merge(It first, It mid, It last, C comp) {
  // stable merge without a buffer: insert each element of the right half into the left half
  for (It j = mid; j != last; ++j) {
    It i = j;
    while (i != first) { It p = i; --p; if (comp(*i, *p)) { iter_swap(i, p); i = p; } else break; }
  }
}
template <class It> void inplace_merge(It first, It mid, It last) { __inplace_merge(first, mid, last, __less_()); }
template <class It, class C> void inplace_merge(It first, It mid, It last, C comp) { __inplace_merge(first, mid, last, comp); }
template <class It, class C> void __stable_sort(It first, It last, C comp) {
  // stable insertion sort (the output of a stable sort is unique, so it matches g++/MSVC)
  if (last - first < 2) return;
  for (It i = first + 1; i != last; ++i) { It j = i; while (j != first) { It p = j; --p; if (comp(*j, *p)) { iter_swap(j, p); j = p; } else break; } }
}
template <class It> void stable_sort(It first, It last) { __stable_sort(first, last, __less_()); }
template <class It, class C> void stable_sort(It first, It last, C comp) { __stable_sort(first, last, comp); }
template <class It> bool is_sorted(It first, It last) { if (first == last) return true; It nx = first; while (++nx != last) { if (*nx < *first) return false; first = nx; } return true; }
template <class It, class C> bool is_sorted(It first, It last, C comp) { if (first == last) return true; It nx = first; while (++nx != last) { if (comp(*nx, *first)) return false; first = nx; } return true; }

// ---- binary search on sorted ranges ---------------------------------------------------------------------------------------------
template <class It, class T, class C> It __lower_bound(It first, It last, const T& v, C comp) {
  ptrdiff_t len = distance(first, last);
  while (len > 0) { ptrdiff_t half = len >> 1; It mid = first; advance(mid, half); if (comp(*mid, v)) { first = mid; ++first; len = len - half - 1; } else len = half; }
  return first;
}
template <class It, class T, class C> It __upper_bound(It first, It last, const T& v, C comp) {
  ptrdiff_t len = distance(first, last);
  while (len > 0) { ptrdiff_t half = len >> 1; It mid = first; advance(mid, half); if (comp(v, *mid)) len = half; else { first = mid; ++first; len = len - half - 1; } }
  return first;
}
template <class It, class T> It lower_bound(It first, It last, const T& v) { return __lower_bound(first, last, v, __less_()); }
template <class It, class T, class C> It lower_bound(It first, It last, const T& v, C comp) { return __lower_bound(first, last, v, comp); }
template <class It, class T> It upper_bound(It first, It last, const T& v) { return __upper_bound(first, last, v, __less_()); }
template <class It, class T, class C> It upper_bound(It first, It last, const T& v, C comp) { return __upper_bound(first, last, v, comp); }
template <class It, class T> bool binary_search(It first, It last, const T& v) { It i = lower_bound(first, last, v); return i != last && !(v < *i); }
template <class It, class T> pair<It, It> equal_range(It first, It last, const T& v) { return pair<It, It>(lower_bound(first, last, v), upper_bound(first, last, v)); }

template <class A, class B, class O> O merge(A f1, A l1, B f2, B l2, O out) {
  while (f1 != l1 && f2 != l2) { if (*f2 < *f1) { *out = *f2; ++f2; } else { *out = *f1; ++f1; } ++out; }
  out = copy(f1, l1, out);
  return copy(f2, l2, out);
}
template <class It> bool next_permutation(It first, It last) {
  if (first == last) return false;
  It i = last; --i;
  if (first == i) return false;
  while (true) {
    It i1 = i; --i;
    if (*i < *i1) {
      It j = last;
      while (!(*i < *--j)) {}
      iter_swap(i, j);
      reverse(i1, last);
      return true;
    }
    if (i == first) { reverse(first, last); return false; }
  }
}
template <class It> bool prev_permutation(It first, It last) {
  if (first == last) return false;
  It i = last; --i;
  if (first == i) return false;
  while (true) {
    It i1 = i; --i;
    if (*i1 < *i) {
      It j = last;
      while (!(*--j < *i)) {}
      iter_swap(i, j);
      reverse(i1, last);
      return true;
    }
    if (i == first) { reverse(first, last); return false; }
  }
}

// ---- <numeric> -----------------------------------------------------------------------------------------------------------------
template <class It, class T> T accumulate(It first, It last, T init) { for (; first != last; ++first) init = init + *first; return init; }
template <class It, class T, class F> T accumulate(It first, It last, T init, F f) { for (; first != last; ++first) init = f(init, *first); return init; }
template <class A, class B, class T> T inner_product(A f1, A l1, B f2, T init) { for (; f1 != l1; ++f1, ++f2) init = init + (*f1) * (*f2); return init; }
template <class It, class T> void iota(It first, It last, T v) { for (; first != last; ++first, ++v) *first = v; }
template <class A, class B> B partial_sum(A first, A last, B out) {
  if (first == last) return out;
  auto sum = *first; *out = sum;
  while (++first != last) { sum = sum + *first; *++out = sum; }
  return ++out;
}
template <class A, class B> B adjacent_difference(A first, A last, B out) {
  if (first == last) return out;
  auto acc = *first; *out = acc;
  while (++first != last) { auto val = *first; *++out = val - acc; acc = val; }
  return ++out;
}
template <class T> constexpr T __gcd_(T a, T b) { while (b != 0) { T t = a % b; a = b; b = t; } return a; }
template <class A, class B> constexpr auto gcd(A a, B b) -> decltype(a + b) { return __gcd_<decltype(a + b)>(a < 0 ? -a : a, b < 0 ? -b : b); }
template <class A, class B> constexpr auto lcm(A a, B b) -> decltype(a + b) { return (a == 0 || b == 0) ? 0 : (a < 0 ? -a : a) / gcd(a, b) * (b < 0 ? -b : b); }
}
