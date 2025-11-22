# Wish 🌟

> _The async library we wish we had_

**Wish** is a lightweight, elegant concurrency library for TypeScript/JavaScript that brings structured concurrency and cancellation to async programming. It's a playful reference to Promises and the standard async library we always wished existed.

Inspired by Effect.ts but designed to be lightweight, easy to port, and focused on the essentials: **cancellation**, **structured concurrency**, and **composability**.

## Why Wish?

Working with async operations in JavaScript often leads to:
- Manual `AbortSignal` threading through every function
- Complex cleanup logic scattered everywhere
- Resource leaks when operations are cancelled
- No structured way to manage concurrent operations

**Wish** solves these problems with an elegant API that makes cancellation and resource management automatic.

## Installation

```bash
npm install wish-concurrency
# or
pnpm add wish-concurrency
# or
yarn add wish-concurrency
```

## Quick Start

```typescript
import { sleep, scoped, run } from 'wish-concurrency';

// Simple sleep
await run(sleep(1000));

// Structured concurrency - automatic cleanup
const result = await run(
  scoped(async (scope) => {
    // Fork concurrent operations
    const fiber1 = scope.fork(async (signal) => {
      await sleep(100)(signal);
      return 'Hello';
    });

    const fiber2 = scope.fork(async (signal) => {
      await sleep(50)(signal);
      return 'World';
    });

    // Wait for results
    const [a, b] = await Promise.all([
      fiber1.await(),
      fiber2.await()
    ]);

    return `${a}, ${b}!`;
    // Scope automatically cleans up when exiting
  })
);

console.log(result); // "Hello, World!"
```

## Core Concepts

### Wish<A>

A `Wish<A>` is a cancellable async computation that produces a value of type `A`. It's simply a function that takes an `AbortSignal` and returns a `Promise`:

```typescript
type Wish<A> = (signal: AbortSignal) => Promise<A>;
```

This simple type gives you:
- **Automatic cancellation** via AbortSignal
- **Composability** - wishes can be combined with operators
- **Laziness** - wishes don't run until you call `run()`

### Scope

A `Scope` manages the lifecycle of concurrent operations with **structured concurrency**:

```typescript
const result = await run(
  scoped(async (scope) => {
    // All forked operations are tracked
    const fiber = scope.fork(someWish);

    // Scope ensures cleanup when:
    // 1. The function returns normally
    // 2. An error is thrown
    // 3. The operation is cancelled

    return await fiber.await();
  })
);
```

### Fiber<A>

A `Fiber<A>` represents a running computation that can be awaited or interrupted:

```typescript
const fiber = fork(someWish);

// Wait for result
const result = await fiber.await();

// Or interrupt it
fiber.interrupt();
```

## API Reference

### Creating Wishes

#### `succeed<A>(value: A): Wish<A>`
Create a wish that immediately succeeds with a value.

```typescript
const wish = succeed(42);
```

#### `fail(error: Error): Wish<never>`
Create a wish that immediately fails with an error.

```typescript
const wish = fail(new Error('Oops!'));
```

#### `sleep(ms: number): Wish<void>`
Sleep for a given time (cancellable).

```typescript
await run(sleep(1000)); // Sleep 1 second
```

#### `fromPromise<A>(fn: (signal: AbortSignal) => Promise<A>): Wish<A>`
Create a wish from a function returning a promise.

```typescript
const wish = fromPromise(async (signal) => {
  const response = await fetch('/api/data', { signal });
  return response.json();
});
```

### Composition

#### `map<A, B>(wish: Wish<A>, fn: (a: A) => B): Wish<B>`
Transform the result of a wish.

```typescript
const doubled = map(succeed(21), n => n * 2);
await run(doubled); // 42
```

#### `flatMap<A, B>(wish: Wish<A>, fn: (a: A) => Wish<B>): Wish<B>`
Chain wishes together (monadic bind).

```typescript
const result = flatMap(
  succeed(1),
  n => succeed(n + 1)
);
```

### Concurrency

#### `all(...wishes: Wish[]): Wish<Results[]>`
Run multiple wishes concurrently. All must succeed.

```typescript
const [a, b, c] = await run(
  all(
    sleep(100).then(() => 'a'),
    sleep(50).then(() => 'b'),
    sleep(75).then(() => 'c')
  )
);
```

#### `race(...wishes: Wish[]): Wish<Result>`
Race multiple wishes. First to complete wins, others are cancelled.

```typescript
const winner = await run(
  race(
    sleep(100).then(() => 'slow'),
    sleep(50).then(() => 'fast')
  )
);
// winner === 'fast'
```

#### `scoped<A>(fn: (scope: Scope) => Promise<A>): Wish<A>`
Run a function with a managed scope for structured concurrency.

```typescript
const result = await run(
  scoped(async (scope) => {
    const fiber1 = scope.fork(task1);
    const fiber2 = scope.fork(task2);

    return await Promise.all([
      fiber1.await(),
      fiber2.await()
    ]);
  })
);
```

### Error Handling

#### `catchError<A>(wish: Wish<A>, handler: (error: Error) => Wish<A>): Wish<A>`
Catch and handle errors.

```typescript
const safe = catchError(
  riskyOperation,
  error => succeed('fallback')
);
```

#### `timeout<A>(wish: Wish<A>, ms: number): Wish<A>`
Add a timeout to a wish.

```typescript
const result = await run(
  timeout(slowOperation, 1000)
);
```

#### `retry<A>(wish: Wish<A>, times: number, delay?: number): Wish<A>`
Retry a wish on failure.

```typescript
const result = await run(
  retry(flakyOperation, 3, 100)
);
```

### Resources

#### `acquire<A>(resource: Wish<A>, release: (a: A) => Promise<void>): Wish<A>`
Acquire a resource with automatic cleanup.

```typescript
const result = await run(
  acquire(
    async (signal) => openDatabase(),
    async (db) => db.close()
  )
);
```

### Execution

#### `run<A>(wish: Wish<A>, signal?: AbortSignal): Promise<A>`
Execute a wish to completion.

```typescript
const result = await run(myWish);
```

#### `fork<A>(wish: Wish<A>, signal?: AbortSignal): Fiber<A>`
Start a wish and get a fiber handle.

```typescript
const fiber = fork(myWish);
const result = await fiber.await();
```

## Stream Utilities

Work with async iterables elegantly:

```typescript
import { Stream } from 'wish-concurrency';

// Process items one by one
await run(
  Stream.forEach(asyncIterable, async (item, signal) => {
    await processItem(item, signal);
  })
);

// Collect to array
const items = await run(Stream.toArray(asyncIterable));

// Process with concurrency limit
const results = await run(
  Stream.mapConcurrent(asyncIterable, 5, async (item, signal) => {
    return await process(item);
  })
);
```

## Comparison to Raw Promises

### Before (Raw Promises + AbortSignal)

```typescript
async function complexOperation({ signal }) {
  const inflight = new Set();

  const track = p => {
    inflight.add(p);
    p.finally(() => inflight.delete(p));
    return p;
  };

  const cleanup = async () => {
    // Manual cleanup logic...
  };

  signal?.addEventListener('abort', cleanup, { once: true });

  try {
    // Complex nested logic...
    await track(operation1(signal));
    await track(operation2(signal));
  } finally {
    signal?.removeEventListener('abort', cleanup);
    await cleanup();
    await Promise.allSettled([...inflight]);
  }
}
```

### After (With Wish)

```typescript
const complexOperation = scoped(async (scope) => {
  const fiber1 = scope.fork(operation1);
  const fiber2 = scope.fork(operation2);

  return await Promise.all([
    fiber1.await(),
    fiber2.await()
  ]);
  // Automatic cleanup!
});
```

## Real-World Example

Here's the original motivating example refactored with Wish:

```typescript
import { sleep, scoped, run } from 'wish-concurrency';
import { forEach } from 'wish-concurrency/stream';

const iterateBothAndContinue = scoped(async (scope) => {
  const { a, b } = stream({ signal: scope.abortSignal });
  const derived = { aCount: 0, bLast: null };

  // Fork both stream processors
  const fiberA = scope.fork(
    forEach(a, async (v, signal) => {
      derived.aCount++;
      await doSomethingA(v)(signal);
    })
  );

  const fiberB = scope.fork(
    forEach(b, async (v, signal) => {
      derived.bLast = v;
      await doSomethingB(v)(signal);
    })
  );

  await Promise.allSettled([fiberA.await(), fiberB.await()]);
  return derived;
});

// Run with automatic cleanup
const result = await run(iterateBothAndContinue, abortSignal);
```

Compare this to 80+ lines of manual signal threading and cleanup logic!

## Design Philosophy

1. **Lightweight** - Small API surface, minimal dependencies
2. **Type-safe** - Full TypeScript support with excellent inference
3. **Composable** - Build complex operations from simple primitives
4. **Structured** - Structured concurrency ensures resources are cleaned up
5. **Portable** - Easy to copy into projects, no complex build setup
6. **Standard** - Built on web standards (AbortSignal, Promises)

## Inspiration

Wish is inspired by:
- **Effect.ts** - Powerful effect system (we wanted something lighter)
- **Structured Concurrency** - Concepts from Kotlin, Swift, and Trio
- **AbortSignal** - Web standard for cancellation

## License

MIT

## Contributing

Contributions welcome! This is a young library with room to grow.

---

_Built with ❤️ and the wish for better async primitives_
