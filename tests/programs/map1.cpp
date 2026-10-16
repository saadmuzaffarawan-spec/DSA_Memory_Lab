#include <iostream>
#include <map>
#include <set>
#include <string>
using namespace std;
struct T { int v; T(int x = 0) : v(x) { cout << "T(" << v << ")\n"; } T(const T& o) : v(o.v) { cout << "copy " << v << "\n"; } ~T() { cout << "~T(" << v << ")\n"; } };
int main() {
  map<int, string> m;
  m[5] = "five"; m[1] = "one"; m[9] = "nine"; m[3] = "three"; m[7] = "seven";
  m.insert({4, "four"});
  auto r = m.insert({5, "dup"});
  cout << r.second << " " << r.first->second << "\n";
  for (auto& kv : m) cout << kv.first << "=" << kv.second << " ";
  cout << "\nsize " << m.size() << " sizeof " << sizeof(m) << "\n";
  m.erase(3); m.erase(m.find(9));
  for (auto it = m.rbegin(); it != m.rend(); ++it) cout << it->first << " ";
  cout << "\n" << m.count(1) << m.count(2) << "\n";
  auto lb = m.lower_bound(4); cout << lb->first << " " << m.upper_bound(5)->first << "\n";
  set<int> s{5, 2, 8, 1, 9, 3, 2};
  for (int x : s) cout << x << " ";
  cout << "\n" << s.size() << " " << *s.begin() << " " << *s.rbegin() << "\n";
  s.erase(8); s.erase(s.begin());
  for (int x : s) cout << x << " ";
  cout << "\n";
  multiset<int> ms{3, 1, 3, 2, 3};
  cout << ms.count(3) << " " << ms.size() << "\n";
  multimap<int, char> mm; mm.insert({1, 'a'}); mm.insert({1, 'b'}); mm.insert({0, 'c'});
  for (auto& p : mm) cout << p.first << p.second << " ";
  cout << "\n";
  map<int, T> mt;
  mt[1]; mt[2];
  mt.emplace(3, 3);
  cout << "done " << mt.size() << "\n";
  try { m.at(100); } catch (const out_of_range& e) { cout << "oor\n"; }
}
