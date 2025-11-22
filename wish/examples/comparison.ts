/**
 * Comparison: Original code vs Wish API
 *
 * This file shows the original concurrency code alongside
 * its elegant Wish equivalent to demonstrate the improvement.
 */

// ============================================================================
// ORIGINAL CODE (commented out for reference)
// ============================================================================

/*
// Original sleep function
function sleep(ms, signal) {
  return new Promise((res, rej) => {
    if (signal?.aborted) return rej(new DOMException("Aborted", "AbortError"));
    const id = setTimeout(res, ms);
    const onAbort = () => {
      clearTimeout(id);
      rej(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// Original streams
async function* streamA({ signal } = {}) {
  yield "A: start";
  await sleep(50, signal);
  yield "A: chunk 1";
  await sleep(80, signal);
  yield "A: chunk 2";
}

async function* streamB({ signal } = {}) {
  yield "B: boot";
  await sleep(30, signal);
  yield "B: piece 1";
  await sleep(120, signal);
  yield "B: piece 2";
}

// Original work handlers
async function doSomethingA(v, signal) {
  console.log(v);
  await sleep(20, signal);
}

async function doSomethingB(v, signal) {
  console.log(v);
  await sleep(25, signal);
}

// Original main logic - complex and error-prone!
async function iterateBothAndContinue({ signal } = {}) {
  const { a, b } = stream({ signal });

  // Manual tracking of in-flight tasks
  const inflight = new Set();
  const track = p => {
    inflight.add(p);
    p.finally(() => inflight.delete(p));
    return p;
  };

  // Manual cleanup management
  const stopIterators = async () => {
    try { await a.return?.(); } catch {}
    try { await b.return?.(); } catch {}
  };

  const onAbort = () => { stopIterators(); };
  signal?.addEventListener("abort", onAbort, { once: true });

  const derived = { aCount: 0, bLast: null };

  // Manual fiber management
  const doneA = (async () => {
    try {
      for await (const v of a) {
        derived.aCount++;
        await track(doSomethingA(v, signal));
      }
    } finally {
      await a.return?.().catch(() => {});
    }
  })();

  const doneB = (async () => {
    try {
      for await (const v of b) {
        derived.bLast = v;
        await track(doSomethingB(v, signal));
      }
    } finally {
      await b.return?.().catch(() => {});
    }
  })();

  try {
    await Promise.allSettled([doneA, doneB]);
  } finally {
    signal?.removeEventListener("abort", onAbort);
    await stopIterators();
    await Promise.allSettled([...inflight]);
  }

  return derived;
}
*/

// ============================================================================
// WISH API - CLEAN AND ELEGANT! ✨
// ============================================================================

import * as Wish from '../Wish'
import * as Stream from '../Stream'
import * as Scope from '../Scope'
import * as Fiber from '../Fiber'

// Define streams - exactly the same as original, but cleaner type
const streamA: Stream.WishStream<string> = async function* (signal) {
  yield "A: start"
  await Wish.sleep(50)(signal)
  yield "A: chunk 1"
  await Wish.sleep(80)(signal)
  yield "A: chunk 2"
}

const streamB: Stream.WishStream<string> = async function* (signal) {
  yield "B: boot"
  await Wish.sleep(30)(signal)
  yield "B: piece 1"
  await Wish.sleep(120)(signal)
  yield "B: piece 2"
}

// Work handlers - composable effects
const doSomethingA = (value: string): Wish.WishEffect<void> =>
  Wish.flatMap(
    Wish.succeed(console.log(value)),
    () => Wish.sleep(20)
  )

const doSomethingB = (value: string): Wish.WishEffect<void> =>
  Wish.flatMap(
    Wish.succeed(console.log(value)),
    () => Wish.sleep(25)
  )

interface DerivedResult {
  aCount: number
  bLast: string | null
}

// ============================================================================
// VERSION 1: Using Scope for automatic resource management
// No manual tracking, no manual cleanup, no manual abort handling!
// ============================================================================

const iterateBothWithScope: Wish.WishEffect<DerivedResult> =
  Scope.run((scope) => async (signal) => {
    const derived: DerivedResult = { aCount: 0, bLast: null }

    // Define stream processors with side effects
    const processA = Stream.forEach(
      Stream.tap(streamA, (v) => {
        derived.aCount++
        return doSomethingA(v)
      }),
      () => Wish.succeed(undefined)
    )

    const processB = Stream.forEach(
      Stream.tap(streamB, (v) => {
        derived.bLast = v
        return doSomethingB(v)
      }),
      () => Wish.succeed(undefined)
    )

    // Run both in parallel - automatic cleanup!
    await Fiber.zipPar(processA, processB)(signal)

    return derived
  })

// ============================================================================
// VERSION 2: Using supervised fibers for even more control
// ============================================================================

const iterateBothSupervised: Wish.WishEffect<DerivedResult> =
  Fiber.supervised((fork) => async (signal) => {
    const derived: DerivedResult = { aCount: 0, bLast: null }

    // Fork both stream processors
    const fiberA = fork(
      Stream.forEach(
        Stream.tap(streamA, (v) => {
          derived.aCount++
          return doSomethingA(v)
        }),
        () => Wish.succeed(undefined)
      )
    )

    const fiberB = fork(
      Stream.forEach(
        Stream.tap(streamB, (v) => {
          derived.bLast = v
          return doSomethingB(v)
        }),
        () => Wish.succeed(undefined)
      )
    )

    // Wait for both - supervisor handles cleanup
    await Promise.allSettled([fiberA.await(), fiberB.await()])

    return derived
  })

// ============================================================================
// VERSION 3: Most concise - using Stream.merge
// ============================================================================

const iterateBothMerged: Wish.WishEffect<DerivedResult> =
  async (signal) => {
    const derived: DerivedResult = { aCount: 0, bLast: null }

    // Merge both streams and process together
    const combined = Stream.merge(
      Stream.tap(streamA, (v) => {
        derived.aCount++
        return doSomethingA(v)
      }),
      Stream.tap(streamB, (v) => {
        derived.bLast = v
        return doSomethingB(v)
      })
    )

    await Stream.forEach(combined, () => Wish.succeed(undefined))(signal)

    return derived
  }

// ============================================================================
// Demo comparison
// ============================================================================

const runComparison = async () => {
  console.log("=== Wish API Comparison Demo ===\n")

  const { signal, abort } = Scope.controlled()

  console.log("Running with Version 1 (Scope-based)...\n")

  const run = Wish.runPromise(iterateBothWithScope, signal.signal)
    .then(res => {
      console.log("\n✅ Derived result:", res)
    })
    .catch(err => {
      console.log("\n⚠️  Stopped:", err.message)
    })

  // Abort after 120ms (same as original)
  setTimeout(() => {
    console.log("\n⚡ Aborting...\n")
    abort()
  }, 120)

  await run

  console.log("\n" + "=".repeat(50))
  console.log("\nKey improvements over original code:")
  console.log("✓ No manual in-flight task tracking")
  console.log("✓ No manual cleanup code")
  console.log("✓ No manual abort listener management")
  console.log("✓ Automatic resource cleanup")
  console.log("✓ Type-safe throughout")
  console.log("✓ Composable and testable")
  console.log("✓ Multiple implementation styles")
}

// Run the demo
runComparison().catch(console.error)

// ============================================================================
// COMPARISON SUMMARY
// ============================================================================

/*

ORIGINAL CODE (60+ lines):
  - Manual in-flight tracking with Set
  - Manual cleanup functions
  - Manual abort listener registration/removal
  - Manual iterator cleanup in finally blocks
  - Error-prone nested try-catch-finally
  - Hard to test
  - Hard to modify

WISH VERSION 1 (20 lines):
  - Automatic cleanup via Scope
  - Declarative stream processing
  - Type-safe
  - Easy to test
  - Easy to modify

WISH VERSION 2 (25 lines):
  - Supervised fiber execution
  - Explicit fiber management
  - Still automatic cleanup

WISH VERSION 3 (15 lines):
  - Most concise
  - Stream merging
  - Simple and elegant

All Wish versions:
  ✓ Handle abort signals correctly
  ✓ Clean up resources automatically
  ✓ Track in-flight tasks automatically
  ✓ Are type-safe
  ✓ Are composable
  ✓ Are testable

*/
