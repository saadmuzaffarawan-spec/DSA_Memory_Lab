struct _IO_FILE { int _fd; };
typedef _IO_FILE FILE;
extern FILE _iob[3];
#define stdin (&_iob[0])
#define stdout (&_iob[1])
#define stderr (&_iob[2])
int printf(const char* fmt, ...);
int fprintf(FILE* f, const char* fmt, ...);
int sprintf(char* buf, const char* fmt, ...);
int snprintf(char* buf, size_t n, const char* fmt, ...);
int puts(const char* s);
int putchar(int c);
int getchar();
int scanf(const char* fmt, ...);
int fflush(FILE* f);
