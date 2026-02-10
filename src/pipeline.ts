/**
 * Pipeline: Compile Zig source and run the resulting WASM in one step.
 */

import { compile } from "./compiler";
import { loadWasm, type WasmImports, type WasmModule } from "./runtime";

export interface PipelineOptions {
  /** Zig source code string or path to .zig file */
  source: string;
  /** WASM imports to provide */
  imports?: WasmImports;
  /** Output path for the .wasm file (optional) */
  output?: string;
}

/**
 * Compile Zig source and load the resulting WASM module, ready to call.
 */
export async function compileAndRun(
  options: PipelineOptions
): Promise<WasmModule> {
  const result = await compile({
    input: options.source,
    output: options.output,
  });

  return loadWasm({
    wasm: result.wasmBytes,
    imports: options.imports,
  });
}
