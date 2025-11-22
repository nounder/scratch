/**
 * Original example ported to Effect-Lite API
 *
 * This demonstrates how the new API makes concurrent operations
 * cleaner, more composable, and easier to reason about.
 */

import * as E from './effect-lite';

// ============================================================================
// Domain Logic (same as original)
// ============================================================================

async function* streamA({ signal }: { signal?: AbortSignal } = {}) {
  yield 'A: start';
  await E.sleep(50).run(signal);
  yield 'A: chunk 1';
  await E.sleep(80).run(signal);
  yield 'A: chunk 2';
}

async function* streamB({ signal }: { signal?: AbortSignal } = {}) {
  yield 'B: boot';
  await E.sleep(30).run(signal);
  yield 'B: piece 1';
  await E.sleep(120).run(signal);
  yield 'B: piece 2';
}

function stream(opts?: { signal?: AbortSignal }) {
  return { a: streamA(opts), b: streamB(opts) };
}

// ============================================================================
// Effect-based Implementation (NEW!)
// ============================================================================

/**
 * Process a single item from stream A
 */
const doSomethingA = (v: string): E.Effect<void, never> =>
  E.flatMap(E.log(v), () => E.sleep(20));

/**
 * Process a single item from stream B
 */
const doSomethingB = (v: string): E.Effect<void, never> =>
  E.flatMap(E.log(v), () => E.sleep(25));

/**
 * Process all items from stream A
 */
const processStreamA = (
  iterator: AsyncIterable<string>
): E.Effect<number, Error> =>
  E.promise(async (signal) => {
    let count = 0;
    await E.forEach(iterator, (v, sig) =>
      E.flatMap(doSomethingA(v), () => E.sync(() => count++))
    ).run(signal);
    return count;
  });

/**
 * Process all items from stream B
 */
const processStreamB = (
  iterator: AsyncIterable<string>
): E.Effect<string | null, Error> =>
  E.promise(async (signal) => {
    let last: string | null = null;
    await E.forEach(iterator, (v, sig) =>
      E.flatMap(doSomethingB(v), () => E.sync(() => (last = v)))
    ).run(signal);
    return last;
  });

/**
 * Main program: iterate both streams concurrently
 *
 * Compare with original - no manual tracking of:
 * - in-flight operations
 * - iterator cleanup
 * - abort listeners
 * All handled automatically by the Effect runtime!
 */
const iterateBothAndContinue = E.scoped((scope) =>
  E.promise(async (signal) => {
    const { a, b } = stream({ signal });

    // Fork both streams as concurrent fibers
    const fiberA = scope.fork(processStreamA(a));
    const fiberB = scope.fork(processStreamB(b));

    // Wait for both to complete
    // Scope automatically:
    // - Interrupts fibers on abort
    // - Cleans up resources
    // - Waits for in-flight operations
    const [aCount, bLast] = await Promise.all([
      fiberA.await(),
      fiberB.await(),
    ]);

    return { aCount, bLast };
  })
);

// ============================================================================
// Alternative: Even More Elegant with Combinators
// ============================================================================

/**
 * Same program using high-level combinators
 * This is more declarative and composable
 */
const iterateBothAndContinueV2 = E.scoped((scope) =>
  E.promise(async (signal) => {
    const { a, b } = stream({ signal });

    // Fork and collect results in parallel
    const results = await E.all([
      E.promise(() => scope.fork(processStreamA(a)).await()),
      E.promise(() => scope.fork(processStreamB(b)).await()),
    ]).run(signal);

    return {
      aCount: results[0],
      bLast: results[1],
    };
  })
);

// ============================================================================
// Demo
// ============================================================================

async function demo() {
  console.log('=== Demo: Abort mid-flight ===\n');

  const controller = new AbortController();

  const program = E.tap(iterateBothAndContinue, (result) =>
    E.log(`\nDerived: ${JSON.stringify(result)}`)
  );

  const fiber = E.runFork(program, controller.signal);

  // Abort after 120ms
  setTimeout(() => {
    console.log('\n⚠️  Aborting...\n');
    controller.abort(new DOMException('Aborted', 'AbortError'));
  }, 120);

  try {
    await fiber.await();
  } catch (err) {
    console.log(`\n❌ Stopped: ${err}`);
  }
}

// ============================================================================
// Advanced: Custom Resource Management
// ============================================================================

/**
 * Example showing how to use scope for custom resource management
 */
const withManagedResources = E.scoped((scope) =>
  E.promise(async (signal) => {
    // Register cleanup handlers
    scope.addFinalizer(() => console.log('🧹 Cleanup: Closing connections'));
    scope.addFinalizer(() => console.log('🧹 Cleanup: Flushing buffers'));

    const { a, b } = stream({ signal });

    // These will be automatically interrupted if scope closes
    const fiberA = scope.fork(processStreamA(a));
    const fiberB = scope.fork(processStreamB(b));

    // Even if this throws, finalizers will run
    const [aCount, bLast] = await Promise.all([
      fiberA.await(),
      fiberB.await(),
    ]);

    return { aCount, bLast };
  })
);

// Run the demo
if (require.main === module) {
  demo().catch(console.error);
}

export {
  iterateBothAndContinue,
  iterateBothAndContinueV2,
  withManagedResources,
};
