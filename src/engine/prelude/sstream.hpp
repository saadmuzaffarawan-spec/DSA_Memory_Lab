// <sstream>: in-memory streams. The text lives in the simulator (a stream id), not in simulated memory.
namespace std {
int __ss_new();
void __ss_set(int id, const char* s);
void __ss_text(int id);

class ostringstream : public ostream {
 public:
  ostringstream() : ostream(__ss_new()) {}
  explicit ostringstream(const string& s) : ostream(__ss_new()) { __ss_set(_fd, s.c_str()); }
  string str() const { __ss_text(_fd); return string(__lastInput(), __lastInputLen()); }
  void str(const string& s) { __ss_set(_fd, s.c_str()); }
};

class istringstream : public istream {
 public:
  istringstream() : istream(__ss_new()) {}
  explicit istringstream(const string& s) : istream(__ss_new()) { __ss_set(_fd, s.c_str()); }
  string str() const { __ss_text(_fd); return string(__lastInput(), __lastInputLen()); }
  void str(const string& s) { __ss_set(_fd, s.c_str()); clear(); }
};

class stringstream : public istream {
 public:
  ostream __o;
  stringstream() : istream(__ss_new()), __o(_fd) {}
  explicit stringstream(const string& s) : istream(__ss_new()), __o(_fd) { __ss_set(_fd, s.c_str()); }
  string str() const { __ss_text(_fd); return string(__lastInput(), __lastInputLen()); }
  void str(const string& s) { __ss_set(_fd, s.c_str()); clear(); }
  template <class T> stringstream& operator<<(const T& v) { __o << v; return *this; }
  stringstream& operator<<(ostream& (*pf)(ostream&)) { pf(__o); return *this; }
  stringstream& operator<<(ios_base& (*pf)(ios_base&)) { pf(__o); return *this; }
};
}
