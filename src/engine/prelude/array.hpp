// <array>: a plain aggregate wrapping a C array.
namespace std {
template <class T, size_t N>
struct array {
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
#if defined(_WIN32)
  T _Elems[N ? N : 1];
#define SY_EL _Elems
#else
  T _M_elems[N ? N : 1];
#define SY_EL _M_elems
#endif
  T& operator[](size_t i) {
#if defined(_WIN32)
    if (i >= N) __debug_assert("array subscript out of range");
#endif
    return SY_EL[i];
  }
  const T& operator[](size_t i) const {
#if defined(_WIN32)
    if (i >= N) __debug_assert("array subscript out of range");
#endif
    return SY_EL[i];
  }
  T& at(size_t i) {
    if (i >= N) {
#if defined(_WIN32)
      throw out_of_range("invalid array subscript");
#elif defined(__APPLE__)
      throw out_of_range("array::at");
#else
      char buf[128];
      snprintf(buf, 128, "array::at: __n (which is %zu) >= _Nm (which is %zu)", i, static_cast<size_t>(N));
      throw out_of_range(buf);
#endif
    }
    return SY_EL[i];
  }
  const T& at(size_t i) const { return const_cast<array*>(this)->at(i); }
  T& front() { return SY_EL[0]; }
  const T& front() const { return SY_EL[0]; }
  T& back() { return SY_EL[N ? N - 1 : 0]; }
  const T& back() const { return SY_EL[N ? N - 1 : 0]; }
  T* data() noexcept { return SY_EL; }
  const T* data() const noexcept { return SY_EL; }
  iterator begin() noexcept { return SY_EL; }
  const_iterator begin() const noexcept { return SY_EL; }
  const_iterator cbegin() const noexcept { return SY_EL; }
  iterator end() noexcept { return SY_EL + N; }
  const_iterator end() const noexcept { return SY_EL + N; }
  const_iterator cend() const noexcept { return SY_EL + N; }
  reverse_iterator rbegin() noexcept { return reverse_iterator(end()); }
  reverse_iterator rend() noexcept { return reverse_iterator(begin()); }
  const_reverse_iterator rbegin() const noexcept { return const_reverse_iterator(end()); }
  const_reverse_iterator rend() const noexcept { return const_reverse_iterator(begin()); }
  constexpr bool empty() const noexcept { return N == 0; }
  constexpr size_t size() const noexcept { return N; }
  constexpr size_t max_size() const noexcept { return N; }
  void fill(const T& v) { for (size_t i = 0; i < N; ++i) SY_EL[i] = v; }
  void swap(array& o) { for (size_t i = 0; i < N; ++i) std::swap(SY_EL[i], o.SY_EL[i]); }
};
#undef SY_EL
template <class T, size_t N> inline bool operator==(const array<T, N>& a, const array<T, N>& b) { return std::equal(a.begin(), a.end(), b.begin()); }
template <class T, size_t N> inline bool operator!=(const array<T, N>& a, const array<T, N>& b) { return !(a == b); }
template <class T, size_t N> inline bool operator<(const array<T, N>& a, const array<T, N>& b) { return std::lexicographical_compare(a.begin(), a.end(), b.begin(), b.end()); }
template <class T, size_t N> inline bool operator>(const array<T, N>& a, const array<T, N>& b) { return b < a; }
template <class T, size_t N> inline bool operator<=(const array<T, N>& a, const array<T, N>& b) { return !(b < a); }
template <class T, size_t N> inline bool operator>=(const array<T, N>& a, const array<T, N>& b) { return !(a < b); }
template <class T, size_t N> inline void swap(array<T, N>& a, array<T, N>& b) { a.swap(b); }
}
