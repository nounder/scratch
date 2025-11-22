/**
 * Example: Migrating to the concurrency API
 *
 * Shows before/after comparison and various usage patterns
 */

import {
  Task,
  Stream,
  Concurrent,
  Runtime,
  scoped,
  type RunContext,
} from "./concurrency";

// ============================================================================
// Define Streams (same as original async generators)
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

// ============================================================================
// Define Processing Tasks
// ============================================================================

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
// APPROACH 1: Using Stream combinators (simplest)
// ============================================================================

const approach1_simpleReduction = Concurrent.reduceStreams(
  [streamA, streamB],
  { aCount: 0, bLast: null as string | null },
  (state, value) => {
    if (value.startsWith("A:")) {
      return { ...state, aCount: state.aCount + 1 };
    } else {
      return { ...state, bLast: value };
    }
  }
);

// ============================================================================
// APPROACH 2: Using allStreams with separate processors (most flexible)
// ============================================================================

interface DerivedResult {
  aCount: number;
  bLast: string | null;
}

const approach2_separateProcessors: Task<DerivedResult> = Concurrent.allStreams({
  a: {
    stream: streamA,
    process: Stream.runFold(
      Stream.tap(streamA, processA),
      0,
      (count, _) => count + 1
    ),
  },
  b: {
    stream: streamB,
    process: Stream.runFold(
      Stream.tap(streamB, processB),
      null as string | null,
      (_, value) => value
    ),
  },
}).then(({ a, b }) => ({ aCount: a, bLast: b }));

// ============================================================================
// APPROACH 3: Manual composition (most control, closest to original)
// ============================================================================

const approach3_manualComposition: Task<DerivedResult> = async (ctx) => {
  const derived = { aCount: 0, bLast: null as string | null };

  const processStreamA = Stream.runForEach(streamA, (value) =>
    Task.tap(processA(value), () => {
      derived.aCount++;
    })
  );

  const processStreamB = Stream.runForEach(streamB, (value) =>
    Task.tap(processB(value), () => {
      derived.bLast = value;
    })
  );

  await Concurrent.allSettled([processStreamA, processStreamB])(ctx);

  return derived;
};

// ============================================================================
// APPROACH 4: Using scoped resources
// ============================================================================

const approach4_scoped: Task<DerivedResult> = scoped((scope) =>
  Task.of(async (ctx) => {
    const derived = { aCount: 0, bLast: null as string | null };

    // Track iterators for cleanup
    const iteratorA = streamA(ctx);
    const iteratorB = streamB(ctx);

    scope.add(async () => {
      await iteratorA.return?.().catch(() => {});
      await iteratorB.return?.().catch(() => {});
    });

    const processStreamA = (async () => {
      try {
        for await (const value of iteratorA) {
          derived.aCount++;
          await processA(value)(ctx);
        }
      } finally {
        await iteratorA.return?.().catch(() => {});
      }
    })();

    const processStreamB = (async () => {
      try {
        for await (const value of iteratorB) {
          derived.bLast = value;
          await processB(value)(ctx);
        }
      } finally {
        await iteratorB.return?.().catch(() => {});
      }
    })();

    await Promise.allSettled([processStreamA, processStreamB]);

    return derived;
  })
);

// ============================================================================
// APPROACH 5: Pipeline style with pipe (most functional)
// ============================================================================

const makeStreamProcessor = <T, S>(
  stream: Stream<T>,
  process: (value: T) => Task<void>,
  reducer: (state: S, value: T) => S,
  seed: S
): Task<S> =>
  Stream.runFold(Stream.tap(stream, process), seed, reducer);

const approach5_pipeline: Task<DerivedResult> = Task.flatMap(
  Concurrent.all([
    makeStreamProcessor(
      streamA,
      processA,
      (count: number, _) => count + 1,
      0
    ),
    makeStreamProcessor(
      streamB,
      processB,
      (_: string | null, value: string) => value,
      null as string | null
    ),
  ]),
  ([aCount, bLast]) => Task.succeed({ aCount, bLast })
);

// ============================================================================
// Demo Runners
// ============================================================================

async function demo1_basic() {
  console.log("\n=== DEMO 1: Basic execution ===");
  const result = await Runtime.run(approach2_separateProcessors);
  console.log("Result:", result);
}

async function demo2_withAbort() {
  console.log("\n=== DEMO 2: With abort ===");
  const ac = new AbortController();

  const run = Runtime.run(approach2_separateProcessors, ac.signal)
    .then((res) => console.log("Derived:", res))
    .catch((err) => console.log("Stopped:", String(err)));

  setTimeout(() => {
    console.log("Aborting...");
    ac.abort(new DOMException("Aborted", "AbortError"));
  }, 120);

  await run;
}

async function demo3_withTimeout() {
  console.log("\n=== DEMO 3: With timeout ===");
  try {
    const result = await Runtime.runWithTimeout(
      approach2_separateProcessors,
      150
    );
    console.log("Result:", result);
  } catch (err) {
    console.log("Timeout:", String(err));
  }
}

async function demo4_abortableHandle() {
  console.log("\n=== DEMO 4: Abortable handle ===");
  const { result, abort } = Runtime.runAbortable(approach2_separateProcessors);

  setTimeout(() => {
    console.log("Manual abort...");
    abort(new DOMException("User cancelled", "AbortError"));
  }, 100);

  try {
    const res = await result;
    console.log("Result:", res);
  } catch (err) {
    console.log("Aborted:", String(err));
  }
}

async function demo5_compareApproaches() {
  console.log("\n=== DEMO 5: Compare all approaches ===");

  const approaches = [
    { name: "Simple Reduction", task: approach1_simpleReduction },
    { name: "Separate Processors", task: approach2_separateProcessors },
    { name: "Manual Composition", task: approach3_manualComposition },
    { name: "Scoped Resources", task: approach4_scoped },
    { name: "Pipeline Style", task: approach5_pipeline },
  ];

  for (const { name, task } of approaches) {
    console.log(`\n--- ${name} ---`);
    const result = await Runtime.run(task);
    console.log("Result:", result);
  }
}

// ============================================================================
// Advanced Examples
// ============================================================================

// Example: Error handling with retry
const withRetry = <T>(
  task: Task<T>,
  maxRetries: number
): Task<T> =>
  Task.of(async (ctx) => {
    let lastError: unknown;
    for (let i = 0; i <= maxRetries; i++) {
      try {
        return await task(ctx);
      } catch (err) {
        lastError = err;
        if (i < maxRetries) {
          await Task.sleep(Math.pow(2, i) * 100)(ctx);
        }
      }
    }
    throw lastError;
  });

// Example: Rate limiting
const rateLimit = <T>(
  tasks: Task<T>[],
  concurrency: number
): Task<T[]> =>
  Task.of(async (ctx) => {
    const results: T[] = [];
    const executing: Promise<void>[] = [];

    for (const task of tasks) {
      const p = task(ctx).then((r) => {
        results.push(r);
        executing.splice(executing.indexOf(p), 1);
      });
      executing.push(p);

      if (executing.length >= concurrency) {
        await Promise.race(executing);
      }
    }

    await Promise.all(executing);
    return results;
  });

// Example: Combine multiple abort signals
const combinedAbortExample: Task<DerivedResult> = Task.of(async (ctx) => {
  const userAbortController = new AbortController();
  const timeoutController = new AbortController();

  // User can cancel
  setTimeout(() => userAbortController.abort(), 5000);

  // Or timeout
  setTimeout(() => timeoutController.abort(), 10000);

  // Combine with parent signal
  const signals = [ctx.signal, userAbortController.signal, timeoutController.signal]
    .filter(Boolean) as AbortSignal[];

  const combined = new AbortController();
  for (const signal of signals) {
    signal?.addEventListener("abort", () => combined.abort(signal.reason), {
      once: true,
    });
  }

  return approach2_separateProcessors({ signal: combined.signal });
});

// ============================================================================
// Main
// ============================================================================

if (import.meta.main) {
  // Run demo
  await demo2_withAbort();

  // Uncomment to try other demos:
  // await demo1_basic();
  // await demo3_withTimeout();
  // await demo4_abortableHandle();
  // await demo5_compareApproaches();
}
