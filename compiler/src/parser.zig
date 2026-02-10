// Recursive descent parser for the Zig-like language subset.
// Produces an AST from a token stream.

const std = @import("std");
const Tokenizer = @import("tokenizer.zig").Tokenizer;
const TokenTag = @import("tokenizer.zig").TokenTag;
const Token = @import("tokenizer.zig").Token;
const ast = @import("ast.zig");

pub const ParseError = error{
    UnexpectedToken,
    InvalidInteger,
    OutOfMemory,
};

pub const Parser = struct {
    tokenizer: Tokenizer,
    source: []const u8,
    current: Token,
    gpa: std.mem.Allocator,
    errors: std.ArrayList([]const u8) = .empty,

    pub fn init(source: []const u8, gpa: std.mem.Allocator) Parser {
        var tokenizer = Tokenizer.init(source);
        const first = tokenizer.next();
        return .{
            .tokenizer = tokenizer,
            .source = source,
            .current = first,
            .gpa = gpa,
        };
    }

    pub fn deinit(self: *Parser) void {
        self.errors.deinit(self.gpa);
    }

    fn advance(self: *Parser) Token {
        const prev = self.current;
        self.current = self.tokenizer.next();
        return prev;
    }

    fn expect(self: *Parser, tag: TokenTag) ParseError!Token {
        if (self.current.tag == tag) {
            return self.advance();
        }
        self.errors.append(self.gpa, std.fmt.allocPrint(self.gpa, "expected {s}, got {s}", .{
            @tagName(tag), @tagName(self.current.tag),
        }) catch "parse error") catch {};
        return ParseError.UnexpectedToken;
    }

    fn check(self: *const Parser, tag: TokenTag) bool {
        return self.current.tag == tag;
    }

    fn match(self: *Parser, tag: TokenTag) bool {
        if (self.current.tag == tag) {
            _ = self.advance();
            return true;
        }
        return false;
    }

    fn text(self: *const Parser, tok: Token) []const u8 {
        return tok.slice(self.source);
    }

    // ── Module ───────────────────────────────────────────────────

    pub fn parseModule(self: *Parser) ParseError!ast.Module {
        var functions: std.ArrayList(ast.Function) = .empty;
        while (self.current.tag != .eof) {
            const func = try self.parseFunction();
            functions.append(self.gpa, func) catch return ParseError.OutOfMemory;
        }
        return .{ .functions = functions.toOwnedSlice(self.gpa) catch return ParseError.OutOfMemory };
    }

    // ── Function ─────────────────────────────────────────────────

    fn parseFunction(self: *Parser) ParseError!ast.Function {
        const exported = self.match(.kw_export);
        _ = try self.expect(.kw_fn);
        const name_tok = try self.expect(.identifier);
        const name = self.text(name_tok);

        _ = try self.expect(.lparen);
        var params: std.ArrayList(ast.Param) = .empty;
        while (!self.check(.rparen) and !self.check(.eof)) {
            const pname = try self.expect(.identifier);
            _ = try self.expect(.colon);
            const ptyp = try self.parseType();
            params.append(self.gpa, .{ .name = self.text(pname), .typ = ptyp }) catch return ParseError.OutOfMemory;
            if (!self.match(.comma)) break;
        }
        _ = try self.expect(.rparen);

        const ret_type = if (self.check(.lbrace))
            ast.Type.void_type
        else
            try self.parseType();

        const body = try self.parseBlock();

        return .{
            .name = name,
            .params = params.toOwnedSlice(self.gpa) catch return ParseError.OutOfMemory,
            .return_type = ret_type,
            .body = body,
            .exported = exported,
        };
    }

    fn parseType(self: *Parser) ParseError!ast.Type {
        if (self.match(.kw_i32)) return .i32_type;
        if (self.match(.kw_void)) return .void_type;
        self.errors.append(self.gpa, "expected type (i32 or void)") catch {};
        return ParseError.UnexpectedToken;
    }

    // ── Block / Statements ───────────────────────────────────────

    fn parseBlock(self: *Parser) ParseError![]const ast.Stmt {
        _ = try self.expect(.lbrace);
        var stmts: std.ArrayList(ast.Stmt) = .empty;
        while (!self.check(.rbrace) and !self.check(.eof)) {
            const stmt = try self.parseStatement();
            stmts.append(self.gpa, stmt) catch return ParseError.OutOfMemory;
        }
        _ = try self.expect(.rbrace);
        return stmts.toOwnedSlice(self.gpa) catch return ParseError.OutOfMemory;
    }

    fn parseStatement(self: *Parser) ParseError!ast.Stmt {
        if (self.check(.kw_return)) {
            _ = self.advance();
            if (self.check(.semicolon)) {
                _ = self.advance();
                return .{ .return_stmt = null };
            }
            const expr = try self.allocExpr(try self.parseExpr());
            _ = try self.expect(.semicolon);
            return .{ .return_stmt = expr };
        }

        if (self.check(.kw_var) or self.check(.kw_const)) {
            const mutable = self.current.tag == .kw_var;
            _ = self.advance();
            const name_tok = try self.expect(.identifier);
            const name = self.text(name_tok);

            var typ: ?ast.Type = null;
            if (self.match(.colon)) {
                typ = try self.parseType();
            }

            _ = try self.expect(.assign);
            const value = try self.allocExpr(try self.parseExpr());
            _ = try self.expect(.semicolon);
            return .{ .var_decl = .{
                .name = name,
                .typ = typ,
                .mutable = mutable,
                .value = value,
            } };
        }

        if (self.check(.kw_if)) {
            return try self.parseIfStmt();
        }

        if (self.check(.kw_while)) {
            _ = self.advance();
            _ = try self.expect(.lparen);
            const cond = try self.allocExpr(try self.parseExpr());
            _ = try self.expect(.rparen);

            // Optional continue clause: `: (assign_expr)`
            var continue_assign: ?ast.ContinueAssign = null;
            if (self.match(.colon)) {
                _ = try self.expect(.lparen);
                const cname = try self.expect(.identifier);
                const cname_str = self.text(cname);
                // Handle += -= *= or =
                const cop: ?ast.BinOp = switch (self.current.tag) {
                    .plus_eq => .add,
                    .minus_eq => .sub,
                    .star_eq => .mul,
                    else => null,
                };
                if (cop) |op| {
                    _ = self.advance();
                    const rhs = try self.allocExpr(try self.parseExpr());
                    const lhs_id = try self.allocExpr(ast.Expr{ .identifier = cname_str });
                    continue_assign = ast.ContinueAssign{
                        .name = cname_str,
                        .value = try self.allocExpr(ast.Expr{ .binary = .{
                            .op = op,
                            .left = lhs_id,
                            .right = rhs,
                        } }),
                    };
                } else {
                    _ = try self.expect(.assign);
                    continue_assign = ast.ContinueAssign{
                        .name = cname_str,
                        .value = try self.allocExpr(try self.parseExpr()),
                    };
                }
                _ = try self.expect(.rparen);
            }

            const body = try self.parseBlock();
            return .{ .while_stmt = .{
                .condition = cond,
                .body = body,
                .continue_assign = continue_assign,
            } };
        }

        // Assignment: `identifier = expr;` or `identifier += expr;` etc.
        if (self.check(.identifier)) {
            const save_pos = self.tokenizer.pos;
            const save_current = self.current;
            const name_tok = self.advance();
            const name_str = self.text(name_tok);

            if (self.match(.assign)) {
                const value = try self.allocExpr(try self.parseExpr());
                _ = try self.expect(.semicolon);
                return .{ .assign = .{
                    .name = name_str,
                    .value = value,
                } };
            }

            // Compound assignments: +=, -=, *=
            const compound_op: ?ast.BinOp = switch (self.current.tag) {
                .plus_eq => .add,
                .minus_eq => .sub,
                .star_eq => .mul,
                else => null,
            };
            if (compound_op) |op| {
                _ = self.advance(); // consume +=/-=/*=
                const rhs = try self.allocExpr(try self.parseExpr());
                // Desugar `x += expr` into `x = x + expr`
                const lhs_id = try self.allocExpr(ast.Expr{ .identifier = name_str });
                const value = try self.allocExpr(ast.Expr{ .binary = .{
                    .op = op,
                    .left = lhs_id,
                    .right = rhs,
                } });
                _ = try self.expect(.semicolon);
                return .{ .assign = .{
                    .name = name_str,
                    .value = value,
                } };
            }

            // Backtrack
            self.tokenizer.pos = save_pos;
            self.current = save_current;
        }

        // Expression statement
        const expr = try self.allocExpr(try self.parseExpr());
        _ = try self.expect(.semicolon);
        return .{ .expr_stmt = expr };
    }

    fn parseIfStmt(self: *Parser) ParseError!ast.Stmt {
        _ = try self.expect(.kw_if);
        _ = try self.expect(.lparen);
        const cond = try self.allocExpr(try self.parseExpr());
        _ = try self.expect(.rparen);
        const then_body = try self.parseBlock();

        var else_body: ?[]const ast.Stmt = null;
        if (self.match(.kw_else)) {
            if (self.check(.kw_if)) {
                const elif = try self.parseIfStmt();
                const elif_arr = self.gpa.alloc(ast.Stmt, 1) catch return ParseError.OutOfMemory;
                elif_arr[0] = elif;
                else_body = elif_arr;
            } else {
                else_body = try self.parseBlock();
            }
        }

        return .{ .if_stmt = .{
            .condition = cond,
            .then_body = then_body,
            .else_body = else_body,
        } };
    }

    // ── Expressions (precedence climbing) ────────────────────────

    fn parseExpr(self: *Parser) ParseError!ast.Expr {
        return self.parseOr();
    }

    fn makeBinary(self: *Parser, op: ast.BinOp, left: ast.Expr, right_ptr: *const ast.Expr) ParseError!ast.Expr {
        const left_ptr = try self.allocExpr(left);
        return ast.Expr{ .binary = .{
            .op = op,
            .left = left_ptr,
            .right = right_ptr,
        } };
    }

    fn parseOr(self: *Parser) ParseError!ast.Expr {
        var left = try self.parseAnd();
        while (self.match(.kw_or)) {
            const right = try self.allocExpr(try self.parseAnd());
            left = try self.makeBinary(.logic_or, left, right);
        }
        return left;
    }

    fn parseAnd(self: *Parser) ParseError!ast.Expr {
        var left = try self.parseComparison();
        while (self.match(.kw_and)) {
            const right = try self.allocExpr(try self.parseComparison());
            left = try self.makeBinary(.logic_and, left, right);
        }
        return left;
    }

    fn parseComparison(self: *Parser) ParseError!ast.Expr {
        var left = try self.parseAddSub();
        while (true) {
            const op: ast.BinOp = switch (self.current.tag) {
                .eq => .eq,
                .neq => .neq,
                .lt => .lt,
                .gt => .gt,
                .le => .le,
                .ge => .ge,
                else => break,
            };
            _ = self.advance();
            const right = try self.allocExpr(try self.parseAddSub());
            left = try self.makeBinary(op, left, right);
        }
        return left;
    }

    fn parseAddSub(self: *Parser) ParseError!ast.Expr {
        var left = try self.parseMulDiv();
        while (true) {
            const op: ast.BinOp = switch (self.current.tag) {
                .plus => .add,
                .minus => .sub,
                else => break,
            };
            _ = self.advance();
            const right = try self.allocExpr(try self.parseMulDiv());
            left = try self.makeBinary(op, left, right);
        }
        return left;
    }

    fn parseMulDiv(self: *Parser) ParseError!ast.Expr {
        var left = try self.parseUnary();
        while (true) {
            const op: ast.BinOp = switch (self.current.tag) {
                .star => .mul,
                .slash => .div,
                .percent => .rem,
                else => break,
            };
            _ = self.advance();
            const right = try self.allocExpr(try self.parseUnary());
            left = try self.makeBinary(op, left, right);
        }
        return left;
    }

    fn parseUnary(self: *Parser) ParseError!ast.Expr {
        if (self.match(.minus)) {
            const operand = try self.allocExpr(try self.parseUnary());
            return .{ .unary = .{ .op = .negate, .operand = operand } };
        }
        if (self.match(.bang)) {
            const operand = try self.allocExpr(try self.parseUnary());
            return .{ .unary = .{ .op = .logic_not, .operand = operand } };
        }
        return self.parsePrimary();
    }

    fn parsePrimary(self: *Parser) ParseError!ast.Expr {
        if (self.check(.int_literal)) {
            const tok = self.advance();
            const val = std.fmt.parseInt(i32, self.text(tok), 10) catch return ParseError.InvalidInteger;
            return .{ .int_literal = val };
        }

        if (self.match(.kw_true)) return .{ .bool_literal = true };
        if (self.match(.kw_false)) return .{ .bool_literal = false };

        if (self.match(.lparen)) {
            const expr = try self.parseExpr();
            _ = try self.expect(.rparen);
            return expr;
        }

        if (self.check(.identifier)) {
            const name_tok = self.advance();
            const name = self.text(name_tok);

            if (self.match(.lparen)) {
                var args: std.ArrayList(*const ast.Expr) = .empty;
                while (!self.check(.rparen) and !self.check(.eof)) {
                    const arg = try self.allocExpr(try self.parseExpr());
                    args.append(self.gpa, arg) catch return ParseError.OutOfMemory;
                    if (!self.match(.comma)) break;
                }
                _ = try self.expect(.rparen);
                return .{ .call = .{
                    .name = name,
                    .args = args.toOwnedSlice(self.gpa) catch return ParseError.OutOfMemory,
                } };
            }

            return .{ .identifier = name };
        }

        if (self.check(.kw_if)) {
            _ = self.advance();
            _ = try self.expect(.lparen);
            const cond = try self.allocExpr(try self.parseExpr());
            _ = try self.expect(.rparen);
            const then_expr = try self.allocExpr(try self.parsePrimary());
            _ = try self.expect(.kw_else);
            const else_expr = try self.allocExpr(try self.parsePrimary());
            return .{ .if_expr = .{
                .condition = cond,
                .then_body = then_expr,
                .else_body = else_expr,
            } };
        }

        self.errors.append(self.gpa, std.fmt.allocPrint(self.gpa, "unexpected token: {s}", .{
            @tagName(self.current.tag),
        }) catch "unexpected token") catch {};
        return ParseError.UnexpectedToken;
    }

    fn allocExpr(self: *Parser, expr: ast.Expr) ParseError!*const ast.Expr {
        const ptr = self.gpa.create(ast.Expr) catch return ParseError.OutOfMemory;
        ptr.* = expr;
        return ptr;
    }
};

// ── Tests ───────────────────────────────────────────────────────────

test "parse simple function" {
    const src = "export fn add(a: i32, b: i32) i32 { return a + b; }";
    var parser = Parser.init(src, std.testing.allocator);
    defer parser.deinit();

    const module = try parser.parseModule();
    try std.testing.expectEqual(@as(usize, 1), module.functions.len);

    const func = module.functions[0];
    try std.testing.expectEqualStrings("add", func.name);
    try std.testing.expect(func.exported);
    try std.testing.expectEqual(@as(usize, 2), func.params.len);
    try std.testing.expectEqual(ast.Type.i32_type, func.return_type);
}

test "parse if-else" {
    const src = "fn abs(x: i32) i32 { if (x < 0) { return -x; } else { return x; } }";
    var parser = Parser.init(src, std.testing.allocator);
    defer parser.deinit();

    const module = try parser.parseModule();
    try std.testing.expectEqual(@as(usize, 1), module.functions.len);
    try std.testing.expect(!module.functions[0].exported);
}

test "parse while loop" {
    const src = "fn count(n: i32) i32 { var i: i32 = 0; while (i < n) { i = i + 1; } return i; }";
    var parser = Parser.init(src, std.testing.allocator);
    defer parser.deinit();

    const module = try parser.parseModule();
    try std.testing.expectEqual(@as(usize, 1), module.functions.len);
}
