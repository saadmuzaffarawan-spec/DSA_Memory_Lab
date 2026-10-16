#include <iostream>
#include <deque>
#include <stack>
#include <queue>
using namespace std;
int main(){
  deque<int> d; for (int i = 0; i < 200; i++) { if (i % 3) d.push_back(i); else d.push_front(i); }
  cout << d.size() << " " << d.front() << " " << d.back() << " " << d[100] << " " << sizeof(d) << "\n";
  for (int i = 0; i < 50; i++) { d.pop_front(); d.pop_back(); }
  long s = 0; for (int x : d) s += x; cout << d.size() << " " << s << "\n";
  stack<int> st; for (int i = 0; i < 5; i++) st.push(i * i); cout << st.top() << st.size(); st.pop(); cout << st.top() << "\n";
  queue<int> q; for (int i = 0; i < 5; i++) q.push(i); q.pop(); cout << q.front() << q.back() << q.size() << "\n";
  priority_queue<int> pq; for (int x : {5, 1, 9, 3, 7}) pq.push(x); while (!pq.empty()) { cout << pq.top() << ","; pq.pop(); } cout << "\n";
  priority_queue<int, vector<int>, greater<int>> mq; for (int x : {5, 1, 9, 3, 7}) mq.push(x); cout << mq.top() << sizeof(st) << sizeof(pq) << "\n";
  deque<int> e{1,2,3}; e.insert(e.begin()+1, 9); e.erase(e.begin()); for (int x : e) cout << x; cout << "\n";
}
