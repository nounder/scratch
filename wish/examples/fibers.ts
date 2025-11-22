/**
 * Example: Fiber concurrency patterns with Wish
 */

import * as Wish from '../Wish'
import * as Fiber from '../Fiber'
import * as Signal from '../Signal'

// ============================================================================
// Example 1: Basic fork and join
// ============================================================================

const forkJoinExample = async () => {
  console.log("=== Fork and Join ===\n")

  const { signal } = Signal.make()

  const task1 = Wish.flatMap(
    Wish.sleep(50),
    () => Wish.succeed("Task 1 done")
  )

  const task2 = Wish.flatMap(
    Wish.sleep(30),
    () => Wish.succeed("Task 2 done")
  )

  const task3 = Wish.flatMap(
    Wish.sleep(70),
    () => Wish.succeed("Task 3 done")
  )

  const concurrent = Wish.flatMap(
    Fiber.forkAll([task1, task2, task3]),
    (fibers) => Fiber.join(fibers)
  )

  const results = await Wish.runPromise(concurrent, signal)
  console.log("Results:", results)
}

// ============================================================================
// Example 2: Racing fibers
// ============================================================================

const raceExample = async () => {
  console.log("\n=== Racing Fibers ===\n")

  const { signal } = Signal.make()

  const slow = Wish.flatMap(
    Wish.sleep(100),
    () => Wish.succeed("Slow task")
  )

  const fast = Wish.flatMap(
    Wish.sleep(20),
    () => Wish.succeed("Fast task wins!")
  )

  const racing = Wish.flatMap(
    Fiber.forkAll([slow, fast]),
    (fibers) => Fiber.race(...fibers)
  )

  const winner = await Wish.runPromise(racing, signal)
  console.log("Winner:", winner)
}

// ============================================================================
// Example 3: Parallel map with concurrency limit
// ============================================================================

const parallelMapExample = async () => {
  console.log("\n=== Parallel Map with Concurrency Limit ===\n")

  const { signal } = Signal.make()

  const items = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

  const processItem = (n: number): Wish.WishEffect<string> =>
    Wish.flatMap(
      Wish.tap(
        Wish.sleep(50),
        () => console.log(`Processing ${n}...`)
      ),
      () => Wish.succeed(`Processed ${n}`)
    )

  // Process max 3 items concurrently
  const effect = Fiber.forEachPar(items, processItem, { concurrency: 3 })

  const startTime = Date.now()
  const results = await Wish.runPromise(effect, signal)
  const elapsed = Date.now() - startTime

  console.log("\nResults:", results)
  console.log(`Elapsed: ${elapsed}ms (should be ~200ms with concurrency=3)`)
}

// ============================================================================
// Example 4: Supervised fibers with automatic cleanup
// ============================================================================

const supervisedExample = async () => {
  console.log("\n=== Supervised Fibers ===\n")

  const { signal, abort } = Signal.make()

  const effect = Fiber.supervised((fork) => async (signal) => {
    console.log("Starting supervised tasks...")

    const fiber1 = fork(
      Wish.flatMap(
        Wish.sleep(100),
        () => Wish.succeed("Task 1 completed")
      )
    )

    const fiber2 = fork(
      Wish.flatMap(
        Wish.sleep(200),
        () => Wish.succeed("Task 2 completed")
      )
    )

    const fiber3 = fork(
      Wish.flatMap(
        Wish.sleep(50),
        () => Wish.succeed("Task 3 completed")
      )
    )

    // Wait for task 3 (fastest)
    const result = await fiber3.await()
    console.log(result)

    // Supervisor will automatically interrupt remaining fibers
    return "Main task done - other fibers will be cleaned up"
  })

  const result = await Wish.runPromise(effect, signal)
  console.log(result)
}

// ============================================================================
// Example 5: Error handling with fibers
// ============================================================================

const errorHandlingExample = async () => {
  console.log("\n=== Error Handling with Fibers ===\n")

  const { signal } = Signal.make()

  const successTask = Wish.flatMap(
    Wish.sleep(30),
    () => Wish.succeed("Success!")
  )

  const failingTask = Wish.flatMap(
    Wish.sleep(20),
    () => Wish.fail(new Error("Task failed"))
  )

  const effect = Wish.flatMap(
    Fiber.forkAll([successTask, failingTask]),
    (fibers) => Fiber.joinSettled(fibers)
  )

  const results = await Wish.runPromise(effect, signal)

  results.forEach((result, i) => {
    if (result.status === 'fulfilled') {
      console.log(`Task ${i + 1}: ${result.value}`)
    } else {
      console.log(`Task ${i + 1}: Error - ${result.reason.message}`)
    }
  })
}

// ============================================================================
// Example 6: Retry with fibers
// ============================================================================

const retryExample = async () => {
  console.log("\n=== Retry Pattern ===\n")

  const { signal } = Signal.make()

  let attempts = 0
  const unreliableTask: Wish.WishEffect<string> = async () => {
    attempts++
    console.log(`Attempt ${attempts}`)

    if (attempts < 3) {
      throw new Error("Not yet...")
    }

    return "Success after retries!"
  }

  const effect = Wish.retry(unreliableTask, {
    maxAttempts: 5,
    delay: 100
  })

  const result = await Wish.runPromise(effect, signal)
  console.log(result)
}

// ============================================================================
// Example 7: ZipPar - parallel execution of two tasks
// ============================================================================

const zipParExample = async () => {
  console.log("\n=== ZipPar - Parallel Execution ===\n")

  const { signal } = Signal.make()

  const fetchUser = Wish.flatMap(
    Wish.sleep(50),
    () => Wish.succeed({ id: 1, name: "Alice" })
  )

  const fetchPosts = Wish.flatMap(
    Wish.sleep(30),
    () => Wish.succeed([{ id: 1, title: "Hello" }, { id: 2, title: "World" }])
  )

  const effect = Fiber.zipPar(fetchUser, fetchPosts)

  const [user, posts] = await Wish.runPromise(effect, signal)
  console.log("User:", user)
  console.log("Posts:", posts)
}

// ============================================================================
// Run all examples
// ============================================================================

const runAll = async () => {
  await forkJoinExample()
  await raceExample()
  await parallelMapExample()
  await supervisedExample()
  await errorHandlingExample()
  await retryExample()
  await zipParExample()
}

runAll().catch(console.error)
