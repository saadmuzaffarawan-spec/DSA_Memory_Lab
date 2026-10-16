#include <iostream>
using namespace std;
class Animal {
public:
    Animal() { cout << "Animal()\n"; }
    virtual ~Animal() { cout << "~Animal\n"; }
    virtual void speak() { cout << "...\n"; }
    int legs = 4;
};
class Dog : public Animal {
public:
    Dog() { cout << "Dog()\n"; }
    ~Dog() { cout << "~Dog\n"; }
    void speak() override { cout << "Woof\n"; }
};
class Counter {
    static int n;
    int id;
public:
    Counter() : id(++n) { cout << "C" << id << " "; }
    Counter(const Counter& o) : id(++n) { cout << "copy" << o.id << "->" << id << " "; }
    ~Counter() { cout << "~C" << id << " "; }
    static int count() { return n; }
};
int Counter::n = 0;
struct V2 {
    int x, y;
    V2 operator+(const V2& o) const { return {x + o.x, y + o.y}; }
    bool operator==(const V2& o) const { return x == o.x && y == o.y; }
    V2& operator+=(const V2& o) { x += o.x; y += o.y; return *this; }
};
ostream& operator<<(ostream& os, const V2& v) { return os << "(" << v.x << "," << v.y << ")"; }
Counter pass(Counter c) { return c; }
int main() {
    Animal* a = new Dog();
    a->speak();
    cout << a->legs << " " << sizeof(Animal) << " " << sizeof(Dog) << endl;
    delete a;
    {
        Counter c1;
        Counter c2 = c1;
        Counter c3 = pass(c2);
        cout << Counter::count() << endl;
    }
    cout << endl;
    V2 p{1, 2}, q{3, 4};
    V2 r = p + q;
    r += V2{10, 10};
    cout << r << " " << (p == q) << endl;
    return 0;
}
