#include <iostream>
#include <memory>
#include <vector>
#include <string>
using namespace std;
struct Node {
  int v; shared_ptr<Node> next; weak_ptr<Node> prev;
  Node(int x) : v(x) { cout << "Node(" << v << ")\n"; }
  ~Node() { cout << "~Node(" << v << ")\n"; }
};
struct Widget : enable_shared_from_this<Widget> {
  int id; Widget(int i) : id(i) {}
  shared_ptr<Widget> self() { return shared_from_this(); }
};
struct Base { virtual ~Base() { cout << "~Base\n"; } virtual int f() { return 1; } };
struct Derived : Base { ~Derived() { cout << "~Derived\n"; } int f() { return 2; } };
int main() {
  cout << sizeof(unique_ptr<int>) << " " << sizeof(shared_ptr<int>) << " " << sizeof(weak_ptr<int>) << "\n";
  {
    unique_ptr<Node> a = make_unique<Node>(1);
    unique_ptr<Node> b = move(a);
    cout << (a == nullptr) << (b != nullptr) << " " << b->v << "\n";
    b.reset(new Node(2));
    Node* raw = b.release();
    cout << raw->v << "\n";
    delete raw;
  }
  {
    auto s1 = make_shared<Node>(10);
    auto s2 = s1;
    cout << s1.use_count() << "\n";
    s2.reset();
    cout << s1.use_count() << " " << (s2 ? "set" : "empty") << "\n";
    weak_ptr<Node> w = s1;
    cout << w.expired() << w.use_count() << "\n";
    if (auto l = w.lock()) cout << "locked " << l->v << " " << s1.use_count() << "\n";
    s1.reset();
    cout << w.expired() << " " << (w.lock() == nullptr) << "\n";
  }
  {
    auto a = make_shared<Node>(20); auto b = make_shared<Node>(21);
    a->next = b; b->prev = a;
    cout << a.use_count() << b.use_count() << "\n";
  }
  {
    shared_ptr<Widget> w(new Widget(5));
    shared_ptr<Widget> w2 = w->self();
    cout << w.use_count() << " " << w2->id << "\n";
  }
  {
    shared_ptr<Base> p = make_shared<Derived>();
    cout << p->f() << "\n";
    unique_ptr<Base> q(new Derived);
    cout << q->f() << "\n";
  }
  {
    shared_ptr<int> p(new int(7), [](int* x) { cout << "custom delete " << *x << "\n"; delete x; });
    cout << *p << "\n";
    vector<unique_ptr<int>> v;
    for (int i = 0; i < 4; i++) v.push_back(make_unique<int>(i * i));
    int t = 0; for (auto& u : v) t += *u;
    cout << t << "\n";
    unique_ptr<int[]> arr(new int[3]{4, 5, 6});
    cout << arr[0] + arr[2] << "\n";
  }
  cout << "end\n";
}
