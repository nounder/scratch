# Lightweight Concurrency Library

An elegant, Effect.ts-inspired API for handling concurrent, abortable async operations in TypeScript.

## Features

- 🎯 **Declarative**: Compose async operations using pure functions
- 🔄 **Abortable**: Built-in AbortSignal propagation throughout
- 🧹 **Resource-safe**: Automatic cleanup and resource management
- 🚀 **Lightweight**: Zero dependencies, ~300 LOC
- 📦 **Type-safe**: Full TypeScript support
- 🔧 **Composable**: Functional combinators for complex workflows

## Core Concepts

### Task&lt;T&gt;

A `Task<T>` represents an abortable async computation that produces a value of type `T`.

```typescript
type Task<T> = (ctx: RunContext) => Promise<T>

interface RunContext {
  readonly signal?: AbortSignal;
}
```

### Stream&lt;T&gt;

A `Stream<T>` represents an abortable async generator that yields values of type `T`.

```typescript
type Stream<T> = (ctx: RunContext) => AsyncGenerator<T>
```

## Quick Start

### Basic Task

```typescript
import { Task, Runtime } from "./concurrency";

// Create a task
const greet: Task<string> = Task.succeed("Hello!");

// Run it
const result = await Runtime.run(greet);
console.log(result); // "Hello!"
```

### Composing Tasks

```typescript
const fetchUser = Task.of(async ({ signal }) => {
  const res = await fetch("/api/user", { signal });
  return res.json();
});

const processUser = Task.map(
  fetchUser,
  (user) => user.name.toUpperCase()
);

const result = await Runtime.run(processUser);
```

### Abortable Operations

```typescript
const longTask = Task.flatMap(
  Task.sleep(1000),
  () => Task.succeed("Done!")
);

const ac = new AbortController();
const promise = Runtime.run(longTask, ac.signal);

// Cancel after 500ms
setTimeout(() => ac.abort(), 500);

try {
  await promise;
} catch (err) {
  console.log("Aborted!"); // Will be called
}
```

### Concurrent Streams

```typescript
import { Stream, Concurrent } from "./concurrency";

const streamA: Stream<number> = async function* ({ signal }) {
  yield 1;
  await Task.sleep(50)({ signal });
  yield 2;
};

const streamB: Stream<number> = async function* ({ signal }) {
  yield 10;
  await Task.sleep(30)({ signal });
  yield 20;
};

// Process both streams concurrently
const sumTask = Concurrent.reduceStreams(
  [streamA, streamB],
  0,
  (sum, value) => sum + value
);

const total = await Runtime.run(sumTask); // 33
```

## API Reference

### Task Constructors

#### `Task.succeed<T>(value: T): Task<T>`
Create a task that immediately succeeds with a value.

#### `Task.fail<E>(error: E): Task<never>`
Create a task that immediately fails with an error.

#### `Task.of<T>(fn: (ctx: RunContext) => Promise<T>): Task<T>`
Create a task from an async function.

#### `Task.sleep(ms: number): Task<void>`
Create an abortable sleep task.

### Task Combinators

#### `Task.map<A, B>(task: Task<A>, fn: (a: A) => B): Task<B>`
Transform the result of a task.

```typescript
const doubled = Task.map(
  Task.succeed(5),
  (n) => n * 2
); // Task<10>
```

#### `Task.flatMap<A, B>(task: Task<A>, fn: (a: A) => Task<B>): Task<B>`
Chain dependent tasks.

```typescript
const result = Task.flatMap(
  fetchUser,
  (user) => fetchPosts(user.id)
);
```

#### `Task.catchAll<T>(task: Task<T>, onError: (e: unknown) => Task<T>): Task<T>`
Recover from errors.

```typescript
const safe = Task.catchAll(
  riskyTask,
  (error) => Task.succeed(defaultValue)
);
```

#### `Task.tap<T>(task: Task<T>, fn: (t: T) => void | Promise<void>): Task<T>`
Execute a side effect without changing the result.

```typescript
const logged = Task.tap(
  fetchUser,
  (user) => console.log("Fetched:", user)
);
```

#### `Task.ensuring<T>(task: Task<T>, cleanup: Task<void>): Task<T>`
Guarantee cleanup runs on success, failure, or abort.

```typescript
const safe = Task.ensuring(
  useResource,
  cleanupResource
);
```

### Stream Constructors

#### `Stream.of<T>(gen: Stream<T>): Stream<T>`
Create a stream from an async generator function.

#### `Stream.fromIterable<T>(values: Iterable<T>): Stream<T>`
Create a stream from an iterable.

```typescript
const numbers = Stream.fromIterable([1, 2, 3]);
```

### Stream Combinators

#### `Stream.map<A, B>(stream: Stream<A>, fn: (a: A) => B): Stream<B>`
Transform stream values.

#### `Stream.tap<T>(stream: Stream<T>, fn: (t: T) => Task<void>): Stream<T>`
Execute an effect for each element.

```typescript
const logged = Stream.tap(
  numbers,
  (n) => Task.of(async () => console.log(n))
);
```

#### `Stream.runForEach<T>(stream: Stream<T>, fn: (t: T) => Task<void>): Task<void>`
Run an effect for each element and discard results.

#### `Stream.runCollect<T>(stream: Stream<T>): Task<T[]>`
Collect all elements into an array.

#### `Stream.runFold<T, S>(stream: Stream<T>, seed: S, fn: (s: S, t: T) => S): Task<S>`
Fold stream into a single value.

```typescript
const sum = Stream.runFold(
  numbers,
  0,
  (acc, n) => acc + n
);
```

### Concurrent Combinators

#### `Concurrent.all<T>(tasks: Task<T>[]): Task<T[]>`
Run tasks in parallel, wait for all.

```typescript
const [user, posts, comments] = await Runtime.run(
  Concurrent.all([fetchUser, fetchPosts, fetchComments])
);
```

#### `Concurrent.race<T>(tasks: Task<T>[]): Task<T>`
Return the first task to complete.

```typescript
const fastest = Concurrent.race([
  fetchFromCDN,
  fetchFromOrigin
]);
```

#### `Concurrent.allSettled<T>(tasks: Task<T>[]): Task<PromiseSettledResult<T>[]>`
Return all results, including failures.

#### `Concurrent.reduceStreams<T, S>(streams: Stream<T>[], seed: S, reducer: (s: S, t: T) => S): Task<S>`
Process multiple streams concurrently with a shared reducer.

```typescript
const combined = Concurrent.reduceStreams(
  [streamA, streamB, streamC],
  { count: 0, sum: 0 },
  (state, value) => ({
    count: state.count + 1,
    sum: state.sum + value
  })
);
```

#### `Concurrent.allStreams<T>(processors: Record<string, {stream, process}>): Task<T>`
Run multiple stream processors in parallel with independent state.

### Runtime

#### `Runtime.run<T>(task: Task<T>, signal?: AbortSignal): Promise<T>`
Execute a task with optional abort signal.

#### `Runtime.runWithTimeout<T>(task: Task<T>, ms: number, signal?: AbortSignal): Promise<T>`
Execute a task with a timeout.

```typescript
try {
  const result = await Runtime.runWithTimeout(slowTask, 5000);
} catch (err) {
  console.log("Timed out!");
}
```

#### `Runtime.runAbortable<T>(task: Task<T>): {result: Promise<T>, abort: Function}`
Get an abort handle for manual cancellation.

```typescript
const { result, abort } = Runtime.runAbortable(longTask);

// Cancel later
setTimeout(() => abort(), 1000);
```

### Resource Management

#### `scoped<T>(fn: (scope: Scope) => Task<T>): Task<T>`
Create a scope that automatically cleans up resources.

```typescript
const result = await Runtime.run(
  scoped((scope) => Task.of(async (ctx) => {
    const resource = await acquireResource();
    scope.add(async () => await releaseResource(resource));
    return useResource(resource);
  }))
);
```

## Migration Guide

### Before (Manual AbortSignal management)

```typescript
async function iterateBothAndContinue({ signal } = {}) {
  const { a, b } = stream({ signal });
  const inflight = new Set();
  const track = p => { inflight.add(p); p.finally(() => inflight.delete(p)); return p; };

  const stopIterators = async () => {
    try { await a.return?.(); } catch {}
    try { await b.return?.(); } catch {}
  };
  const onAbort = () => { stopIterators(); };
  signal?.addEventListener("abort", onAbort, { once: true });

  const derived = { aCount: 0, bLast: null };

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
```

### After (Using concurrency library)

```typescript
const iterateBothAndContinue: Task<DerivedResult> = Concurrent.allStreams({
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
      null,
      (_, value) => value
    ),
  },
}).then(({ a, b }) => ({ aCount: a, bLast: b }));

// Run it
const ac = new AbortController();
const result = await Runtime.run(iterateBothAndContinue, ac.signal);

// Abort anytime
setTimeout(() => ac.abort(), 120);
```

### Benefits

- ✅ No manual iterator cleanup
- ✅ No manual abort listener management
- ✅ No manual inflight tracking
- ✅ Automatic resource cleanup
- ✅ Composable and reusable
- ✅ Type-safe

## Advanced Patterns

### Retry with Exponential Backoff

```typescript
const withRetry = <T>(task: Task<T>, maxRetries: number): Task<T> =>
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

const resilientFetch = withRetry(fetchData, 3);
```

### Rate Limiting

```typescript
const rateLimit = <T>(tasks: Task<T>[], concurrency: number): Task<T[]> =>
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

const limited = rateLimit(manyTasks, 5); // Max 5 concurrent
```

### Timeout with Fallback

```typescript
const withTimeout = <T>(
  task: Task<T>,
  ms: number,
  fallback: Task<T>
): Task<T> =>
  Task.catchAll(
    Task.of((ctx) => Runtime.runWithTimeout(task, ms, ctx.signal)),
    () => fallback
  );

const result = withTimeout(
  fetchFromAPI,
  5000,
  Task.succeed(cachedValue)
);
```

### Multiple Abort Sources

```typescript
const multiAbortTask = Task.of(async (ctx) => {
  const userAbort = new AbortController();
  const timeoutAbort = new AbortController();

  // User cancels
  document.getElementById("cancel")?.addEventListener("click", () =>
    userAbort.abort()
  );

  // Timeout
  setTimeout(() => timeoutAbort.abort(), 30000);

  // Combine with parent signal
  const combined = combineSignals([
    ctx.signal,
    userAbort.signal,
    timeoutAbort.signal
  ].filter(Boolean));

  return someTask({ signal: combined });
});
```

## Comparison with Effect.ts

| Feature | This Library | Effect.ts |
|---------|-------------|-----------|
| Size | ~300 LOC | Large framework |
| Dependencies | Zero | Many |
| Learning Curve | Gentle | Steep |
| AbortSignal | Native | Custom |
| Streams | AsyncGenerator | Custom |
| Fibers | No | Yes |
| Layers/Services | No | Yes |
| Best For | Simple to moderate concurrency | Complex effect systems |

## When to Use

**Use this library when:**
- You need lightweight, abortable async operations
- You want Effect.ts-style composability without the complexity
- You're working with AbortController/AbortSignal
- You need to port existing async/await code gradually

**Use Effect.ts when:**
- You need a full effect system with dependency injection
- You want advanced features like fibers and layers
- You're building a large, complex application
- You can invest in the learning curve

## License

MIT
