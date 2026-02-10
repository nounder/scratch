const std = @import("std");
const Parser = @import("parser.zig").Parser;
const Codegen = @import("codegen.zig").Codegen;

const Io = std.Io;
const Dir = Io.Dir;
const File = Io.File;

fn sysWrite(fd: std.posix.fd_t, data: []const u8) void {
    var written: usize = 0;
    while (written < data.len) {
        const rc = std.posix.system.write(fd, data.ptr + written, data.len - written);
        const signed: isize = @bitCast(rc);
        if (signed <= 0) break;
        written += @intCast(rc);
    }
}

fn msgPrint(alloc: std.mem.Allocator, comptime fmt: []const u8, fmtargs: anytype) void {
    const s = std.fmt.allocPrint(alloc, fmt, fmtargs) catch return;
    sysWrite(1, s);
}

fn errPrint(alloc: std.mem.Allocator, comptime fmt: []const u8, fmtargs: anytype) void {
    const s = std.fmt.allocPrint(alloc, fmt, fmtargs) catch return;
    sysWrite(2, s);
}

pub fn main(init: std.process.Init) !void {
    const alloc = init.gpa;
    const io = init.io;

    const args = try init.minimal.args.toSlice(init.arena.allocator());

    if (args.len < 2) {
        sysWrite(2,
            "zigc - Zig-like language to WASM compiler\n\n" ++
                "Usage: zigc <input.zig> [-o output.wasm]\n\n" ++
                "Compiles a .zig source file to a standalone .wasm module.\n",
        );
        std.process.exit(1);
    }

    const input_path: []const u8 = args[1];

    var output_path: []const u8 = "output.wasm";
    if (args.len >= 4 and std.mem.eql(u8, args[2], "-o")) {
        output_path = args[3];
    } else {
        if (std.mem.endsWith(u8, input_path, ".zig")) {
            const stem = input_path[0 .. input_path.len - 4];
            output_path = try std.fmt.allocPrint(alloc, "{s}.wasm", .{stem});
        }
    }

    const source = Dir.readFileAlloc(.cwd(), io, input_path, alloc, .limited(10 * 1024 * 1024)) catch {
        errPrint(alloc, "error: cannot read '{s}'\n", .{input_path});
        std.process.exit(1);
    };
    defer alloc.free(source);

    var parser = Parser.init(source, alloc);
    defer parser.deinit();
    const module = parser.parseModule() catch {
        for (parser.errors.items) |m| {
            errPrint(alloc, "parse error: {s}\n", .{m});
        }
        std.process.exit(1);
    };

    var codegen = Codegen.init(alloc);
    defer codegen.deinit();
    const wasm_binary = codegen.generate(module) catch |e| {
        errPrint(alloc, "codegen error: {s}\n", .{@errorName(e)});
        std.process.exit(1);
    };
    defer alloc.free(wasm_binary);

    const out_file = Dir.createFile(.cwd(), io, output_path, .{}) catch |e| {
        errPrint(alloc, "error: cannot create '{s}': {s}\n", .{ output_path, @errorName(e) });
        std.process.exit(1);
    };
    defer out_file.close(io);

    out_file.writePositionalAll(io, wasm_binary, 0) catch |e| {
        errPrint(alloc, "error: cannot write '{s}': {s}\n", .{ output_path, @errorName(e) });
        std.process.exit(1);
    };

    msgPrint(alloc, "compiled {s} -> {s} ({d} bytes)\n", .{ input_path, output_path, wasm_binary.len });
}
