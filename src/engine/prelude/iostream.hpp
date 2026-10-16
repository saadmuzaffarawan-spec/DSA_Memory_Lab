namespace std {
class ios_base {
 public:
  int _flags;
  int _prec;
  int _width;
  char _fill;
  int _fd;
  int _state;
  int _gcount;
  ios_base(int fd = 1) : _flags(0), _prec(6), _width(0), _fill(' '), _fd(fd), _state(0), _gcount(0) {}
  static constexpr int boolalpha = 32;
  static constexpr int hex = 1;
  static constexpr int oct = 2;
  static constexpr int dec = 0;
  static constexpr int fixed = 4;
  static constexpr int scientific = 8;
  static constexpr int showpos = 16;
  static constexpr int left = 64;
  static constexpr int right = 0;
  static constexpr int uppercase = 128;
  static constexpr int showbase = 256;
  static constexpr int internal = 512;
  static bool sync_with_stdio(bool = true) { return true; }
  int precision() const { return _prec; }
  int precision(int p) { int o = _prec; _prec = p; return o; }
  int width() const { return _width; }
  int width(int w) { int o = _width; _width = w; return o; }
  char fill() const { return _fill; }
  char fill(char c) { char o = _fill; _fill = c; return o; }
  int flags() const { return _flags; }
  int setf(int f) { int o = _flags; _flags |= f; return o; }
  int setf(int f, int mask) { int o = _flags; _flags = (_flags & ~mask) | (f & mask); return o; }
  void unsetf(int f) { _flags &= ~f; }
  bool good() const { return _state == 0; }
  bool eof() const { return (_state & 1) != 0; }
  bool fail() const { return (_state & 6) != 0; }
  bool bad() const { return (_state & 4) != 0; }
  void clear(int s = 0) { _state = s; }
  explicit operator bool() const { return !fail(); }
  bool operator!() const { return fail(); }
};
typedef ios_base ios;

class ostream : public ios_base {
 public:
  ostream(int fd = 1) : ios_base(fd) {}
  ostream& __put(...);
  ostream& operator<<(bool v);
  ostream& operator<<(char v);
  ostream& operator<<(signed char v);
  ostream& operator<<(unsigned char v);
  ostream& operator<<(short v);
  ostream& operator<<(unsigned short v);
  ostream& operator<<(int v);
  ostream& operator<<(unsigned int v);
  ostream& operator<<(long v);
  ostream& operator<<(unsigned long v);
  ostream& operator<<(long long v);
  ostream& operator<<(unsigned long long v);
  ostream& operator<<(float v);
  ostream& operator<<(double v);
  ostream& operator<<(long double v);
  ostream& operator<<(const void* v);
  ostream& operator<<(const char* v);
  ostream& operator<<(nullptr_t v);
  ostream& operator<<(ostream& (*pf)(ostream&)) { return pf(*this); }
  ostream& operator<<(ios_base& (*pf)(ios_base&)) { pf(*this); return *this; }
  ostream& write(const char* s, long long n);
  ostream& put(char c);
  ostream& flush();
};

class istream : public ios_base {
 public:
  istream(int fd = 0) : ios_base(fd) {}
  istream& __extract(...);
  int __extractLine(int delim = 10);
  int __token();
  istream& operator>>(bool& v) { return __extract(v); }
  istream& operator>>(char& v) { return __extract(v); }
  istream& operator>>(signed char& v) { return __extract(v); }
  istream& operator>>(unsigned char& v) { return __extract(v); }
  istream& operator>>(short& v) { return __extract(v); }
  istream& operator>>(unsigned short& v) { return __extract(v); }
  istream& operator>>(int& v) { return __extract(v); }
  istream& operator>>(unsigned int& v) { return __extract(v); }
  istream& operator>>(long& v) { return __extract(v); }
  istream& operator>>(unsigned long& v) { return __extract(v); }
  istream& operator>>(long long& v) { return __extract(v); }
  istream& operator>>(unsigned long long& v) { return __extract(v); }
  istream& operator>>(float& v) { return __extract(v); }
  istream& operator>>(double& v) { return __extract(v); }
  template <size_t N> istream& operator>>(char (&v)[N]) { return __extract(v); }
  istream& operator>>(istream& (*pf)(istream&)) { return pf(*this); }
  int get();
  int peek();
  istream& ignore(long long n = 1, int delim = -1);
  ostream* tie(ostream* p) { return p; }
  ostream* tie() { return nullptr; }
};

ostream cout(1);
ostream cerr(2);
ostream clog(2);
istream cin(0);

ostream& endl(ostream& os) { os.put('\n'); os.flush(); return os; }
ostream& ends(ostream& os) { os.put('\0'); return os; }
ostream& flush(ostream& os) { os.flush(); return os; }
ios_base& hex(ios_base& b) { b._flags = (b._flags & ~3) | 1; return b; }
ios_base& oct(ios_base& b) { b._flags = (b._flags & ~3) | 2; return b; }
ios_base& dec(ios_base& b) { b._flags = (b._flags & ~3); return b; }
ios_base& fixed(ios_base& b) { b._flags |= 4; return b; }
ios_base& scientific(ios_base& b) { b._flags |= 8; return b; }
ios_base& defaultfloat(ios_base& b) { b._flags &= ~12; return b; }
ios_base& boolalpha(ios_base& b) { b._flags |= 32; return b; }
ios_base& noboolalpha(ios_base& b) { b._flags &= ~32; return b; }
ios_base& showpos(ios_base& b) { b._flags |= 16; return b; }
ios_base& noshowpos(ios_base& b) { b._flags &= ~16; return b; }
ios_base& showbase(ios_base& b) { b._flags |= 256; return b; }
ios_base& noshowbase(ios_base& b) { b._flags &= ~256; return b; }
ios_base& uppercase(ios_base& b) { b._flags |= 128; return b; }
ios_base& nouppercase(ios_base& b) { b._flags &= ~128; return b; }
ios_base& left(ios_base& b) { b._flags |= 64; return b; }
ios_base& right(ios_base& b) { b._flags &= ~(64 | 512); return b; }
ios_base& internal(ios_base& b) { b._flags |= 512; return b; }
istream& ws(istream& is) { while (is.peek() == ' ' || is.peek() == '\n' || is.peek() == '\t') is.get(); return is; }

struct _Setw { int n; };
struct _Setprecision { int n; };
struct _Setfill { char c; };
_Setw setw(int n) { _Setw s; s.n = n; return s; }
_Setprecision setprecision(int n) { _Setprecision s; s.n = n; return s; }
_Setfill setfill(char c) { _Setfill s; s.c = c; return s; }
ostream& operator<<(ostream& os, _Setw w) { os._width = w.n; return os; }
ostream& operator<<(ostream& os, _Setprecision p) { os._prec = p.n; return os; }
ostream& operator<<(ostream& os, _Setfill f) { os._fill = f.c; return os; }

const char* __lastInput();
size_t __lastInputLen();
inline ostream& operator<<(ostream& os, const string& s) { return os << s.c_str(); }
inline istream& operator>>(istream& is, string& s) { if (is.__token()) s.assign(__lastInput(), __lastInputLen()); return is; }
inline istream& getline(istream& is, string& s, char delim) { if (is.__extractLine(delim)) s.assign(__lastInput(), __lastInputLen()); else s.clear(); return is; }
inline istream& getline(istream& is, string& s) { if (is.__extractLine(10)) s.assign(__lastInput(), __lastInputLen()); else s.clear(); return is; }
}
