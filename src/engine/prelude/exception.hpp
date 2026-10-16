// <exception>, <stdexcept>, <new>
namespace std {
const char* __exc_dup(const char*);
void __exc_free(const char*);
class exception {
#if defined(_WIN32)
  const char* _What; bool _DoFree;
 public:
  exception() noexcept : _What(0), _DoFree(false) {}
  explicit exception(const char* m, int = 1) noexcept : _What(__exc_dup(m)), _DoFree(true) {}
  exception(const exception& o) noexcept : _What(o._DoFree && o._What ? __exc_dup(o._What) : o._What), _DoFree(o._DoFree) {}
  exception& operator=(const exception& o) noexcept { if (this != &o) { if (_DoFree && _What) __exc_free(_What); _What = o._DoFree && o._What ? __exc_dup(o._What) : o._What; _DoFree = o._DoFree; } return *this; }
  virtual ~exception() noexcept { if (_DoFree && _What) __exc_free(_What); }
  virtual const char* what() const noexcept { return _What ? _What : "Unknown exception"; }
#else
 public:
  exception() noexcept {}
  exception(const exception&) noexcept {}
  exception& operator=(const exception&) noexcept { return *this; }
  virtual ~exception() noexcept {}
  virtual const char* what() const noexcept { return "std::exception"; }
#endif
};
class bad_exception : public exception {
 public:
  bad_exception() noexcept {}
  const char* what() const noexcept { return "std::bad_exception"; }
};
class bad_alloc : public exception {
 public:
  bad_alloc() noexcept {}
#if defined(_WIN32)
  const char* what() const noexcept { return "bad allocation"; }
#else
  const char* what() const noexcept { return "std::bad_alloc"; }
#endif
};
class bad_array_new_length : public bad_alloc {
 public:
  bad_array_new_length() noexcept {}
#if defined(_WIN32)
  const char* what() const noexcept { return "bad array new length"; }
#else
  const char* what() const noexcept { return "std::bad_array_new_length"; }
#endif
};
class bad_cast : public exception {
 public:
  bad_cast() noexcept {}
#if defined(_WIN32)
  const char* what() const noexcept { return "Bad dynamic_cast!"; }
#else
  const char* what() const noexcept { return "std::bad_cast"; }
#endif
};
class bad_function_call : public exception {
 public:
  const char* what() const noexcept { return "bad_function_call"; }
};

#if defined(_WIN32)
class logic_error : public exception {
 public:
  explicit logic_error(const char* m) : exception(m, 1) {}
  template <class S> explicit logic_error(const S& s) : exception(s.c_str(), 1) {}
};
class runtime_error : public exception {
 public:
  explicit runtime_error(const char* m) : exception(m, 1) {}
  template <class S> explicit runtime_error(const S& s) : exception(s.c_str(), 1) {}
};
#else
class logic_error : public exception {
  const char* _M_msg;
 public:
  explicit logic_error(const char* m) : _M_msg(__exc_dup(m)) {}
  template <class S> explicit logic_error(const S& s) : _M_msg(__exc_dup(s.c_str())) {}
  logic_error(const logic_error& o) noexcept : exception(o), _M_msg(__exc_dup(o._M_msg)) {}
  logic_error& operator=(const logic_error& o) noexcept { if (this != &o) { __exc_free(_M_msg); _M_msg = __exc_dup(o._M_msg); } return *this; }
  virtual ~logic_error() noexcept { __exc_free(_M_msg); }
  virtual const char* what() const noexcept { return _M_msg; }
};
class runtime_error : public exception {
  const char* _M_msg;
 public:
  explicit runtime_error(const char* m) : _M_msg(__exc_dup(m)) {}
  template <class S> explicit runtime_error(const S& s) : _M_msg(__exc_dup(s.c_str())) {}
  runtime_error(const runtime_error& o) noexcept : exception(o), _M_msg(__exc_dup(o._M_msg)) {}
  runtime_error& operator=(const runtime_error& o) noexcept { if (this != &o) { __exc_free(_M_msg); _M_msg = __exc_dup(o._M_msg); } return *this; }
  virtual ~runtime_error() noexcept { __exc_free(_M_msg); }
  virtual const char* what() const noexcept { return _M_msg; }
};
#endif
class domain_error : public logic_error { public: explicit domain_error(const char* m) : logic_error(m) {} template <class S> explicit domain_error(const S& s) : logic_error(s) {} };
class invalid_argument : public logic_error { public: explicit invalid_argument(const char* m) : logic_error(m) {} template <class S> explicit invalid_argument(const S& s) : logic_error(s) {} };
class length_error : public logic_error { public: explicit length_error(const char* m) : logic_error(m) {} template <class S> explicit length_error(const S& s) : logic_error(s) {} };
class out_of_range : public logic_error { public: explicit out_of_range(const char* m) : logic_error(m) {} template <class S> explicit out_of_range(const S& s) : logic_error(s) {} };
class range_error : public runtime_error { public: explicit range_error(const char* m) : runtime_error(m) {} template <class S> explicit range_error(const S& s) : runtime_error(s) {} };
class overflow_error : public runtime_error { public: explicit overflow_error(const char* m) : runtime_error(m) {} template <class S> explicit overflow_error(const S& s) : runtime_error(s) {} };
class underflow_error : public runtime_error { public: explicit underflow_error(const char* m) : runtime_error(m) {} template <class S> explicit underflow_error(const S& s) : runtime_error(s) {} };

struct nothrow_t { explicit nothrow_t() = default; };
inline constexpr nothrow_t nothrow{};
}
void* operator new(size_t);
void* operator new[](size_t);
void operator delete(void*) noexcept;
void operator delete[](void*) noexcept;
void operator delete(void*, size_t) noexcept;
void operator delete[](void*, size_t) noexcept;
