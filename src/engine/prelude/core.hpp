// Stackyard prelude: always loaded. Fundamental typedefs and std::initializer_list.
#if defined(_WIN32)
typedef unsigned long long size_t;
typedef long long ptrdiff_t;
typedef long long ssize_t;
#else
typedef unsigned long size_t;
typedef long ptrdiff_t;
typedef long ssize_t;
#endif
typedef long long intmax_t;
typedef unsigned long long uintmax_t;
typedef signed char int8_t;
typedef unsigned char uint8_t;
typedef short int16_t;
typedef unsigned short uint16_t;
typedef int int32_t;
typedef unsigned int uint32_t;
typedef long long int64_t;
typedef unsigned long long uint64_t;
typedef long long intptr_t;
typedef unsigned long long uintptr_t;
typedef double max_align_t_dummy;
#define NULL 0
#define EOF (-1)
#define INT_MAX 2147483647
#define INT_MIN (-2147483647 - 1)
#define UINT_MAX 4294967295u
#define SHRT_MAX 32767
#define SHRT_MIN (-32768)
#define USHRT_MAX 65535
#define CHAR_BIT 8
#define SCHAR_MAX 127
#define SCHAR_MIN (-128)
#define UCHAR_MAX 255
#define CHAR_MAX 127
#define CHAR_MIN (-128)
#define LLONG_MAX 9223372036854775807LL
#define LLONG_MIN (-9223372036854775807LL - 1)
#define ULLONG_MAX 18446744073709551615ULL
#if defined(_WIN32)
#define LONG_MAX 2147483647L
#define LONG_MIN (-2147483647L - 1)
#define ULONG_MAX 4294967295UL
#define RAND_MAX 32767
#else
#define LONG_MAX 9223372036854775807L
#define LONG_MIN (-9223372036854775807L - 1)
#define ULONG_MAX 18446744073709551615UL
#define RAND_MAX 2147483647
#endif
#define INT8_MAX 127
#define INT16_MAX 32767
#define INT32_MAX 2147483647
#define INT64_MAX 9223372036854775807LL
#define UINT8_MAX 255
#define UINT16_MAX 65535
#define UINT32_MAX 4294967295u
#define UINT64_MAX 18446744073709551615ULL
#define SIZE_MAX 18446744073709551615ULL
#define M_PI 3.14159265358979323846
#define M_E 2.7182818284590452354
#define M_SQRT2 1.41421356237309504880
#define HUGE_VAL (1.0 / 0.0)
#define INFINITY (1.0f / 0.0f)
#define NAN (0.0f / 0.0f)

namespace std {
typedef decltype(nullptr) nullptr_t;
using ::size_t;
using ::ptrdiff_t;

template <class T> class initializer_list {
#if defined(_WIN32)
  const T* _First;
  const T* _Last;
 public:
  const T* begin() const { return _First; }
  const T* end() const { return _Last; }
  size_t size() const { return static_cast<size_t>(_Last - _First); }
  initializer_list() : _First(nullptr), _Last(nullptr) {}
#else
  const T* _M_array;
  size_t _M_len;
 public:
  const T* begin() const { return _M_array; }
  const T* end() const { return _M_array + _M_len; }
  size_t size() const { return _M_len; }
  initializer_list() : _M_array(nullptr), _M_len(0) {}
#endif
};
template <class T> const T* begin(initializer_list<T> il) { return il.begin(); }
template <class T> const T* end(initializer_list<T> il) { return il.end(); }
}
#define offsetof(T, m) ((size_t)&(((T*)0)->m))
