# Wish 🌟

**A lightweight concurrency library inspired by Effect.ts**

> _A playful reference to Promises and the standard async library we wish we had._

Wish is a modern TypeScript library for handling asynchronous operations, concurrent execution, and resource management with built-in AbortSignal support. It provides an elegant, composable API similar to Effect.ts but remains lightweight and easy to port.

## Features

- 🎯 **Effect-style API** - Uppercase module names, fluent operations
- 🚀 **Lightweight** - No heavy dependencies, easy to understand
- 🔄 **Concurrent Execution** - Fibers, parallel operations, racing
- 📡 **Stream Processing** - Async generators with abort support
- 🧹 **Resource Management** - Scopes with automatic cleanup
- ⚡ **AbortSignal Integration** - First-class cancellation support
- 🔧 **TypeScript** - Fully typed with excellent inference
- 🌊 **Composable** - Functional, pipe-able operations

## Installation

```bash
npm install @wish/core
# or
pnpm add @wish/core
# or
bun add @wish/core
```

## Quick Start

```typescript
import * as Wish from '@wish/core/Wish'
import * as Stream from '@wish/core/Stream'
import * as Fiber from '@wish/core/Fiber'
import * as Scope from '@wish/core/Scope'

// Simple effect with sleep
const hello = Wish.flatMap(
  Wish.sleep(1000),
  () => Wish.succeed("Hello, Wish!")
)

await Wish.runPromise(hello)
```

## Core Concepts

### Wish Effects

`WishEffect<A>` represents an async computation that may use an AbortSignal:

```typescript
import * as Wish from '@wish/core/Wish'

// Create effects
const effect = Wish.succeed(42)
const delayed = Wish.flatMap(Wish.sleep(100), () => Wish.succeed("done"))

// Transform effects
const doubled = Wish.map(effect, x => x * 2)

// Handle errors
const safe = Wish.catchAll(riskyEffect, err => Wish.succeed("fallback"))

// Run effects
await Wish.runPromise(effect)
```

### Streams

`WishStream<A>` represents async generators with abort support:

```typescript
import * as Stream from '@wish/core/Stream'

// Create streams
const numbers = Stream.range(1, 10)
const fromArray = Stream.fromIterable([1, 2, 3])

// Transform streams
const doubled = Stream.map(numbers, x => x * 2)
const evens = Stream.filter(numbers, x => x % 2 === 0)
const first5 = Stream.take(numbers, 5)

// Process streams
await Stream.forEach(numbers, (n) =>
  Wish.succeed(console.log(n))
)(signal)

// Collect results
const array = await Stream.toArray(numbers)(signal)
```

### Fibers

Fibers represent concurrent computations with cancellation:

```typescript
import * as Fiber from '@wish/core/Fiber'

// Fork effects concurrently
const fiber = await Fiber.fork(myEffect)(signal)

// Wait for result
const result = await fiber.await()

// Or interrupt
await fiber.interrupt()

// Run multiple fibers
const [result1, result2] = await Fiber.zipPar(effect1, effect2)(signal)

// Parallel map with concurrency limit
const results = await Fiber.forEachPar(
  items,
  processItem,
  { concurrency: 5 }
)(signal)
```

### Scopes

Scopes manage resources with automatic cleanup:

```typescript
import * as Scope from '@wish/core/Scope'

// Use a scope
const result = await Scope.run((scope) => async (signal) => {
  // Fork fibers that auto-cleanup when scope closes
  const fiber1 = Fiber.forkIn(scope, task1)
  const fiber2 = Fiber.forkIn(scope, task2)

  // Add custom cleanup
  scope.addFinalizer(() => console.log("Cleaning up!"))

  return await fiber1.await()
})(signal)

// Everything is automatically cleaned up
```

## API Reference

### Wish Module

Core effect operations:

| Function | Description |
|----------|-------------|
| `make` | Create a WishEffect from a function |
| `succeed` | Create a successful effect |
| `fail` | Create a failed effect |
| `sleep` | Sleep with abort support |
| `map` | Transform effect result |
| `flatMap` | Chain effects |
| `catchAll` | Handle errors |
| `tap` | Side effects without changing value |
| `race` | Race multiple effects |
| `all` | Run all effects in parallel |
| `retry` | Retry with backoff |
| `pipe` | Compose operations |

### Stream Module

Stream operations following Effect.ts conventions:

| Function | Description |
|----------|-------------|
| `make` | Create a stream from async generator |
| `fromIterable` | Create from iterable |
| `fromAsyncIterable` | Create from async iterable |
| `range` | Generate range of numbers |
| `map` | Transform stream values |
| `filter` | Filter stream values |
| `take` | Take first N elements |
| `tap` | Side effects on each element |
| `forEach` | Run effect for each element |
| `toArray` | Collect to array |
| `reduce` | Reduce to single value |
| `merge` | Merge multiple streams |
| `concat` | Concatenate streams |
| `interval` | Emit values at intervals |

### Fiber Module

Concurrent execution primitives:

| Function | Description |
|----------|-------------|
| `fork` | Fork effect into fiber |
| `forkIn` | Fork in scope (auto-managed) |
| `forkAll` | Fork multiple effects |
| `join` | Wait for all fibers |
| `race` | Race fibers |
| `zipPar` | Run two effects in parallel |
| `forEachPar` | Parallel map with concurrency limit |
| `supervised` | Supervised fiber execution |
| `interruptAll` | Interrupt all fibers |

### Scope Module

Resource management:

| Function | Description |
|----------|-------------|
| `make` | Create a scope |
| `controlled` | Create with abort controller |
| `run` | Run effect in scope |
| `acquire` | Acquire resource with cleanup |
| `manageStream` | Manage stream lifecycle |
| `onAbort` | Run cleanup on abort |
| `use` | Use scope in async function |

### Signal Module

AbortSignal utilities:

| Function | Description |
|----------|-------------|
| `make` | Create AbortController |
| `any` | Combine multiple signals |
| `timeout` | Create timeout signal |
| `withTimeout` | Add timeout to signal |
| `isAbortError` | Check if error is abort |
| `throwIfAborted` | Throw if aborted |
| `onAbort` | Register abort callback |
| `never` | Signal that never aborts |
| `aborted` | Already-aborted signal |

## Examples

### Example 1: Concurrent Stream Processing

Transform your complex concurrency code into clean, elegant operations:

```typescript
import * as Wish from '@wish/core/Wish'
import * as Stream from '@wish/core/Stream'
import * as Scope from '@wish/core/Scope'
import * as Fiber from '@wish/core/Fiber'

// Define streams
const streamA: Stream.WishStream<string> = async function* (signal) {
  yield "A: start"
  await Wish.sleep(50)(signal)
  yield "A: chunk 1"
}

const streamB: Stream.WishStream<string> = async function* (signal) {
  yield "B: boot"
  await Wish.sleep(30)(signal)
  yield "B: piece 1"
}

// Process both concurrently with automatic cleanup
const process = Scope.run((scope) => async (signal) => {
  const results = { aCount: 0, bLast: null }

  const processA = Stream.forEach(
    Stream.tap(streamA, v => {
      results.aCount++
      return Wish.succeed(console.log(v))
    }),
    () => Wish.succeed(undefined)
  )

  const processB = Stream.forEach(
    Stream.tap(streamB, v => {
      results.bLast = v
      return Wish.succeed(console.log(v))
    }),
    () => Wish.succeed(undefined)
  )

  await Fiber.zipPar(processA, processB)(signal)
  return results
})

// Run with auto-abort
const { signal, abort } = Scope.controlled()
setTimeout(() => abort(), 120)
await Wish.runPromise(process, signal.signal)
```

### Example 2: Parallel Data Processing

```typescript
import * as Fiber from '@wish/core/Fiber'
import * as Wish from '@wish/core/Wish'

const urls = ['url1', 'url2', 'url3', /* ... */]

const fetchUrl = (url: string): Wish.WishEffect<Response> =>
  async (signal) => fetch(url, { signal })

// Fetch max 5 URLs concurrently
const results = await Fiber.forEachPar(
  urls,
  fetchUrl,
  { concurrency: 5 }
)(signal)
```

### Example 3: Stream Transformations

```typescript
import * as Stream from '@wish/core/Stream'

const processData = async (signal: AbortSignal) => {
  const stream = Stream.pipe(
    Stream.range(1, 100),
    s => Stream.map(s, x => x * 2),
    s => Stream.filter(s, x => x > 50),
    s => Stream.take(s, 10)
  )

  return await Stream.toArray(stream)(signal)
}
```

### Example 4: Retry with Backoff

```typescript
import * as Wish from '@wish/core/Wish'

let attempts = 0
const unreliableTask: Wish.WishEffect<string> = async () => {
  attempts++
  if (attempts < 3) throw new Error("Not yet")
  return "Success!"
}

const result = await Wish.runPromise(
  Wish.retry(unreliableTask, {
    maxAttempts: 5,
    delay: 1000
  })
)
```

## Design Philosophy

Wish follows these principles:

1. **Effect.ts Style** - Uppercase modules, functional patterns
2. **Lightweight** - Minimal dependencies, simple implementation
3. **AbortSignal First** - Built-in cancellation everywhere
4. **Resource Safety** - Automatic cleanup via scopes
5. **Type Safety** - Full TypeScript support
6. **Composability** - Small, composable primitives

## Comparison with Effect.ts

| Feature | Wish | Effect.ts |
|---------|------|-----------|
| Size | Lightweight (~500 LOC) | Comprehensive |
| API Style | Similar | Original |
| AbortSignal | Built-in | Via context |
| Learning Curve | Gentle | Steep |
| Type System | Simple | Advanced |
| Use Case | Small-medium projects | Large projects |

Wish is perfect when you want Effect.ts-style elegance without the complexity.

## Migration from Promises

```typescript
// Before: Promises
const result = await Promise.all([
  fetch('/api/1'),
  fetch('/api/2')
])

// After: Wish
const result = await Wish.all([
  fetchEffect('/api/1'),
  fetchEffect('/api/2')
])(signal)

// With automatic cancellation and cleanup!
```

## Browser and Runtime Support

Wish works in:

- ✅ Node.js 18+
- ✅ Bun
- ✅ Deno
- ✅ Modern browsers
- ✅ Edge functions (Cloudflare Workers, etc.)

## License

MIT

## Contributing

Contributions welcome! This is a lightweight library meant to stay simple and focused.

---

**Wish** - The async library we wish we had. 🌟
