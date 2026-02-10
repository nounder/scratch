// Tokenizer for a Zig-like language subset.
// Produces a flat token stream from source text.

const std = @import("std");

pub const TokenTag = enum {
    // Literals
    int_literal,
    identifier,

    // Keywords
    kw_fn,
    kw_export,
    kw_return,
    kw_var,
    kw_const,
    kw_if,
    kw_else,
    kw_while,
    kw_true,
    kw_false,
    kw_and,
    kw_or,

    // Types
    kw_i32,
    kw_void,

    // Operators
    plus,
    minus,
    star,
    slash,
    percent,
    eq,       // ==
    neq,      // !=
    lt,       // <
    gt,       // >
    le,       // <=
    ge,       // >=
    assign,      // =
    plus_eq,     // +=
    minus_eq,    // -=
    star_eq,     // *=
    bang,        // !

    // Punctuation
    lparen,
    rparen,
    lbrace,
    rbrace,
    semicolon,
    colon,
    comma,

    // Special
    eof,
    invalid,
};

pub const Token = struct {
    tag: TokenTag,
    start: u32,
    end: u32,

    pub fn slice(self: Token, source: []const u8) []const u8 {
        return source[self.start..self.end];
    }
};

const keywords = std.StaticStringMap(TokenTag).initComptime(.{
    .{ "fn", .kw_fn },
    .{ "export", .kw_export },
    .{ "return", .kw_return },
    .{ "var", .kw_var },
    .{ "const", .kw_const },
    .{ "if", .kw_if },
    .{ "else", .kw_else },
    .{ "while", .kw_while },
    .{ "true", .kw_true },
    .{ "false", .kw_false },
    .{ "and", .kw_and },
    .{ "or", .kw_or },
    .{ "i32", .kw_i32 },
    .{ "void", .kw_void },
});

pub const Tokenizer = struct {
    source: []const u8,
    pos: u32,

    pub fn init(source: []const u8) Tokenizer {
        return .{ .source = source, .pos = 0 };
    }

    pub fn next(self: *Tokenizer) Token {
        self.skipWhitespaceAndComments();

        if (self.pos >= self.source.len) {
            return .{ .tag = .eof, .start = self.pos, .end = self.pos };
        }

        const start = self.pos;
        const c = self.source[self.pos];

        // Single-char tokens (with compound assignment checks)
        if (c == '+') {
            if (self.peek(1) == @as(u8, '=')) {
                self.pos += 2;
                return .{ .tag = .plus_eq, .start = start, .end = self.pos };
            }
            self.pos += 1;
            return .{ .tag = .plus, .start = start, .end = self.pos };
        }
        if (c == '-') {
            if (self.peek(1) == @as(u8, '=')) {
                self.pos += 2;
                return .{ .tag = .minus_eq, .start = start, .end = self.pos };
            }
            self.pos += 1;
            return .{ .tag = .minus, .start = start, .end = self.pos };
        }
        if (c == '*') {
            if (self.peek(1) == @as(u8, '=')) {
                self.pos += 2;
                return .{ .tag = .star_eq, .start = start, .end = self.pos };
            }
            self.pos += 1;
            return .{ .tag = .star, .start = start, .end = self.pos };
        }

        const single: ?TokenTag = switch (c) {
            '(' => .lparen,
            ')' => .rparen,
            '{' => .lbrace,
            '}' => .rbrace,
            ';' => .semicolon,
            ':' => .colon,
            ',' => .comma,
            '%' => .percent,
            else => null,
        };

        if (single) |tag| {
            self.pos += 1;
            return .{ .tag = tag, .start = start, .end = self.pos };
        }

        // Slash (check for comment)
        if (c == '/') {
            if (self.pos + 1 < self.source.len and self.source[self.pos + 1] == '/') {
                // Line comment - skip to end of line
                while (self.pos < self.source.len and self.source[self.pos] != '\n') {
                    self.pos += 1;
                }
                return self.next();
            }
            self.pos += 1;
            return .{ .tag = .slash, .start = start, .end = self.pos };
        }

        // Two-char operators
        if (c == '=' and self.peek(1) == '=') {
            self.pos += 2;
            return .{ .tag = .eq, .start = start, .end = self.pos };
        }
        if (c == '!' and self.peek(1) == '=') {
            self.pos += 2;
            return .{ .tag = .neq, .start = start, .end = self.pos };
        }
        if (c == '<' and self.peek(1) == '=') {
            self.pos += 2;
            return .{ .tag = .le, .start = start, .end = self.pos };
        }
        if (c == '>' and self.peek(1) == '=') {
            self.pos += 2;
            return .{ .tag = .ge, .start = start, .end = self.pos };
        }
        if (c == '=') {
            self.pos += 1;
            return .{ .tag = .assign, .start = start, .end = self.pos };
        }
        if (c == '!') {
            self.pos += 1;
            return .{ .tag = .bang, .start = start, .end = self.pos };
        }
        if (c == '<') {
            self.pos += 1;
            return .{ .tag = .lt, .start = start, .end = self.pos };
        }
        if (c == '>') {
            self.pos += 1;
            return .{ .tag = .gt, .start = start, .end = self.pos };
        }

        // Integer literals
        if (std.ascii.isDigit(c)) {
            while (self.pos < self.source.len and std.ascii.isDigit(self.source[self.pos])) {
                self.pos += 1;
            }
            return .{ .tag = .int_literal, .start = start, .end = self.pos };
        }

        // Identifiers and keywords
        if (std.ascii.isAlphabetic(c) or c == '_') {
            while (self.pos < self.source.len and
                (std.ascii.isAlphanumeric(self.source[self.pos]) or self.source[self.pos] == '_'))
            {
                self.pos += 1;
            }
            const text = self.source[start..self.pos];
            const tag = keywords.get(text) orelse .identifier;
            return .{ .tag = tag, .start = start, .end = self.pos };
        }

        // Unknown character
        self.pos += 1;
        return .{ .tag = .invalid, .start = start, .end = self.pos };
    }

    fn peek(self: *const Tokenizer, offset: u32) ?u8 {
        const idx = self.pos + offset;
        if (idx < self.source.len) return self.source[idx];
        return null;
    }

    fn skipWhitespaceAndComments(self: *Tokenizer) void {
        while (self.pos < self.source.len) {
            const c = self.source[self.pos];
            if (c == ' ' or c == '\t' or c == '\n' or c == '\r') {
                self.pos += 1;
                continue;
            }
            // Line comments
            if (c == '/' and self.pos + 1 < self.source.len and self.source[self.pos + 1] == '/') {
                while (self.pos < self.source.len and self.source[self.pos] != '\n') {
                    self.pos += 1;
                }
                continue;
            }
            break;
        }
    }
};

// ── Tests ───────────────────────────────────────────────────────────

test "tokenize simple function" {
    const src = "export fn add(a: i32, b: i32) i32 { return a + b; }";
    var tok = Tokenizer.init(src);

    try std.testing.expectEqual(TokenTag.kw_export, tok.next().tag);
    try std.testing.expectEqual(TokenTag.kw_fn, tok.next().tag);

    const name = tok.next();
    try std.testing.expectEqual(TokenTag.identifier, name.tag);
    try std.testing.expectEqualStrings("add", name.slice(src));

    try std.testing.expectEqual(TokenTag.lparen, tok.next().tag);
}

test "tokenize operators" {
    const src = "== != <= >= < > + - * / %";
    var tok = Tokenizer.init(src);

    try std.testing.expectEqual(TokenTag.eq, tok.next().tag);
    try std.testing.expectEqual(TokenTag.neq, tok.next().tag);
    try std.testing.expectEqual(TokenTag.le, tok.next().tag);
    try std.testing.expectEqual(TokenTag.ge, tok.next().tag);
    try std.testing.expectEqual(TokenTag.lt, tok.next().tag);
    try std.testing.expectEqual(TokenTag.gt, tok.next().tag);
    try std.testing.expectEqual(TokenTag.plus, tok.next().tag);
    try std.testing.expectEqual(TokenTag.minus, tok.next().tag);
    try std.testing.expectEqual(TokenTag.star, tok.next().tag);
    try std.testing.expectEqual(TokenTag.slash, tok.next().tag);
    try std.testing.expectEqual(TokenTag.percent, tok.next().tag);
    try std.testing.expectEqual(TokenTag.eof, tok.next().tag);
}

test "tokenize integers" {
    const src = "123 0 999";
    var tok = Tokenizer.init(src);

    const t1 = tok.next();
    try std.testing.expectEqual(TokenTag.int_literal, t1.tag);
    try std.testing.expectEqualStrings("123", t1.slice(src));

    const t2 = tok.next();
    try std.testing.expectEqualStrings("0", t2.slice(src));

    const t3 = tok.next();
    try std.testing.expectEqualStrings("999", t3.slice(src));
}
