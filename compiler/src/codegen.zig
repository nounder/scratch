// WASM code generator.
// Walks the AST and produces a WASM binary module.

const std = @import("std");
const ast = @import("ast.zig");
const wasm = @import("wasm.zig");

pub const CodegenError = error{
    UndefinedVariable,
    UndefinedFunction,
    OutOfMemory,
    TypeMismatch,
};

const Local = struct {
    name: []const u8,
    index: u32,
};

const FuncInfo = struct {
    name: []const u8,
    index: u32,
    param_count: u32,
    has_return: bool,
};

pub const Codegen = struct {
    gpa: std.mem.Allocator,
    module: *wasm.ModuleBuilder,
    functions: std.ArrayList(FuncInfo) = .empty,
    // Per-function state
    locals: std.ArrayList(Local) = .empty,
    local_count: u32 = 0,
    body: wasm.Writer,
    current_func: ?*const ast.Function = null,

    pub fn init(gpa: std.mem.Allocator) Codegen {
        const mb = gpa.create(wasm.ModuleBuilder) catch unreachable;
        mb.* = wasm.ModuleBuilder.init(gpa);
        return .{
            .gpa = gpa,
            .module = mb,
            .body = wasm.Writer.init(gpa),
        };
    }

    pub fn deinit(self: *Codegen) void {
        self.module.deinit();
        self.gpa.destroy(self.module);
        self.functions.deinit(self.gpa);
        self.locals.deinit(self.gpa);
        self.body.deinit();
    }

    pub fn generate(self: *Codegen, mod: ast.Module) CodegenError![]u8 {
        // First pass: register all functions so calls resolve
        for (mod.functions) |*func| {
            try self.registerFunction(func);
        }

        // Second pass: generate code
        for (mod.functions) |*func| {
            try self.generateFunction(func);
        }

        // Export memory
        self.module.setMemory(1, null);
        self.module.addExport(.{
            .name = "memory",
            .kind = .memory,
            .index = 0,
        }) catch return CodegenError.OutOfMemory;

        return self.module.encode() catch return CodegenError.OutOfMemory;
    }

    fn registerFunction(self: *Codegen, func: *const ast.Function) CodegenError!void {
        var params: std.ArrayList(wasm.ValType) = .empty;
        for (func.params) |_| {
            params.append(self.gpa, .i32) catch return CodegenError.OutOfMemory;
        }

        var results: std.ArrayList(wasm.ValType) = .empty;
        if (func.return_type == .i32_type) {
            results.append(self.gpa, .i32) catch return CodegenError.OutOfMemory;
        }

        const type_idx = self.module.addType(.{
            .params = params.toOwnedSlice(self.gpa) catch return CodegenError.OutOfMemory,
            .results = results.toOwnedSlice(self.gpa) catch return CodegenError.OutOfMemory,
        }) catch return CodegenError.OutOfMemory;

        const func_idx = self.module.addFunction(type_idx) catch return CodegenError.OutOfMemory;

        if (func.exported) {
            self.module.addExport(.{
                .name = func.name,
                .kind = .func,
                .index = func_idx,
            }) catch return CodegenError.OutOfMemory;
        }

        self.functions.append(self.gpa, .{
            .name = func.name,
            .index = func_idx,
            .param_count = @intCast(func.params.len),
            .has_return = func.return_type == .i32_type,
        }) catch return CodegenError.OutOfMemory;
    }

    fn generateFunction(self: *Codegen, func: *const ast.Function) CodegenError!void {
        self.locals.clearRetainingCapacity();
        self.local_count = @intCast(func.params.len);
        self.body.clearRetainingCapacity();
        self.current_func = func;

        for (func.params, 0..) |param, i| {
            self.locals.append(self.gpa, .{
                .name = param.name,
                .index = @intCast(i),
            }) catch return CodegenError.OutOfMemory;
        }

        // Generate instructions into temp buffer
        var instr = wasm.Writer.init(self.gpa);
        defer instr.deinit();

        for (func.body) |stmt| {
            try self.emitStmt(&instr, stmt);
        }

        instr.emit(wasm.Op.end) catch return CodegenError.OutOfMemory;

        // Build full body: local declarations + instructions
        const extra_locals = self.local_count - @as(u32, @intCast(func.params.len));
        self.body.clearRetainingCapacity();

        if (extra_locals > 0) {
            self.body.emitU32(1) catch return CodegenError.OutOfMemory;
            self.body.emitU32(extra_locals) catch return CodegenError.OutOfMemory;
            self.body.emit(@intFromEnum(wasm.ValType.i32)) catch return CodegenError.OutOfMemory;
        } else {
            self.body.emitU32(0) catch return CodegenError.OutOfMemory;
        }
        self.body.emitSlice(instr.data.items) catch return CodegenError.OutOfMemory;

        self.module.addCode(self.body.data.items) catch return CodegenError.OutOfMemory;
    }

    // ── Statement emission ───────────────────────────────────────

    fn emitStmt(self: *Codegen, w: *wasm.Writer, stmt: ast.Stmt) CodegenError!void {
        switch (stmt) {
            .return_stmt => |maybe_expr| {
                if (maybe_expr) |expr| {
                    try self.emitExpr(w, expr.*);
                }
                w.emit(wasm.Op.return_) catch return CodegenError.OutOfMemory;
            },
            .var_decl => |decl| {
                const idx = self.local_count;
                self.local_count += 1;
                self.locals.append(self.gpa, .{
                    .name = decl.name,
                    .index = idx,
                }) catch return CodegenError.OutOfMemory;
                try self.emitExpr(w, decl.value.*);
                w.emit(wasm.Op.local_set) catch return CodegenError.OutOfMemory;
                w.emitU32(idx) catch return CodegenError.OutOfMemory;
            },
            .assign => |asgn| {
                const idx = self.resolveLocal(asgn.name) orelse return CodegenError.UndefinedVariable;
                try self.emitExpr(w, asgn.value.*);
                w.emit(wasm.Op.local_set) catch return CodegenError.OutOfMemory;
                w.emitU32(idx) catch return CodegenError.OutOfMemory;
            },
            .if_stmt => |if_s| {
                try self.emitExpr(w, if_s.condition.*);
                w.emit(wasm.Op.if_) catch return CodegenError.OutOfMemory;
                w.emit(wasm.Op.block_empty) catch return CodegenError.OutOfMemory;
                for (if_s.then_body) |s| {
                    try self.emitStmt(w, s);
                }
                if (if_s.else_body) |else_body| {
                    w.emit(wasm.Op.else_) catch return CodegenError.OutOfMemory;
                    for (else_body) |s| {
                        try self.emitStmt(w, s);
                    }
                }
                w.emit(wasm.Op.end) catch return CodegenError.OutOfMemory;
            },
            .while_stmt => |whl| {
                // block { loop { br_if(!cond, break); body; [continue]; br loop; } }
                w.emit(wasm.Op.block) catch return CodegenError.OutOfMemory;
                w.emit(wasm.Op.block_empty) catch return CodegenError.OutOfMemory;
                w.emit(wasm.Op.loop_) catch return CodegenError.OutOfMemory;
                w.emit(wasm.Op.block_empty) catch return CodegenError.OutOfMemory;

                try self.emitExpr(w, whl.condition.*);
                w.emit(wasm.Op.i32_eqz) catch return CodegenError.OutOfMemory;
                w.emit(wasm.Op.br_if) catch return CodegenError.OutOfMemory;
                w.emitU32(1) catch return CodegenError.OutOfMemory;

                for (whl.body) |s| {
                    try self.emitStmt(w, s);
                }

                // Emit continue assignment if present
                if (whl.continue_assign) |ca| {
                    const idx = self.resolveLocal(ca.name) orelse return CodegenError.UndefinedVariable;
                    try self.emitExpr(w, ca.value.*);
                    w.emit(wasm.Op.local_set) catch return CodegenError.OutOfMemory;
                    w.emitU32(idx) catch return CodegenError.OutOfMemory;
                }

                w.emit(wasm.Op.br) catch return CodegenError.OutOfMemory;
                w.emitU32(0) catch return CodegenError.OutOfMemory;

                w.emit(wasm.Op.end) catch return CodegenError.OutOfMemory;
                w.emit(wasm.Op.end) catch return CodegenError.OutOfMemory;
            },
            .expr_stmt => |expr| {
                try self.emitExpr(w, expr.*);
                w.emit(wasm.Op.drop) catch return CodegenError.OutOfMemory;
            },
        }
    }

    // ── Expression emission ──────────────────────────────────────

    fn emitExpr(self: *Codegen, w: *wasm.Writer, expr: ast.Expr) CodegenError!void {
        switch (expr) {
            .int_literal => |val| {
                w.emit(wasm.Op.i32_const) catch return CodegenError.OutOfMemory;
                w.emitI32(val) catch return CodegenError.OutOfMemory;
            },
            .bool_literal => |val| {
                w.emit(wasm.Op.i32_const) catch return CodegenError.OutOfMemory;
                w.emitI32(if (val) 1 else 0) catch return CodegenError.OutOfMemory;
            },
            .identifier => |name| {
                const idx = self.resolveLocal(name) orelse return CodegenError.UndefinedVariable;
                w.emit(wasm.Op.local_get) catch return CodegenError.OutOfMemory;
                w.emitU32(idx) catch return CodegenError.OutOfMemory;
            },
            .binary => |bin| {
                if (bin.op == .logic_and) {
                    try self.emitExpr(w, bin.left.*);
                    w.emit(wasm.Op.if_) catch return CodegenError.OutOfMemory;
                    w.emit(wasm.Op.block_i32) catch return CodegenError.OutOfMemory;
                    try self.emitExpr(w, bin.right.*);
                    w.emit(wasm.Op.else_) catch return CodegenError.OutOfMemory;
                    w.emit(wasm.Op.i32_const) catch return CodegenError.OutOfMemory;
                    w.emitI32(0) catch return CodegenError.OutOfMemory;
                    w.emit(wasm.Op.end) catch return CodegenError.OutOfMemory;
                    return;
                }
                if (bin.op == .logic_or) {
                    try self.emitExpr(w, bin.left.*);
                    w.emit(wasm.Op.if_) catch return CodegenError.OutOfMemory;
                    w.emit(wasm.Op.block_i32) catch return CodegenError.OutOfMemory;
                    w.emit(wasm.Op.i32_const) catch return CodegenError.OutOfMemory;
                    w.emitI32(1) catch return CodegenError.OutOfMemory;
                    w.emit(wasm.Op.else_) catch return CodegenError.OutOfMemory;
                    try self.emitExpr(w, bin.right.*);
                    w.emit(wasm.Op.end) catch return CodegenError.OutOfMemory;
                    return;
                }

                try self.emitExpr(w, bin.left.*);
                try self.emitExpr(w, bin.right.*);
                const opcode: u8 = switch (bin.op) {
                    .add => wasm.Op.i32_add,
                    .sub => wasm.Op.i32_sub,
                    .mul => wasm.Op.i32_mul,
                    .div => wasm.Op.i32_div_s,
                    .rem => wasm.Op.i32_rem_s,
                    .eq => wasm.Op.i32_eq,
                    .neq => wasm.Op.i32_ne,
                    .lt => wasm.Op.i32_lt_s,
                    .gt => wasm.Op.i32_gt_s,
                    .le => wasm.Op.i32_le_s,
                    .ge => wasm.Op.i32_ge_s,
                    .bit_and => wasm.Op.i32_and,
                    .bit_or => wasm.Op.i32_or,
                    .bit_xor => wasm.Op.i32_xor,
                    .shl => wasm.Op.i32_shl,
                    .shr => wasm.Op.i32_shr_s,
                    .logic_and, .logic_or => unreachable,
                };
                w.emit(opcode) catch return CodegenError.OutOfMemory;
            },
            .unary => |un| {
                switch (un.op) {
                    .negate => {
                        w.emit(wasm.Op.i32_const) catch return CodegenError.OutOfMemory;
                        w.emitI32(0) catch return CodegenError.OutOfMemory;
                        try self.emitExpr(w, un.operand.*);
                        w.emit(wasm.Op.i32_sub) catch return CodegenError.OutOfMemory;
                    },
                    .logic_not => {
                        try self.emitExpr(w, un.operand.*);
                        w.emit(wasm.Op.i32_eqz) catch return CodegenError.OutOfMemory;
                    },
                }
            },
            .call => |c| {
                const fi = self.resolveFunction(c.name) orelse return CodegenError.UndefinedFunction;
                for (c.args) |arg| {
                    try self.emitExpr(w, arg.*);
                }
                w.emit(wasm.Op.call) catch return CodegenError.OutOfMemory;
                w.emitU32(fi.index) catch return CodegenError.OutOfMemory;
            },
            .if_expr => |ie| {
                try self.emitExpr(w, ie.condition.*);
                w.emit(wasm.Op.if_) catch return CodegenError.OutOfMemory;
                w.emit(wasm.Op.block_i32) catch return CodegenError.OutOfMemory;
                try self.emitExpr(w, ie.then_body.*);
                w.emit(wasm.Op.else_) catch return CodegenError.OutOfMemory;
                if (ie.else_body) |eb| {
                    try self.emitExpr(w, eb.*);
                } else {
                    w.emit(wasm.Op.i32_const) catch return CodegenError.OutOfMemory;
                    w.emitI32(0) catch return CodegenError.OutOfMemory;
                }
                w.emit(wasm.Op.end) catch return CodegenError.OutOfMemory;
            },
        }
    }

    fn resolveLocal(self: *const Codegen, name: []const u8) ?u32 {
        var i: usize = self.locals.items.len;
        while (i > 0) {
            i -= 1;
            if (std.mem.eql(u8, self.locals.items[i].name, name)) {
                return self.locals.items[i].index;
            }
        }
        return null;
    }

    fn resolveFunction(self: *const Codegen, name: []const u8) ?FuncInfo {
        for (self.functions.items) |fi| {
            if (std.mem.eql(u8, fi.name, name)) return fi;
        }
        return null;
    }
};

// ── Tests ───────────────────────────────────────────────────────────

test "codegen simple add" {
    const alloc = std.testing.allocator;
    const Parser = @import("parser.zig").Parser;

    const src = "export fn add(a: i32, b: i32) i32 { return a + b; }";
    var parser = Parser.init(src, alloc);
    defer parser.deinit();
    const module = try parser.parseModule();

    var gen = Codegen.init(alloc);
    defer gen.deinit();
    const binary = try gen.generate(module);
    defer alloc.free(binary);

    try std.testing.expectEqualSlices(u8, &.{ 0x00, 0x61, 0x73, 0x6d }, binary[0..4]);
    try std.testing.expect(binary.len > 8);
}
