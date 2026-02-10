// Minimal SQLite WASM exports
// Thin wrapper around SQLite's C API, compiled for wasm32-wasi with libc.
// Only exports the functions needed by the JavaScript layer.

const c = @cImport({
    @cInclude("sqlite3.h");
});

const Sqlite3 = c.sqlite3;
const Stmt = c.sqlite3_stmt;

// ─── Exported WASM API ───

/// Open an in-memory database. Returns pointer to db, or null on error.
export fn sql_open() ?*Sqlite3 {
    var db: ?*Sqlite3 = null;
    const rc = c.sqlite3_open(":memory:", &db);
    if (rc != c.SQLITE_OK) {
        if (db) |d| _ = c.sqlite3_close(d);
        return null;
    }
    return db;
}

export fn sql_close(db: ?*Sqlite3) c_int {
    return c.sqlite3_close(db);
}

/// Execute SQL that doesn't return rows.
export fn sql_exec(db: ?*Sqlite3, sql_ptr: [*]const u8) c_int {
    return c.sqlite3_exec(db, sql_ptr, null, null, null);
}

/// Prepare a statement. Returns stmt pointer or null.
export fn sql_prepare(db: ?*Sqlite3, sql_ptr: [*]const u8, sql_len: c_int) ?*Stmt {
    var stmt: ?*Stmt = null;
    const rc = c.sqlite3_prepare_v2(db, sql_ptr, sql_len, &stmt, null);
    if (rc != c.SQLITE_OK) return null;
    return stmt;
}

export fn sql_step(stmt: ?*Stmt) c_int {
    return c.sqlite3_step(stmt);
}

export fn sql_reset(stmt: ?*Stmt) c_int {
    return c.sqlite3_reset(stmt);
}

export fn sql_finalize(stmt: ?*Stmt) c_int {
    return c.sqlite3_finalize(stmt);
}

export fn sql_column_count(stmt: ?*Stmt) c_int {
    return c.sqlite3_column_count(stmt);
}

export fn sql_column_type(stmt: ?*Stmt, col: c_int) c_int {
    return c.sqlite3_column_type(stmt, col);
}

export fn sql_column_int(stmt: ?*Stmt, col: c_int) c_int {
    return c.sqlite3_column_int(stmt, col);
}

export fn sql_column_int64(stmt: ?*Stmt, col: c_int) i64 {
    return c.sqlite3_column_int64(stmt, col);
}

export fn sql_column_double(stmt: ?*Stmt, col: c_int) f64 {
    return c.sqlite3_column_double(stmt, col);
}

export fn sql_column_text(stmt: ?*Stmt, col: c_int) ?[*]const u8 {
    return c.sqlite3_column_text(stmt, col);
}

export fn sql_column_bytes(stmt: ?*Stmt, col: c_int) c_int {
    return c.sqlite3_column_bytes(stmt, col);
}

export fn sql_column_blob(stmt: ?*Stmt, col: c_int) ?*const anyopaque {
    return c.sqlite3_column_blob(stmt, col);
}

export fn sql_column_name(stmt: ?*Stmt, col: c_int) ?[*]const u8 {
    return c.sqlite3_column_name(stmt, col);
}

// ─── Bind parameters ───

export fn sql_bind_int(stmt: ?*Stmt, col: c_int, val: c_int) c_int {
    return c.sqlite3_bind_int(stmt, col, val);
}

export fn sql_bind_int64(stmt: ?*Stmt, col: c_int, val: i64) c_int {
    return c.sqlite3_bind_int64(stmt, col, val);
}

export fn sql_bind_double(stmt: ?*Stmt, col: c_int, val: f64) c_int {
    return c.sqlite3_bind_double(stmt, col, val);
}

export fn sql_bind_text(stmt: ?*Stmt, col: c_int, ptr: [*]const u8, len: c_int) c_int {
    return c.sqlite3_bind_text(stmt, col, ptr, len, c.SQLITE_TRANSIENT);
}

export fn sql_bind_blob(stmt: ?*Stmt, col: c_int, ptr: ?*const anyopaque, len: c_int) c_int {
    return c.sqlite3_bind_blob(stmt, col, ptr, len, c.SQLITE_TRANSIENT);
}

export fn sql_bind_null(stmt: ?*Stmt, col: c_int) c_int {
    return c.sqlite3_bind_null(stmt, col);
}

export fn sql_bind_parameter_count(stmt: ?*Stmt) c_int {
    return c.sqlite3_bind_parameter_count(stmt);
}

// ─── Error / info ───

export fn sql_errmsg(db: ?*Sqlite3) ?[*]const u8 {
    return c.sqlite3_errmsg(db);
}

export fn sql_changes(db: ?*Sqlite3) c_int {
    return c.sqlite3_changes(db);
}

export fn sql_last_insert_rowid(db: ?*Sqlite3) i64 {
    return c.sqlite3_last_insert_rowid(db);
}

// ─── Memory helpers for JS ───

export fn wasm_malloc(size: usize) ?*anyopaque {
    return c.sqlite3_malloc(@intCast(size));
}

export fn wasm_free(ptr: ?*anyopaque) void {
    c.sqlite3_free(ptr);
}
