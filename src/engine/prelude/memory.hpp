// <memory>: default_delete, unique_ptr, shared_ptr, weak_ptr, make_unique, make_shared, enable_shared_from_this (control blocks mirror each ABI's shape)
namespace std {
template <class T> struct default_delete {
  constexpr default_delete() noexcept = default;
  template <class U> default_delete(const default_delete<U>&) noexcept {}
  void operator()(T* p) const { delete p; }
};
template <class T> struct default_delete<T[]> {
  constexpr default_delete() noexcept = default;
  void operator()(T* p) const { delete[] p; }
};

// a pointer plus a deleter; an empty deleter takes no space (the empty-base optimisation every real library uses here)
template <class P, class D, bool E = is_empty<D>::value && !is_final<D>::value> struct __cpair {
  P first; D _d;
  __cpair() : first(), _d() {}
  __cpair(P p, const D& d) : first(p), _d(d) {}
  D& second() { return _d; }
  const D& second() const { return _d; }
};
template <class P, class D> struct __cpair<P, D, true> : private D {
  P first;
  __cpair() : D(), first() {}
  __cpair(P p, const D& d) : D(d), first(p) {}
  D& second() { return *this; }
  const D& second() const { return *this; }
};

template <class T, class D = default_delete<T>> class unique_ptr {
  __cpair<T*, D> _s;
 public:
  typedef T element_type; typedef D deleter_type; typedef T* pointer;
  constexpr unique_ptr() noexcept : _s() {}
  constexpr unique_ptr(nullptr_t) noexcept : _s() {}
  explicit unique_ptr(T* p) noexcept : _s(p, D()) {}
  unique_ptr(T* p, const D& d) noexcept : _s(p, d) {}
  unique_ptr(unique_ptr&& o) noexcept : _s(o.release(), std::move(o.get_deleter())) {}
  template <class U, class E> unique_ptr(unique_ptr<U, E>&& o) noexcept : _s(o.release(), D(std::move(o.get_deleter()))) {}
  unique_ptr(const unique_ptr&) = delete;
  unique_ptr& operator=(const unique_ptr&) = delete;
  ~unique_ptr() { if (_s.first) _s.second()(_s.first); }
  unique_ptr& operator=(unique_ptr&& o) noexcept { reset(o.release()); _s.second() = std::move(o.get_deleter()); return *this; }
  template <class U, class E> unique_ptr& operator=(unique_ptr<U, E>&& o) noexcept { reset(o.release()); _s.second() = std::move(o.get_deleter()); return *this; }
  unique_ptr& operator=(nullptr_t) noexcept { reset(); return *this; }
  T& operator*() const { return *_s.first; }
  T* operator->() const noexcept { return _s.first; }
  T* get() const noexcept { return _s.first; }
  D& get_deleter() noexcept { return _s.second(); }
  const D& get_deleter() const noexcept { return _s.second(); }
  explicit operator bool() const noexcept { return _s.first != nullptr; }
  T* release() noexcept { T* t = _s.first; _s.first = nullptr; return t; }
  void reset(T* p = nullptr) noexcept { T* old = _s.first; _s.first = p; if (old) _s.second()(old); }
  void swap(unique_ptr& o) noexcept { std::swap(_s.first, o._s.first); std::swap(_s.second(), o._s.second()); }
};
template <class T, class D> class unique_ptr<T[], D> {
  __cpair<T*, D> _s;
 public:
  constexpr unique_ptr() noexcept : _s() {}
  explicit unique_ptr(T* p) noexcept : _s(p, D()) {}
  unique_ptr(unique_ptr&& o) noexcept : _s(o.release(), D()) {}
  unique_ptr(const unique_ptr&) = delete;
  unique_ptr& operator=(const unique_ptr&) = delete;
  ~unique_ptr() { if (_s.first) _s.second()(_s.first); }
  unique_ptr& operator=(unique_ptr&& o) noexcept { reset(o.release()); return *this; }
  T& operator[](size_t i) const { return _s.first[i]; }
  T* get() const noexcept { return _s.first; }
  explicit operator bool() const noexcept { return _s.first != nullptr; }
  T* release() noexcept { T* t = _s.first; _s.first = nullptr; return t; }
  void reset(T* p = nullptr) noexcept { T* old = _s.first; _s.first = p; if (old) _s.second()(old); }
};
template <class T, class... Args> typename enable_if<!is_array<T>::value, unique_ptr<T>>::type make_unique(Args&&... args) { return unique_ptr<T>(new T(std::forward<Args>(args)...)); }
template <class T> typename enable_if<is_array<T>::value, unique_ptr<T>>::type make_unique(size_t n) { return unique_ptr<T>(new typename remove_extent<T>::type[n]()); }
template <class T, class D, class U, class E> bool operator==(const unique_ptr<T, D>& a, const unique_ptr<U, E>& b) { return a.get() == b.get(); }
template <class T, class D, class U, class E> bool operator!=(const unique_ptr<T, D>& a, const unique_ptr<U, E>& b) { return a.get() != b.get(); }
template <class T, class D> bool operator==(const unique_ptr<T, D>& a, nullptr_t) noexcept { return !a; }
template <class T, class D> bool operator!=(const unique_ptr<T, D>& a, nullptr_t) noexcept { return static_cast<bool>(a); }
template <class T, class D> bool operator==(nullptr_t, const unique_ptr<T, D>& a) noexcept { return !a; }
template <class T, class D> bool operator!=(nullptr_t, const unique_ptr<T, D>& a) noexcept { return static_cast<bool>(a); }

// ---- shared_ptr ----------------------------------------------------------------------------------------------------------------
#if defined(__APPLE__)
typedef long __sp_count_t;     // libc++: shared_owners/weak_owners are `long` (8 bytes), stored as "count - 1"
#else
typedef int __sp_count_t;      // libstdc++ / MSVC: two 32-bit counters after the vptr
#endif
class __sp_ctrl {
 public:
  __sp_count_t _use; __sp_count_t _weak;
  __sp_ctrl() : _use(1), _weak(1) {}
  virtual ~__sp_ctrl() {}
  virtual void _dispose() noexcept = 0;
  virtual void _destroy() noexcept { delete this; }
  void _add_ref() noexcept { ++_use; }
  bool _add_ref_lock() noexcept { if (_use == 0) return false; ++_use; return true; }
  void _release() noexcept {
    if (--_use == 0) {
      _dispose();
      if (--_weak == 0) _destroy();
    }
  }
  void _weak_add() noexcept { ++_weak; }
  void _weak_release() noexcept { if (--_weak == 0) _destroy(); }
};
template <class P, class D> class __sp_ptr_ctrl : public __sp_ctrl {
  __cpair<P, D> _s;
 public:
  __sp_ptr_ctrl(P p, D d) : _s(p, d) {}
  void _dispose() noexcept { _s.second()(_s.first); }
};
template <class T> class __sp_inplace_ctrl : public __sp_ctrl {
 public:
  alignas(T) char _storage[sizeof(T)];
  template <class... Args> __sp_inplace_ctrl(Args&&... args) { ::new (static_cast<void*>(_storage)) T(std::forward<Args>(args)...); }
  T* _ptr() { return reinterpret_cast<T*>(_storage); }
  void _dispose() noexcept { _ptr()->~T(); }
};

template <class T> class weak_ptr;
template <class T> class shared_ptr;
template <class T> class enable_shared_from_this;

template <class T> class shared_ptr {
 public:  // (internals are public here so make_shared / weak_ptr need no friend declarations)
  T* _ptr; __sp_ctrl* _ctrl;
  void _enable(...) {}
  template <class U> void _enable(enable_shared_from_this<U>* e) { e->_weak_this = *this; }
  typedef T element_type;
  constexpr shared_ptr() noexcept : _ptr(nullptr), _ctrl(nullptr) {}
  constexpr shared_ptr(nullptr_t) noexcept : _ptr(nullptr), _ctrl(nullptr) {}
  template <class U> explicit shared_ptr(U* p) : _ptr(p), _ctrl(new __sp_ptr_ctrl<U*, default_delete<U>>(p, default_delete<U>())) { _enable(p); }
  template <class U, class D> shared_ptr(U* p, D d) : _ptr(p), _ctrl(new __sp_ptr_ctrl<U*, D>(p, std::move(d))) { _enable(p); }
  shared_ptr(const shared_ptr& o) noexcept : _ptr(o._ptr), _ctrl(o._ctrl) { if (_ctrl) _ctrl->_add_ref(); }
  template <class U, class = typename enable_if<is_convertible<U*, T*>::value>::type> shared_ptr(const shared_ptr<U>& o) noexcept : _ptr(o._ptr), _ctrl(o._ctrl) { if (_ctrl) _ctrl->_add_ref(); }
  template <class U> shared_ptr(const shared_ptr<U>& o, T* p) noexcept : _ptr(p), _ctrl(o._ctrl) { if (_ctrl) _ctrl->_add_ref(); }
  shared_ptr(shared_ptr&& o) noexcept : _ptr(o._ptr), _ctrl(o._ctrl) { o._ptr = nullptr; o._ctrl = nullptr; }
  template <class U, class = typename enable_if<is_convertible<U*, T*>::value>::type> shared_ptr(shared_ptr<U>&& o) noexcept : _ptr(o._ptr), _ctrl(o._ctrl) { o._ptr = nullptr; o._ctrl = nullptr; }
  template <class U, class D> shared_ptr(unique_ptr<U, D>&& u) : _ptr(u.get()), _ctrl(u.get() ? new __sp_ptr_ctrl<U*, D>(u.get(), u.get_deleter()) : nullptr) { u.release(); }
  explicit shared_ptr(const weak_ptr<T>& w);
  ~shared_ptr() { if (_ctrl) _ctrl->_release(); }
  shared_ptr& operator=(const shared_ptr& o) noexcept { shared_ptr(o).swap(*this); return *this; }
  template <class U> shared_ptr& operator=(const shared_ptr<U>& o) noexcept { shared_ptr(o).swap(*this); return *this; }
  shared_ptr& operator=(shared_ptr&& o) noexcept { shared_ptr(std::move(o)).swap(*this); return *this; }
  template <class U> shared_ptr& operator=(shared_ptr<U>&& o) noexcept { shared_ptr(std::move(o)).swap(*this); return *this; }
  void swap(shared_ptr& o) noexcept { std::swap(_ptr, o._ptr); std::swap(_ctrl, o._ctrl); }
  void reset() noexcept { shared_ptr().swap(*this); }
  template <class U> void reset(U* p) { shared_ptr(p).swap(*this); }
  T* get() const noexcept { return _ptr; }
  T& operator*() const noexcept { return *_ptr; }
  T* operator->() const noexcept { return _ptr; }
  long use_count() const noexcept { return _ctrl ? static_cast<long>(_ctrl->_use) : 0; }
  bool unique() const noexcept { return use_count() == 1; }
  explicit operator bool() const noexcept { return _ptr != nullptr; }
  template <class U> bool owner_before(const shared_ptr<U>& o) const noexcept { return _ctrl < o._ctrl; }
};
template <class T, class U> bool operator==(const shared_ptr<T>& a, const shared_ptr<U>& b) noexcept { return a.get() == b.get(); }
template <class T, class U> bool operator!=(const shared_ptr<T>& a, const shared_ptr<U>& b) noexcept { return a.get() != b.get(); }
template <class T, class U> bool operator<(const shared_ptr<T>& a, const shared_ptr<U>& b) noexcept { return a.get() < b.get(); }
template <class T> bool operator==(const shared_ptr<T>& a, nullptr_t) noexcept { return !a; }
template <class T> bool operator!=(const shared_ptr<T>& a, nullptr_t) noexcept { return static_cast<bool>(a); }
template <class T> bool operator==(nullptr_t, const shared_ptr<T>& a) noexcept { return !a; }
template <class T> bool operator!=(nullptr_t, const shared_ptr<T>& a) noexcept { return static_cast<bool>(a); }

class bad_weak_ptr : public exception { public: const char* what() const noexcept { return "bad_weak_ptr"; } };

template <class T> class weak_ptr {
 public:
  T* _ptr; __sp_ctrl* _ctrl;
  constexpr weak_ptr() noexcept : _ptr(nullptr), _ctrl(nullptr) {}
  weak_ptr(const weak_ptr& o) noexcept : _ptr(o._ptr), _ctrl(o._ctrl) { if (_ctrl) _ctrl->_weak_add(); }
  template <class U> weak_ptr(const shared_ptr<U>& s) noexcept : _ptr(s._ptr), _ctrl(s._ctrl) { if (_ctrl) _ctrl->_weak_add(); }
  template <class U> weak_ptr(const weak_ptr<U>& o) noexcept : _ptr(o._ptr), _ctrl(o._ctrl) { if (_ctrl) _ctrl->_weak_add(); }
  weak_ptr(weak_ptr&& o) noexcept : _ptr(o._ptr), _ctrl(o._ctrl) { o._ptr = nullptr; o._ctrl = nullptr; }
  ~weak_ptr() { if (_ctrl) _ctrl->_weak_release(); }
  weak_ptr& operator=(const weak_ptr& o) noexcept { weak_ptr(o).swap(*this); return *this; }
  template <class U> weak_ptr& operator=(const shared_ptr<U>& s) noexcept { weak_ptr(s).swap(*this); return *this; }
  weak_ptr& operator=(weak_ptr&& o) noexcept { weak_ptr(std::move(o)).swap(*this); return *this; }
  void swap(weak_ptr& o) noexcept { std::swap(_ptr, o._ptr); std::swap(_ctrl, o._ctrl); }
  void reset() noexcept { weak_ptr().swap(*this); }
  long use_count() const noexcept { return _ctrl ? static_cast<long>(_ctrl->_use) : 0; }
  bool expired() const noexcept { return use_count() == 0; }
  shared_ptr<T> lock() const noexcept {
    shared_ptr<T> r;
    if (_ctrl && _ctrl->_add_ref_lock()) { r._ptr = _ptr; r._ctrl = _ctrl; }
    return r;
  }
};
template <class T> shared_ptr<T>::shared_ptr(const weak_ptr<T>& w) : _ptr(w._ptr), _ctrl(w._ctrl) {
  if (!_ctrl || !_ctrl->_add_ref_lock()) throw bad_weak_ptr();
}

template <class T> class enable_shared_from_this {
 public:
  mutable weak_ptr<T> _weak_this;
 protected:
  constexpr enable_shared_from_this() noexcept {}
  enable_shared_from_this(const enable_shared_from_this&) noexcept {}
  enable_shared_from_this& operator=(const enable_shared_from_this&) noexcept { return *this; }
  ~enable_shared_from_this() {}
 public:
  shared_ptr<T> shared_from_this() { return shared_ptr<T>(_weak_this); }
  shared_ptr<const T> shared_from_this() const { return shared_ptr<const T>(_weak_this); }
  weak_ptr<T> weak_from_this() noexcept { return _weak_this; }
};

template <class T, class... Args> shared_ptr<T> make_shared(Args&&... args) {
  __sp_inplace_ctrl<T>* c = new __sp_inplace_ctrl<T>(std::forward<Args>(args)...);
  shared_ptr<T> r;
  r._ptr = c->_ptr();
  r._ctrl = c;
  r._enable(r._ptr);
  return r;
}
template <class T, class U> shared_ptr<T> static_pointer_cast(const shared_ptr<U>& r) noexcept { return shared_ptr<T>(r, static_cast<T*>(r.get())); }
template <class T, class U> shared_ptr<T> dynamic_pointer_cast(const shared_ptr<U>& r) noexcept { T* p = dynamic_cast<T*>(r.get()); return p ? shared_ptr<T>(r, p) : shared_ptr<T>(); }
}
