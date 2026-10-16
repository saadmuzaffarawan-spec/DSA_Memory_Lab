#include <iostream>
using namespace std;
class Shape {
public:
    virtual double area() const = 0;
    virtual const char* name() const { return "shape"; }
    virtual ~Shape() {}
};
class Rect : public Shape {
protected: double w, h;
public: Rect(double w, double h) : w(w), h(h) {}
    double area() const override { return w * h; }
    const char* name() const override { return "rect"; }
};
class Square : public Rect {
public: Square(double s) : Rect(s, s) {}
    const char* name() const override { return "square"; }
};
class Circle : public Shape {
    double r;
public: Circle(double r) : r(r) {}
    double area() const override { return 3.0 * r * r; }
};
struct A { int a = 1; virtual void f() { cout << "A::f\n"; } };
struct B : A { int b = 2; void f() override { cout << "B::f\n"; } };
struct M1 { int x = 10; }; struct M2 { int y = 20; };
struct MM : M1, M2 { int z = 30; };
struct VB { int v = 5; };
struct L : virtual VB { int l = 1; };
struct R : virtual VB { int r = 2; };
struct D : L, R { int d = 3; };
int main() {
    Shape* s[] = {new Rect(2, 3), new Square(4), new Circle(2)};
    for (Shape* p : s) cout << p->name() << " " << p->area() << endl;
    for (Shape* p : s) delete p;
    B b; A& ra = b; ra.f();
    A a = b; a.f();
    cout << sizeof(A) << sizeof(B) << sizeof(MM) << sizeof(D) << endl;
    MM mm; M2* p2 = &mm;
    cout << p2->y << " " << ((char*)p2 - (char*)&mm) << endl;
    D d; cout << d.v << d.l << d.r << d.d << endl;
    return 0;
}
