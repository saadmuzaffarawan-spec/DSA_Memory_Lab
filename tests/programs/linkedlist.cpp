#include <iostream>
using namespace std;
struct Node { int val; Node* next; Node(int v) : val(v), next(nullptr) {} };
class List {
    Node* head = nullptr;
    int n = 0;
public:
    void push_front(int v) { Node* x = new Node(v); x->next = head; head = x; n++; }
    void push_back(int v) {
        Node* x = new Node(v);
        if (!head) head = x; else { Node* c = head; while (c->next) c = c->next; c->next = x; }
        n++;
    }
    bool remove(int v) {
        Node** pp = &head;
        while (*pp) { if ((*pp)->val == v) { Node* d = *pp; *pp = d->next; delete d; n--; return true; } pp = &(*pp)->next; }
        return false;
    }
    void reverse() { Node *prev = nullptr, *cur = head; while (cur) { Node* nx = cur->next; cur->next = prev; prev = cur; cur = nx; } head = prev; }
    void print() const { for (Node* c = head; c; c = c->next) cout << c->val << (c->next ? "->" : ""); cout << " (" << n << ")\n"; }
    ~List() { while (head) { Node* d = head; head = head->next; delete d; } }
};
int main() {
    List l;
    for (int i = 1; i <= 5; i++) l.push_back(i * 10);
    l.push_front(5);
    l.print();
    l.remove(30); l.remove(99);
    l.print();
    l.reverse();
    l.print();
    return 0;
}
