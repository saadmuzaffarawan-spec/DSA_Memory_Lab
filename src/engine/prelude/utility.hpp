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

template <class T> struct is_const : false_type {};
template <class T> struct is_const<const T> : true_type {};
template <class T> struct is_volatile : false_type {};
template <class T> struct is_volatile<volatile T> : true_type {};
template <class T> struct is_reference : false_type {};
template <class T> struct is_reference<T&> : true_type {};
template <class T> struct is_reference<T&&> : true_type {};
template <class T> struct is_rvalue_reference : false_type {};
template <class T> struct is_rvalue_reference<T&&> : true_type {};
template <class T> struct is_array : false_type {};
template <class T> struct is_array<T[]> : true_type {};
template <class T, size_t N> struct is_array<T[N]> : true_type {};
template <class T> struct is_void : false_type {};
template <> struct is_void<void> : true_type {};
template <class T> struct is_null_pointer : false_type {};
template <> struct is_null_pointer<nullptr_t> : true_type {};
template <class T> struct is_arithmetic : integral_constant<bool, is_integral<T>::value || is_floating_point<T>::value> {};
template <class T> struct is_fundamental : integral_constant<bool, is_arithmetic<T>::value || is_void<T>::value || is_null_pointer<T>::value> {};
template <class T> struct is_signed : integral_constant<bool, is_arithmetic<T>::value && T(-1) < T(0)> {};
template <class T> struct is_unsigned : integral_constant<bool, is_arithmetic<T>::value && T(0) < T(-1)> {};
template <class T> struct is_enum : integral_constant<bool, __is_enum(T)> {};
template <class T> struct is_class : integral_constant<bool, __is_class(T)> {};
template <class T> struct is_union : integral_constant<bool, __is_union(T)> {};
template <class T> struct is_polymorphic : integral_constant<bool, __is_polymorphic(T)> {};
template <class T> struct is_abstract : integral_constant<bool, __is_abstract(T)> {};
template <class T> struct is_final : integral_constant<bool, __is_final(T)> {};
template <class T> struct is_empty : integral_constant<bool, __is_empty(T)> {};
template <class T> struct is_aggregate : integral_constant<bool, __is_aggregate(T)> {};
template <class T> struct is_standard_layout : integral_constant<bool, __is_standard_layout(T)> {};
template <class T> struct is_trivial : integral_constant<bool, __is_trivial(T)> {};
template <class T> struct is_pod : integral_constant<bool, __is_pod(T)> {};
template <class T> struct is_trivially_copyable : integral_constant<bool, __is_trivially_copyable(T)> {};
template <class T> struct is_trivially_destructible : integral_constant<bool, __is_trivially_destructible(T)> {};
template <class T> struct is_trivially_default_constructible : integral_constant<bool, __is_trivially_default_constructible(T)> {};
template <class T> struct is_copy_constructible : integral_constant<bool, __is_copy_constructible(T)> {};
template <class T> struct is_move_constructible : integral_constant<bool, __is_move_constructible(T)> {};
template <class T> struct is_default_constructible : integral_constant<bool, __is_default_constructible(T)> {};
template <class T> struct is_copy_assignable : integral_constant<bool, __is_copy_assignable(T)> {};
template <class T> struct is_move_assignable : integral_constant<bool, __is_move_assignable(T)> {};
template <class T> struct is_destructible : integral_constant<bool, __is_destructible(T)> {};
template <class T> struct is_nothrow_move_constructible : integral_constant<bool, __is_nothrow_move_constructible(T)> {};
template <class T> struct is_nothrow_copy_constructible : integral_constant<bool, __is_nothrow_copy_constructible(T)> {};
template <class T> struct is_nothrow_default_constructible : integral_constant<bool, __is_nothrow_default_constructible(T)> {};
template <class T> struct is_nothrow_move_assignable : integral_constant<bool, __is_nothrow_move_assignable(T)> {};
template <class T> struct is_nothrow_copy_assignable : integral_constant<bool, __is_nothrow_copy_assignable(T)> {};
template <class T> struct is_nothrow_destructible : integral_constant<bool, __is_nothrow_destructible(T)> {};
template <class B, class D> struct is_base_of : integral_constant<bool, __is_base_of(B, D)> {};
template <class A, class B> struct is_convertible : integral_constant<bool, __is_convertible(A, B)> {};
template <class T> struct add_const { typedef const T type; };
template <class T> struct add_pointer { typedef typename remove_reference<T>::type* type; };
template <class T> struct add_lvalue_reference { typedef T& type; };
template <class T> struct add_rvalue_reference { typedef T&& type; };
template <class T> struct remove_pointer { typedef T type; };
template <class T> struct remove_pointer<T*> { typedef T type; };
template <class T> struct remove_extent { typedef T type; };
template <class T> struct remove_extent<T[]> { typedef T type; };
template <class T, size_t N> struct remove_extent<T[N]> { typedef T type; };
template <class T> struct decay { typedef typename remove_cv<typename remove_reference<T>::type>::type type; };
template <class T> struct decay<T[]> { typedef T* type; };
template <class T, size_t N> struct decay<T[N]> { typedef T* type; };
template <class...> struct make_void { typedef void type; };
template <class... T> using void_t = void;
template <class T> typename add_rvalue_reference<T>::type declval() noexcept;
template <bool B, class T = void> using enable_if_t = typename enable_if<B, T>::type;
template <bool B, class T, class F> using conditional_t = typename conditional<B, T, F>::type;
template <class T> using remove_reference_t = typename remove_reference<T>::type;
template <class T> using remove_cv_t = typename remove_cv<T>::type;
template <class T> using decay_t = typename decay<T>::type;
template <class T> struct make_unsigned { typedef T type; };
template <> struct make_unsigned<char> { typedef unsigned char type; };
template <> struct make_unsigned<signed char> { typedef unsigned char type; };
template <> struct make_unsigned<short> { typedef unsigned short type; };
template <> struct make_unsigned<int> { typedef unsigned int type; };
template <> struct make_unsigned<long> { typedef unsigned long type; };
template <> struct make_unsigned<long long> { typedef unsigned long long type; };
template <class T> struct make_signed { typedef T type; };
template <> struct make_signed<unsigned char> { typedef signed char type; };
template <> struct make_signed<unsigned short> { typedef short type; };
template <> struct make_signed<unsigned int> { typedef int type; };
template <> struct make_signed<unsigned long> { typedef long type; };
template <> struct make_signed<unsigned long long> { typedef long long type; };
template <class T, class U> inline constexpr bool is_same_v = is_same<T, U>::value;
template <class T> inline constexpr bool is_integral_v = is_integral<T>::value;
template <class T> inline constexpr bool is_floating_point_v = is_floating_point<T>::value;
template <class T> inline constexpr bool is_pointer_v = is_pointer<T>::value;
template <class T> inline constexpr bool is_class_v = is_class<T>::value;
template <class T> inline constexpr bool is_arithmetic_v = is_arithmetic<T>::value;
template <class T> inline constexpr bool is_trivially_copyable_v = is_trivially_copyable<T>::value;
template <class B, class D> inline constexpr bool is_base_of_v = is_base_of<B, D>::value;
template <class T> typename conditional<!is_nothrow_move_constructible<T>::value && is_copy_constructible<T>::value, const T&, T&&>::type move_if_noexcept(T& x) noexcept { return static_cast<typename conditional<!is_nothrow_move_constructible<T>::value && is_copy_constructible<T>::value, const T&, T&&>::type>(x); }
template <class T> constexpr const T& as_const(T& t) noexcept { return t; }
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

struct piecewise_construct_t { explicit piecewise_construct_t() {} };
template <class A, class B> struct pair {
  typedef A first_type; typedef B second_type;
  A first; B second;
  constexpr pair() : first(), second() {}
  constexpr pair(const A& a, const B& b) : first(a), second(b) {}
  template <class U, class V, class = typename enable_if<!is_same<typename remove_cv<typename remove_reference<U>::type>::type, piecewise_construct_t>::value>::type> constexpr pair(U&& a, V&& b) : first(forward<U>(a)), second(forward<V>(b)) {}
  template <class U, class V> constexpr pair(const pair<U, V>& p) : first(p.first), second(p.second) {}
  template <class K2, class... Args> pair(piecewise_construct_t, K2&& k, Args&&... a) : first(forward<K2>(k)), second(forward<Args>(a)...) {}
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
