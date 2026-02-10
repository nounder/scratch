import { describe, test, expect } from "bun:test";
import { compile } from "../src/compiler";

describe("compiler", () => {
  test("compiles inline Zig source to WASM", async () => {
    const result = await compile({
      input: "export fn add(a: i32, b: i32) i32 { return a + b; }",
    });

    expect(result.wasmBytes).toBeInstanceOf(Uint8Array);
    expect(result.size).toBeGreaterThan(0);
    // WASM magic number: \0asm
    expect(result.wasmBytes[0]).toBe(0x00);
    expect(result.wasmBytes[1]).toBe(0x61); // 'a'
    expect(result.wasmBytes[2]).toBe(0x73); // 's'
    expect(result.wasmBytes[3]).toBe(0x6d); // 'm'
  });

  test("compiles a .zig file to WASM", async () => {
    const result = await compile({
      input: "examples/math.zig",
    });

    expect(result.wasmBytes).toBeInstanceOf(Uint8Array);
    expect(result.size).toBeGreaterThan(0);
    expect(result.wasmPath).toContain("math.wasm");
  });

  test("throws on invalid Zig source", async () => {
    expect(
      compile({ input: "this is not valid zig code !!!" })
    ).rejects.toThrow("zigc compilation failed");
  });

  test("compiles with custom output path", async () => {
    const result = await compile({
      input: "export fn id(x: i32) i32 { return x; }",
      output: "/tmp/zigc-test-custom-output.wasm",
    });

    expect(result.wasmPath).toBe("/tmp/zigc-test-custom-output.wasm");
    expect(result.size).toBeGreaterThan(0);
  });

  test("produces compact WASM output", async () => {
    const result = await compile({
      input: "export fn add(a: i32, b: i32) i32 { return a + b; }",
    });

    // Our custom compiler produces very compact WASM (< 100 bytes for simple functions)
    expect(result.size).toBeLessThan(100);
  });
});
