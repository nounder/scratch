/**
 * Example: Using pipe-style composition for elegant code
 *
 * This demonstrates how to use functional composition patterns
 * inspired by Effect.ts for maximum readability.
 */

import * as Wish from '../Wish'
import * as Stream from '../Stream'
import * as Fiber from '../Fiber'

// ============================================================================
// Helper: Pipe function for clean composition
// ============================================================================

function pipe<A>(value: A): A
function pipe<A, B>(value: A, fn1: (a: A) => B): B
function pipe<A, B, C>(value: A, fn1: (a: A) => B, fn2: (b: B) => C): C
function pipe<A, B, C, D>(
  value: A,
  fn1: (a: A) => B,
  fn2: (b: B) => C,
  fn3: (c: C) => D
): D
function pipe<A, B, C, D, E>(
  value: A,
  fn1: (a: A) => B,
  fn2: (b: B) => C,
  fn3: (c: C) => D,
  fn4: (d: D) => E
): E
function pipe(value: any, ...fns: Array<(arg: any) => any>): any {
  return fns.reduce((acc, fn) => fn(acc), value)
}

// ============================================================================
// Curried versions of common operations for piping
// ============================================================================

const map = <A, B>(f: (a: A) => B) => (effect: Wish.WishEffect<A>) =>
  Wish.map(effect, f)

const flatMap = <A, B>(f: (a: A) => Wish.WishEffect<B>) =>
  (effect: Wish.WishEffect<A>) =>
    Wish.flatMap(effect, f)

const tap = <A>(f: (a: A) => void | Wish.WishEffect<void>) =>
  (effect: Wish.WishEffect<A>) =>
    Wish.tap(effect, f)

const catchAll = <A, B>(f: (error: unknown) => Wish.WishEffect<B>) =>
  (effect: Wish.WishEffect<A>) =>
    Wish.catchAll(effect, f)

// Stream versions
const streamMap = <A, B>(f: (a: A) => B) => (stream: Stream.WishStream<A>) =>
  Stream.map(stream, f)

const streamFilter = <A>(predicate: (a: A) => boolean) =>
  (stream: Stream.WishStream<A>) =>
    Stream.filter(stream, predicate)

const streamTake = <A>(n: number) => (stream: Stream.WishStream<A>) =>
  Stream.take(stream, n)

const streamTap = <A>(f: (a: A) => void | Wish.WishEffect<void>) =>
  (stream: Stream.WishStream<A>) =>
    Stream.tap(stream, f)

// ============================================================================
// Example 1: Pipe-style effect composition
// ============================================================================

const pipeExample1 = async () => {
  console.log("=== Pipe-Style Effect Composition ===\n")

  const fetchUser = async (id: number) => ({
    id,
    name: "Alice",
    age: 30
  })

  const program = pipe(
    Wish.succeed(123),
    flatMap((userId) => async () => fetchUser(userId)),
    map((user) => user.name.toUpperCase()),
    tap((name) => console.log("User name:", name)),
    map((name) => `Hello, ${name}!`)
  )

  const result = await Wish.runPromise(program)
  console.log("Result:", result)
}

// ============================================================================
// Example 2: Pipe-style stream processing
// ============================================================================

const pipeExample2 = async () => {
  console.log("\n=== Pipe-Style Stream Processing ===\n")

  const stream = pipe(
    Stream.range(1, 20),
    streamMap((x) => x * 2),
    streamFilter((x) => x % 3 === 0),
    streamTake(5),
    streamTap((x) => console.log("Processing:", x))
  )

  const result = await Stream.toArray(stream)()
  console.log("Final array:", result)
}

// ============================================================================
// Example 3: Complex data pipeline
// ============================================================================

interface User {
  id: number
  name: string
  active: boolean
}

const pipeExample3 = async () => {
  console.log("\n=== Complex Data Pipeline ===\n")

  const users: User[] = [
    { id: 1, name: "Alice", active: true },
    { id: 2, name: "Bob", active: false },
    { id: 3, name: "Charlie", active: true },
    { id: 4, name: "David", active: true },
  ]

  const processUser = (user: User): Wish.WishEffect<string> =>
    pipe(
      Wish.succeed(user),
      map((u) => u.name),
      flatMap((name) =>
        pipe(
          Wish.sleep(50),
          map(() => `Processed: ${name}`)
        )
      )
    )

  const pipeline = pipe(
    Stream.fromIterable(users),
    streamFilter((user) => user.active),
    streamMap((user) => user.name),
    streamTap((name) => console.log("Active user:", name))
  )

  await Stream.forEach(pipeline, () => Wish.succeed(undefined))()
}

// ============================================================================
// Example 4: Error handling pipeline
// ============================================================================

const pipeExample4 = async () => {
  console.log("\n=== Error Handling Pipeline ===\n")

  const riskyOperation = (x: number): Wish.WishEffect<number> =>
    async () => {
      if (x < 0) throw new Error("Negative number!")
      return x * 2
    }

  const safeProgram = pipe(
    Wish.succeed(-5),
    flatMap(riskyOperation),
    catchAll((error) => {
      console.log("Error caught:", (error as Error).message)
      return Wish.succeed(0)
    }),
    map((x) => x + 10),
    tap((result) => console.log("Final result:", result))
  )

  await Wish.runPromise(safeProgram)
}

// ============================================================================
// Example 5: Parallel processing with pipe
// ============================================================================

const pipeExample5 = async () => {
  console.log("\n=== Parallel Processing ===\n")

  const items = [1, 2, 3, 4, 5]

  const processItem = (n: number): Wish.WishEffect<number> =>
    pipe(
      Wish.sleep(100),
      flatMap(() => Wish.succeed(n * n)),
      tap((result) => console.log(`${n}² = ${result}`))
    )

  const program = Fiber.forEachPar(
    items,
    processItem,
    { concurrency: 3 }
  )

  const results = await Wish.runPromise(program)
  console.log("All results:", results)
}

// ============================================================================
// Example 6: Stream merging with pipe
// ============================================================================

const pipeExample6 = async () => {
  console.log("\n=== Stream Merging ===\n")

  const stream1 = pipe(
    Stream.range(1, 4),
    streamMap((x) => `A${x}`),
    streamTap((x) => console.log("Stream 1:", x))
  )

  const stream2 = pipe(
    Stream.range(10, 13),
    streamMap((x) => `B${x}`),
    streamTap((x) => console.log("Stream 2:", x))
  )

  const merged = Stream.merge(stream1, stream2)

  await Stream.forEach(merged, () => Wish.succeed(undefined))()
}

// ============================================================================
// Example 7: Advanced composition - the full power of pipe!
// ============================================================================

const pipeExample7 = async () => {
  console.log("\n=== Advanced Composition ===\n")

  interface ApiResponse {
    data: number[]
    status: string
  }

  const fetchData = (): Wish.WishEffect<ApiResponse> =>
    pipe(
      Wish.sleep(100),
      map(() => ({
        data: [1, 2, 3, 4, 5],
        status: "success"
      }))
    )

  const program = pipe(
    fetchData(),
    flatMap((response) => {
      const stream = pipe(
        Stream.fromIterable(response.data),
        streamFilter((x) => x % 2 === 0),
        streamMap((x) => x * 10),
        streamTap((x) => console.log("Even number x10:", x))
      )
      return Stream.toArray(stream)
    }),
    map((numbers) => numbers.reduce((a, b) => a + b, 0)),
    tap((sum) => console.log("Sum:", sum))
  )

  const result = await Wish.runPromise(program)
  console.log("Final result:", result)
}

// ============================================================================
// Run all examples
// ============================================================================

const runAll = async () => {
  await pipeExample1()
  await pipeExample2()
  await pipeExample3()
  await pipeExample4()
  await pipeExample5()
  await pipeExample6()
  await pipeExample7()

  console.log("\n" + "=".repeat(50))
  console.log("\nPipe-style composition benefits:")
  console.log("✓ Clean, readable code")
  console.log("✓ Left-to-right flow")
  console.log("✓ Easy to add/remove steps")
  console.log("✓ Type-safe composition")
  console.log("✓ Functional programming style")
}

runAll().catch(console.error)
