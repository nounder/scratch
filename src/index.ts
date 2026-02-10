/**
 * zig-wasm-compiler: Compile Zig source code to WebAssembly and run it with Bun.
 *
 * Uses a custom compiler (zigc) written in Zig that directly emits WASM binary.
 *
 * Usage:
 *   import { compile, loadWasm, compileAndRun } from "./index";
 *
 *   // Compile inline Zig source to WASM
 *   const result = await compile({ input: 'export fn add(a: i32, b: i32) i32 { return a + b; }' });
 *
 *   // Load and call functions
 *   const mod = await loadWasm({ wasm: result.wasmBytes });
 *   console.log(mod.call("add", 2, 3)); // 5
 *
 *   // Or do it all in one step
 *   const mod2 = await compileAndRun({
 *     source: 'export fn multiply(a: i32, b: i32) i32 { return a * b; }',
 *   });
 *   console.log(mod2.call("multiply", 6, 7)); // 42
 */

export { compile } from "./compiler";
export type { CompileOptions, CompileResult } from "./compiler";

export { loadWasm, createDefaultImports } from "./runtime";
export type { RunOptions, WasmModule, WasmImports } from "./runtime";

export { compileAndRun } from "./pipeline";
export type { PipelineOptions } from "./pipeline";
