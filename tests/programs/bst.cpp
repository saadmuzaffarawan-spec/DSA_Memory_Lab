#include <iostream>
using namespace std;
struct T { int k; T *l, *r; T(int k) : k(k), l(0), r(0) {} };
T* ins(T* t, int k) { if (!t) return new T(k); if (k < t->k) t->l = ins(t->l, k); else t->r = ins(t->r, k); return t; }
void inorder(T* t) { if (!t) return; inorder(t->l); cout << t->k << " "; inorder(t->r); }
int height(T* t) { return t ? 1 + max(height(t->l), height(t->r)) : 0; }
void destroy(T* t) { if (!t) return; destroy(t->l); destroy(t->r); delete t; }
int main() {
    T* root = nullptr;
    int keys[] = {50, 30, 70, 20, 40, 60, 80, 35};
    for (int k : keys) root = ins(root, k);
    inorder(root); cout << endl;
    cout << height(root) << endl;
    destroy(root);
    return 0;
}
