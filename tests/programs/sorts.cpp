#include <iostream>
using namespace std;
void qs(int* a, int lo, int hi) {
    if (lo >= hi) return;
    int p = a[hi], i = lo - 1;
    for (int j = lo; j < hi; j++) if (a[j] < p) { i++; int t = a[i]; a[i] = a[j]; a[j] = t; }
    int t = a[i + 1]; a[i + 1] = a[hi]; a[hi] = t;
    qs(a, lo, i); qs(a, i + 2, hi);
}
void msort(int* a, int* tmp, int lo, int hi) {
    if (hi - lo < 2) return;
    int mid = (lo + hi) / 2;
    msort(a, tmp, lo, mid); msort(a, tmp, mid, hi);
    int i = lo, j = mid, k = lo;
    while (i < mid && j < hi) tmp[k++] = a[i] <= a[j] ? a[i++] : a[j++];
    while (i < mid) tmp[k++] = a[i++];
    while (j < hi) tmp[k++] = a[j++];
    for (k = lo; k < hi; k++) a[k] = tmp[k];
}
int bsearch_(const int* a, int n, int x) { int lo = 0, hi = n - 1; while (lo <= hi) { int m = lo + (hi - lo) / 2; if (a[m] == x) return m; if (a[m] < x) lo = m + 1; else hi = m - 1; } return -1; }
int main() {
    int a[] = {9, 4, 7, 1, 8, 2, 6, 3, 5, 0};
    int b[10]; for (int i = 0; i < 10; i++) b[i] = a[i];
    qs(a, 0, 9);
    for (int x : a) cout << x << " "; cout << endl;
    int* tmp = new int[10];
    msort(b, tmp, 0, 10);
    for (int x : b) cout << x << " "; cout << endl;
    delete[] tmp;
    cout << bsearch_(a, 10, 7) << " " << bsearch_(a, 10, 42) << endl;
    int sieve[50]; for (int i = 0; i < 50; i++) sieve[i] = 1;
    sieve[0] = sieve[1] = 0;
    for (int i = 2; i * i < 50; i++) if (sieve[i]) for (int j = i * i; j < 50; j += i) sieve[j] = 0;
    for (int i = 0; i < 50; i++) if (sieve[i]) cout << i << " "; cout << endl;
    return 0;
}
