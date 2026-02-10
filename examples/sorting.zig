// Sorting algorithms operating on WASM linear memory

export fn bubble_sort(ptr: [*]i32, len: i32) void {
    if (len <= 1) return;
    const n: usize = @intCast(len);
    var i: usize = 0;
    while (i < n - 1) : (i += 1) {
        var j: usize = 0;
        while (j < n - i - 1) : (j += 1) {
            if (ptr[j] > ptr[j + 1]) {
                const temp = ptr[j];
                ptr[j] = ptr[j + 1];
                ptr[j + 1] = temp;
            }
        }
    }
}

export fn find_max(ptr: [*]const i32, len: i32) i32 {
    if (len <= 0) return 0;
    var result = ptr[0];
    var i: usize = 1;
    const n: usize = @intCast(len);
    while (i < n) : (i += 1) {
        if (ptr[i] > result) result = ptr[i];
    }
    return result;
}

export fn find_min(ptr: [*]const i32, len: i32) i32 {
    if (len <= 0) return 0;
    var result = ptr[0];
    var i: usize = 1;
    const n: usize = @intCast(len);
    while (i < n) : (i += 1) {
        if (ptr[i] < result) result = ptr[i];
    }
    return result;
}

export fn sum(ptr: [*]const i32, len: i32) i32 {
    var total: i32 = 0;
    var i: usize = 0;
    const n: usize = @intCast(len);
    while (i < n) : (i += 1) {
        total += ptr[i];
    }
    return total;
}
