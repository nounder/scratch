import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import { Database } from "../src/index.ts";

describe("SQLite WASM (Zig build)", () => {
  let db: Database;

  beforeEach(async () => {
    db = await Database.open();
  });

  afterEach(() => {
    db.close();
  });

  it("opens an in-memory database", () => {
    expect(db).toBeDefined();
  });

  it("creates a table and inserts data", () => {
    db.exec("CREATE TABLE t(id INTEGER PRIMARY KEY, name TEXT)");
    db.exec("INSERT INTO t VALUES(1, 'alice')");
    db.exec("INSERT INTO t VALUES(2, 'bob')");

    const rows = db.query("SELECT * FROM t ORDER BY id");
    expect(rows).toEqual([
      { id: 1, name: "alice" },
      { id: 2, name: "bob" },
    ]);
  });

  it("handles parameterized queries", () => {
    db.exec("CREATE TABLE t(x INTEGER, y TEXT)");
    db.run("INSERT INTO t VALUES(?, ?)", 42, "hello");
    db.run("INSERT INTO t VALUES(?, ?)", 100, "world");

    const rows = db.query("SELECT * FROM t WHERE x > ?", 50);
    expect(rows).toEqual([{ x: 100, y: "world" }]);
  });

  it("returns changes count", () => {
    db.exec("CREATE TABLE t(x INTEGER)");
    db.exec("INSERT INTO t VALUES(1)");
    db.exec("INSERT INTO t VALUES(2)");
    db.exec("INSERT INTO t VALUES(3)");

    const changes = db.run("DELETE FROM t WHERE x > 1");
    expect(changes).toBe(2);
  });

  it("handles NULL values", () => {
    db.exec("CREATE TABLE t(x INTEGER, y TEXT)");
    db.run("INSERT INTO t VALUES(?, ?)", null, null);

    const row = db.queryOne("SELECT * FROM t");
    expect(row).toEqual({ x: null, y: null });
  });

  it("handles float values", () => {
    db.exec("CREATE TABLE t(x REAL)");
    db.run("INSERT INTO t VALUES(?)", 3.14159);

    const row = db.queryOne<{ x: number }>("SELECT * FROM t");
    expect(row!.x).toBeCloseTo(3.14159, 4);
  });

  it("handles blob values", () => {
    db.exec("CREATE TABLE t(data BLOB)");
    const blob = new Uint8Array([0xde, 0xad, 0xbe, 0xef]);
    db.run("INSERT INTO t VALUES(?)", blob);

    const row = db.queryOne<{ data: Uint8Array }>("SELECT * FROM t");
    expect(row!.data).toEqual(blob);
  });

  it("handles large integer values with bigint", () => {
    db.exec("CREATE TABLE t(big INTEGER)");
    db.run("INSERT INTO t VALUES(?)", 9007199254740993n); // > Number.MAX_SAFE_INTEGER

    const row = db.queryOne<{ big: bigint }>("SELECT * FROM t");
    expect(row!.big).toBe(9007199254740993n);
  });

  it("handles last insert rowid", () => {
    db.exec(
      "CREATE TABLE t(id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT)"
    );
    db.run("INSERT INTO t(name) VALUES(?)", "test");
    expect(db.lastInsertRowid).toBe(1);
    db.run("INSERT INTO t(name) VALUES(?)", "test2");
    expect(db.lastInsertRowid).toBe(2);
  });

  it("handles prepared statement reuse", () => {
    db.exec("CREATE TABLE t(x INTEGER)");
    const stmt = db.prepare("INSERT INTO t VALUES(?)");

    for (let i = 0; i < 100; i++) {
      stmt.bind(i).run();
      stmt.reset();
    }
    stmt.finalize();

    const rows = db.query<{ count: number }>(
      "SELECT COUNT(*) as count FROM t"
    );
    expect(rows[0].count).toBe(100);
  });

  it("handles empty result sets", () => {
    db.exec("CREATE TABLE t(x INTEGER)");
    const rows = db.query("SELECT * FROM t");
    expect(rows).toEqual([]);
  });

  it("handles queryOne with no results", () => {
    db.exec("CREATE TABLE t(x INTEGER)");
    const row = db.queryOne("SELECT * FROM t");
    expect(row).toBeNull();
  });

  it("throws on SQL errors", () => {
    expect(() => db.exec("INVALID SQL")).toThrow();
  });

  it("throws when using closed database", () => {
    db.close();
    expect(() => db.exec("SELECT 1")).toThrow("Database is closed");
  });

  it("handles multiple tables and joins", () => {
    db.exec(`
      CREATE TABLE users(id INTEGER PRIMARY KEY, name TEXT);
      CREATE TABLE orders(id INTEGER PRIMARY KEY, user_id INTEGER, amount REAL);
    `);

    db.run("INSERT INTO users VALUES(?, ?)", 1, "alice");
    db.run("INSERT INTO users VALUES(?, ?)", 2, "bob");
    db.run("INSERT INTO orders VALUES(?, ?, ?)", 1, 1, 9.99);
    db.run("INSERT INTO orders VALUES(?, ?, ?)", 2, 1, 19.99);
    db.run("INSERT INTO orders VALUES(?, ?, ?)", 3, 2, 4.99);

    const rows = db.query<{ name: string; total: number }>(`
      SELECT u.name, SUM(o.amount) as total
      FROM users u
      JOIN orders o ON u.id = o.user_id
      GROUP BY u.id
      ORDER BY total DESC
    `);

    expect(rows).toHaveLength(2);
    expect(rows[0].name).toBe("alice");
    expect(rows[0].total).toBeCloseTo(29.98, 1);
    expect(rows[1].name).toBe("bob");
  });

  it("handles transaction semantics", () => {
    db.exec("CREATE TABLE t(x INTEGER)");

    // Explicit transaction
    db.exec("BEGIN");
    db.run("INSERT INTO t VALUES(1)");
    db.run("INSERT INTO t VALUES(2)");
    db.exec("COMMIT");

    const rows = db.query<{ x: number }>("SELECT * FROM t ORDER BY x");
    expect(rows).toEqual([{ x: 1 }, { x: 2 }]);

    // Rollback
    db.exec("BEGIN");
    db.run("INSERT INTO t VALUES(3)");
    db.exec("ROLLBACK");

    const rows2 = db.query<{ count: number }>(
      "SELECT COUNT(*) as count FROM t"
    );
    expect(rows2[0].count).toBe(2);
  });

  it("handles unicode strings", () => {
    db.exec("CREATE TABLE t(text TEXT)");
    const testStrings = [
      "Hello, 世界! 🌍",
      "Ñoño señor",
      "Привет мир",
      "日本語テスト",
    ];

    for (const s of testStrings) {
      db.run("INSERT INTO t VALUES(?)", s);
    }

    const rows = db.query<{ text: string }>("SELECT * FROM t");
    expect(rows.map((r) => r.text)).toEqual(testStrings);
  });

  it("handles concurrent multiple database instances", async () => {
    const db2 = await Database.open();
    db.exec("CREATE TABLE t(x INTEGER)");
    db2.exec("CREATE TABLE t(x INTEGER)");

    db.run("INSERT INTO t VALUES(1)");
    db2.run("INSERT INTO t VALUES(2)");

    expect(db.query<{ x: number }>("SELECT x FROM t")[0].x).toBe(1);
    expect(db2.query<{ x: number }>("SELECT x FROM t")[0].x).toBe(2);

    db2.close();
  });
});

describe("WASM binary size", () => {
  it("is smaller than the official Emscripten build (897KB)", async () => {
    const { statSync } = await import("fs");
    const { join, dirname } = await import("path");
    const { fileURLToPath } = await import("url");

    const dir = dirname(fileURLToPath(import.meta.url));
    const wasmPath = join(dir, "..", "dist", "sqlite3.wasm");
    const stat = statSync(wasmPath);

    console.log(`\n  WASM binary size: ${stat.size} bytes (${(stat.size / 1024).toFixed(1)}KB)`);
    console.log(`  Official sqlite3.wasm (Emscripten): 897KB`);
    console.log(`  wa-sqlite: 566KB`);
    console.log(`  Savings vs Emscripten: ${((1 - stat.size / (897 * 1024)) * 100).toFixed(1)}%\n`);

    expect(stat.size).toBeLessThan(897 * 1024); // less than official
  });
});
