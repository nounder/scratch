// Math library - basic arithmetic operations exported to WASM

export fn add(a: i32, b: i32) i32 {
    return a + b;
}

export fn subtract(a: i32, b: i32) i32 {
    return a - b;
}

export fn multiply(a: i32, b: i32) i32 {
    return a * b;
}

export fn divide(a: i32, b: i32) i32 {
    if (b == 0) return 0;
    return @divTrunc(a, b);
}

export fn modulo(a: i32, b: i32) i32 {
    if (b == 0) return 0;
    return @mod(a, b);
}

export fn power(base: i32, exp: i32) i32 {
    if (exp < 0) return 0;
    var result: i32 = 1;
    var i: i32 = 0;
    while (i < exp) : (i += 1) {
        result *= base;
    }
    return result;
}

export fn abs(x: i32) i32 {
    return if (x < 0) -x else x;
}

export fn max(a: i32, b: i32) i32 {
    return if (a > b) a else b;
}

export fn min(a: i32, b: i32) i32 {
    return if (a < b) a else b;
}
