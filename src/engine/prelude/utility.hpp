// <utility>, <type_traits> (subset), <algorithm>-lite helpers used everywhere.
namespace std {
template <class T, T v> struct integral_constant { static constexpr T value = v; typedef T value_type; constexpr operator T() const { return v; } };
typedef integral_constant<bool, true> true_type;
typedef integral_constant<bool, false> false_type;
template <class T> struct remove_reference { typedef T type; };
template <class T> struct remove_reference<T&> { typedef T type; };
template <class T> struct remove_reference<T&&> { typedef T type; };
template <class T> struct remove_const { typedef T type; };
template <class T> struct remove_const<const T> { typedef T type; };
template <class T> struct remove_cv { typedef T type; };
template <class T> struct remove_cv<const T> { typedef T type; };
template <class T> struct remove_cv<volatile T> { typedef T type; };
template <class T> struct remove_cv<const volatile T> { typedef T type; };
template <class T> struct is_lvalue_reference : false_type {};
template <class T> struct is_lvalue_reference<T&> : true_type {};
template <class T, class U> struct is_same : false_type {};
template <class T> struct is_same<T, T> : true_type {};
template <bool B, class T = void> struct enable_if {};
template <class T> struct enable_if<true, T> { typedef T type; };
template <bool B, class T, class F> struct conditional { typedef T type; };
template <class T, class F> struct conditional<false, T, F> { typedef F type; };
template <class T> struct is_pointer : false_type {};
template <class T> struct is_pointer<T*> : true_type {};
template <class T> struct is_integral : false_type {};
template <> struct is_integral<bool> : true_type {};
template <> struct is_integral<char> : true_type {};
template <> struct is_integral<signed char> : true_type {};
template <> struct is_integral<unsigned char> : true_type {};
template <> struct is_integral<short> : true_type {};
template <> struct is_integral<unsigned short> : true_type {};
template <> struct is_integral<int> : true_type {};
template <> struct is_integral<unsigned int> : true_type {};
template <> struct is_integral<long> : true_type {};
template <> struct is_integral<unsigned long> : true_type {};
template <> struct is_integral<long long> : true_type {};
template <> struct is_integral<unsigned long long> : true_type {};
template <class T> struct is_floating_point : false_type {};
template <> struct is_floating_point<float> : true_type {};
template <> struct is_floating_point<double> : true_type {};
template <> struct is_floating_point<long double> : true_type {};

template <class T> constexpr typename remove_reference<T>::type&& move(T&& t) noexcept { return static_cast<typename remove_reference<T>::type&&>(t); }
template <class T> constexpr T&& forward(typename remove_reference<T>::type& t) noexcept { return static_cast<T&&>(t); }
template <class T> constexpr T&& forward(typename remove_reference<T>::type&& t) noexcept { return static_cast<T&&>(t); }
template <class T> void swap(T& a, T& b) { T tmp = move(a); a = move(b); b = move(tmp); }
template <class T, class U = T> T exchange(T& obj, U&& nv) { T old = move(obj); obj = forward<U>(nv); return old; }
template <class T> constexpr const T& min(const T& a, const T& b) { return (b < a) ? b : a; }
template <class T> constexpr const T& max(const T& a, const T& b) { return (a < b) ? b : a; }
template <class T, class C> constexpr const T& min(const T& a, const T& b, C comp) { return comp(b, a) ? b : a; }
template <class T, class C> constexpr const T& max(const T& a, const T& b, C comp) { return comp(a, b) ? b : a; }
template <class T> T min(initializer_list<T> il) { const T* p = il.begin(); T m = *p; for (++p; p != il.end(); ++p) if (*p < m) m = *p; return m; }
template <class T> T max(initializer_list<T> il) { const T* p = il.begin(); T m = *p; for (++p; p != il.end(); ++p) if (m < *p) m = *p; return m; }

template <class A, class B> struct pair {
  typedef A first_type; typedef B second_type;
  A first; B second;
  constexpr pair() : first(), second() {}
  constexpr pair(const A& a, const B& b) : first(a), second(b) {}
  template <class U, class V> constexpr pair(U&& a, V&& b) : first(forward<U>(a)), second(forward<V>(b)) {}
  template <class U, class V> constexpr pair(const pair<U, V>& p) : first(p.first), second(p.second) {}
  pair(const pair&) = default;
  pair(pair&&) = default;
  pair& operator=(const pair& p) { first = p.first; second = p.second; return *this; }
  void swap(pair& o) { std::swap(first, o.first); std::swap(second, o.second); }
};
template <class A, class B> constexpr pair<typename remove_cv<typename remove_reference<A>::type>::type, typename remove_cv<typename remove_reference<B>::type>::type> make_pair(A&& a, B&& b) {
  return pair<typename remove_cv<typename remove_reference<A>::type>::type, typename remove_cv<typename remove_reference<B>::type>::type>(forward<A>(a), forward<B>(b));
}
template <class A, class B> constexpr bool operator==(const pair<A, B>& x, const pair<A, B>& y) { return x.first == y.first && x.second == y.second; }
template <class A, class B> constexpr bool operator!=(const pair<A, B>& x, const pair<A, B>& y) { return !(x == y); }
template <class A, class B> constexpr bool operator<(const pair<A, B>& x, const pair<A, B>& y) { return x.first < y.first || (!(y.first < x.first) && x.second < y.second); }
template <class A, class B> constexpr bool operator>(const pair<A, B>& x, const pair<A, B>& y) { return y < x; }
template <class A, class B> constexpr bool operator<=(const pair<A, B>& x, const pair<A, B>& y) { return !(y < x); }
template <class A, class B> constexpr bool operator>=(const pair<A, B>& x, const pair<A, B>& y) { return !(x < y); }

template <class T> struct less { constexpr bool operator()(const T& a, const T& b) const { return a < b; } };
template <class T> struct greater { constexpr bool operator()(const T& a, const T& b) const { return a > b; } };
template <class T> struct equal_to { constexpr bool operator()(const T& a, const T& b) const { return a == b; } };
template <class T> struct plus { constexpr T operator()(const T& a, const T& b) const { return a + b; } };
template <class T> struct minus { constexpr T operator()(const T& a, const T& b) const { return a - b; } };
template <class T> struct multiplies { constexpr T operator()(const T& a, const T& b) const { return a * b; } };
}
