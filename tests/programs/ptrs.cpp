#include <iostream>
#include <cstdlib>
#include <cstring>
using namespace std;
void swap_(int* a, int* b) { int t = *a; *a = *b; *b = t; }
void inc(int& r) { r++; }
int main() {
    int x = 1, y = 2;
    swap_(&x, &y);
    inc(x);
    cout << x << " " << y << endl;
    int a[5] = {10, 20, 30, 40, 50};
    int* p = a;
    cout << *p << " " << *(p + 2) << " " << p[3] << " " << *(a + 4) << endl;
    p += 2; p--;
    cout << *p << " " << (p - a) << endl;
    int** pp = &p;
    **pp = 99;
    cout << a[1] << endl;
    const char* s = "hello";
    cout << strlen(s) << " " << s[1] << " " << *s << endl;
    char buf[16];
    strcpy(buf, "abc"); strcat(buf, "def");
    cout << buf << " " << strlen(buf) << " " << strcmp(buf, "abcdef") << endl;
    int* h = (int*)malloc(3 * sizeof(int));
    for (int i = 0; i < 3; i++) h[i] = i * i;
    cout << h[0] + h[1] + h[2] << endl;
    free(h);
    int* q = new int(5);
    *q += 1;
    cout << *q << endl;
    delete q;
    int* arr2 = new int[4]{1, 2, 3, 4};
    cout << arr2[3] << endl;
    delete[] arr2;
    int m[2][3] = {{1, 2, 3}, {4, 5, 6}};
    cout << m[1][2] << " " << sizeof(m) << " " << sizeof(m[0]) << " " << *(*(m + 1) + 1) << endl;
    int c3[2][2][2];
    for (int i = 0; i < 8; i++) (&c3[0][0][0])[i] = i;
    cout << c3[1][0][1] << " " << sizeof(c3) << endl;
    void (*fp)(int*, int*) = swap_;
    fp(&x, &y);
    cout << x << " " << y << endl;
    int* np = nullptr;
    cout << (np == nullptr) << endl;
    return 0;
}
