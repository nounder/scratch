/**
 * Side-by-side comparison: Original vs New API
 */

import { Task, Stream, Concurrent, Runtime } from "./concurrency";

console.log("=".repeat(70));
console.log("BEFORE vs AFTER COMPARISON");
console.log("=".repeat(70));

// ============================================================================
// Define the streams (same structure in both approaches)
// ============================================================================

const streamA: Stream<string> = async function* ({ signal }) {
  yield "A: start";
  await Task.sleep(50)({ signal });
  yield "A: chunk 1";
  await Task.sleep(80)({ signal });
  yield "A: chunk 2";
};

const streamB: Stream<string> = async function* ({ signal }) {
  yield "B: boot";
  await Task.sleep(30)({ signal });
  yield "B: piece 1";
  await Task.sleep(120)({ signal });
  yield "B: piece 2";
};

const processA = (value: string): Task<void> =>
  Task.of(async ({ signal }) => {
    console.log(value);
    await Task.sleep(20)({ signal });
  });

const processB = (value: string): Task<void> =>
  Task.of(async ({ signal }) => {
    console.log(value);
    await Task.sleep(25)({ signal });
  });

// ============================================================================
// ORIGINAL APPROACH (Manual Management)
// ============================================================================

async function originalApproach({ signal }: { signal?: AbortSignal } = {}) {
  const iteratorA = streamA({ signal });
  const iteratorB = streamB({ signal });

  // ❌ Manual inflight tracking
  const inflight = new Set<Promise<any>>();
  const track = <P extends Promise<any>>(p: P): P => {
    inflight.add(p);
    p.finally(() => inflight.delete(p));
    return p;
  };

  // ❌ Manual iterator cleanup
  const stopIterators = async () => {
    try {
      await iteratorA.return?.();
    } catch {}
    try {
      await iteratorB.return?.();
    } catch {}
  };

  // ❌ Manual abort listener
  const onAbort = () => {
    stopIterators();
  };
  signal?.addEventListener("abort", onAbort, { once: true });

  const derived = { aCount: 0, bLast: null as string | null };

  const doneA = (async () => {
    try {
      for await (const v of iteratorA) {
        derived.aCount++;
        await track(processA(v)({ signal }));
      }
    } finally {
      await iteratorA.return?.().catch(() => {});
    }
  })();

  const doneB = (async () => {
    try {
      for await (const v of iteratorB) {
        derived.bLast = v;
        await track(processB(v)({ signal }));
      }
    } finally {
      await iteratorB.return?.().catch(() => {});
    }
  })();

  try {
    await Promise.allSettled([doneA, doneB]);
  } finally {
    signal?.removeEventListener("abort", onAbort);
    await stopIterators();
    // ❌ Manual wait for inflight tasks
    await Promise.allSettled([...inflight]);
  }

  return derived;
}

// ============================================================================
// NEW APPROACH (Concurrency Library)
// ============================================================================

const newApproach: Task<{ aCount: number; bLast: string | null }> = Task.map(
  Concurrent.all([
    Stream.runFold(
      Stream.tap(streamA, processA),
      0,
      (count, _) => count + 1
    ),
    Stream.runFold(
      Stream.tap(streamB, processB),
      null as string | null,
      (_, value) => value
    ),
  ]),
  ([aCount, bLast]) => ({ aCount, bLast })
);

// ============================================================================
// RUN BOTH
// ============================================================================

console.log("\n🔴 ORIGINAL APPROACH (Manual Management)");
console.log("─".repeat(70));
console.log("Lines of code: ~50");
console.log("Manual tracking: ✓ inflight Set, ✓ abort listeners, ✓ cleanup\n");

const ac1 = new AbortController();
setTimeout(() => {
  console.log("\n  🚨 Aborting...\n");
  ac1.abort();
}, 120);

try {
  const result1 = await originalApproach({ signal: ac1.signal });
  console.log("\n✓ Result:", result1);
} catch (err: any) {
  console.log("\n✓ Aborted:", err.message);
}

console.log("\n\n🟢 NEW APPROACH (Concurrency Library)");
console.log("─".repeat(70));
console.log("Lines of code: ~15 (-70% reduction!)");
console.log("Manual tracking: ✗ automatic resource management\n");

const ac2 = new AbortController();
setTimeout(() => {
  console.log("\n  🚨 Aborting...\n");
  ac2.abort();
}, 120);

try {
  const result2 = await Runtime.run(newApproach, ac2.signal);
  console.log("\n✓ Result:", result2);
} catch (err: any) {
  console.log("\n✓ Aborted:", err.message);
}

console.log("\n" + "=".repeat(70));
console.log("KEY IMPROVEMENTS:");
console.log("─".repeat(70));
console.log("✅ 70% less code");
console.log("✅ No manual resource tracking");
console.log("✅ No manual abort listener setup/cleanup");
console.log("✅ No manual iterator cleanup");
console.log("✅ Composable and reusable");
console.log("✅ Type-safe");
console.log("✅ Easier to test");
console.log("=".repeat(70) + "\n");
