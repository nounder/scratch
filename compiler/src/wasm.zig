// WASM binary format encoding utilities.
// Handles LEB128, section construction, opcodes, and value types.

const std = @import("std");
const Allocator = std.mem.Allocator;

// ── Value Types ──────────────────────────────────────────────────────

pub const ValType = enum(u8) {
    i32 = 0x7f,
    i64 = 0x7e,
    f32 = 0x7d,
    f64 = 0x7c,
};

// ── Section IDs ──────────────────────────────────────────────────────

pub const SectionId = enum(u8) {
    custom = 0,
    type_section = 1,
    import_section = 2,
    function = 3,
    table = 4,
    memory = 5,
    global = 6,
    export_section = 7,
    start = 8,
    element = 9,
    code = 10,
    data = 11,
    data_count = 12,
};

// ── Export Kinds ─────────────────────────────────────────────────────

pub const ExportKind = enum(u8) {
    func = 0x00,
    table = 0x01,
    memory = 0x02,
    global = 0x03,
};

// ── Opcodes ─────────────────────────────────────────────────────────

pub const Op = struct {
    pub const @"unreachable": u8 = 0x00;
    pub const nop: u8 = 0x01;
    pub const block: u8 = 0x02;
    pub const loop_: u8 = 0x03;
    pub const if_: u8 = 0x04;
    pub const else_: u8 = 0x05;
    pub const end: u8 = 0x0b;
    pub const br: u8 = 0x0c;
    pub const br_if: u8 = 0x0d;
    pub const return_: u8 = 0x0f;
    pub const call: u8 = 0x10;
    pub const drop: u8 = 0x1a;
    pub const select: u8 = 0x1b;
    pub const local_get: u8 = 0x20;
    pub const local_set: u8 = 0x21;
    pub const local_tee: u8 = 0x22;
    pub const global_get: u8 = 0x23;
    pub const global_set: u8 = 0x24;
    pub const i32_load: u8 = 0x28;
    pub const i32_store: u8 = 0x36;
    pub const memory_size: u8 = 0x3f;
    pub const memory_grow: u8 = 0x40;
    pub const i32_const: u8 = 0x41;
    pub const i32_eqz: u8 = 0x45;
    pub const i32_eq: u8 = 0x46;
    pub const i32_ne: u8 = 0x47;
    pub const i32_lt_s: u8 = 0x48;
    pub const i32_gt_s: u8 = 0x4a;
    pub const i32_le_s: u8 = 0x4c;
    pub const i32_ge_s: u8 = 0x4e;
    pub const i32_add: u8 = 0x6a;
    pub const i32_sub: u8 = 0x6b;
    pub const i32_mul: u8 = 0x6c;
    pub const i32_div_s: u8 = 0x6d;
    pub const i32_rem_s: u8 = 0x6f;
    pub const i32_and: u8 = 0x71;
    pub const i32_or: u8 = 0x72;
    pub const i32_xor: u8 = 0x73;
    pub const i32_shl: u8 = 0x74;
    pub const i32_shr_s: u8 = 0x75;
    pub const block_empty: u8 = 0x40;
    pub const block_i32: u8 = 0x7f;
};

// ── LEB128 Encoding ─────────────────────────────────────────────────

pub fn encodeULEB128(value: u32, buf: []u8) usize {
    var val = value;
    var i: usize = 0;
    while (true) {
        var byte: u8 = @truncate(val & 0x7f);
        val >>= 7;
        if (val != 0) byte |= 0x80;
        buf[i] = byte;
        i += 1;
        if (val == 0) break;
    }
    return i;
}

pub fn encodeSLEB128(value: i32, buf: []u8) usize {
    var val = value;
    var i: usize = 0;
    while (true) {
        const byte_val: u8 = @truncate(@as(u32, @bitCast(val)) & 0x7f);
        val >>= 7;
        if ((val == 0 and (byte_val & 0x40) == 0) or
            (val == -1 and (byte_val & 0x40) != 0))
        {
            buf[i] = byte_val;
            i += 1;
            break;
        } else {
            buf[i] = byte_val | 0x80;
            i += 1;
        }
    }
    return i;
}

// ── Binary Writer ───────────────────────────────────────────────────

pub const Writer = struct {
    data: std.ArrayList(u8) = .empty,
    gpa: Allocator,

    pub fn init(gpa: Allocator) Writer {
        return .{ .gpa = gpa };
    }

    pub fn deinit(self: *Writer) void {
        self.data.deinit(self.gpa);
    }

    pub fn emit(self: *Writer, byte: u8) !void {
        try self.data.append(self.gpa, byte);
    }

    pub fn emitSlice(self: *Writer, bytes: []const u8) !void {
        try self.data.appendSlice(self.gpa, bytes);
    }

    pub fn emitU32(self: *Writer, value: u32) !void {
        var buf: [5]u8 = undefined;
        const n = encodeULEB128(value, &buf);
        try self.data.appendSlice(self.gpa, buf[0..n]);
    }

    pub fn emitI32(self: *Writer, value: i32) !void {
        var buf: [5]u8 = undefined;
        const n = encodeSLEB128(value, &buf);
        try self.data.appendSlice(self.gpa, buf[0..n]);
    }

    pub fn emitName(self: *Writer, name: []const u8) !void {
        try self.emitU32(@intCast(name.len));
        try self.data.appendSlice(self.gpa, name);
    }

    pub fn len(self: *const Writer) usize {
        return self.data.items.len;
    }

    pub fn toOwnedSlice(self: *Writer) ![]u8 {
        return self.data.toOwnedSlice(self.gpa);
    }

    pub fn clearRetainingCapacity(self: *Writer) void {
        self.data.clearRetainingCapacity();
    }
};

// ── Module Builder ──────────────────────────────────────────────────

pub const FuncType = struct {
    params: []const ValType,
    results: []const ValType,
};

pub const Export = struct {
    name: []const u8,
    kind: ExportKind,
    index: u32,
};

pub const ModuleBuilder = struct {
    gpa: Allocator,
    types: std.ArrayList(FuncType) = .empty,
    func_type_indices: std.ArrayList(u32) = .empty,
    exports: std.ArrayList(Export) = .empty,
    code_bodies: std.ArrayList([]const u8) = .empty,
    has_memory: bool = false,
    memory_min: u32 = 0,
    memory_max: ?u32 = null,

    pub fn init(gpa: Allocator) ModuleBuilder {
        return .{ .gpa = gpa };
    }

    pub fn deinit(self: *ModuleBuilder) void {
        self.types.deinit(self.gpa);
        self.func_type_indices.deinit(self.gpa);
        self.exports.deinit(self.gpa);
        for (self.code_bodies.items) |body| {
            self.gpa.free(body);
        }
        self.code_bodies.deinit(self.gpa);
    }

    pub fn addType(self: *ModuleBuilder, ft: FuncType) !u32 {
        for (self.types.items, 0..) |existing, i| {
            if (std.mem.eql(ValType, existing.params, ft.params) and
                std.mem.eql(ValType, existing.results, ft.results))
            {
                return @intCast(i);
            }
        }
        const idx: u32 = @intCast(self.types.items.len);
        try self.types.append(self.gpa, ft);
        return idx;
    }

    pub fn addFunction(self: *ModuleBuilder, type_idx: u32) !u32 {
        const idx: u32 = @intCast(self.func_type_indices.items.len);
        try self.func_type_indices.append(self.gpa, type_idx);
        return idx;
    }

    pub fn addCode(self: *ModuleBuilder, body: []const u8) !void {
        const owned = try self.gpa.dupe(u8, body);
        try self.code_bodies.append(self.gpa, owned);
    }

    pub fn addExport(self: *ModuleBuilder, exp: Export) !void {
        try self.exports.append(self.gpa, exp);
    }

    pub fn setMemory(self: *ModuleBuilder, min_pages: u32, max_pages: ?u32) void {
        self.has_memory = true;
        self.memory_min = min_pages;
        self.memory_max = max_pages;
    }

    pub fn encode(self: *ModuleBuilder) ![]u8 {
        var out = Writer.init(self.gpa);
        defer out.deinit();

        try out.emitSlice(&.{ 0x00, 0x61, 0x73, 0x6d });
        try out.emitSlice(&.{ 0x01, 0x00, 0x00, 0x00 });

        if (self.types.items.len > 0) {
            var sec = Writer.init(self.gpa);
            defer sec.deinit();
            try sec.emitU32(@intCast(self.types.items.len));
            for (self.types.items) |ft| {
                try sec.emit(0x60);
                try sec.emitU32(@intCast(ft.params.len));
                for (ft.params) |p| try sec.emit(@intFromEnum(p));
                try sec.emitU32(@intCast(ft.results.len));
                for (ft.results) |r| try sec.emit(@intFromEnum(r));
            }
            try emitSection(&out, .type_section, &sec);
        }

        if (self.func_type_indices.items.len > 0) {
            var sec = Writer.init(self.gpa);
            defer sec.deinit();
            try sec.emitU32(@intCast(self.func_type_indices.items.len));
            for (self.func_type_indices.items) |idx| {
                try sec.emitU32(idx);
            }
            try emitSection(&out, .function, &sec);
        }

        if (self.has_memory) {
            var sec = Writer.init(self.gpa);
            defer sec.deinit();
            try sec.emitU32(1);
            if (self.memory_max) |mx| {
                try sec.emit(0x01);
                try sec.emitU32(self.memory_min);
                try sec.emitU32(mx);
            } else {
                try sec.emit(0x00);
                try sec.emitU32(self.memory_min);
            }
            try emitSection(&out, .memory, &sec);
        }

        if (self.exports.items.len > 0) {
            var sec = Writer.init(self.gpa);
            defer sec.deinit();
            try sec.emitU32(@intCast(self.exports.items.len));
            for (self.exports.items) |exp| {
                try sec.emitName(exp.name);
                try sec.emit(@intFromEnum(exp.kind));
                try sec.emitU32(exp.index);
            }
            try emitSection(&out, .export_section, &sec);
        }

        if (self.code_bodies.items.len > 0) {
            var sec = Writer.init(self.gpa);
            defer sec.deinit();
            try sec.emitU32(@intCast(self.code_bodies.items.len));
            for (self.code_bodies.items) |body| {
                try sec.emitU32(@intCast(body.len));
                try sec.emitSlice(body);
            }
            try emitSection(&out, .code, &sec);
        }

        return out.toOwnedSlice();
    }
};

fn emitSection(out: *Writer, id: SectionId, sec: *const Writer) !void {
    try out.emit(@intFromEnum(id));
    try out.emitU32(@intCast(sec.len()));
    try out.emitSlice(sec.data.items);
}

// ── Tests ───────────────────────────────────────────────────────────

test "uleb128 encoding" {
    var buf: [5]u8 = undefined;
    try std.testing.expectEqual(@as(usize, 1), encodeULEB128(0, &buf));
    try std.testing.expectEqual(@as(u8, 0x00), buf[0]);

    try std.testing.expectEqual(@as(usize, 1), encodeULEB128(127, &buf));
    try std.testing.expectEqual(@as(u8, 0x7f), buf[0]);

    try std.testing.expectEqual(@as(usize, 2), encodeULEB128(128, &buf));
    try std.testing.expectEqual(@as(u8, 0x80), buf[0]);
    try std.testing.expectEqual(@as(u8, 0x01), buf[1]);
}

test "sleb128 encoding" {
    var buf: [5]u8 = undefined;
    try std.testing.expectEqual(@as(usize, 1), encodeSLEB128(0, &buf));
    try std.testing.expectEqual(@as(u8, 0x00), buf[0]);

    try std.testing.expectEqual(@as(usize, 1), encodeSLEB128(-1, &buf));
    try std.testing.expectEqual(@as(u8, 0x7f), buf[0]);

    try std.testing.expectEqual(@as(usize, 1), encodeSLEB128(63, &buf));
    try std.testing.expectEqual(@as(u8, 0x3f), buf[0]);
}

test "minimal wasm module" {
    const alloc = std.testing.allocator;
    var mb = ModuleBuilder.init(alloc);
    defer mb.deinit();

    const type_idx = try mb.addType(.{
        .params = &.{ .i32, .i32 },
        .results = &.{.i32},
    });
    const func_idx = try mb.addFunction(type_idx);

    const body = &[_]u8{ 0x00, Op.local_get, 0x00, Op.local_get, 0x01, Op.i32_add, Op.end };
    try mb.addCode(body);
    try mb.addExport(.{ .name = "add", .kind = .func, .index = func_idx });

    const binary = try mb.encode();
    defer alloc.free(binary);

    try std.testing.expectEqualSlices(u8, &.{ 0x00, 0x61, 0x73, 0x6d }, binary[0..4]);
    try std.testing.expectEqualSlices(u8, &.{ 0x01, 0x00, 0x00, 0x00 }, binary[4..8]);
    try std.testing.expect(binary.len < 100);
}
