// Minimal C standard library stubs for SQLite on wasm32-freestanding.
// Only implements what SQLite actually calls for in-memory databases.

#ifndef SQLITE_WASM_STUBS_H
#define SQLITE_WASM_STUBS_H

// ─── Standard types ───
typedef unsigned long size_t;
typedef long ssize_t;
typedef int int32_t;
typedef unsigned int uint32_t;
typedef long long int64_t;
typedef unsigned long long uint64_t;
typedef short int16_t;
typedef unsigned short uint16_t;
typedef signed char int8_t;
typedef unsigned char uint8_t;
typedef long intptr_t;
typedef unsigned long uintptr_t;
typedef long ptrdiff_t;
typedef long off_t;
typedef int mode_t;
typedef int uid_t;
typedef int gid_t;
typedef int pid_t;
typedef unsigned int useconds_t;

#define NULL ((void*)0)
#define INT32_MAX 2147483647
#define INT32_MIN (-2147483647-1)
#define INT64_MAX 9223372036854775807LL
#define UINT32_MAX 4294967295U
#define INT16_MAX 32767
#define LONG_MAX  2147483647L
#define LLONG_MAX 9223372036854775807LL

#define CHAR_BIT 8
#define EOF (-1)

#define va_list __builtin_va_list
#define va_start __builtin_va_start
#define va_end __builtin_va_end
#define va_arg __builtin_va_arg
#define va_copy __builtin_va_copy

// ─── stdio stubs ───
typedef struct FILE FILE;
extern FILE *stderr;
#define SEEK_SET 0
#define SEEK_CUR 1
#define SEEK_END 2
#define FILENAME_MAX 4096

// ─── stdlib ───
#define RAND_MAX 2147483647

// ─── errno ───
extern int errno;
#define ENOENT 2
#define EACCES 13
#define EEXIST 17
#define ENOTDIR 20
#define EISDIR 21
#define ENOMEM 12
#define ERANGE 34
#define EINVAL 22
#define ENOSYS 38

// ─── assert ───
#define assert(x) ((void)0)
#define NDEBUG 1

// ─── String/memory ───
void *memset(void *s, int c, size_t n);
void *memcpy(void *dest, const void *src, size_t n);
void *memmove(void *dest, const void *src, size_t n);
int memcmp(const void *s1, const void *s2, size_t n);
size_t strlen(const char *s);
int strcmp(const char *s1, const char *s2);
int strncmp(const char *s1, const char *s2, size_t n);
char *strcpy(char *dest, const char *src);
char *strncpy(char *dest, const char *src, size_t n);
char *strcat(char *dest, const char *src);
char *strchr(const char *s, int c);
char *strrchr(const char *s, int c);
char *strstr(const char *haystack, const char *needle);
size_t strspn(const char *s, const char *accept);
size_t strcspn(const char *s, const char *reject);
int atoi(const char *s);
long strtol(const char *s, char **endp, int base);
long long strtoll(const char *s, char **endp, int base);
unsigned long long strtoull(const char *s, char **endp, int base);
double strtod(const char *s, char **endp);

// ─── Math ───
double fabs(double x);
double ceil(double x);
double floor(double x);
double log(double x);
double log2(double x);
double log10(double x);
double pow(double x, double y);
double sqrt(double x);
double fmod(double x, double y);
double ldexp(double x, int exp);
double frexp(double x, int *exp);
int isdigit(int c);
int isspace(int c);
int isalpha(int c);
int isalnum(int c);
int isupper(int c);
int islower(int c);
int isxdigit(int c);
int isprint(int c);
int toupper(int c);
int tolower(int c);

// ─── Memory allocation ───
void *malloc(size_t size);
void free(void *ptr);
void *realloc(void *ptr, size_t size);
void *calloc(size_t count, size_t size);

// ─── I/O stubs — all return error ───
int fprintf(FILE *stream, const char *fmt, ...);
int printf(const char *fmt, ...);
int snprintf(char *buf, size_t size, const char *fmt, ...);
int sprintf(char *buf, const char *fmt, ...);
int vsnprintf(char *buf, size_t size, const char *fmt, va_list ap);
int fflush(FILE *stream);
int fclose(FILE *stream);
FILE *fopen(const char *path, const char *mode);
size_t fread(void *ptr, size_t size, size_t nmemb, FILE *stream);
size_t fwrite(const void *ptr, size_t size, size_t nmemb, FILE *stream);

// ─── Time stubs ───
typedef long time_t;
struct tm {
    int tm_sec, tm_min, tm_hour, tm_mday, tm_mon, tm_year;
    int tm_wday, tm_yday, tm_isdst;
};
struct timeval { long tv_sec; long tv_usec; };
time_t time(time_t *t);
struct tm *localtime(const time_t *t);
struct tm *gmtime(const time_t *t);
size_t strftime(char *s, size_t max, const char *fmt, const struct tm *tm);
int gettimeofday(struct timeval *tv, void *tz);

// ─── OS stubs ───
int open(const char *path, int flags, ...);
int close(int fd);
ssize_t read(int fd, void *buf, size_t count);
ssize_t write(int fd, const void *buf, size_t count);
off_t lseek(int fd, off_t offset, int whence);
ssize_t pread(int fd, void *buf, size_t count, off_t offset);
ssize_t pwrite(int fd, const void *buf, size_t count, off_t offset);
int ftruncate(int fd, off_t length);
int fsync(int fd);
int fstat(int fd, void *buf);
int stat(const char *path, void *buf);
int fchmod(int fd, mode_t mode);
int unlink(const char *path);
int access(const char *path, int mode);
int mkdir(const char *path, mode_t mode);
int rmdir(const char *path);
char *getcwd(char *buf, size_t size);
pid_t getpid(void);
uid_t geteuid(void);
int fchown(int fd, uid_t owner, gid_t group);
unsigned int sleep(unsigned int seconds);
int usleep(useconds_t usec);
int fcntl(int fd, int cmd, ...);
int ioctl(int fd, int request, ...);
void *mmap(void *addr, size_t len, int prot, int flags, int fd, off_t off);
int munmap(void *addr, size_t len);
ssize_t readlink(const char *path, char *buf, size_t bufsiz);
int utimes(const char *path, const void *times);
char *strerror(int errnum);

// dlopen stubs
void *dlopen(const char *filename, int flags);
int dlclose(void *handle);
void *dlsym(void *handle, const char *symbol);
char *dlerror(void);

// qsort
void qsort(void *base, size_t nmemb, size_t size,
           int (*compar)(const void *, const void *));

// setjmp/longjmp
typedef int jmp_buf[6];
int setjmp(jmp_buf env);
void longjmp(jmp_buf env, int val);

// ─── WASM intrinsics ───
void abort(void);

// locale stubs
typedef void *locale_t;
int strcasecmp(const char *s1, const char *s2);
int strncasecmp(const char *s1, const char *s2, size_t n);
int strcasecmp_l(const char *s1, const char *s2, locale_t loc);
int strncasecmp_l(const char *s1, const char *s2, size_t n, locale_t loc);

#endif // SQLITE_WASM_STUBS_H
