#include <iostream>
#include <string>
#include <tuple>
#include <optional>
#include <functional>
#include <vector>
using namespace std;

int callIt(function<int(int)> f, int x) { return f(x); }
int twice(int x) { return 2 * x; }

struct Counter {
  int n = 0;
  int operator()(int d) { n += d; return n; }
};

optional<int> findFirstEven(const vector<int>& v) {
  for (int x : v) if (x % 2 == 0) return x;
  return nullopt;
}

int main() {
  auto t = make_tuple(1, 2.5, 'c');
  cout << get<0>(t) << " " << get<1>(t) << " " << get<2>(t) << " " << sizeof(t) << "\n";
  get<0>(t) = 9;
  cout << get<0>(t) << " " << tuple_size<decltype(t)>::value << "\n";
  tuple<int, string> ts(4, "four");
  cout << get<0>(ts) << get<1>(ts) << " " << sizeof(ts) << "\n";
  int a, b;
  tie(a, b) = make_tuple(7, 8);
  cout << a << b << "\n";

  optional<int> o = 5;
  cout << o.value() << " " << o.has_value() << " " << sizeof(o) << " " << sizeof(optional<string>) << "\n";
  optional<string> e;
  cout << e.has_value() << " " << e.value_or("none") << "\n";
  try { e.value(); } catch (const bad_optional_access& ex) { cout << "caught\n"; }
  e = string("hello");
  cout << *e << " " << e->size() << "\n";
  e.reset();
  cout << (e ? "set" : "empty") << "\n";
  auto r = findFirstEven({1, 3, 6, 8});
  cout << (r ? *r : -1) << " " << (findFirstEven({1, 3}) ? 1 : 0) << "\n";

  int k = 3;
  function<int(int)> f = [k](int x) { return x * k; };
  cout << f(4) << " " << callIt(f, 5) << " " << callIt([](int x) { return x + 1; }, 5) << " " << callIt(twice, 21) << "\n";
  function<int(int)> g = f;
  cout << g(2) << "\n";
  Counter c;
  function<int(int)> h = c;
  h(5); h(6);
  cout << h(0) << " " << c.n << "\n";
  function<void()> none;
  cout << (none ? "bound" : "empty") << "\n";
  try { none(); } catch (const bad_function_call&) { cout << "bad_function_call\n"; }
  vector<function<int(int)>> ops;
  ops.push_back([](int x) { return x + 1; });
  ops.push_back([](int x) { return x * x; });
  int acc = 3;
  for (auto& op : ops) acc = op(acc);
  cout << acc << "\n";
  return 0;
}
