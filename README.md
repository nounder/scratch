# Effect-Lite: Elegant Concurrency for TypeScript

A lightweight, Effect.ts-inspired concurrency API that makes async operations composable, cancellable, and resource-safe.

## Why Effect-Lite?

**Problem**: JavaScript's async primitives (Promises, async/await) make concurrency hard:
- Manual resource cleanup
- AbortSignal boilerplate everywhere
- Tracking in-flight operations
- Race conditions during cancellation
- No built-in resource management

**Solution**: Effect-Lite provides:
- ✅ Automatic AbortSignal propagation
- ✅ Built-in resource management
- ✅ Composable operations
- ✅ Type-safe error handling
- ✅ Structured concurrency with Scopes and Fibers
- ✅ Lightweight (~300 LOC, zero dependencies)

## Quick Comparison

### Before (Raw Promises + AbortSignal):

```typescript
async function iterateBothAndContinue({ signal } = {}) {
  const { a, b } = stream({ signal });
  const inflight = new Set();
  const track = p => {
    inflight.add(p);
    p.finally(() => inflight.delete(p));
    return p;
  };

  const stopIterators = async () => {
    try { await a.return?.(); } catch {}
    try { await b.return?.(); } catch {}
  };

  const onAbort = () => { stopIterators(); };
  signal?.addEventListener("abort", onAbort, { once: true });

  // ... 50+ lines of manual cleanup logic
}
```

### After (Effect-Lite):

```typescript
const iterateBothAndContinue = E.scoped((scope) =>
  E.promise(async (signal) => {
    const { a, b } = stream({ signal });

    const fiberA = scope.fork(processStreamA(a));
    const fiberB = scope.fork(processStreamB(b));

    return await Promise.all([
      fiberA.await(),
      fiberB.await(),
    ]);
  })
);
```

**Scope automatically handles**:
- Aborting fibers on cancellation
- Closing async iterators
- Waiting for in-flight operations
- Running cleanup finalizers

## Core Concepts

### 1. Effect

An `Effect<A, E>` represents an async computation that:
- Succeeds with value `A`
- Fails with error `E`
- Respects `AbortSignal` for cancellation
- Can be composed with other Effects

```typescript
// Create Effects
const value = E.succeed(42);
const error = E.fail(new Error('oops'));
const delayed = E.sleep(1000);

// Compose Effects
const program = E.flatMap(
  E.sleep(100),
  () => E.succeed('Hello!')
);

// Run Effects
await E.runPromise(program);
```

### 2. Scope

A `Scope` manages the lifecycle of concurrent operations:

```typescript
const program = E.scoped((scope) =>
  E.promise(async (signal) => {
    // Fork concurrent operations
    const fiber1 = scope.fork(task1);
    const fiber2 = scope.fork(task2);

    // Register cleanup
    scope.addFinalizer(() => console.log('Cleanup!'));

    // Scope ensures:
    // - Fibers are interrupted on abort
    // - Finalizers run on completion/error/abort
    // - Resources are cleaned up properly

    return await fiber1.await();
  })
);
```

### 3. Fiber

A `Fiber` represents a running Effect:

```typescript
const fiber = E.runFork(longTask);

// Wait for completion
const result = await fiber.await();

// Or interrupt early
await fiber.interrupt();
```

## API Reference

### Constructors

```typescript
// Values
E.succeed(42)                    // Effect<number, never>
E.fail(new Error('oops'))        // Effect<never, Error>
E.sync(() => 1 + 1)              // Effect<number, never>

// Promises
E.promise(async (signal) => {    // Effect<string, Error>
  return 'hello';
})

// Time
E.sleep(1000)                    // Effect<void, Error>
E.never()                        // Effect<never, never>
```

### Combinators

```typescript
// Transform
E.map(effect, x => x * 2)
E.flatMap(effect, x => E.succeed(x + 1))
E.tap(effect, x => console.log(x))

// Error handling
E.catchAll(effect, err => E.succeed('fallback'))
E.ensuring(effect, cleanup)

// Time
E.timeout(effect, 1000)
E.delay(effect, 500)
E.retry(effect, { times: 3, delay: 100 })
```

### Concurrency

```typescript
// Parallel execution
E.all([effect1, effect2, effect3])
E.allSettled([effect1, effect2])
E.race([effect1, effect2])

// Structured concurrency
E.scoped((scope) => {
  const fiber = scope.fork(effect);
  return fiber.await();
})
```

### Async Iterators

```typescript
// Process each item
E.forEach(asyncIterator, (item, signal) =>
  E.log(item)
)

// Collect all
E.collectAll(asyncIterator)
```

### Runtime

```typescript
// Run and get Promise
await E.runPromise(effect, signal);

// Run and get Fiber
const fiber = E.runFork(effect, signal);
```

## Common Patterns

### Rate-Limited Concurrency

```typescript
function mapConcurrent<T, A>(
  items: T[],
  concurrency: number,
  f: (item: T) => E.Effect<A, Error>
): E.Effect<A[], Error>
```

### Circuit Breaker

```typescript
const breaker = new CircuitBreaker(3, 5000);
const protected = breaker.execute(unreliableAPI);
```

### Supervision (Auto-Restart)

```typescript
const supervised = supervise(flaky, {
  maxRestarts: 5,
  restartDelay: 1000
});
```

### Pipeline Processing

```typescript
const result = pipeline(
  items,
  stage1,
  stage2,
  stage3
);
```

See `examples-advanced.ts` for more patterns!

## Design Principles

1. **Lightweight**: ~300 LOC, zero dependencies
2. **Composable**: Effects are pure values until run
3. **Resource-safe**: Scopes ensure cleanup
4. **Cancellation-aware**: AbortSignal flows automatically
5. **Type-safe**: Full TypeScript support
6. **Practical**: Designed for real-world use

## Comparison with Effect.ts

| Feature | Effect-Lite | Effect.ts |
|---------|-------------|-----------|
| Size | ~300 LOC | Large framework |
| Dependencies | 0 | Many |
| Learning curve | Low | Steep |
| Features | Essential | Comprehensive |
| Cancellation | AbortSignal | Built-in |
| Ecosystem | Standalone | Rich |

**Use Effect-Lite when**:
- You want lightweight concurrency primitives
- You're building libraries (minimal dependencies)
- You need easy migration from Promise-based code
- You want to learn Effect.ts patterns gradually

**Use Effect.ts when**:
- You need the full ecosystem (Schema, Streaming, etc.)
- You're building large applications
- You want advanced features (Layers, Services, etc.)

## Migration Guide

### From Promises

```typescript
// Before
async function fetchUser(id: string, signal?: AbortSignal) {
  const response = await fetch(`/users/${id}`, { signal });
  return response.json();
}

// After
const fetchUser = (id: string) =>
  E.promise(async (signal) => {
    const response = await fetch(`/users/${id}`, { signal });
    return response.json();
  });
```

### From Manual AbortSignal Tracking

```typescript
// Before: 50+ lines of tracking, cleanup, listeners

// After
E.scoped((scope) =>
  E.promise(async (signal) => {
    const fiber1 = scope.fork(task1);
    const fiber2 = scope.fork(task2);
    return await Promise.all([fiber1.await(), fiber2.await()]);
  })
);
```

## Best Practices

1. **Use `scoped` for concurrent operations**: Ensures cleanup
2. **Prefer combinators over manual promise chaining**: More composable
3. **Add finalizers for resources**: Always clean up
4. **Use `forEach` for async iterators**: Handles cleanup automatically
5. **Propagate signal to blocking operations**: Enable cancellation
6. **Keep Effects pure**: Side effects only in `promise` or `sync`

## Examples

See:
- `example-ported.ts` - Original example ported to Effect-Lite
- `examples-advanced.ts` - Advanced patterns and use cases

## License

MIT
