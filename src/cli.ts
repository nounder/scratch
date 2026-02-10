#!/usr/bin/env bun
/**
 * CLI for zig-wasm-compiler.
 *
 * Usage:
 *   bun run src/cli.ts compile <file.zig> [-o output.wasm] [--target wasm32-freestanding] [--optimize ReleaseSmall]
 *   bun run src/cli.ts run <file.wasm> [--invoke fn_name] [--args 1,2,3]
 *   bun run src/cli.ts build <file.zig> [--invoke fn_name] [--args 1,2,3]
 */

import { compile, type OptLevel, type WasmTarget } from "./compiler";
import { loadWasm } from "./runtime";

const [command, ...rest] = process.argv.slice(2);

function usage(): never {
  console.log(`zig-wasm-compiler - Compile Zig to WASM and run it with Bun

Commands:
  compile <file.zig>   Compile a .zig file to .wasm
    -o <path>          Output path (default: <input>.wasm)
    --target <target>  WASM target (default: wasm32-freestanding)
    --optimize <level> Optimization: Debug|ReleaseSafe|ReleaseFast|ReleaseSmall

  run <file.wasm>      Load and run a .wasm file
    --invoke <fn>      Function to call
    --args <a,b,...>   Comma-separated arguments

  build <file.zig>     Compile and run in one step
    --invoke <fn>      Function to call after compile
    --args <a,b,...>   Arguments for the function
    -o <path>          Output path for .wasm`);
  process.exit(1);
}

function getFlag(args: string[], flag: string): string | undefined {
  const idx = args.indexOf(flag);
  if (idx === -1) return undefined;
  return args[idx + 1];
}

async function main() {
  if (!command || command === "--help" || command === "-h") {
    usage();
  }

  switch (command) {
    case "compile": {
      const file = rest.find((a) => !a.startsWith("-"));
      if (!file) {
        console.error("Error: No input file specified");
        usage();
      }
      const output = getFlag(rest, "-o");
      const target = (getFlag(rest, "--target") || "wasm32-freestanding") as WasmTarget;
      const optimize = (getFlag(rest, "--optimize") || "ReleaseSmall") as OptLevel;

      console.log(`Compiling ${file} -> WASM (${target}, ${optimize})...`);
      const result = await compile({ input: file, output, target, optimize });
      console.log(`Output: ${result.wasmPath} (${result.size} bytes)`);
      if (result.warnings.length > 0) {
        console.log("Warnings:", result.warnings.join("\n"));
      }
      break;
    }

    case "run": {
      const file = rest.find((a) => !a.startsWith("-"));
      if (!file) {
        console.error("Error: No .wasm file specified");
        usage();
      }
      const invoke = getFlag(rest, "--invoke");
      const argsStr = getFlag(rest, "--args");
      const args = argsStr ? argsStr.split(",").map(Number) : [];

      const mod = await loadWasm({ wasm: file });
      console.log("Exported functions:", mod.listFunctions().join(", "));

      if (invoke) {
        const result = mod.call(invoke, ...args);
        console.log(`${invoke}(${args.join(", ")}) = ${result}`);
      }
      break;
    }

    case "build": {
      const file = rest.find((a) => !a.startsWith("-"));
      if (!file) {
        console.error("Error: No input file specified");
        usage();
      }
      const output = getFlag(rest, "-o");
      const target = (getFlag(rest, "--target") || "wasm32-freestanding") as WasmTarget;
      const optimize = (getFlag(rest, "--optimize") || "ReleaseSmall") as OptLevel;
      const invoke = getFlag(rest, "--invoke");
      const argsStr = getFlag(rest, "--args");
      const args = argsStr ? argsStr.split(",").map(Number) : [];

      console.log(`Compiling ${file} -> WASM...`);
      const result = await compile({ input: file, output, target, optimize });
      console.log(`Compiled: ${result.wasmPath} (${result.size} bytes)`);

      const mod = await loadWasm({ wasm: result.wasmBytes });
      console.log("Exported functions:", mod.listFunctions().join(", "));

      if (invoke) {
        const callResult = mod.call(invoke, ...args);
        console.log(`${invoke}(${args.join(", ")}) = ${callResult}`);
      }
      break;
    }

    default:
      console.error(`Unknown command: ${command}`);
      usage();
  }
}

main().catch((err) => {
  console.error("Error:", err.message);
  process.exit(1);
});
