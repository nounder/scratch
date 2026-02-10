const std = @import("std");

pub fn build(b: *std.Build) void {
    const optimize = b.standardOptimizeOption(.{});

    const target = b.resolveTargetQuery(.{
        .cpu_arch = .wasm32,
        .os_tag = .freestanding,
    });

    // SQLite C compilation flags for minimal freestanding WASM build
    const sqlite_flags: []const []const u8 = &.{
        // Custom OS layer (no-op VFS registered in wasm_stubs.c)
        "-DSQLITE_OS_OTHER=1",
        "-DSQLITE_BYTEORDER=1234",
        "-DSQLITE_OMIT_AUTOINIT",

        // Disable unused subsystems
        "-DSQLITE_OMIT_LOAD_EXTENSION",
        "-DSQLITE_OMIT_DEPRECATED",
        "-DSQLITE_OMIT_UTF16",
        "-DSQLITE_OMIT_SHARED_CACHE",
        "-DSQLITE_OMIT_GET_TABLE",
        "-DSQLITE_OMIT_TRACE",
        "-DSQLITE_OMIT_AUTHORIZATION",
        "-DSQLITE_OMIT_EXPLAIN",
        "-DSQLITE_OMIT_JSON",
        "-DSQLITE_OMIT_PROGRESS_CALLBACK",
        "-DSQLITE_OMIT_COMPLETE",
        "-DSQLITE_OMIT_TCL_VARIABLE",
        "-DSQLITE_OMIT_DECLTYPE",
        "-DSQLITE_OMIT_FLAG_PRAGMAS",
        "-DSQLITE_OMIT_SCHEMA_PRAGMAS",
        "-DSQLITE_OMIT_SCHEMA_VERSION_PRAGMAS",
        "-DSQLITE_OMIT_INTEGRITY_CHECK",
        "-DSQLITE_OMIT_COMPILEOPTION_DIAGS",
        "-DSQLITE_OMIT_LIKE_OPTIMIZATION",
        "-DSQLITE_OMIT_INTROSPECTION_PRAGMAS",
        "-DSQLITE_OMIT_DATETIME_FUNCS",
        "-DSQLITE_OMIT_BETWEEN_OPTIMIZATION",
        "-DSQLITE_OMIT_OR_OPTIMIZATION",
        "-DSQLITE_OMIT_CAST",
        "-DSQLITE_OMIT_BLOB_LITERAL",
        "-DSQLITE_OMIT_BUILTIN_TEST",
        "-DSQLITE_OMIT_LOOKASIDE",

        // Disable full-text search, R-tree, geo
        "-DSQLITE_OMIT_FTS3",
        "-DSQLITE_OMIT_FTS4",
        "-DSQLITE_OMIT_FTS5",
        "-DSQLITE_OMIT_RTREE",
        "-DSQLITE_OMIT_GEOPOLY",

        // Disable WAL (not needed for in-memory)
        "-DSQLITE_OMIT_WAL",

        // No threads in WASM
        "-DSQLITE_THREADSAFE=0",

        // Use memory for temp storage
        "-DSQLITE_TEMP_STORE=3",

        // Smaller defaults
        "-DSQLITE_DEFAULT_MEMSTATUS=0",
        "-DSQLITE_DEFAULT_PAGE_SIZE=4096",
        "-DSQLITE_DEFAULT_CACHE_SIZE=10",
        "-DSQLITE_DEFAULT_MMAP_SIZE=0",
        "-DSQLITE_MAX_EXPR_DEPTH=0",

        "-fno-stack-protector",
        "-nostdinc",
        "-isystem",
        "src/include",
    };

    const wasm = b.addExecutable(.{
        .name = "sqlite3",
        .root_module = b.createModule(.{
            .root_source_file = b.path("src/exports.zig"),
            .target = target,
            .optimize = optimize,
            .strip = true,
            .single_threaded = true,
        }),
    });

    wasm.entry = .disabled;
    wasm.rdynamic = true;
    wasm.root_module.addCSourceFiles(.{
        .files = &.{ "vendor/sqlite3.c", "src/wasm_stubs.c" },
        .flags = sqlite_flags,
    });
    wasm.root_module.addIncludePath(b.path("vendor"));
    wasm.root_module.addIncludePath(b.path("src"));
    wasm.initial_memory = 33554432;
    wasm.export_table = true;
    wasm.global_base = 6560;

    b.installArtifact(wasm);
}
