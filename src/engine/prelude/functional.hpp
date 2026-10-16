// <tuple>, <optional>, <functional>(std::function, ref, bind-less subset)
namespace std {
// ---------------------------------------------------------------------------------------------------------------- tuple
template <class... T> class tuple;
template <> class tuple<> { public: tuple() {} };
template <class H, class... T> class tuple<H, T...> : public tuple<T...> {
 public:
  H _head;
  tuple() : tuple<T...>(), _head() {}
  tuple(const H& h, const T&... t) : tuple<T...>(t...), _head(h) {}
  tuple(const tuple& o) : tuple<T...>(static_cast<const tuple<T...>&>(o)), _head(o._head) {}
  template <class U, class... V> tuple& operator=(const tuple<U, V...>& o) { static_cast<tuple<T...>&>(*this) = static_cast<const tuple<V...>&>(o); _head = o._head; return *this; }
  tuple& operator=(const tuple& o) { static_cast<tuple<T...>&>(*this) = static_cast<const tuple<T...>&>(o); _head = o._head; return *this; }
};
template <class T> struct tuple_size;
template <class... T> struct tuple_size<tuple<T...>> : integral_constant<size_t, sizeof...(T)> {};
template <size_t I, class T> struct tuple_element;
template <class H, class... T> struct tuple_element<0, tuple<H, T...>> { typedef H type; };
template <size_t I, class H, class... T> struct tuple_element<I, tuple<H, T...>> { typedef typename tuple_element<I - 1, tuple<T...>>::type type; };

template <size_t I> struct __tget {
  template <class H, class... T> static typename tuple_element<I, tuple<H, T...>>::type& get(tuple<H, T...>& t) { return __tget<I - 1>::get(static_cast<tuple<T...>&>(t)); }
  template <class H, class... T> static const typename tuple_element<I, tuple<H, T...>>::type& cget(const tuple<H, T...>& t) { return __tget<I - 1>::cget(static_cast<const tuple<T...>&>(t)); }
};
template <> struct __tget<0> {
  template <class H, class... T> static H& get(tuple<H, T...>& t) { return t._head; }
  template <class H, class... T> static const H& cget(const tuple<H, T...>& t) { return t._head; }
};
template <size_t I, class... T> typename tuple_element<I, tuple<T...>>::type& get(tuple<T...>& t) { return __tget<I>::get(t); }
template <size_t I, class... T> const typename tuple_element<I, tuple<T...>>::type& get(const tuple<T...>& t) { return __tget<I>::cget(t); }

template <class... T> tuple<typename remove_reference<T>::type...> make_tuple(T&&... t) { return tuple<typename remove_reference<T>::type...>(t...); }
template <class... T> tuple<T&...> tie(T&... t) { return tuple<T&...>(t...); }

// -------------------------------------------------------------------------------------------------------------- optional
struct nullopt_t { explicit nullopt_t(int) {} };
const nullopt_t nullopt(0);
class bad_optional_access : public exception {
 public:
  const char* what() const noexcept { return "bad optional access"; }
};
template <class T> class optional {
 public:
  alignas(T) unsigned char _store[sizeof(T)];
  bool _has;
  T* _p() { return reinterpret_cast<T*>(_store); }
  const T* _p() const { return reinterpret_cast<const T*>(_store); }
  optional() : _has(false) {}
  optional(nullopt_t) : _has(false) {}
  optional(const T& v) : _has(true) { ::new (static_cast<void*>(_store)) T(v); }
  optional(const optional& o) : _has(o._has) { if (o._has) ::new (static_cast<void*>(_store)) T(*o._p()); }
  ~optional() { reset(); }
  optional& operator=(nullopt_t) { reset(); return *this; }
  optional& operator=(const optional& o) {
    if (this == &o) return *this;
    if (o._has) { if (_has) *_p() = *o._p(); else { ::new (static_cast<void*>(_store)) T(*o._p()); _has = true; } }
    else reset();
    return *this;
  }
  optional& operator=(const T& v) { if (_has) *_p() = v; else { ::new (static_cast<void*>(_store)) T(v); _has = true; } return *this; }
  template <class... A> T& emplace(A&&... a) { reset(); ::new (static_cast<void*>(_store)) T(forward<A>(a)...); _has = true; return *_p(); }
  void reset() { if (_has) { _p()->~T(); _has = false; } }
  bool has_value() const { return _has; }
  explicit operator bool() const { return _has; }
  T& operator*() { return *_p(); }
  const T& operator*() const { return *_p(); }
  T* operator->() { return _p(); }
  const T* operator->() const { return _p(); }
  T& value() { if (!_has) throw bad_optional_access(); return *_p(); }
  const T& value() const { if (!_has) throw bad_optional_access(); return *_p(); }
  template <class U> T value_or(const U& d) const { return _has ? *_p() : static_cast<T>(d); }
};
template <class T> optional<T> make_optional(const T& v) { return optional<T>(v); }
template <class T> bool operator==(const optional<T>& a, const optional<T>& b) { return a.has_value() == b.has_value() && (!a.has_value() || *a == *b); }
template <class T> bool operator!=(const optional<T>& a, const optional<T>& b) { return !(a == b); }
template <class T> bool operator==(const optional<T>& a, nullopt_t) { return !a.has_value(); }
template <class T> bool operator!=(const optional<T>& a, nullopt_t) { return a.has_value(); }

// ------------------------------------------------------------------------------------------------------------- function
class bad_function_call : public exception {
 public:
  const char* what() const noexcept { return "bad_function_call"; }
};
template <class Sig> class function;
template <class R, class... A> class function<R(A...)> {
 public:
  struct _base {
    virtual R call(A... a) = 0;
    virtual _base* clone() const = 0;
    virtual ~_base() {}
  };
  template <class F> struct _impl : _base {
    F f;
    _impl(const F& x) : f(x) {}
    R call(A... a) { return f(forward<A>(a)...); }
    _base* clone() const { return new _impl<F>(f); }
  };
  _base* _p;
  function() : _p(0) {}
  function(nullptr_t) : _p(0) {}
  template <class F, class = typename enable_if<!is_same<F, function>::value>::type> function(F f) : _p(new _impl<F>(f)) {}
  function(const function& o) : _p(o._p ? o._p->clone() : 0) {}
  ~function() { delete _p; }
  function& operator=(const function& o) { if (this != &o) { _base* n = o._p ? o._p->clone() : 0; delete _p; _p = n; } return *this; }
  function& operator=(nullptr_t) { delete _p; _p = 0; return *this; }
  template <class F, class = typename enable_if<!is_same<F, function>::value>::type> function& operator=(F f) { _base* n = new _impl<F>(f); delete _p; _p = n; return *this; }
  explicit operator bool() const { return _p != 0; }
  R operator()(A... a) const { if (!_p) throw bad_function_call(); return _p->call(forward<A>(a)...); }
};
}
