// AST node definitions for the Zig-like language subset.

const std = @import("std");

pub const Type = enum {
    i32_type,
    void_type,
};

pub const BinOp = enum {
    add,
    sub,
    mul,
    div,
    rem,
    eq,
    neq,
    lt,
    gt,
    le,
    ge,
    bit_and,
    bit_or,
    bit_xor,
    shl,
    shr,
    logic_and,
    logic_or,
};

pub const UnaryOp = enum {
    negate,
    logic_not,
};

pub const Expr = union(enum) {
    int_literal: i32,
    bool_literal: bool,
    identifier: []const u8,
    binary: struct {
        op: BinOp,
        left: *const Expr,
        right: *const Expr,
    },
    unary: struct {
        op: UnaryOp,
        operand: *const Expr,
    },
    call: struct {
        name: []const u8,
        args: []const *const Expr,
    },
    if_expr: struct {
        condition: *const Expr,
        then_body: *const Expr,
        else_body: ?*const Expr,
    },
};

pub const ContinueAssign = struct {
    name: []const u8,
    value: *const Expr,
};

pub const Stmt = union(enum) {
    return_stmt: ?*const Expr,
    var_decl: struct {
        name: []const u8,
        typ: ?Type,
        mutable: bool,
        value: *const Expr,
    },
    assign: struct {
        name: []const u8,
        value: *const Expr,
    },
    if_stmt: struct {
        condition: *const Expr,
        then_body: []const Stmt,
        else_body: ?[]const Stmt,
    },
    while_stmt: struct {
        condition: *const Expr,
        body: []const Stmt,
        continue_assign: ?ContinueAssign,
    },
    expr_stmt: *const Expr,
};

pub const Param = struct {
    name: []const u8,
    typ: Type,
};

pub const Function = struct {
    name: []const u8,
    params: []const Param,
    return_type: Type,
    body: []const Stmt,
    exported: bool,
};

pub const Module = struct {
    functions: []const Function,
};
