/**
 * Example: Refactoring the original concurrent code using Wish API
 */

import * as Wish from '../Wish'
import * as Stream from '../Stream'
import * as Scope from '../Scope'
import * as Fiber from '../Fiber'

// ============================================================================
// Define streams using Wish.Stream
// ============================================================================

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

// ============================================================================
// Define work handlers
// ============================================================================

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

// ============================================================================
// Main logic using Wish API - Clean and elegant!
// ============================================================================

interface DerivedResult {
  aCount: number
  bLast: string | null
}

const iterateBothAndContinue: Wish.WishEffect<DerivedResult> =
  async (signal) => {
    return Scope.use(signal, async (scope) => {
      const derived: DerivedResult = { aCount: 0, bLast: null }

      // Process stream A
      const fiberA = Fiber.forkIn(
        scope,
        async (signal) => {
          const stream = Stream.tap(streamA, (value) => {
            derived.aCount++
            return doSomethingA(value)
          })

          await Stream.forEach(stream, (v) => Wish.succeed(undefined))(signal)
        }
      )

      // Process stream B
      const fiberB = Fiber.forkIn(
        scope,
        async (signal) => {
          const stream = Stream.tap(streamB, (value) => {
            derived.bLast = value
            return doSomethingB(value)
          })

          await Stream.forEach(stream, (v) => Wish.succeed(undefined))(signal)
        }
      )

      // Wait for both to complete
      await Fiber.joinSettled([fiberA, fiberB])()

      return derived
    })
  }

// ============================================================================
// Even cleaner version using pipe and higher-level combinators
// ============================================================================

const iterateBothCleaner: Wish.WishEffect<DerivedResult> =
  Scope.run((scope) => async (signal) => {
    const derived: DerivedResult = { aCount: 0, bLast: null }

    // Define processing pipelines
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

    // Run both concurrently with automatic cleanup
    await Fiber.zipPar(processA, processB)(signal)

    return derived
  })

// ============================================================================
// Demo
// ============================================================================

const demo = async () => {
  console.log("=== Running with auto-abort ===\n")

  const { signal, abort } = Scope.controlled()

  const run = Wish.runPromise(iterateBothAndContinue, signal.signal)
    .then(res => console.log("\nDerived result:", res))
    .catch(err => console.log("\nStopped:", String(err)))

  // Abort after 120ms
  setTimeout(() => {
    console.log("\n⚡ Aborting...\n")
    abort()
  }, 120)

  await run
}

// ============================================================================
// Alternative: Using supervised fibers for automatic management
// ============================================================================

const supervisedExample: Wish.WishEffect<DerivedResult> =
  Fiber.supervised((fork) => async (signal) => {
    const derived: DerivedResult = { aCount: 0, bLast: null }

    // Fork both streams in supervised context
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

    // Wait for both
    await Promise.allSettled([fiberA.await(), fiberB.await()])

    return derived
  })

// Run the demo
demo().catch(console.error)
