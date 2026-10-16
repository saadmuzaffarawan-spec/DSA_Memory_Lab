#include <iostream>
#include <vector>
#include <algorithm>
using namespace std;
struct N { int v; N(int x):v(x){ cout<<"c"<<v<<" "; } N(const N& o):v(o.v){ cout<<"cp"<<v<<" "; } N(N&& o) noexcept :v(o.v){ cout<<"mv"<<v<<" "; } ~N(){ cout<<"d"<<v<<" "; } N& operator=(const N& o){ v=o.v; cout<<"=cp "; return *this; } N& operator=(N&& o) noexcept { v=o.v; cout<<"=mv "; return *this; } };
struct M { int v; M(int x):v(x){} M(const M& o):v(o.v){ cout<<"Mcp"<<v<<" "; } M(M&& o):v(o.v){ cout<<"Mmv"<<v<<" "; } ~M(){ cout<<"Md"<<v<<" "; } };
int main(){
  vector<int> v; for(int i=0;i<10;i++){ v.push_back(i*i); cout<<v.size()<<"/"<<v.capacity()<<" "; } cout<<"\n";
  v.insert(v.begin()+2, 99); v.erase(v.begin()); v.insert(v.end(), 3, 7); cout<<v.size()<<" "<<v.capacity()<<" "; for(int x:v) cout<<x<<","; cout<<"\n";
  v.resize(4); v.shrink_to_fit(); cout<<v.size()<<v.capacity()<<v.front()<<v.back()<<v.at(2)<<"\n";
  vector<int> w(5, 3), z{1,2,3}; w.swap(z); cout<<w.size()<<z.size()<<(w<z)<<"\n";
  try { v.at(100); } catch (const out_of_range& e) { cout<<e.what()<<"\n"; }
  vector<N> a; a.reserve(2); a.emplace_back(1); a.emplace_back(2); cout<<"| "; a.emplace_back(3); cout<<"| "; a.erase(a.begin()); cout<<"| "; a.clear(); cout<<"\n";
  vector<M> b; b.push_back(M(1)); cout<<"| "; b.push_back(M(2)); cout<<"| "; b.push_back(M(3)); cout<<"\n";
  vector<vector<int>> g(3, vector<int>(2, 5)); g[1].push_back(9); cout<<g[1].size()<<g[0].size()<<"\n";
  sort(v.begin(), v.end(), greater<int>()); for(int x:v) cout<<x; cout<<" "<<sizeof(vector<int>)<<"\n";
}
