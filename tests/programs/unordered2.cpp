#include <iostream>
#include <string>
#include <unordered_map>
#include <unordered_set>
using namespace std;

int main() {
  unsigned seed = 12345;
  auto rnd = [&]() { seed = seed * 1103515245u + 12345u; return (seed >> 8) & 0xffff; };
  unordered_map<int, int> m;
  unordered_set<string> s;
  unsigned long long h = 1469598103934665603ULL;
  for (int step = 0; step < 120; step++) {
    int k = rnd() % 97;
    if (step % 3 == 2) m.erase(k); else m[k] += step;
    string w = "k" + to_string(rnd() % 40);
    if (step % 4 == 3) s.erase(w); else s.insert(w);
    if (step % 20 == 19) {
      cout << step << ": " << m.size() << "/" << m.bucket_count() << " " << s.size() << "/" << s.bucket_count() << "\n";
    }
  }
  for (auto& kv : m) { h = (h ^ (unsigned long long)(kv.first * 31 + kv.second)) * 1099511628211ULL; }
  for (auto& x : s) { for (char c : x) h = (h ^ (unsigned char)c) * 1099511628211ULL; }
  cout << h << "\n";
  int shown = 0;
  for (auto& kv : m) { if (shown++ < 12) cout << kv.first << " "; }
  cout << "\n";
  shown = 0;
  for (auto& x : s) { if (shown++ < 8) cout << x << " "; }
  cout << "\n";
  return 0;
}
