import { existsSync } from "fs";
import { join, basename, dirname, resolve } from "path";
import { tmpdir } from "os";
import { mkdir } from "fs/promises";

export type OptLevel = "Debug" | "ReleaseSafe" | "ReleaseFast" | "ReleaseSmall";

export type WasmTarget =
  | "wasm32-freestanding"
  | "wasm32-wasi"
  | "wasm32-emscripten";

export interface CompileOptions {
  /** Zig source code as a string, or path to a .zig file */
  input: string;
  /** Output path for the .wasm file (optional, defaults to same name as input) */
  output?: string;
  /** WASM target (default: wasm32-freestanding) */
  target?: WasmTarget;
  /** Optimization level (default: ReleaseSmall) */
  optimize?: OptLevel;
  /** Export all public symbols via -rdynamic (default: true) */
  rdynamic?: boolean;
}

export interface CompileResult {
  /** Path to the generated .wasm file */
  wasmPath: string;
  /** Raw WASM bytes */
  wasmBytes: Uint8Array;
  /** Size of the WASM binary in bytes */
  size: number;
  /** Compiler warnings/messages */
  warnings: string[];
}

/**
 * Resolves the zig compiler binary path.
 */
function findZig(): string {
  const zigPath = Bun.which("zig");
  if (!zigPath) {
    throw new Error(
      "Zig compiler not found. Install zig: https://ziglang.org/download/"
    );
  }
  return zigPath;
}

/**
 * Determines if `input` is inline source code or a file path.
 */
function isSourceCode(input: string): boolean {
  if (input.includes("\n") || input.includes(";")) return true;
  if (/\b(export|fn|const|var|pub)\b/.test(input) && input.includes("{"))
    return true;
  if (input.endsWith(".zig") && existsSync(resolve(input))) return false;
  return !input.endsWith(".zig");
}

/**
 * Compile Zig source code or a .zig file to WASM.
 *
 * Uses `zig build-exe -fno-entry -rdynamic` to produce a standalone WASM
 * module with exported functions and no required host imports.
 */
export async function compile(options: CompileOptions): Promise<CompileResult> {
  const {
    input,
    target = "wasm32-freestanding",
    optimize = "ReleaseSmall",
    rdynamic = true,
  } = options;

  const zig = findZig();
  let zigFile: string;
  let tempDir: string | null = null;

  // Handle inline source vs file path
  if (isSourceCode(input)) {
    tempDir = join(tmpdir(), `zig-wasm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`);
    await mkdir(tempDir, { recursive: true });
    zigFile = join(tempDir, "module.zig");
    await Bun.write(zigFile, input);
  } else {
    zigFile = resolve(input);
    if (!existsSync(zigFile)) {
      throw new Error(`Zig source file not found: ${zigFile}`);
    }
  }

  // Determine output path
  const inputBasename = basename(zigFile, ".zig");
  const outputDir = options.output
    ? dirname(resolve(options.output))
    : tempDir || dirname(zigFile);
  const outputFile = options.output
    ? resolve(options.output)
    : join(outputDir, `${inputBasename}.wasm`);

  await mkdir(dirname(outputFile), { recursive: true });

  // Build args: use build-exe with -fno-entry to produce standalone WASM
  // This avoids the env.memory / __memory_base / __table_base imports
  // that build-lib -dynamic creates.
  const args: string[] = [
    zig, "build-exe",
    zigFile,
    "-target", target,
    `-O${optimize}`,
    "-fno-entry",
  ];

  if (rdynamic) {
    args.push("-rdynamic");
  }

  // Run compiler
  const proc = Bun.spawn(args, {
    cwd: outputDir,
    stdout: "pipe",
    stderr: "pipe",
  });

  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(`Zig compilation failed (exit code ${exitCode}):\n${stderr}`);
  }

  // Zig outputs to the cwd with the input file's basename
  const generatedWasm = join(outputDir, `${inputBasename}.wasm`);

  if (!existsSync(generatedWasm)) {
    throw new Error(
      `WASM output not found at ${generatedWasm}. Compiler output: ${stderr}`
    );
  }

  // Move to desired output location if different
  if (resolve(generatedWasm) !== resolve(outputFile)) {
    const bytes = await Bun.file(generatedWasm).arrayBuffer();
    await Bun.write(outputFile, bytes);
  }

  const wasmBytes = new Uint8Array(
    await Bun.file(outputFile).arrayBuffer()
  );

  // Parse warnings from stderr
  const warnings = stderr
    .split("\n")
    .filter((line) => line.includes("warning"))
    .map((line) => line.trim());

  return {
    wasmPath: outputFile,
    wasmBytes,
    size: wasmBytes.byteLength,
    warnings,
  };
}
