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
    expect(mod.call("modulo", 17, 5)).toBe(2);
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

  test("handles negative numbers correctly", async () => {
    const mod = await compileAndRun({
      source: `
        export fn negate(x: i32) i32 { return -x; }
        export fn abs(x: i32) i32 {
          if (x < 0) { return -x; }
          return x;
        }
      `,
    });

    expect(mod.call("negate", 42)).toBe(-42);
    expect(mod.call("negate", -7)).toBe(7);
    expect(mod.call("abs", -100)).toBe(100);
    expect(mod.call("abs", 100)).toBe(100);
  });

  test("handles while loops with continue clause", async () => {
    const mod = await compileAndRun({
      source: `
        export fn sum_to(n: i32) i32 {
          var total: i32 = 0;
          var i: i32 = 1;
          while (i <= n) : (i += 1) {
            total += i;
          }
          return total;
        }
      `,
    });

    expect(mod.call("sum_to", 10)).toBe(55);
    expect(mod.call("sum_to", 100)).toBe(5050);
  });

  test("handles function calls between functions", async () => {
    const mod = await compileAndRun({
      source: `
        fn square(x: i32) i32 { return x * x; }
        export fn sum_of_squares(a: i32, b: i32) i32 {
          return square(a) + square(b);
        }
      `,
    });

    expect(mod.call("sum_of_squares", 3, 4)).toBe(25);
  });

  test("handles comparison operators", async () => {
    const mod = await compileAndRun({
      source: `
        export fn is_positive(x: i32) i32 {
          if (x > 0) { return 1; }
          return 0;
        }
        export fn clamp(x: i32, lo: i32, hi: i32) i32 {
          if (x < lo) { return lo; }
          if (x > hi) { return hi; }
          return x;
        }
      `,
    });

    expect(mod.call("is_positive", 5)).toBe(1);
    expect(mod.call("is_positive", 0)).toBe(0);
    expect(mod.call("is_positive", -3)).toBe(0);
    expect(mod.call("clamp", 50, 0, 100)).toBe(50);
    expect(mod.call("clamp", -10, 0, 100)).toBe(0);
    expect(mod.call("clamp", 200, 0, 100)).toBe(100);
  });
});
