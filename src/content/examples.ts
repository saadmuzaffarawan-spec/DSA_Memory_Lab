// Starter programs. Each one is meant to be stepped through; the comments say what to watch.
export interface Example {
  id: string;
  title: string;
  group: 'Basics' | 'Arrays' | 'Pointers' | 'Structs & classes' | 'Heap' | 'Containers' | 'Bugs';
  blurb: string;
  code: string;
}

export const EXAMPLES: Example[] = [
  {
    id: 'variables', title: 'Variables and sizes', group: 'Basics',
    blurb: 'How much room does each type take, and where does it live?',
    code: `#include <iostream>
using namespace std;

int main() {
  // Step through and watch each variable appear on the stack.
  // Open the Memory map tab to see which addresses they use.
  char   letter = 'A';
  bool   ready  = true;
  int    count  = 42;
  long   big    = 1234567;      // 4 bytes on Windows, 8 on Linux and macOS
  float  ratio  = 0.5f;
  double pi     = 3.14159;

  cout << "sizeof(int) = " << sizeof(int) << "\\n";
  cout << "sizeof(long) = " << sizeof(long) << "\\n";
  cout << "sizeof(double) = " << sizeof(double) << "\\n";

  count = count + 8;           // the bytes at count's address change in place
  return 0;
}
`,
  },
  {
    id: 'operators', title: 'Operators and overflow', group: 'Basics',
    blurb: 'Integer maths, shifts, bit tricks and what happens at the edge.',
    code: `#include <iostream>
using namespace std;

int main() {
  int a = 7, b = 2;
  cout << a / b << " " << a % b << " " << (double)a / b << "\\n";   // integer division truncates

  unsigned char small = 250;
  small = small + 10;          // wraps around: unsigned overflow is well defined
  cout << (int)small << "\\n";

  int flags = 0;
  flags |= 1 << 3;             // set bit 3
  flags |= 1 << 0;             // set bit 0
  cout << flags << " " << (flags & 8 ? "bit 3 is set" : "bit 3 is clear") << "\\n";

  int x = 5;
  int y = x++ + ++x;           // careful: this is unsequenced in C++03, defined in C++17 left to right
  cout << x << " " << y << "\\n";

  int neg = -17;
  cout << neg / 4 << " " << neg % 4 << " " << (neg >> 2) << "\\n";   // division truncates toward zero, >> floors
  return 0;
}
`,
  },
  {
    id: 'array1d', title: 'A 1D array', group: 'Arrays',
    blurb: 'Elements sit side by side. The array name is the address of element 0.',
    code: `#include <iostream>
using namespace std;

int main() {
  int scores[5] = {90, 72, 85, 60, 77};

  int total = 0;
  for (int i = 0; i < 5; i++) {
    total += scores[i];        // scores[i] is the same as *(scores + i)
  }
  cout << "average = " << total / 5 << "\\n";

  cout << "sizeof(scores) = " << sizeof(scores) << "\\n";
  cout << "elements = " << sizeof(scores) / sizeof(scores[0]) << "\\n";
  return 0;
}
`,
  },
  {
    id: 'array2d', title: '2D and 3D arrays vs separate arrays', group: 'Arrays',
    blurb: 'Three separate arrays and one 3D array: where do the elements really sit?',
    code: `#include <iostream>
using namespace std;

int main() {
  // Three separate arrays: the compiler may place them anywhere (watch the addresses).
  int a[2] = {1, 2};
  int b[2] = {3, 4};
  int c[2] = {5, 6};

  // One 2D array: rows are laid out one after another ("row-major").
  int grid[2][3] = {{1, 2, 3}, {4, 5, 6}};

  // One 3D array: 2 layers, each 2 rows of 3 columns.
  int cube[2][2][3] = {{{1, 2, 3}, {4, 5, 6}}, {{7, 8, 9}, {10, 11, 12}}};

  cout << &grid[0][2] << " " << &grid[1][0] << "\\n";   // neighbours in memory
  cout << cube[1][0][2] << "\\n";                       // = *(&cube[0][0][0] + 1*6 + 0*3 + 2)

  int* flat = &cube[0][0][0];
  cout << flat[8] << "\\n";                             // the same memory seen as one long row
  return 0;
}
`,
  },
  {
    id: 'pointers', title: 'Pointers and references', group: 'Pointers',
    blurb: 'A pointer is a variable that holds an address. Follow the arrows.',
    code: `#include <iostream>
using namespace std;

void bump(int* p)  { *p = *p + 1; }
void bump(int& r)  { r = r + 1; }

int main() {
  int x = 10;
  int* p = &x;                 // p holds the address of x
  int** pp = &p;               // a pointer to a pointer

  *p = 20;                     // write through the pointer: x changes
  **pp = 30;

  bump(p);
  bump(x);                     // a reference is an alias: no new address to follow

  int* none = nullptr;         // points at nothing
  cout << x << " " << *p << " " << (none == nullptr) << "\\n";
  return 0;
}
`,
  },
  {
    id: 'ptrarith', title: 'Pointer arithmetic', group: 'Pointers',
    blurb: 'p + 1 moves by one element, not by one byte.',
    code: `#include <iostream>
using namespace std;

int main() {
  int nums[4] = {10, 20, 30, 40};
  int* p = nums;               // decays to &nums[0]

  p = p + 2;                   // 2 elements = 8 bytes forward
  cout << *p << "\\n";

  char text[6] = {'h', 'e', 'l', 'l', 'o', 0};
  char* q = text;
  q++;                         // 1 element = 1 byte
  cout << q << "\\n";

  cout << (&nums[3] - &nums[0]) << "\\n";   // difference counts elements, not bytes
  return 0;
}
`,
  },
  {
    id: 'padding', title: 'Struct padding and alignment', group: 'Structs & classes',
    blurb: 'Why a struct of 13 bytes of data is 24 bytes big. The grey hatching is padding.',
    code: `#include <iostream>
using namespace std;

struct Loose {        // fields in an unlucky order
  char   tag;
  double value;
  char   flag;
  int    id;
};

struct Tight {        // same fields, largest first
  double value;
  int    id;
  char   tag;
  char   flag;
};

int main() {
  Loose a = {'x', 2.5, 'y', 7};
  Tight b = {2.5, 7, 'x', 'y'};
  cout << sizeof(Loose) << " vs " << sizeof(Tight) << "\\n";
  return 0;
}
`,
  },
  {
    id: 'classes', title: 'Objects, constructors and destructors', group: 'Structs & classes',
    blurb: 'Watch an object being built and torn down, and how a virtual function changes its layout.',
    code: `#include <iostream>
using namespace std;

class Animal {
 public:
  Animal(int legs) : legs_(legs) { cout << "Animal(" << legs_ << ")\\n"; }
  virtual ~Animal() { cout << "~Animal\\n"; }
  virtual void speak() { cout << "...\\n"; }
 protected:
  int legs_;
};

class Dog : public Animal {
 public:
  Dog() : Animal(4), tricks_(3) { cout << "Dog()\\n"; }
  ~Dog() { cout << "~Dog\\n"; }
  void speak() override { cout << "Woof\\n"; }
 private:
  int tricks_;
};

int main() {
  Dog d;                       // the first 8 bytes are the hidden vptr
  Animal* a = &d;
  a->speak();                  // chosen at run time through the vptr
  cout << sizeof(Dog) << "\\n";
  return 0;                    // destructors run in reverse order
}
`,
  },
  {
    id: 'newdelete', title: 'new and delete', group: 'Heap',
    blurb: 'Heap blocks live until you free them. The stack variable only holds the address.',
    code: `#include <iostream>
using namespace std;

struct Point { int x, y; };

int main() {
  int* one = new int(5);
  int* many = new int[4]{1, 2, 3, 4};
  Point* pt = new Point{3, 4};

  *one += 1;
  many[2] = 99;
  cout << *one << " " << many[2] << " " << pt->x + pt->y << "\\n";

  delete one;                  // single object: delete
  delete[] many;               // array: delete[]
  delete pt;
  return 0;
}
`,
  },
  {
    id: 'linkedlist', title: 'A linked list', group: 'Heap',
    blurb: 'Nodes scattered across the heap, joined only by pointers.',
    code: `#include <iostream>
using namespace std;

struct Node {
  int value;
  Node* next;
};

Node* push_front(Node* head, int v) {
  Node* n = new Node{v, head};
  return n;
}

int main() {
  Node* head = nullptr;
  for (int i = 1; i <= 4; i++) head = push_front(head, i * 10);

  for (Node* p = head; p != nullptr; p = p->next) cout << p->value << " ";
  cout << "\\n";

  while (head) {               // free every node
    Node* next = head->next;
    delete head;
    head = next;
  }
  return 0;
}
`,
  },
  {
    id: 'recursion', title: 'Recursion and the call stack', group: 'Basics',
    blurb: 'Every call gets its own frame. Step in and watch the stack grow, then unwind.',
    code: `#include <iostream>
using namespace std;

int factorial(int n) {
  if (n <= 1) return 1;
  int smaller = factorial(n - 1);   // a new frame for every call
  return n * smaller;
}

int main() {
  int result = factorial(5);
  cout << result << "\\n";
  return 0;
}
`,
  },
  {
    id: 'vector', title: 'vector growth', group: 'Containers',
    blurb: 'push_back reallocates when full. Watch the old block die and the elements move.',
    code: `#include <iostream>
#include <vector>
using namespace std;

int main() {
  vector<int> v;
  for (int i = 1; i <= 6; i++) {
    v.push_back(i * i);
    cout << "size " << v.size() << ", capacity " << v.capacity() << "\\n";
  }
  // The data pointer changes whenever the capacity grows.
  return 0;
}
`,
  },
  {
    id: 'string', title: 'std::string and small-string optimisation', group: 'Containers',
    blurb: 'Short strings live inside the object; long ones move to the heap.',
    code: `#include <iostream>
#include <string>
using namespace std;

int main() {
  string small = "hello";
  string big = "this string is far too long to fit inside the object itself";
  cout << sizeof(string) << "\\n";
  small += " world";
  big += "!";
  cout << small << "\\n" << big << "\\n";
  return 0;
}
`,
  },
  {
    id: 'map', title: 'map: a red-black tree', group: 'Containers',
    blurb: 'std::map is a balanced tree of heap nodes. Each insert allocates one node.',
    code: `#include <iostream>
#include <map>
#include <string>
using namespace std;

int main() {
  map<int, string> m;
  m[30] = "thirty";
  m[10] = "ten";
  m[20] = "twenty";
  m[40] = "forty";

  for (auto& kv : m) cout << kv.first << "=" << kv.second << " ";
  cout << "\\n";

  m.erase(20);
  return 0;
}
`,
  },
  {
    id: 'list', title: 'list: a doubly linked list', group: 'Containers',
    blurb: 'Every element is its own heap node with next and prev pointers. Sorting relinks nodes; nothing is copied.',
    code: `#include <iostream>
#include <list>
using namespace std;

int main() {
  list<int> l;
  l.push_back(30);
  l.push_back(10);
  l.push_front(20);      // a new node in front: watch the arrows

  l.sort();              // the nodes are relinked, the values never move
  for (int x : l) cout << x << " ";
  cout << "\\n";

  auto it = l.begin();
  ++it;
  l.erase(it);           // one node is freed, its neighbours are joined
  return 0;
}
`,
  },
  {
    id: 'hashmap', title: 'unordered_map: buckets and nodes', group: 'Containers',
    blurb: 'A hash table: an array of buckets plus a chain of nodes. Watch it grow and rehash.',
    code: `#include <iostream>
#include <unordered_map>
using namespace std;

int main() {
  unordered_map<int, int> m;
  cout << "buckets at start: " << m.bucket_count() << "\\n";
  for (int i = 1; i <= 14; i++) {
    m[i * 10] = i;       // the 14th insert goes over the load limit
    cout << m.size() << " items, " << m.bucket_count() << " buckets\\n";
  }
  // The iteration order is NOT the insertion order: it follows the node chain.
  for (auto& kv : m) cout << kv.first << " ";
  cout << "\\n";
  return 0;
}
`,
  },
  {
    id: 'smart', title: 'unique_ptr and shared_ptr', group: 'Heap',
    blurb: 'Smart pointers free memory for you. See the reference count change.',
    code: `#include <iostream>
#include <memory>
using namespace std;

struct Widget { int id; Widget(int i) : id(i) { cout << "Widget " << id << " created\\n"; } ~Widget() { cout << "Widget " << id << " destroyed\\n"; } };

int main() {
  unique_ptr<Widget> u = make_unique<Widget>(1);
  {
    shared_ptr<Widget> a = make_shared<Widget>(2);
    shared_ptr<Widget> b = a;                 // use count 2
    cout << a.use_count() << "\\n";
  }                                           // both gone: the widget is destroyed here
  cout << "end of main\\n";
  return 0;
}
`,
  },
  {
    id: 'bug-uaf', title: 'Bug: use after free', group: 'Bugs',
    blurb: 'The pointer still holds the address, but the block is no longer yours.',
    code: `#include <iostream>
using namespace std;

int main() {
  int* p = new int(42);
  delete p;
  cout << *p << "\\n";         // reads freed memory: undefined behaviour
  *p = 7;                      // writes into the allocator's bookkeeping
  return 0;
}
`,
  },
  {
    id: 'bug-leak', title: 'Bug: memory leak', group: 'Bugs',
    blurb: 'Overwrite the only pointer and the block is lost forever.',
    code: `#include <iostream>
using namespace std;

int main() {
  int* data = new int[100];
  data[0] = 1;
  data = new int[10];          // the first block can no longer be freed
  delete[] data;
  return 0;                    // 400 bytes leaked
}
`,
  },
  {
    id: 'bug-overflow', title: 'Bug: buffer overflow and uninitialised read', group: 'Bugs',
    blurb: 'Writing past the end corrupts the neighbour. Reading before writing gives garbage.',
    code: `#include <iostream>
using namespace std;

int main() {
  int guard = 1234;
  int buf[4] = {1, 2, 3, 4};
  int unset;

  cout << unset << "\\n";      // never assigned: whatever bytes were here
  for (int i = 0; i <= 4; i++) {
    buf[i] = 0;                // i == 4 is one past the end
  }
  cout << guard << "\\n";
  return 0;
}
`,
  },
];

export const DEFAULT_EXAMPLE = 'array2d';
export const byId = (id: string) => EXAMPLES.find((e) => e.id === id);
