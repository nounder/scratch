import { existsSync } from "fs";
import { join, basename, dirname, resolve } from "path";
import { tmpdir } from "os";
import { mkdir } from "fs/promises";

export interface CompileOptions {
  /** Zig source code as a string, or path to a .zig file */
  input: string;
  /** Output path for the .wasm file (optional, defaults to same name as input) */
  output?: string;
}

export interface CompileResult {
  /** Path to the generated .wasm file */
  wasmPath: string;
  /** Raw WASM bytes */
  wasmBytes: Uint8Array;
  /** Size of the WASM binary in bytes */
  size: number;
}

/**
 * Find the zigc compiler binary (our custom Zig-to-WASM compiler written in Zig).
 */
function findZigc(): string {
  const repoRoot = resolve(import.meta.dir, "..");
  const zigcPath = join(repoRoot, "compiler", "zig-out", "bin", "zigc");
  if (existsSync(zigcPath)) {
    return zigcPath;
  }

  const pathZigc = Bun.which("zigc");
  if (pathZigc) return pathZigc;

  throw new Error(
    "zigc compiler not found. Build it with: cd compiler && zig build"
  );
}

/**
 * Determines if `input` is inline source code or a file path.
 */
function isSourceCode(input: string): boolean {
  if (input.includes("\n") || input.includes(";")) return true;
  if (/\b(export|fn|const|var)\b/.test(input) && input.includes("{"))
    return true;
  if (input.endsWith(".zig") && existsSync(resolve(input))) return false;
  return !input.endsWith(".zig");
}

/**
 * Compile Zig source code or a .zig file to WASM using our custom zigc compiler.
 *
 * The zigc compiler directly emits WASM binary without needing the full
 * Zig toolchain. It supports a subset of Zig: functions, if/else, while loops,
 * variable declarations, i32 arithmetic, comparisons, and logic operators.
 */
export async function compile(options: CompileOptions): Promise<CompileResult> {
  const { input } = options;
  const zigc = findZigc();
  let zigFile: string;
  let tempDir: string | null = null;

  if (isSourceCode(input)) {
    tempDir = join(
      tmpdir(),
      `zigc-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
    );
    await mkdir(tempDir, { recursive: true });
    zigFile = join(tempDir, "module.zig");
    await Bun.write(zigFile, input);
  } else {
    zigFile = resolve(input);
    if (!existsSync(zigFile)) {
      throw new Error(`Zig source file not found: ${zigFile}`);
    }
  }

  const inputBasename = basename(zigFile, ".zig");
  const outputDir = options.output
    ? dirname(resolve(options.output))
    : tempDir || dirname(zigFile);
  const outputFile = options.output
    ? resolve(options.output)
    : join(outputDir, `${inputBasename}.wasm`);

  await mkdir(dirname(outputFile), { recursive: true });

  const args = [zigc, zigFile, "-o", outputFile];
  const proc = Bun.spawn(args, {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stderr = await new Response(proc.stderr).text();
  const exitCode = await proc.exited;

  if (exitCode !== 0) {
    throw new Error(
      `zigc compilation failed (exit code ${exitCode}):\n${stderr}`
    );
  }

  if (!existsSync(outputFile)) {
    throw new Error(
      `WASM output not found at ${outputFile}. Compiler output: ${stderr}`
    );
  }

  const wasmBytes = new Uint8Array(await Bun.file(outputFile).arrayBuffer());

  return {
    wasmPath: outputFile,
    wasmBytes,
    size: wasmBytes.byteLength,
  };
}
