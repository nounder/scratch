/**
 * Pipeline: Compile Zig source and run the resulting WASM in one step.
 */

import { compile, type CompileOptions } from "./compiler";
import { loadWasm, type WasmImports, type WasmModule } from "./runtime";

export interface PipelineOptions {
  /** Zig source code string or path to .zig file */
  source: string;
  /** WASM imports to provide */
  imports?: WasmImports;
  /** Compile options overrides */
  compileOptions?: Partial<Omit<CompileOptions, "input">>;
}

/**
 * Compile Zig source and load the resulting WASM module, ready to call.
 */
export async function compileAndRun(
  options: PipelineOptions
): Promise<WasmModule> {
  const compileOpts: CompileOptions = {
    input: options.source,
    ...options.compileOptions,
  };

  const result = await compile(compileOpts);

  return loadWasm({
    wasm: result.wasmBytes,
    imports: options.imports,
  });
}
