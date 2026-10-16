#include <iostream>
#include <map>
#include <set>
using namespace std;
int main() {
  unsigned s = 12345;
  auto rnd = [&]() { s = s * 1103515245u + 12345u; return (s >> 16) & 0x7fff; };
  map<int, int> m; set<int> st; multiset<int> ms;
  long long sum = 0;
  for (int i = 0; i < 90; i++) {
    int k = rnd() % 97, op = rnd() % 3;
    if (op < 2) { m[k] += i; st.insert(k); ms.insert(k % 13); }
    else { m.erase(k); st.erase(k); auto it = ms.find(k % 13); if (it != ms.end()) ms.erase(it); }
    sum += (long long)m.size() * 3 + st.size() + ms.size();
  }
  cout << m.size() << " " << st.size() << " " << ms.size() << " " << sum << "\n";
  for (auto& kv : m) cout << kv.first << ":" << kv.second << " ";
  cout << "\n";
  for (int x : st) cout << x << " ";
  cout << "\n";
  for (auto it = ms.begin(); it != ms.end(); ++it) cout << *it << " ";
  cout << "\n";
  while (!m.empty()) m.erase(m.begin());
  cout << m.size() << "\n";
  map<int,int> c1{{1,1},{2,2},{3,3}}; map<int,int> c2 = c1; c2[4] = 4; c1 = c2; c1.erase(2);
  for (auto& kv : c1) cout << kv.first << kv.second << " ";
  cout << c2.size() << "\n";
}
