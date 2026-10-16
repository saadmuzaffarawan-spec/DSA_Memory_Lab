#include <iostream>
#include <string>
#include <unordered_map>
#include <unordered_set>
#include <vector>
using namespace std;

int main() {
  cout << sizeof(unordered_map<int, int>) << " " << sizeof(unordered_set<string>) << "\n";
  unordered_map<int, int> m;
  cout << m.bucket_count() << "\n";
  for (int i = 0; i < 40; i++) {
    m[i * 7 % 31 + i] = i;
    if (i < 3 || i == 12 || i == 13 || i == 26 || i == 27 || i == 39) cout << i << ":" << m.size() << "/" << m.bucket_count() << " ";
  }
  cout << "\n";
  for (auto& kv : m) cout << kv.first << "=" << kv.second << " ";
  cout << "\n";
  m.erase(0); m.erase(7); m.erase(m.begin());
  for (auto& kv : m) cout << kv.first << " ";
  cout << "\n" << m.size() << " " << m.count(5) << " " << m.count(1000) << " " << m.at(63) << "\n";
  auto it = m.find(14);
  cout << (it != m.end()) << "\n";
  m.rehash(100);
  cout << m.bucket_count() << " " << m.load_factor() << "\n";
  for (auto& kv : m) cout << kv.first << " ";
  cout << "\n";

  unordered_map<string, int> wc;
  string words[] = {"the", "quick", "brown", "fox", "jumps", "over", "the", "lazy", "dog", "the", "end", "of", "a", "long", "sentence", "again"};
  for (auto& w : words) wc[w]++;
  for (auto& kv : wc) cout << kv.first << ":" << kv.second << " ";
  cout << "\n" << wc.bucket_count() << " " << wc.size() << "\n";

  unordered_set<int> s = {5, 3, 9, 3, 1, 100, 55, 17};
  for (int x : s) cout << x << " ";
  cout << s.size() << " " << s.count(9) << " " << s.count(4) << "\n";
  unordered_set<string> ss;
  ss.insert("alpha"); ss.insert("beta"); ss.insert("gamma"); ss.insert("alpha");
  for (auto& x : ss) cout << x << " ";
  cout << ss.size() << "\n";
  unordered_map<char, vector<int>> g;
  g['a'].push_back(1); g['b'].push_back(2); g['a'].push_back(3);
  for (auto& kv : g) cout << kv.first << kv.second.size() << " ";
  cout << "\n";
  s.clear();
  cout << s.empty() << " " << s.bucket_count() << "\n";
  return 0;
}
