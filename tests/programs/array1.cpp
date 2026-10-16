#include <iostream>
#include <array>
#include <algorithm>
using namespace std;
int main(){
  array<int,5> a = {5,3,1,4,2}; array<int,3> b{7,8,9}; array<int,4> c{};
  sort(a.begin(), a.end()); for (int x : a) cout << x; cout << " " << b[1] << c[3] << " " << sizeof(a) << a.size() << a.front() << a.back() << "\n";
  try { b.at(5); } catch (const out_of_range& e) { cout << e.what() << "\n"; }
  array<array<int,2>,2> m{{{1,2},{3,4}}}; cout << m[1][0] << m.size() << "\n";
  b.fill(1); cout << b[0] << b[2] << (a == a) << "\n";
}
