#include <iostream>
#include <algorithm>
#include <numeric>
using namespace std;
struct P { int k; int id; };
int main(){
  int a[40]; unsigned s=12345; for(int i=0;i<40;i++){ s=s*1103515245u+12345u; a[i]=(s>>16)%50; }
  sort(a,a+40); for(int x:a) cout<<x<<' '; cout<<"\n";
  P p[30]; for(int i=0;i<30;i++){ s=s*1103515245u+12345u; p[i]={int((s>>16)%5), i}; }
  sort(p,p+30,[](const P&x,const P&y){return x.k<y.k;}); for(auto&q:p) cout<<q.k<<':'<<q.id<<' '; cout<<"\n";
  int b[8]={5,3,9,1,7,2,8,4}; nth_element(b,b+3,b+8); for(int x:b) cout<<x<<' '; cout<<"\n";
  reverse(b,b+8); cout<<accumulate(b,b+8,0)<<" "<<*max_element(b,b+8)<<" "<<*lower_bound(a,a+40,25)<<"\n";
  int c[5]={1,2,3,4,5}; do { cout<<c[0]<<c[1]; } while(next_permutation(c,c+3)); cout<<"\n";
  cout << gcd(12,18) << lcm(4,6) << "\n";
  stable_sort(p,p+30,[](const P&x,const P&y){return x.k<y.k;}); for(auto&q:p) cout<<q.k<<':'<<q.id<<' '; cout<<"\n";
}
