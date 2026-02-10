import { describe, test, expect } from "bun:test";
import { compile } from "../src/compiler";
import { loadWasm } from "../src/runtime";

describe("runtime", () => {
  test("loads WASM and calls exported functions", async () => {
    const compiled = await compile({
      input: `
        export fn add(a: i32, b: i32) i32 { return a + b; }
        export fn multiply(a: i32, b: i32) i32 { return a * b; }
      `,
    });

    const mod = await loadWasm({ wasm: compiled.wasmBytes });

    expect(mod.call("add", 2, 3)).toBe(5);
    expect(mod.call("multiply", 6, 7)).toBe(42);
  });

  test("lists exported functions", async () => {
    const compiled = await compile({
      input: `
        export fn foo() i32 { return 1; }
        export fn bar() i32 { return 2; }
      `,
    });

    const mod = await loadWasm({ wasm: compiled.wasmBytes });
    const fns = mod.listFunctions();

    expect(fns).toContain("foo");
    expect(fns).toContain("bar");
  });

  test("throws on calling non-existent function", async () => {
    const compiled = await compile({
      input: "export fn exists() i32 { return 1; }",
    });

    const mod = await loadWasm({ wasm: compiled.wasmBytes });

    expect(() => mod.call("does_not_exist")).toThrow("not found");
  });

  test("loads WASM from file path", async () => {
    const compiled = await compile({
      input: "export fn double(x: i32) i32 { return x * 2; }",
      output: "/tmp/zig-test-runtime-load.wasm",
    });

    const mod = await loadWasm({ wasm: compiled.wasmPath });
    expect(mod.call("double", 21)).toBe(42);
  });

  test("invokes function on load", async () => {
    const compiled = await compile({
      input: "export fn square(x: i32) i32 { return x * x; }",
    });

    const mod = await loadWasm({
      wasm: compiled.wasmBytes,
      invoke: "square",
      args: [7],
    });

    // Module should still be usable after invoke
    expect(mod.call("square", 5)).toBe(25);
  });
});
