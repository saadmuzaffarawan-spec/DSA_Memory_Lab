void* malloc(size_t n);
void* calloc(size_t n, size_t sz);
void* realloc(void* p, size_t n);
void free(void* p);
int abs(int x);
long labs(long x);
long long llabs(long long x);
int atoi(const char* s);
long atol(const char* s);
long long atoll(const char* s);
double atof(const char* s);
int rand();
void srand(unsigned int seed);
void exit(int code);
void _Exit(int code);
void abort();
int atexit(void (*f)());
char* getenv(const char* name);
void qsort(void* base, size_t n, size_t size, int (*cmp)(const void*, const void*));
long time(long* t);
long clock();
#define EXIT_SUCCESS 0
#define EXIT_FAILURE 1
#define CLOCKS_PER_SEC 1000
