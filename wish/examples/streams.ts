/**
 * Example: Advanced stream operations with Wish
 */

import * as Wish from '../Wish'
import * as Stream from '../Stream'
import * as Signal from '../Signal'

// ============================================================================
// Example 1: Stream transformations
// ============================================================================

const transformExample = async () => {
  console.log("=== Stream Transformations ===\n")

  const { signal, abort } = Signal.make()

  // Create a stream of numbers
  const numbers = Stream.pipe(
    Stream.range(1, 10),
    s => Stream.map(s, x => x * 2),
    s => Stream.filter(s, x => x > 5),
    s => Stream.take(s, 3)
  )

  const result = await Stream.toArray(numbers)(signal)
  console.log("Transformed stream:", result)
}

// Helper for pipe operations on streams
namespace Stream {
  export const pipe = <A, B>(
    stream: Stream.WishStream<A>,
    ...fns: Array<(s: any) => any>
  ): any => {
    return fns.reduce((acc, fn) => fn(acc), stream)
  }
}

// ============================================================================
// Example 2: Merging multiple streams
// ============================================================================

const mergeExample = async () => {
  console.log("\n=== Merging Streams ===\n")

  const { signal, abort } = Signal.make()

  const stream1: Stream.WishStream<string> = async function* (signal) {
    for (let i = 0; i < 3; i++) {
      await Wish.sleep(50)(signal)
      yield `Stream1: ${i}`
    }
  }

  const stream2: Stream.WishStream<string> = async function* (signal) {
    for (let i = 0; i < 3; i++) {
      await Wish.sleep(75)(signal)
      yield `Stream2: ${i}`
    }
  }

  const merged = Stream.merge(stream1, stream2)

  await Stream.forEach(merged, (value) =>
    Wish.succeed(console.log(value))
  )(signal)
}

// ============================================================================
// Example 3: Stream with side effects and error handling
// ============================================================================

const errorHandlingExample = async () => {
  console.log("\n=== Error Handling ===\n")

  const { signal, abort } = Signal.make()

  const riskyStream: Stream.WishStream<number> = async function* (signal) {
    for (let i = 0; i < 5; i++) {
      if (i === 3) {
        throw new Error("Something went wrong!")
      }
      yield i
      await Wish.sleep(10)(signal)
    }
  }

  const safeEffect = Wish.catchAll(
    Stream.forEach(riskyStream, (value) =>
      Wish.succeed(console.log("Value:", value))
    ),
    (error) => {
      console.log("Caught error:", String(error))
      return Wish.succeed(undefined)
    }
  )

  await Wish.runPromise(safeEffect, signal)
}

// ============================================================================
// Example 4: Stream reduction
// ============================================================================

const reduceExample = async () => {
  console.log("\n=== Stream Reduction ===\n")

  const { signal } = Signal.make()

  const numbers = Stream.range(1, 6)

  const sum = await Stream.reduce(
    numbers,
    0,
    (acc, n) => acc + n
  )(signal)

  console.log("Sum of 1-5:", sum)
}

// ============================================================================
// Example 5: Interval stream with timeout
// ============================================================================

const intervalExample = async () => {
  console.log("\n=== Interval with Timeout ===\n")

  // Auto-abort after 250ms
  const timeoutSignal = Signal.timeout(250)

  const ticks = Stream.take(Stream.interval(50), 10)

  try {
    await Stream.forEach(ticks, (tick) =>
      Wish.succeed(console.log(`Tick: ${tick}`))
    )(timeoutSignal)
  } catch (error) {
    if (Signal.isAbortError(error)) {
      console.log("Timed out as expected!")
    }
  }
}

// ============================================================================
// Run all examples
// ============================================================================

const runAll = async () => {
  await transformExample()
  await mergeExample()
  await errorHandlingExample()
  await reduceExample()
  await intervalExample()
}

runAll().catch(console.error)
