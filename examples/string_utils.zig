// String utilities operating on WASM linear memory
// The host provides memory and writes strings into it;
// these functions operate on pointers and lengths.

export fn string_length(ptr: [*]const u8, max_len: i32) i32 {
    var i: i32 = 0;
    while (i < max_len) : (i += 1) {
        if (ptr[@intCast(i)] == 0) return i;
    }
    return max_len;
}

export fn count_char(ptr: [*]const u8, len: i32, char: u8) i32 {
    var count: i32 = 0;
    var i: i32 = 0;
    while (i < len) : (i += 1) {
        if (ptr[@intCast(i)] == char) count += 1;
    }
    return count;
}

export fn to_uppercase(ptr: [*]u8, len: i32) void {
    var i: i32 = 0;
    while (i < len) : (i += 1) {
        const idx: usize = @intCast(i);
        if (ptr[idx] >= 'a' and ptr[idx] <= 'z') {
            ptr[idx] -= 32;
        }
    }
}

export fn to_lowercase(ptr: [*]u8, len: i32) void {
    var i: i32 = 0;
    while (i < len) : (i += 1) {
        const idx: usize = @intCast(i);
        if (ptr[idx] >= 'A' and ptr[idx] <= 'Z') {
            ptr[idx] += 32;
        }
    }
}

// Return 1 if byte sequences are equal, 0 otherwise
export fn bytes_equal(a: [*]const u8, b: [*]const u8, len: i32) i32 {
    var i: i32 = 0;
    while (i < len) : (i += 1) {
        const idx: usize = @intCast(i);
        if (a[idx] != b[idx]) return 0;
    }
    return 1;
}
