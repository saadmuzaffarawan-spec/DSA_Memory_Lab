// <limits>: numeric_limits for the arithmetic types
namespace std {
template <class T> struct numeric_limits {
  static constexpr bool is_specialized = false;
  static constexpr T min() { return T(); }
  static constexpr T max() { return T(); }
};
#define __NL_INT(T, LO, HI, DIGITS, SIGNED) \
template <> struct numeric_limits<T> { \
  static constexpr bool is_specialized = true; static constexpr bool is_signed = SIGNED; static constexpr bool is_integer = true; \
  static constexpr int digits = DIGITS; \
  static constexpr T min() { return LO; } static constexpr T max() { return HI; } static constexpr T lowest() { return LO; } \
};
__NL_INT(bool, false, true, 1, false)
__NL_INT(char, CHAR_MIN, CHAR_MAX, 7, true)
__NL_INT(signed char, SCHAR_MIN, SCHAR_MAX, 7, true)
__NL_INT(unsigned char, 0, UCHAR_MAX, 8, false)
__NL_INT(short, SHRT_MIN, SHRT_MAX, 15, true)
__NL_INT(unsigned short, 0, USHRT_MAX, 16, false)
__NL_INT(int, INT_MIN, INT_MAX, 31, true)
__NL_INT(unsigned int, 0u, UINT_MAX, 32, false)
__NL_INT(long, LONG_MIN, LONG_MAX, (sizeof(long) * 8 - 1), true)
__NL_INT(unsigned long, 0ul, ULONG_MAX, (sizeof(long) * 8), false)
__NL_INT(long long, LLONG_MIN, LLONG_MAX, 63, true)
__NL_INT(unsigned long long, 0ull, ULLONG_MAX, 64, false)
template <> struct numeric_limits<float> {
  static constexpr bool is_specialized = true; static constexpr bool is_signed = true; static constexpr bool is_integer = false;
  static constexpr int digits = 24;
  static constexpr float min() { return 1.17549435e-38f; }
  static constexpr float max() { return 3.40282347e+38f; }
  static constexpr float lowest() { return -3.40282347e+38f; }
  static constexpr float epsilon() { return 1.1920929e-07f; }
  static constexpr float infinity() { return (float)(1e308 * 10); }
  static constexpr float quiet_NaN() { return (float)((1e308 * 10) - (1e308 * 10)); }
};
template <> struct numeric_limits<double> {
  static constexpr bool is_specialized = true; static constexpr bool is_signed = true; static constexpr bool is_integer = false;
  static constexpr int digits = 53;
  static constexpr double min() { return 2.2250738585072014e-308; }
  static constexpr double max() { return 1.7976931348623157e+308; }
  static constexpr double lowest() { return -1.7976931348623157e+308; }
  static constexpr double epsilon() { return 2.220446049250313e-16; }
  static constexpr double infinity() { return (1e308 * 10); }
  static constexpr double quiet_NaN() { return ((1e308 * 10) - (1e308 * 10)); }
};
}
