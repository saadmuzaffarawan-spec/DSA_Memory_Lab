#include <iostream>
#include <cstring>
#include <cstdlib>
using namespace std;
int main() {
    int rows = 3, cols = 4;
    int** m = new int*[rows];
    for (int i = 0; i < rows; i++) { m[i] = new int[cols]; for (int j = 0; j < cols; j++) m[i][j] = i * cols + j; }
    long s = 0; for (int i = 0; i < rows; i++) for (int j = 0; j < cols; j++) s += m[i][j];
    cout << s << " " << m[2][3] << endl;
    for (int i = 0; i < rows; i++) delete[] m[i];
    delete[] m;
    int* flat = (int*)calloc(rows * cols, sizeof(int));
    flat[1 * cols + 2] = 7;
    cout << flat[6] << flat[0] << endl;
    flat = (int*)realloc(flat, 20 * sizeof(int));
    cout << flat[6] << endl;
    free(flat);
    char buf[10]; memset(buf, 'x', 9); buf[9] = 0;
    char buf2[10]; memcpy(buf2, buf, 10);
    cout << buf2 << " " << strlen(buf2) << endl;
    double mat[2][2] = {{1.5, 2}, {3, 4}}, res[2][2] = {};
    for (int i = 0; i < 2; i++) for (int j = 0; j < 2; j++) for (int k = 0; k < 2; k++) res[i][j] += mat[i][k] * mat[k][j];
    cout << res[0][0] << " " << res[0][1] << " " << res[1][0] << " " << res[1][1] << endl;
    return 0;
}
