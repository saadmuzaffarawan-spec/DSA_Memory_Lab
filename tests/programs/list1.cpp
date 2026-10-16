#include <iostream>
#include <list>
#include <string>
#include <vector>
#include <algorithm>
using namespace std;

void show(const list<int>& l, const char* tag) {
  cout << tag << ":";
  for (int x : l) cout << " " << x;
  cout << " (size " << l.size() << ")\n";
}

int main() {
  cout << sizeof(list<int>) << " " << sizeof(list<string>) << "\n";
  list<int> l;
  l.push_back(3); l.push_back(1); l.push_front(0); l.push_back(2);
  show(l, "built");
  l.sort(); show(l, "sorted");
  l.reverse(); show(l, "reversed");
  l.pop_front(); l.pop_back(); show(l, "popped");
  auto it = l.begin(); ++it;
  l.insert(it, 99); show(l, "insert");
  it = l.begin(); advance(it, 2);
  it = l.erase(it);
  cout << *it << "\n";
  list<int> m = {5, 5, 6, 6, 6, 7};
  m.unique(); show(m, "unique");
  m.remove(6); show(m, "remove");
  list<int> a = {1, 4, 9}, b = {2, 3, 10};
  a.merge(b); show(a, "merged"); cout << b.size() << "\n";
  list<int> c = {100, 200};
  a.splice(a.begin(), c); show(a, "spliced"); cout << c.empty() << "\n";
  a.remove_if([](int x) { return x % 2 == 0; }); show(a, "odd only");
  list<string> s = {"pear", "apple", "fig"};
  s.sort();
  for (auto& x : s) cout << x << " ";
  cout << s.front() << s.back() << "\n";
  list<int> d(a);
  d.push_back(-1);
  cout << (a == d) << " " << a.size() << " " << d.size() << "\n";
  vector<int> v(d.begin(), d.end());
  cout << v.size() << " " << *max_element(d.begin(), d.end()) << "\n";
  for (auto r = d.rbegin(); r != d.rend(); ++r) cout << *r << ",";
  cout << "\n";
  d.clear();
  cout << d.empty() << "\n";
  return 0;
}
