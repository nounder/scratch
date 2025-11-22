# Getting Started with Wish

A quick guide to get you up and running with Wish.

## Installation

```bash
npm install @wish/core
```

## Basic Concepts

Wish has 5 main modules, all following Effect.ts conventions with uppercase names:

1. **Wish** - Core async effects
2. **Stream** - Async generators
3. **Fiber** - Concurrent execution
4. **Scope** - Resource management
5. **Signal** - AbortSignal utilities

## Your First Wish Effect

```typescript
import * as Wish from '@wish/core/Wish'

// Create a simple effect
const greet: Wish.WishEffect<string> = async () => {
  return "Hello, World!"
}

// Run it
const result = await Wish.runPromise(greet)
console.log(result) // "Hello, World!"
```

## Adding Sleep

```typescript
import * as Wish from '@wish/core/Wish'

const delayed = Wish.flatMap(
  Wish.sleep(1000),
  () => Wish.succeed("Done after 1 second")
)

await Wish.runPromise(delayed)
```

## Working with Streams

```typescript
import * as Stream from '@wish/core/Stream'
import * as Wish from '@wish/core/Wish'

// Create a stream
const numbers = Stream.range(1, 6)

// Process each item
await Stream.forEach(numbers, (n) =>
  Wish.succeed(console.log(n))
)()

// Or collect to array
const array = await Stream.toArray(numbers)()
console.log(array) // [1, 2, 3, 4, 5]
```

## Concurrent Execution

```typescript
import * as Fiber from '@wish/core/Fiber'
import * as Wish from '@wish/core/Wish'

const task1 = Wish.sleep(100)
const task2 = Wish.sleep(50)

// Run in parallel
const [result1, result2] = await Fiber.zipPar(task1, task2)()

// Parallel map
const items = [1, 2, 3, 4, 5]
const results = await Fiber.forEachPar(
  items,
  (n) => Wish.flatMap(Wish.sleep(100), () => Wish.succeed(n * 2)),
  { concurrency: 2 }
)()
```

## Cancellation with AbortSignal

```typescript
import * as Wish from '@wish/core/Wish'
import * as Signal from '@wish/core/Signal'

const { signal, abort } = Signal.make()

const longRunning = Wish.sleep(10000)

// Abort after 1 second
setTimeout(() => abort(), 1000)

try {
  await Wish.runPromise(longRunning, signal)
} catch (error) {
  if (Signal.isAbortError(error)) {
    console.log("Cancelled!")
  }
}
```

## Automatic Cleanup with Scopes

```typescript
import * as Scope from '@wish/core/Scope'
import * as Fiber from '@wish/core/Fiber'
import * as Wish from '@wish/core/Wish'

const program = Scope.run((scope) => async (signal) => {
  // Fork tasks that auto-cleanup
  const fiber1 = Fiber.forkIn(scope, Wish.sleep(1000))
  const fiber2 = Fiber.forkIn(scope, Wish.sleep(2000))

  // Add custom cleanup
  scope.addFinalizer(() => console.log("Cleanup!"))

  return await fiber1.await()
})

await Wish.runPromise(program)
// Both fibers cleaned up automatically
```

## Stream Transformations

```typescript
import * as Stream from '@wish/core/Stream'

const stream = Stream.range(1, 100)
const transformed = Stream.take(
  Stream.filter(
    Stream.map(stream, x => x * 2),
    x => x > 50
  ),
  10
)

const result = await Stream.toArray(transformed)()
```

## Error Handling

```typescript
import * as Wish from '@wish/core/Wish'

const riskyTask = Wish.fail(new Error("Oops!"))

const safe = Wish.catchAll(
  riskyTask,
  (error) => {
    console.log("Caught:", error)
    return Wish.succeed("Fallback value")
  }
)

const result = await Wish.runPromise(safe) // "Fallback value"
```

## Retry Pattern

```typescript
import * as Wish from '@wish/core/Wish'

let attempts = 0
const unreliable: Wish.WishEffect<string> = async () => {
  attempts++
  if (attempts < 3) {
    throw new Error("Not ready")
  }
  return "Success!"
}

const withRetry = Wish.retry(unreliable, {
  maxAttempts: 5,
  delay: 100
})

const result = await Wish.runPromise(withRetry)
```

## Real-World Example: Concurrent API Calls

```typescript
import * as Wish from '@wish/core/Wish'
import * as Fiber from '@wish/core/Fiber'
import * as Signal from '@wish/core/Signal'

interface User {
  id: number
  name: string
}

interface Post {
  id: number
  title: string
}

const fetchUser = (id: number): Wish.WishEffect<User> =>
  async (signal) => {
    const response = await fetch(`/api/users/${id}`, { signal })
    return response.json()
  }

const fetchPosts = (userId: number): Wish.WishEffect<Post[]> =>
  async (signal) => {
    const response = await fetch(`/api/users/${userId}/posts`, { signal })
    return response.json()
  }

// Fetch user and posts in parallel
const getUserData = (userId: number): Wish.WishEffect<[User, Post[]]> =>
  Fiber.zipPar(
    fetchUser(userId),
    fetchPosts(userId)
  )

// With timeout
const timeoutSignal = Signal.timeout(5000)
const [user, posts] = await Wish.runPromise(
  getUserData(123),
  timeoutSignal
)
```

## Next Steps

- Read the [API Reference](./README.md#api-reference)
- Explore [examples/](./examples/)
- Check out the [comparison](./examples/comparison.ts) with vanilla JS

## Tips

1. **Use Scopes** for automatic cleanup
2. **Use Fibers** for concurrent execution
3. **Always pass signal** for cancellation support
4. **Compose small effects** instead of large ones
5. **Use Stream operations** for async iteration

Happy Wishing! 🌟
