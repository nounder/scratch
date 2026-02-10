// Fibonacci sequence - compute nth Fibonacci number

export fn fibonacci(n: i32) i32 {
    if (n <= 0) {
        return 0;
    }
    if (n == 1) {
        return 1;
    }

    var a: i32 = 0;
    var b: i32 = 1;
    var i: i32 = 2;
    while (i <= n) : (i += 1) {
        var temp: i32 = a + b;
        a = b;
        b = temp;
    }
    return b;
}

export fn is_fibonacci(n: i32) i32 {
    if (n < 0) {
        return 0;
    }
    var a: i32 = 0;
    var b: i32 = 1;
    while (a < n) {
        var temp: i32 = a + b;
        a = b;
        b = temp;
    }
    if (a == n) {
        return 1;
    }
    return 0;
}
