// Minimal SQLite WASM exports — wasm32-freestanding, no libc.
// Declares SQLite functions as extern C and re-exports them for WASM.

// SQLite return codes
const SQLITE_OK = 0;

// Opaque types matching sqlite3 C structs
const Sqlite3 = anyopaque;
const Stmt = anyopaque;

// SQLITE_TRANSIENT tells SQLite to make its own copy of bound data
const SQLITE_TRANSIENT: *anyopaque = @ptrFromInt(@as(usize, @bitCast(@as(isize, -1))));

// ─── Extern declarations for SQLite C API ───
extern fn sqlite3_open(filename: [*:0]const u8, ppDb: *?*Sqlite3) c_int;
extern fn sqlite3_close(db: ?*Sqlite3) c_int;
extern fn sqlite3_exec(db: ?*Sqlite3, sql: [*:0]const u8, callback: ?*anyopaque, arg: ?*anyopaque, errmsg: ?*?[*:0]u8) c_int;
extern fn sqlite3_prepare_v2(db: ?*Sqlite3, sql: [*]const u8, nByte: c_int, ppStmt: *?*Stmt, pzTail: ?*?[*]const u8) c_int;
extern fn sqlite3_step(stmt: ?*Stmt) c_int;
extern fn sqlite3_reset(stmt: ?*Stmt) c_int;
extern fn sqlite3_finalize(stmt: ?*Stmt) c_int;
extern fn sqlite3_column_count(stmt: ?*Stmt) c_int;
extern fn sqlite3_column_type(stmt: ?*Stmt, col: c_int) c_int;
extern fn sqlite3_column_int(stmt: ?*Stmt, col: c_int) c_int;
extern fn sqlite3_column_int64(stmt: ?*Stmt, col: c_int) i64;
extern fn sqlite3_column_double(stmt: ?*Stmt, col: c_int) f64;
extern fn sqlite3_column_text(stmt: ?*Stmt, col: c_int) ?[*]const u8;
extern fn sqlite3_column_bytes(stmt: ?*Stmt, col: c_int) c_int;
extern fn sqlite3_column_blob(stmt: ?*Stmt, col: c_int) ?*const anyopaque;
extern fn sqlite3_column_name(stmt: ?*Stmt, col: c_int) ?[*]const u8;
extern fn sqlite3_bind_int(stmt: ?*Stmt, col: c_int, val: c_int) c_int;
extern fn sqlite3_bind_int64(stmt: ?*Stmt, col: c_int, val: i64) c_int;
extern fn sqlite3_bind_double(stmt: ?*Stmt, col: c_int, val: f64) c_int;
extern fn sqlite3_bind_text(stmt: ?*Stmt, col: c_int, ptr: [*]const u8, len: c_int, dtor: ?*anyopaque) c_int;
extern fn sqlite3_bind_blob(stmt: ?*Stmt, col: c_int, ptr: ?*const anyopaque, len: c_int, dtor: ?*anyopaque) c_int;
extern fn sqlite3_bind_null(stmt: ?*Stmt, col: c_int) c_int;
extern fn sqlite3_bind_parameter_count(stmt: ?*Stmt) c_int;
extern fn sqlite3_errmsg(db: ?*Sqlite3) ?[*]const u8;
extern fn sqlite3_changes(db: ?*Sqlite3) c_int;
extern fn sqlite3_last_insert_rowid(db: ?*Sqlite3) i64;
extern fn sqlite3_malloc(n: c_int) ?*anyopaque;
extern fn sqlite3_free(ptr: ?*anyopaque) void;
extern fn sqlite3_initialize() c_int;

// ─── WASM-exported API ───

export fn sql_open() ?*Sqlite3 {
    // Ensure SQLite is initialized (registers VFS, etc.)
    _ = sqlite3_initialize();
    var db: ?*Sqlite3 = null;
    const rc = sqlite3_open(":memory:", &db);
    if (rc != SQLITE_OK) {
        if (db) |d| _ = sqlite3_close(d);
        return null;
    }
    return db;
}

export fn sql_close(db: ?*Sqlite3) c_int {
    return sqlite3_close(db);
}

export fn sql_exec(db: ?*Sqlite3, sql_ptr: [*:0]const u8) c_int {
    return sqlite3_exec(db, sql_ptr, null, null, null);
}

export fn sql_prepare(db: ?*Sqlite3, sql_ptr: [*]const u8, sql_len: c_int) ?*Stmt {
    var stmt: ?*Stmt = null;
    const rc = sqlite3_prepare_v2(db, sql_ptr, sql_len, &stmt, null);
    if (rc != SQLITE_OK) return null;
    return stmt;
}

export fn sql_step(stmt: ?*Stmt) c_int { return sqlite3_step(stmt); }
export fn sql_reset(stmt: ?*Stmt) c_int { return sqlite3_reset(stmt); }
export fn sql_finalize(stmt: ?*Stmt) c_int { return sqlite3_finalize(stmt); }
export fn sql_column_count(stmt: ?*Stmt) c_int { return sqlite3_column_count(stmt); }
export fn sql_column_type(stmt: ?*Stmt, col: c_int) c_int { return sqlite3_column_type(stmt, col); }
export fn sql_column_int(stmt: ?*Stmt, col: c_int) c_int { return sqlite3_column_int(stmt, col); }
export fn sql_column_int64(stmt: ?*Stmt, col: c_int) i64 { return sqlite3_column_int64(stmt, col); }
export fn sql_column_double(stmt: ?*Stmt, col: c_int) f64 { return sqlite3_column_double(stmt, col); }
export fn sql_column_text(stmt: ?*Stmt, col: c_int) ?[*]const u8 { return sqlite3_column_text(stmt, col); }
export fn sql_column_bytes(stmt: ?*Stmt, col: c_int) c_int { return sqlite3_column_bytes(stmt, col); }
export fn sql_column_blob(stmt: ?*Stmt, col: c_int) ?*const anyopaque { return sqlite3_column_blob(stmt, col); }
export fn sql_column_name(stmt: ?*Stmt, col: c_int) ?[*]const u8 { return sqlite3_column_name(stmt, col); }

export fn sql_bind_int(stmt: ?*Stmt, col: c_int, val: c_int) c_int { return sqlite3_bind_int(stmt, col, val); }
export fn sql_bind_int64(stmt: ?*Stmt, col: c_int, val: i64) c_int { return sqlite3_bind_int64(stmt, col, val); }
export fn sql_bind_double(stmt: ?*Stmt, col: c_int, val: f64) c_int { return sqlite3_bind_double(stmt, col, val); }
export fn sql_bind_text(stmt: ?*Stmt, col: c_int, ptr: [*]const u8, len: c_int) c_int { return sqlite3_bind_text(stmt, col, ptr, len, SQLITE_TRANSIENT); }
export fn sql_bind_blob(stmt: ?*Stmt, col: c_int, ptr: ?*const anyopaque, len: c_int) c_int { return sqlite3_bind_blob(stmt, col, ptr, len, SQLITE_TRANSIENT); }
export fn sql_bind_null(stmt: ?*Stmt, col: c_int) c_int { return sqlite3_bind_null(stmt, col); }
export fn sql_bind_parameter_count(stmt: ?*Stmt) c_int { return sqlite3_bind_parameter_count(stmt); }

export fn sql_errmsg(db: ?*Sqlite3) ?[*]const u8 { return sqlite3_errmsg(db); }
export fn sql_changes(db: ?*Sqlite3) c_int { return sqlite3_changes(db); }
export fn sql_last_insert_rowid(db: ?*Sqlite3) i64 { return sqlite3_last_insert_rowid(db); }

export fn wasm_malloc(size: usize) ?*anyopaque { return sqlite3_malloc(@intCast(size)); }
export fn wasm_free(ptr: ?*anyopaque) void { sqlite3_free(ptr); }
