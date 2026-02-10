/**
 * SQLite WASM — compiled with Zig for minimal binary size.
 *
 * Usage:
 *   import { Database } from "./src/index.ts";
 *   const db = await Database.open();
 *   db.exec("CREATE TABLE t(x INTEGER, y TEXT)");
 *   db.exec("INSERT INTO t VALUES(1, 'hello')");
 *   const rows = db.query("SELECT * FROM t");
 *   db.close();
 */

import { readFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

// SQLite constants
const SQLITE_OK = 0;
const SQLITE_ROW = 100;
const SQLITE_DONE = 101;
const SQLITE_INTEGER = 1;
const SQLITE_FLOAT = 2;
const SQLITE_TEXT = 3;
const SQLITE_BLOB = 4;
const SQLITE_NULL = 5;

// WASM instance types
interface SQLiteExports {
  memory: WebAssembly.Memory;
  _initialize?: () => void;
  sql_open: () => number;
  sql_close: (db: number) => number;
  sql_exec: (db: number, sql: number) => number;
  sql_prepare: (db: number, sql: number, len: number) => number;
  sql_step: (stmt: number) => number;
  sql_reset: (stmt: number) => number;
  sql_finalize: (stmt: number) => number;
  sql_column_count: (stmt: number) => number;
  sql_column_type: (stmt: number, col: number) => number;
  sql_column_int: (stmt: number, col: number) => number;
  sql_column_int64: (stmt: number, col: number) => bigint;
  sql_column_double: (stmt: number, col: number) => number;
  sql_column_text: (stmt: number, col: number) => number;
  sql_column_bytes: (stmt: number, col: number) => number;
  sql_column_blob: (stmt: number, col: number) => number;
  sql_column_name: (stmt: number, col: number) => number;
  sql_bind_int: (stmt: number, col: number, val: number) => number;
  sql_bind_int64: (stmt: number, col: number, val: bigint) => number;
  sql_bind_double: (stmt: number, col: number, val: number) => number;
  sql_bind_text: (stmt: number, col: number, ptr: number, len: number) => number;
  sql_bind_blob: (stmt: number, col: number, ptr: number, len: number) => number;
  sql_bind_null: (stmt: number, col: number) => number;
  sql_bind_parameter_count: (stmt: number) => number;
  sql_errmsg: (db: number) => number;
  sql_changes: (db: number) => number;
  sql_last_insert_rowid: (db: number) => bigint;
  wasm_malloc: (size: number) => number;
  wasm_free: (ptr: number) => void;
}

type BindValue = number | bigint | string | Uint8Array | null;

let cachedWasm: WebAssembly.Module | null = null;

async function loadWasm(): Promise<WebAssembly.Module> {
  if (cachedWasm) return cachedWasm;

  const dir = dirname(fileURLToPath(import.meta.url));
  const wasmPath = join(dir, "..", "dist", "sqlite3.wasm");
  const bytes = readFileSync(wasmPath);
  cachedWasm = await WebAssembly.compile(bytes);
  return cachedWasm;
}

function instantiate(mod: WebAssembly.Module): SQLiteExports {
  // Freestanding WASM — no WASI imports needed.
  const instance = new WebAssembly.Instance(
    mod,
    {}
  ) as WebAssembly.Instance & { exports: SQLiteExports };

  return instance.exports;
}

/** Read a null-terminated C string from WASM memory. */
function readCString(exports: SQLiteExports, ptr: number): string {
  if (ptr === 0) return "";
  const mem = new Uint8Array(exports.memory.buffer);
  let end = ptr;
  while (mem[end] !== 0) end++;
  return new TextDecoder().decode(mem.slice(ptr, end));
}

/** Write a string into WASM memory, returning [ptr, len]. Caller must free ptr. */
function writeCString(
  exports: SQLiteExports,
  str: string
): [number, number] {
  const encoded = new TextEncoder().encode(str);
  const ptr = exports.wasm_malloc(encoded.length + 1);
  if (ptr === 0) throw new Error("WASM OOM");
  const mem = new Uint8Array(exports.memory.buffer);
  mem.set(encoded, ptr);
  mem[ptr + encoded.length] = 0; // null terminator
  return [ptr, encoded.length];
}

export class Statement {
  private stmtPtr: number;
  private exports: SQLiteExports;
  private dbPtr: number;
  private finalized = false;

  /** @internal */
  constructor(exports: SQLiteExports, dbPtr: number, stmtPtr: number) {
    this.exports = exports;
    this.dbPtr = dbPtr;
    this.stmtPtr = stmtPtr;
  }

  /** Bind values to the statement parameters (1-indexed). */
  bind(...values: BindValue[]): this {
    for (let i = 0; i < values.length; i++) {
      const col = i + 1;
      const val = values[i];
      let rc: number;

      if (val === null || val === undefined) {
        rc = this.exports.sql_bind_null(this.stmtPtr, col);
      } else if (typeof val === "bigint") {
        rc = this.exports.sql_bind_int64(this.stmtPtr, col, val);
      } else if (typeof val === "number") {
        if (Number.isInteger(val) && val >= -2147483648 && val <= 2147483647) {
          rc = this.exports.sql_bind_int(this.stmtPtr, col, val);
        } else {
          rc = this.exports.sql_bind_double(this.stmtPtr, col, val);
        }
      } else if (typeof val === "string") {
        const [ptr, len] = writeCString(this.exports, val);
        rc = this.exports.sql_bind_text(this.stmtPtr, col, ptr, len);
        this.exports.wasm_free(ptr);
      } else if (val instanceof Uint8Array) {
        const ptr = this.exports.wasm_malloc(val.length);
        if (ptr === 0) throw new Error("WASM OOM");
        new Uint8Array(this.exports.memory.buffer).set(val, ptr);
        rc = this.exports.sql_bind_blob(this.stmtPtr, col, ptr, val.length);
        this.exports.wasm_free(ptr);
      } else {
        throw new Error(`Unsupported bind type: ${typeof val}`);
      }

      if (rc !== SQLITE_OK) {
        throw new Error(
          `Bind error (col ${col}): ${readCString(this.exports, this.exports.sql_errmsg(this.dbPtr))}`
        );
      }
    }
    return this;
  }

  /** Execute the statement, returning all result rows. */
  all<T = Record<string, unknown>>(): T[] {
    const rows: T[] = [];
    const colCount = this.exports.sql_column_count(this.stmtPtr);
    const colNames: string[] = [];
    for (let i = 0; i < colCount; i++) {
      colNames.push(
        readCString(this.exports, this.exports.sql_column_name(this.stmtPtr, i))
      );
    }

    while (true) {
      const rc = this.exports.sql_step(this.stmtPtr);
      if (rc === SQLITE_DONE) break;
      if (rc !== SQLITE_ROW) {
        throw new Error(
          `Step error: ${readCString(this.exports, this.exports.sql_errmsg(this.dbPtr))}`
        );
      }

      const row: Record<string, unknown> = {};
      for (let i = 0; i < colCount; i++) {
        row[colNames[i]] = this.readColumn(i);
      }
      rows.push(row as T);
    }

    return rows;
  }

  /** Execute and return the first row, or null. */
  get<T = Record<string, unknown>>(): T | null {
    const rc = this.exports.sql_step(this.stmtPtr);
    if (rc === SQLITE_DONE) return null;
    if (rc !== SQLITE_ROW) {
      throw new Error(
        `Step error: ${readCString(this.exports, this.exports.sql_errmsg(this.dbPtr))}`
      );
    }

    const colCount = this.exports.sql_column_count(this.stmtPtr);
    const row: Record<string, unknown> = {};
    for (let i = 0; i < colCount; i++) {
      const name = readCString(
        this.exports,
        this.exports.sql_column_name(this.stmtPtr, i)
      );
      row[name] = this.readColumn(i);
    }
    return row as T;
  }

  /** Execute a statement that returns no rows. Returns the number of changes. */
  run(): number {
    const rc = this.exports.sql_step(this.stmtPtr);
    if (rc !== SQLITE_DONE && rc !== SQLITE_ROW) {
      throw new Error(
        `Run error: ${readCString(this.exports, this.exports.sql_errmsg(this.dbPtr))}`
      );
    }
    return this.exports.sql_changes(this.dbPtr);
  }

  /** Reset the statement for re-use. */
  reset(): this {
    this.exports.sql_reset(this.stmtPtr);
    return this;
  }

  /** Finalize (free) the statement. */
  finalize(): void {
    if (!this.finalized) {
      this.exports.sql_finalize(this.stmtPtr);
      this.finalized = true;
    }
  }

  private readColumn(i: number): unknown {
    const type = this.exports.sql_column_type(this.stmtPtr, i);
    switch (type) {
      case SQLITE_INTEGER: {
        // Use int64 and return bigint for large values
        const val = this.exports.sql_column_int64(this.stmtPtr, i);
        if (val >= -2147483648n && val <= 2147483647n) return Number(val);
        return val;
      }
      case SQLITE_FLOAT:
        return this.exports.sql_column_double(this.stmtPtr, i);
      case SQLITE_TEXT:
        return readCString(
          this.exports,
          this.exports.sql_column_text(this.stmtPtr, i)
        );
      case SQLITE_BLOB: {
        const len = this.exports.sql_column_bytes(this.stmtPtr, i);
        const ptr = this.exports.sql_column_blob(this.stmtPtr, i);
        if (ptr === 0 || len === 0) return new Uint8Array(0);
        return new Uint8Array(this.exports.memory.buffer.slice(ptr, ptr + len));
      }
      case SQLITE_NULL:
        return null;
      default:
        return null;
    }
  }
}

export class Database {
  private exports: SQLiteExports;
  private dbPtr: number;
  private closed = false;

  private constructor(exports: SQLiteExports, dbPtr: number) {
    this.exports = exports;
    this.dbPtr = dbPtr;
  }

  /** Open a new in-memory SQLite database. */
  static async open(): Promise<Database> {
    const mod = await loadWasm();
    const exports = instantiate(mod);
    const dbPtr = exports.sql_open();
    if (dbPtr === 0) {
      throw new Error("Failed to open SQLite database");
    }

    // Must call sqlite3_initialize manually since we set SQLITE_OMIT_AUTOINIT
    const db = new Database(exports, dbPtr);

    return db;
  }

  /** Execute SQL that doesn't return rows. */
  exec(sql: string): void {
    this.ensureOpen();
    const [ptr] = writeCString(this.exports, sql);
    const rc = this.exports.sql_exec(this.dbPtr, ptr);
    this.exports.wasm_free(ptr);
    if (rc !== SQLITE_OK) {
      throw new Error(
        `SQL error: ${readCString(this.exports, this.exports.sql_errmsg(this.dbPtr))}`
      );
    }
  }

  /** Prepare a SQL statement. */
  prepare(sql: string): Statement {
    this.ensureOpen();
    const [ptr, len] = writeCString(this.exports, sql);
    const stmtPtr = this.exports.sql_prepare(this.dbPtr, ptr, len);
    this.exports.wasm_free(ptr);
    if (stmtPtr === 0) {
      throw new Error(
        `Prepare error: ${readCString(this.exports, this.exports.sql_errmsg(this.dbPtr))}`
      );
    }
    return new Statement(this.exports, this.dbPtr, stmtPtr);
  }

  /** Shorthand: prepare, bind, return all rows, finalize. */
  query<T = Record<string, unknown>>(
    sql: string,
    ...params: BindValue[]
  ): T[] {
    const stmt = this.prepare(sql);
    try {
      if (params.length > 0) stmt.bind(...params);
      return stmt.all<T>();
    } finally {
      stmt.finalize();
    }
  }

  /** Shorthand: prepare, bind, return first row, finalize. */
  queryOne<T = Record<string, unknown>>(
    sql: string,
    ...params: BindValue[]
  ): T | null {
    const stmt = this.prepare(sql);
    try {
      if (params.length > 0) stmt.bind(...params);
      return stmt.get<T>();
    } finally {
      stmt.finalize();
    }
  }

  /** Shorthand: prepare, bind, run (for INSERT/UPDATE/DELETE), finalize. Returns changes count. */
  run(sql: string, ...params: BindValue[]): number {
    const stmt = this.prepare(sql);
    try {
      if (params.length > 0) stmt.bind(...params);
      return stmt.run();
    } finally {
      stmt.finalize();
    }
  }

  /** Number of rows changed by the last INSERT/UPDATE/DELETE. */
  get changes(): number {
    this.ensureOpen();
    return this.exports.sql_changes(this.dbPtr);
  }

  /** Rowid of the last INSERT. */
  get lastInsertRowid(): number | bigint {
    this.ensureOpen();
    const val = this.exports.sql_last_insert_rowid(this.dbPtr);
    if (val >= -2147483648n && val <= 2147483647n) return Number(val);
    return val;
  }

  /** Close the database. */
  close(): void {
    if (!this.closed) {
      this.exports.sql_close(this.dbPtr);
      this.closed = true;
    }
  }

  private ensureOpen(): void {
    if (this.closed) throw new Error("Database is closed");
  }
}
