/**
 * WASM Runtime - Load and execute compiled WASM modules with Bun.
 */

export interface WasmImports {
  [module: string]: {
    [name: string]: WebAssembly.ImportValue;
  };
}

export interface RunOptions {
  /** Path to .wasm file or raw WASM bytes */
  wasm: string | Uint8Array;
  /** Import objects to provide to the WASM module */
  imports?: WasmImports;
  /** Function to call after instantiation (default: none) */
  invoke?: string;
  /** Arguments to pass to the invoked function */
  args?: number[];
}

export interface WasmModule {
  /** The instantiated WebAssembly instance */
  instance: WebAssembly.Instance;
  /** The WebAssembly module */
  module: WebAssembly.Module;
  /** Exported functions from the WASM module */
  exports: Record<string, (...args: number[]) => number>;
  /** All exports (including memory, globals, etc.) */
  rawExports: WebAssembly.Exports;
  /** Call an exported function by name */
  call: (name: string, ...args: number[]) => number;
  /** List all exported function names */
  listFunctions: () => string[];
  /** Get exported memory (if any) */
  memory: WebAssembly.Memory | null;
}

/**
 * Default imports providing basic I/O capabilities.
 */
export function createDefaultImports(): WasmImports {
  const outputBuffer: number[] = [];

  return {
    env: {
      // Basic print for a single character
      print_char: (char: number) => {
        if (char === 10) {
          // newline
          console.log(String.fromCharCode(...outputBuffer));
          outputBuffer.length = 0;
        } else {
          outputBuffer.push(char);
        }
      },
      // Print an i32 value
      print_i32: (value: number) => {
        console.log(value);
      },
      // Print a f64 value
      print_f64: (value: number) => {
        console.log(value);
      },
    },
  };
}

/**
 * Load and instantiate a WASM module.
 */
export async function loadWasm(options: RunOptions): Promise<WasmModule> {
  const { wasm, imports = {} } = options;

  let wasmBytes: Uint8Array;
  if (typeof wasm === "string") {
    wasmBytes = new Uint8Array(await Bun.file(wasm).arrayBuffer());
  } else {
    wasmBytes = wasm;
  }

  // Merge default imports with user-provided imports
  const mergedImports: WasmImports = { ...createDefaultImports() };
  for (const [mod, fns] of Object.entries(imports)) {
    mergedImports[mod] = { ...mergedImports[mod], ...fns };
  }

  const module = await WebAssembly.compile(wasmBytes);
  const requiredImports = WebAssembly.Module.imports(module);

  // Build final import object, only including modules that are actually needed
  const finalImports: WasmImports = {};
  for (const imp of requiredImports) {
    if (!finalImports[imp.module]) {
      finalImports[imp.module] = {};
    }
    const provided = mergedImports[imp.module]?.[imp.name];
    if (provided !== undefined) {
      finalImports[imp.module][imp.name] = provided;
    } else {
      // Provide a no-op stub for missing imports to avoid instantiation errors
      console.warn(`Warning: Missing import ${imp.module}.${imp.name}, using stub`);
      if (imp.kind === "function") {
        finalImports[imp.module][imp.name] = () => 0;
      } else if (imp.kind === "memory") {
        finalImports[imp.module][imp.name] = new WebAssembly.Memory({
          initial: 1,
        });
      } else if (imp.kind === "global") {
        finalImports[imp.module][imp.name] = new WebAssembly.Global(
          { value: "i32", mutable: false },
          0
        );
      } else if (imp.kind === "table") {
        finalImports[imp.module][imp.name] = new WebAssembly.Table({
          initial: 1,
          element: "anyfunc",
        });
      }
    }
  }

  const instance = await WebAssembly.instantiate(module, finalImports);
  const rawExports = instance.exports;

  // Extract function exports
  const exports: Record<string, (...args: number[]) => number> = {};
  for (const [name, value] of Object.entries(rawExports)) {
    if (typeof value === "function") {
      exports[name] = value as (...args: number[]) => number;
    }
  }

  const memory =
    (Object.values(rawExports).find(
      (e) => e instanceof WebAssembly.Memory
    ) as WebAssembly.Memory) || null;

  const wasmModule: WasmModule = {
    instance,
    module,
    exports,
    rawExports,
    memory,
    call(name: string, ...args: number[]): number {
      const fn = exports[name];
      if (!fn) {
        throw new Error(
          `Function '${name}' not found. Available: ${Object.keys(exports).join(", ")}`
        );
      }
      return fn(...args);
    },
    listFunctions(): string[] {
      return Object.keys(exports);
    },
  };

  // If invoke is specified, call it immediately
  if (options.invoke) {
    wasmModule.call(options.invoke, ...(options.args || []));
  }

  return wasmModule;
}
