import { describe, test, expect } from "bun:test";
import { compileAndRun } from "../src/pipeline";

describe("pipeline (compile + run)", () => {
  test("compiles and runs inline Zig source", async () => {
    const mod = await compileAndRun({
      source: "export fn add(a: i32, b: i32) i32 { return a + b; }",
    });

    expect(mod.call("add", 10, 20)).toBe(30);
    expect(mod.call("add", -5, 5)).toBe(0);
    expect(mod.call("add", 0, 0)).toBe(0);
  });

  test("compiles and runs math.zig example", async () => {
    const mod = await compileAndRun({ source: "examples/math.zig" });

    expect(mod.call("add", 3, 4)).toBe(7);
    expect(mod.call("subtract", 10, 3)).toBe(7);
    expect(mod.call("multiply", 5, 6)).toBe(30);
    expect(mod.call("divide", 15, 3)).toBe(5);
    expect(mod.call("divide", 10, 0)).toBe(0); // safe division by zero
    expect(mod.call("power", 2, 10)).toBe(1024);
    expect(mod.call("abs", -42)).toBe(42);
    expect(mod.call("max", 5, 9)).toBe(9);
    expect(mod.call("min", 5, 9)).toBe(5);
  });

  test("compiles and runs fibonacci.zig example", async () => {
    const mod = await compileAndRun({ source: "examples/fibonacci.zig" });

    expect(mod.call("fibonacci", 0)).toBe(0);
    expect(mod.call("fibonacci", 1)).toBe(1);
    expect(mod.call("fibonacci", 2)).toBe(1);
    expect(mod.call("fibonacci", 10)).toBe(55);
    expect(mod.call("fibonacci", 20)).toBe(6765);

    expect(mod.call("is_fibonacci", 0)).toBe(1);
    expect(mod.call("is_fibonacci", 1)).toBe(1);
    expect(mod.call("is_fibonacci", 8)).toBe(1);
    expect(mod.call("is_fibonacci", 9)).toBe(0);
  });

  test("compiles and runs sorting.zig with memory access", async () => {
    const mod = await compileAndRun({ source: "examples/sorting.zig" });

    // We need memory to test sorting - get the exported memory
    expect(mod.memory).not.toBeNull();

    if (mod.memory) {
      const mem = new Int32Array(mod.memory.buffer);

      // Write test data to memory at offset 0
      const testData = [5, 3, 8, 1, 9, 2, 7, 4, 6];
      testData.forEach((v, i) => (mem[i] = v));

      // Test sum before sort
      expect(mod.call("sum", 0, testData.length)).toBe(45);

      // Test find_max and find_min
      expect(mod.call("find_max", 0, testData.length)).toBe(9);
      expect(mod.call("find_min", 0, testData.length)).toBe(1);

      // Sort the array
      mod.call("bubble_sort", 0, testData.length);

      // Verify sorted order
      const sorted = Array.from(mem.slice(0, testData.length));
      expect(sorted).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    }
  });

  test("compiles and runs string_utils.zig with memory access", async () => {
    const mod = await compileAndRun({ source: "examples/string_utils.zig" });

    expect(mod.memory).not.toBeNull();

    if (mod.memory) {
      const mem = new Uint8Array(mod.memory.buffer);
      const encoder = new TextEncoder();

      // Write "hello" to memory at offset 1024 (avoid low addresses)
      const hello = encoder.encode("hello\0");
      mem.set(hello, 1024);

      // Test string_length
      expect(mod.call("string_length", 1024, 100)).toBe(5);

      // Test count_char - count 'l' in "hello"
      expect(mod.call("count_char", 1024, 5, "l".charCodeAt(0))).toBe(2);

      // Test to_uppercase
      const upper = encoder.encode("hello");
      mem.set(upper, 2048);
      mod.call("to_uppercase", 2048, 5);
      const result = new TextDecoder().decode(mem.slice(2048, 2053));
      expect(result).toBe("HELLO");

      // Test to_lowercase
      const lower = encoder.encode("WORLD");
      mem.set(lower, 3072);
      mod.call("to_lowercase", 3072, 5);
      const lowerResult = new TextDecoder().decode(mem.slice(3072, 3077));
      expect(lowerResult).toBe("world");

      // Test bytes_equal
      const a = encoder.encode("abc");
      const b = encoder.encode("abc");
      const c = encoder.encode("xyz");
      mem.set(a, 4096);
      mem.set(b, 4100);
      mem.set(c, 4104);
      expect(mod.call("bytes_equal", 4096, 4100, 3)).toBe(1);
      expect(mod.call("bytes_equal", 4096, 4104, 3)).toBe(0);
    }
  });

  test("handles multiple compilation targets", async () => {
    const source = "export fn identity(x: i32) i32 { return x; }";

    const freestanding = await compileAndRun({
      source,
      compileOptions: { target: "wasm32-freestanding" },
    });

    expect(freestanding.call("identity", 42)).toBe(42);
  });
});
