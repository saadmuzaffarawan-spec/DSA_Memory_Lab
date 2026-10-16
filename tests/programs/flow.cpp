#include <iostream>
using namespace std;
int fib(int n) { return n < 2 ? n : fib(n - 1) + fib(n - 2); }
int fact(int n) { if (n <= 1) return 1; return n * fact(n - 1); }
int main() {
    for (int i = 0; i < 5; i++) { if (i == 3) continue; cout << i << " "; }
    cout << endl;
    int i = 0;
    while (i < 10) { i += 3; if (i > 7) break; }
    cout << i << endl;
    do { i--; } while (i > 5);
    cout << i << endl;
    switch (i) { case 1: cout << "one"; break; case 5: cout << "five"; case 6: cout << "six"; break; default: cout << "def"; }
    cout << endl;
    for (int a = 0, b = 10; a < b; a += 3, b -= 3) cout << a << ',' << b << ' ';
    cout << endl;
    cout << fib(15) << " " << fact(10) << endl;
    int arr[] = {5, 3, 8, 1, 9, 2};
    int n = sizeof(arr) / sizeof(arr[0]);
    for (int p = 0; p < n - 1; p++) for (int q = 0; q < n - 1 - p; q++) if (arr[q] > arr[q + 1]) { int t = arr[q]; arr[q] = arr[q + 1]; arr[q + 1] = t; }
    for (int v : arr) cout << v << " ";
    cout << endl;
    goto end;
    cout << "skipped";
end:
    cout << "done" << endl;
    return 0;
}
