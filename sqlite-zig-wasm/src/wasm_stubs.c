// Minimal libc + VFS for SQLite on wasm32-freestanding.
// Provides just enough to run in-memory databases.

#include "wasm_stubs.h"
#include "sqlite3.h"

// ─── Globals ───
int errno = 0;
FILE *stderr = (FILE*)0;
static struct tm _tm_buf;

// ─── WASM memory management ───
// Simple bump allocator with free-list for reuse.
// WASM memory is grown via __builtin_wasm_memory_grow.

extern unsigned char __heap_base;
static unsigned char *heap_ptr = 0;

// Allocation header: stores size for realloc
typedef struct { size_t size; } AllocHeader;
#define ALLOC_ALIGN 16
#define HEADER_SIZE ALLOC_ALIGN

static void heap_init(void) {
    if (!heap_ptr) {
        heap_ptr = &__heap_base;
        // Align to 16 bytes
        heap_ptr = (unsigned char*)(((uintptr_t)heap_ptr + 15) & ~(uintptr_t)15);
    }
}

static void ensure_memory(unsigned char *end) {
    size_t current_pages = __builtin_wasm_memory_size(0);
    size_t current_end = current_pages * 65536;
    if ((uintptr_t)end > current_end) {
        size_t needed = (uintptr_t)end - current_end;
        size_t pages = (needed + 65535) / 65536;
        if (__builtin_wasm_memory_grow(0, pages) == (size_t)-1) {
            return; // OOM
        }
    }
}

void *malloc(size_t size) {
    if (size == 0) return NULL;
    heap_init();
    size_t total = ((size + HEADER_SIZE + ALLOC_ALIGN - 1) / ALLOC_ALIGN) * ALLOC_ALIGN;
    unsigned char *block = heap_ptr;
    ensure_memory(block + total);
    heap_ptr += total;
    AllocHeader *hdr = (AllocHeader*)block;
    hdr->size = size;
    return block + HEADER_SIZE;
}

void free(void *ptr) {
    (void)ptr; // bump allocator: no-op
}

void *realloc(void *ptr, size_t new_size) {
    if (!ptr) return malloc(new_size);
    if (new_size == 0) { free(ptr); return NULL; }
    AllocHeader *hdr = (AllocHeader*)((unsigned char*)ptr - HEADER_SIZE);
    size_t old_size = hdr->size;
    void *new_ptr = malloc(new_size);
    if (!new_ptr) return NULL;
    size_t copy = old_size < new_size ? old_size : new_size;
    memcpy(new_ptr, ptr, copy);
    return new_ptr;
}

void *calloc(size_t count, size_t size) {
    size_t total = count * size;
    void *ptr = malloc(total);
    if (ptr) memset(ptr, 0, total);
    return ptr;
}

// ─── String/memory functions ───

void *memset(void *s, int c, size_t n) {
    unsigned char *p = (unsigned char*)s;
    while (n--) *p++ = (unsigned char)c;
    return s;
}

void *memcpy(void *dest, const void *src, size_t n) {
    unsigned char *d = (unsigned char*)dest;
    const unsigned char *s = (const unsigned char*)src;
    while (n--) *d++ = *s++;
    return dest;
}

void *memmove(void *dest, const void *src, size_t n) {
    unsigned char *d = (unsigned char*)dest;
    const unsigned char *s = (const unsigned char*)src;
    if (d < s) { while (n--) *d++ = *s++; }
    else { d += n; s += n; while (n--) *--d = *--s; }
    return dest;
}

int memcmp(const void *s1, const void *s2, size_t n) {
    const unsigned char *a = (const unsigned char*)s1;
    const unsigned char *b = (const unsigned char*)s2;
    while (n--) { if (*a != *b) return *a - *b; a++; b++; }
    return 0;
}

size_t strlen(const char *s) {
    const char *p = s;
    while (*p) p++;
    return (size_t)(p - s);
}

int strcmp(const char *s1, const char *s2) {
    while (*s1 && *s1 == *s2) { s1++; s2++; }
    return (unsigned char)*s1 - (unsigned char)*s2;
}

int strncmp(const char *s1, const char *s2, size_t n) {
    if (!n) return 0;
    while (--n && *s1 && *s1 == *s2) { s1++; s2++; }
    return (unsigned char)*s1 - (unsigned char)*s2;
}

char *strcpy(char *dest, const char *src) {
    char *d = dest;
    while ((*d++ = *src++));
    return dest;
}

char *strncpy(char *dest, const char *src, size_t n) {
    char *d = dest;
    while (n && (*d = *src)) { d++; src++; n--; }
    while (n--) *d++ = 0;
    return dest;
}

char *strcat(char *dest, const char *src) {
    char *d = dest + strlen(dest);
    while ((*d++ = *src++));
    return dest;
}

char *strchr(const char *s, int c) {
    while (*s) { if (*s == (char)c) return (char*)s; s++; }
    return (c == 0) ? (char*)s : NULL;
}

char *strrchr(const char *s, int c) {
    const char *last = NULL;
    while (*s) { if (*s == (char)c) last = s; s++; }
    if (c == 0) return (char*)s;
    return (char*)last;
}

char *strstr(const char *haystack, const char *needle) {
    if (!*needle) return (char*)haystack;
    size_t nlen = strlen(needle);
    while (*haystack) {
        if (strncmp(haystack, needle, nlen) == 0) return (char*)haystack;
        haystack++;
    }
    return NULL;
}

size_t strspn(const char *s, const char *accept) {
    size_t count = 0;
    while (*s) {
        const char *a = accept;
        int found = 0;
        while (*a) { if (*s == *a) { found = 1; break; } a++; }
        if (!found) break;
        count++; s++;
    }
    return count;
}

size_t strcspn(const char *s, const char *reject) {
    size_t count = 0;
    while (*s) {
        const char *r = reject;
        while (*r) { if (*s == *r) return count; r++; }
        count++; s++;
    }
    return count;
}

long long strtoll(const char *s, char **endp, int base) {
    return (long long)strtol(s, endp, base);
}

unsigned long long strtoull(const char *s, char **endp, int base) {
    return (unsigned long long)strtol(s, endp, base);
}

// ─── Math functions ───
// Use WASM builtins where possible, simple implementations otherwise.

double fabs(double x) { return x < 0 ? -x : x; }
double ceil(double x) { return __builtin_ceil(x); }
double floor(double x) { return __builtin_floor(x); }
double sqrt(double x) { return __builtin_sqrt(x); }
double fmod(double x, double y) { return x - (int)(x / y) * y; }

// ln(x) via Taylor series around 1 — sufficient for SQLite's limited math use
double log(double x) {
    if (x <= 0) return -1.0/0.0; // -inf
    // Reduce: x = m * 2^e where 1 <= m < 2
    int e = 0;
    double m = x;
    while (m >= 2.0) { m /= 2.0; e++; }
    while (m < 1.0) { m *= 2.0; e--; }
    // ln(m * 2^e) = ln(m) + e * ln(2)
    // ln(m) via series: ln(1+t) = t - t^2/2 + t^3/3 - ...
    double t = m - 1.0;
    double result = 0.0, term = t;
    for (int i = 1; i <= 40; i++) {
        result += term / i;
        term *= -t;
    }
    return result + e * 0.6931471805599453; // ln(2)
}

double log2(double x) { return log(x) * 1.4426950408889634; }
double log10(double x) { return log(x) * 0.4342944819032518; }

double pow(double base, double exp) {
    if (exp == 0.0) return 1.0;
    if (base == 0.0) return 0.0;
    // For integer exponents, use repeated multiplication
    if (exp == (int)exp && exp > 0 && exp < 64) {
        double result = 1.0;
        int n = (int)exp;
        double b = base;
        while (n > 0) { if (n & 1) result *= b; b *= b; n >>= 1; }
        return result;
    }
    // General: base^exp = exp(exp * ln(base))
    double ln_base = log(base);
    double y = exp * ln_base;
    // exp(y) via Taylor series
    double result = 1.0, term = 1.0;
    for (int i = 1; i <= 40; i++) { term *= y / i; result += term; }
    return result;
}

double ldexp(double x, int exp) {
    while (exp > 0) { x *= 2.0; exp--; }
    while (exp < 0) { x *= 0.5; exp++; }
    return x;
}

double frexp(double x, int *exp) {
    if (x == 0.0) { *exp = 0; return 0.0; }
    int e = 0;
    double m = fabs(x);
    while (m >= 1.0) { m *= 0.5; e++; }
    while (m < 0.5) { m *= 2.0; e--; }
    *exp = e;
    return x < 0 ? -m : m;
}

int strcasecmp(const char *s1, const char *s2) {
    while (*s1 && tolower((unsigned char)*s1) == tolower((unsigned char)*s2)) { s1++; s2++; }
    return tolower((unsigned char)*s1) - tolower((unsigned char)*s2);
}

int strncasecmp(const char *s1, const char *s2, size_t n) {
    if (!n) return 0;
    while (--n && *s1 && tolower((unsigned char)*s1) == tolower((unsigned char)*s2)) { s1++; s2++; }
    return tolower((unsigned char)*s1) - tolower((unsigned char)*s2);
}

int strcasecmp_l(const char *s1, const char *s2, locale_t loc) {
    (void)loc;
    return strcasecmp(s1, s2);
}

int strncasecmp_l(const char *s1, const char *s2, size_t n, locale_t loc) {
    (void)loc;
    return strncasecmp(s1, s2, n);
}

// ─── ctype ───

int isdigit(int c) { return c >= '0' && c <= '9'; }
int isspace(int c) { return c == ' ' || (c >= '\t' && c <= '\r'); }
int isalpha(int c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z'); }
int isalnum(int c) { return isalpha(c) || isdigit(c); }
int isupper(int c) { return c >= 'A' && c <= 'Z'; }
int islower(int c) { return c >= 'a' && c <= 'z'; }
int isxdigit(int c) { return isdigit(c) || (c >= 'a' && c <= 'f') || (c >= 'A' && c <= 'F'); }
int isprint(int c) { return c >= ' ' && c <= '~'; }
int toupper(int c) { return (c >= 'a' && c <= 'z') ? c - 32 : c; }
int tolower(int c) { return (c >= 'A' && c <= 'Z') ? c + 32 : c; }

// ─── Number parsing ───

int atoi(const char *s) {
    int sign = 1, result = 0;
    while (isspace(*s)) s++;
    if (*s == '-') { sign = -1; s++; } else if (*s == '+') s++;
    while (isdigit(*s)) { result = result * 10 + (*s - '0'); s++; }
    return sign * result;
}

long strtol(const char *s, char **endp, int base) {
    long result = 0;
    int sign = 1;
    while (isspace(*s)) s++;
    if (*s == '-') { sign = -1; s++; } else if (*s == '+') s++;
    if (base == 0) {
        if (*s == '0' && (s[1] == 'x' || s[1] == 'X')) { base = 16; s += 2; }
        else if (*s == '0') { base = 8; s++; }
        else base = 10;
    } else if (base == 16 && *s == '0' && (s[1] == 'x' || s[1] == 'X')) { s += 2; }
    while (*s) {
        int d;
        if (isdigit(*s)) d = *s - '0';
        else if (*s >= 'a' && *s <= 'z') d = *s - 'a' + 10;
        else if (*s >= 'A' && *s <= 'Z') d = *s - 'A' + 10;
        else break;
        if (d >= base) break;
        result = result * base + d;
        s++;
    }
    if (endp) *endp = (char*)s;
    return sign * result;
}

// Simple strtod — handles basic decimal and scientific notation
double strtod(const char *s, char **endp) {
    double result = 0.0, sign = 1.0;
    while (isspace(*s)) s++;
    if (*s == '-') { sign = -1.0; s++; } else if (*s == '+') s++;
    while (isdigit(*s)) { result = result * 10.0 + (*s - '0'); s++; }
    if (*s == '.') {
        s++;
        double frac = 0.1;
        while (isdigit(*s)) { result += (*s - '0') * frac; frac *= 0.1; s++; }
    }
    if (*s == 'e' || *s == 'E') {
        s++;
        int esign = 1, exp = 0;
        if (*s == '-') { esign = -1; s++; } else if (*s == '+') s++;
        while (isdigit(*s)) { exp = exp * 10 + (*s - '0'); s++; }
        double mul = 1.0;
        for (int i = 0; i < exp; i++) mul *= 10.0;
        if (esign < 0) result /= mul; else result *= mul;
    }
    if (endp) *endp = (char*)s;
    return sign * result;
}

// ─── qsort (insertion sort) ───

void qsort(void *base, size_t nmemb, size_t size,
           int (*compar)(const void *, const void *)) {
    unsigned char *b = (unsigned char*)base;
    for (size_t i = 1; i < nmemb; i++) {
        for (size_t j = i; j > 0; j--) {
            unsigned char *a = b + j * size;
            unsigned char *c = b + (j - 1) * size;
            if (compar(a, c) < 0) {
                for (size_t k = 0; k < size; k++) {
                    unsigned char tmp = a[k]; a[k] = c[k]; c[k] = tmp;
                }
            } else break;
        }
    }
}

// ─── setjmp/longjmp — SQLite uses these for error recovery ───

// In WASM, we can't do real setjmp/longjmp. SQLite's use is limited to
// error paths that abort parsing. We provide minimal stubs.
int setjmp(jmp_buf env) { (void)env; return 0; }
void longjmp(jmp_buf env, int val) { (void)env; (void)val; __builtin_unreachable(); }

// ─── printf family — SQLite needs snprintf/vsnprintf ───

// Minimal snprintf: only handles %s, %d, %ld, %lld, %u, %lu, %llu, %c, %%, %p, %x
// SQLite's own mprintf handles the complex formatting.
static void write_num(char **buf, char *end, long long val, int is_unsigned, int base) {
    char tmp[24];
    int neg = 0, i = 0;
    unsigned long long uval;
    if (!is_unsigned && val < 0) { neg = 1; uval = (unsigned long long)(-val); }
    else uval = (unsigned long long)val;
    if (uval == 0) tmp[i++] = '0';
    else while (uval > 0) {
        int d = uval % base;
        tmp[i++] = d < 10 ? '0' + d : 'a' + d - 10;
        uval /= base;
    }
    if (neg && *buf < end) *(*buf)++ = '-';
    while (i > 0) { if (*buf < end) *(*buf)++ = tmp[--i]; else i--; }
}

int vsnprintf(char *buf, size_t size, const char *fmt, va_list ap) {
    char *out = buf;
    char *end = buf + (size > 0 ? size - 1 : 0);
    if (size == 0) end = out; // no writing at all

    while (*fmt) {
        if (*fmt != '%') {
            if (out < end) *out = *fmt;
            out++; fmt++;
            continue;
        }
        fmt++; // skip %

        // Handle flags/width loosely — skip numeric width/flags
        int is_long = 0, is_longlong = 0;
        while (*fmt == '-' || *fmt == '+' || *fmt == ' ' || *fmt == '0' ||
               *fmt == '#' || (*fmt >= '1' && *fmt <= '9') || *fmt == '.') {
            if (*fmt == '.') { fmt++; while (*fmt >= '0' && *fmt <= '9') fmt++; continue; }
            fmt++;
        }
        if (*fmt == 'l') { is_long = 1; fmt++; if (*fmt == 'l') { is_longlong = 1; fmt++; } }
        else if (*fmt == 'z') { is_long = 1; fmt++; }

        switch (*fmt) {
            case 'd': case 'i': {
                long long val = is_longlong ? va_arg(ap, long long) : is_long ? va_arg(ap, long) : va_arg(ap, int);
                write_num(&out, end + 1, val, 0, 10);
                break;
            }
            case 'u': {
                unsigned long long val = is_longlong ? va_arg(ap, unsigned long long) : is_long ? va_arg(ap, unsigned long) : va_arg(ap, unsigned int);
                write_num(&out, end + 1, (long long)val, 1, 10);
                break;
            }
            case 'x': case 'X': {
                unsigned long long val = is_longlong ? va_arg(ap, unsigned long long) : is_long ? va_arg(ap, unsigned long) : va_arg(ap, unsigned int);
                write_num(&out, end + 1, (long long)val, 1, 16);
                break;
            }
            case 's': {
                const char *s = va_arg(ap, const char*);
                if (!s) s = "(null)";
                while (*s) { if (out < end) *out = *s; out++; s++; }
                break;
            }
            case 'c': {
                int c = va_arg(ap, int);
                if (out < end) *out = (char)c;
                out++;
                break;
            }
            case 'p': {
                void *p = va_arg(ap, void*);
                if (out < end) *out = '0'; out++;
                if (out < end) *out = 'x'; out++;
                write_num(&out, end + 1, (long long)(uintptr_t)p, 1, 16);
                break;
            }
            case '%': {
                if (out < end) *out = '%';
                out++;
                break;
            }
            case 'f': case 'g': case 'e': {
                // SQLite uses its own mprintf for floats. Stub with "0.0".
                va_arg(ap, double);
                const char *s = "0.0";
                while (*s) { if (out < end) *out = *s; out++; s++; }
                break;
            }
            default:
                if (out < end) *out = *fmt;
                out++;
                break;
        }
        if (*fmt) fmt++;
    }
    if (size > 0) {
        if (out <= end) *out = '\0';
        else *end = '\0';
    }
    return (int)(out - buf);
}

int snprintf(char *buf, size_t size, const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    int ret = vsnprintf(buf, size, fmt, ap);
    va_end(ap);
    return ret;
}

int sprintf(char *buf, const char *fmt, ...) {
    va_list ap;
    va_start(ap, fmt);
    int ret = vsnprintf(buf, 0x7fffffff, fmt, ap);
    va_end(ap);
    return ret;
}

int fprintf(FILE *stream, const char *fmt, ...) { (void)stream; (void)fmt; return 0; }
int printf(const char *fmt, ...) { (void)fmt; return 0; }
int fflush(FILE *stream) { (void)stream; return 0; }
int fclose(FILE *stream) { (void)stream; return -1; }
FILE *fopen(const char *path, const char *mode) { (void)path; (void)mode; return NULL; }
size_t fread(void *ptr, size_t size, size_t nmemb, FILE *stream) { (void)ptr; (void)size; (void)nmemb; (void)stream; return 0; }
size_t fwrite(const void *ptr, size_t size, size_t nmemb, FILE *stream) { (void)ptr; (void)size; (void)nmemb; (void)stream; return 0; }

// ─── Time stubs ───
time_t time(time_t *t) { if (t) *t = 0; return 0; }
struct tm *localtime(const time_t *t) { (void)t; memset(&_tm_buf, 0, sizeof(_tm_buf)); return &_tm_buf; }
struct tm *gmtime(const time_t *t) { (void)t; memset(&_tm_buf, 0, sizeof(_tm_buf)); return &_tm_buf; }
size_t strftime(char *s, size_t max, const char *fmt, const struct tm *tm) { (void)s; (void)max; (void)fmt; (void)tm; return 0; }
int gettimeofday(struct timeval *tv, void *tz) { (void)tz; if (tv) { tv->tv_sec = 0; tv->tv_usec = 0; } return 0; }

// ─── OS stubs — all return error ───
int open(const char *p, int f, ...) { (void)p; (void)f; return -1; }
int close(int fd) { (void)fd; return -1; }
ssize_t read(int fd, void *b, size_t c) { (void)fd; (void)b; (void)c; return -1; }
ssize_t write(int fd, const void *b, size_t c) { (void)fd; (void)b; (void)c; return -1; }
off_t lseek(int fd, off_t o, int w) { (void)fd; (void)o; (void)w; return -1; }
ssize_t pread(int fd, void *b, size_t c, off_t o) { (void)fd; (void)b; (void)c; (void)o; return -1; }
ssize_t pwrite(int fd, const void *b, size_t c, off_t o) { (void)fd; (void)b; (void)c; (void)o; return -1; }
int ftruncate(int fd, off_t l) { (void)fd; (void)l; return -1; }
int fsync(int fd) { (void)fd; return -1; }
int fstat(int fd, void *b) { (void)fd; (void)b; return -1; }
int stat(const char *p, void *b) { (void)p; (void)b; return -1; }
int fchmod(int fd, mode_t m) { (void)fd; (void)m; return -1; }
int unlink(const char *p) { (void)p; return -1; }
int access(const char *p, int m) { (void)p; (void)m; return -1; }
int mkdir(const char *p, mode_t m) { (void)p; (void)m; return -1; }
int rmdir(const char *p) { (void)p; return -1; }
char *getcwd(char *b, size_t s) { (void)b; (void)s; return NULL; }
pid_t getpid(void) { return 1; }
uid_t geteuid(void) { return 0; }
int fchown(int fd, uid_t o, gid_t g) { (void)fd; (void)o; (void)g; return -1; }
unsigned int sleep(unsigned int s) { (void)s; return 0; }
int usleep(useconds_t u) { (void)u; return 0; }
int fcntl(int fd, int c, ...) { (void)fd; (void)c; return -1; }
int ioctl(int fd, int r, ...) { (void)fd; (void)r; return -1; }
void *mmap(void *a, size_t l, int p, int f, int fd, off_t o) { (void)a; (void)l; (void)p; (void)f; (void)fd; (void)o; return (void*)(size_t)-1; }
int munmap(void *a, size_t l) { (void)a; (void)l; return -1; }
ssize_t readlink(const char *p, char *b, size_t s) { (void)p; (void)b; (void)s; return -1; }
int utimes(const char *p, const void *t) { (void)p; (void)t; return -1; }
char *strerror(int e) { (void)e; return "error"; }
void *dlopen(const char *f, int fl) { (void)f; (void)fl; return NULL; }
int dlclose(void *h) { (void)h; return 0; }
void *dlsym(void *h, const char *s) { (void)h; (void)s; return NULL; }
char *dlerror(void) { return NULL; }

void abort(void) { __builtin_unreachable(); }

// ─── Minimal no-op VFS ───
// With SQLITE_OS_OTHER=1, we must register a default VFS.
// It only needs to exist — :memory: databases use SQLite's internal memdb.
// But sqlite3_open() still needs a default VFS to be non-NULL.

static int nopOpen(sqlite3_vfs *v, const char *z, sqlite3_file *f, int flags, int *pOut) {
    (void)v; (void)z; (void)f; (void)flags; (void)pOut;
    return SQLITE_CANTOPEN;
}
static int nopDelete(sqlite3_vfs *v, const char *z, int s) { (void)v; (void)z; (void)s; return SQLITE_OK; }
static int nopAccess(sqlite3_vfs *v, const char *z, int f, int *out) { (void)v; (void)z; (void)f; *out = 0; return SQLITE_OK; }
static int nopFullPathname(sqlite3_vfs *v, const char *z, int n, char *out) {
    (void)v;
    size_t len = strlen(z);
    if ((int)len >= n) len = (size_t)(n - 1);
    memcpy(out, z, len);
    out[len] = 0;
    return SQLITE_OK;
}
static int nopRandomness(sqlite3_vfs *v, int n, char *out) { (void)v; memset(out, 0, (size_t)n); return n; }
static int nopSleep(sqlite3_vfs *v, int us) { (void)v; (void)us; return 0; }
static int nopCurrentTime(sqlite3_vfs *v, double *out) { (void)v; *out = 2451545.0; return SQLITE_OK; /* J2000 */ }
static int nopGetLastError(sqlite3_vfs *v, int n, char *out) { (void)v; if (n > 0) out[0] = 0; return 0; }
static int nopCurrentTimeInt64(sqlite3_vfs *v, sqlite3_int64 *out) { (void)v; *out = 211845067200000LL; return SQLITE_OK; }

static sqlite3_vfs nop_vfs = {
    3,                     /* iVersion */
    0,                     /* szOsFile */
    512,                   /* mxPathname */
    0,                     /* pNext */
    "nop",                 /* zName */
    0,                     /* pAppData */
    nopOpen,
    nopDelete,
    nopAccess,
    nopFullPathname,
    0,                     /* xDlOpen */
    0,                     /* xDlError */
    0,                     /* xDlSym */
    0,                     /* xDlClose */
    nopRandomness,
    nopSleep,
    nopCurrentTime,
    nopGetLastError,
    nopCurrentTimeInt64,
    0,                     /* xSetSystemCall */
    0,                     /* xGetSystemCall */
    0,                     /* xNextSystemCall */
};

int sqlite3_os_init(void) {
    return sqlite3_vfs_register(&nop_vfs, 1);
}

int sqlite3_os_end(void) {
    return SQLITE_OK;
}
