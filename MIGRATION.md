# Migration Guide: From Manual to Concurrency Library

This guide shows how to migrate from manual AbortSignal management to the elegant concurrency API.

## Table of Contents

1. [Basic Sleep](#basic-sleep)
2. [Async Generators → Streams](#async-generators--streams)
3. [Processing Functions → Tasks](#processing-functions--tasks)
4. [Concurrent Iteration](#concurrent-iteration)
5. [Full Example Comparison](#full-example-comparison)

---

## Basic Sleep

### Before

```typescript
function sleep(ms, signal) {
  return new Promise((res, rej) => {
    if (signal?.aborted) return rej(new DOMException("Aborted", "AbortError"));
    const id = setTimeout(res, ms);
    const onAbort = () => {
      clearTimeout(id);
      rej(new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

await sleep(1000, signal);
```

### After

```typescript
import { Task, Runtime } from "./concurrency";

const sleepTask = Task.sleep(1000);
await Runtime.run(sleepTask, signal);
```

**Benefits:**
- No manual timeout cleanup
- No manual abort listener
- Reusable task

---

## Async Generators → Streams

### Before

```typescript
async function* streamA({ signal } = {}) {
  yield "A: start";
  await sleep(50, signal);
  yield "A: chunk 1";
  await sleep(80, signal);
  yield "A: chunk 2";
}

// Usage
const iterator = streamA({ signal });
try {
  for await (const value of iterator) {
    console.log(value);
  }
} finally {
  await iterator.return?.().catch(() => {});
}
```

### After

```typescript
import { Stream, Task } from "./concurrency";

const streamA: Stream<string> = async function* ({ signal }) {
  yield "A: start";
  await Task.sleep(50)({ signal });
  yield "A: chunk 1";
  await Task.sleep(80)({ signal });
  yield "A: chunk 2";
};

// Usage - automatic cleanup!
await Runtime.run(
  Stream.runForEach(streamA, (value) =>
    Task.of(async () => console.log(value))
  ),
  signal
);
```

**Benefits:**
- Automatic iterator cleanup
- No try/finally needed
- Composable with other streams

---

## Processing Functions → Tasks

### Before

```typescript
async function doSomethingA(v, signal) {
  console.log(v);
  await sleep(20, signal);
}

// Usage
await doSomethingA("hello", signal);
```

### After

```typescript
const processA = (value: string): Task<void> =>
  Task.of(async ({ signal }) => {
    console.log(value);
    await Task.sleep(20)({ signal });
  });

// Usage
await Runtime.run(processA("hello"), signal);
```

**Benefits:**
- Curried for easier composition
- First-class values (can pass around)
- Consistent with other Tasks

---

## Concurrent Iteration

### Before: Manual Tracking

```typescript
async function iterateBothAndContinue({ signal } = {}) {
  const { a, b } = stream({ signal });

  // Manual inflight tracking
  const inflight = new Set();
  const track = p => {
    inflight.add(p);
    p.finally(() => inflight.delete(p));
    return p;
  };

  // Manual iterator cleanup
  const stopIterators = async () => {
    try { await a.return?.(); } catch {}
    try { await b.return?.(); } catch {}
  };

  // Manual abort listener
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

### After: Declarative Composition

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
      null as string | null,
      (_, value) => value
    ),
  },
}).then(({ a, b }) => ({ aCount: a, bLast: b }));
```

**Benefits:**
- ❌ No manual `inflight` tracking → ✅ Handled internally
- ❌ No manual `stopIterators` → ✅ Automatic cleanup
- ❌ No manual abort listeners → ✅ Built-in propagation
- ❌ No try/finally blocks → ✅ Resource-safe by default
- ❌ Imperative loops → ✅ Declarative combinators
- 📉 ~50 lines → 📈 ~15 lines

---

## Alternative Approaches

The library offers multiple ways to solve the same problem, choose based on your needs:

### Approach 1: Simple Reduction (Most Concise)

**When to use:** Simple state aggregation across streams

```typescript
const result = Concurrent.reduceStreams(
  [streamA, streamB],
  { aCount: 0, bLast: null },
  (state, value) => {
    if (value.startsWith("A:")) {
      return { ...state, aCount: state.aCount + 1 };
    } else {
      return { ...state, bLast: value };
    }
  }
);
```

### Approach 2: Separate Processors (Most Flexible)

**When to use:** Each stream needs different processing logic

```typescript
const result = Concurrent.allStreams({
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
```

### Approach 3: Manual Composition (Most Control)

**When to use:** You need precise control over state mutations

```typescript
const result = Task.of(async (ctx) => {
  const derived = { aCount: 0, bLast: null };

  const processStreamA = Stream.runForEach(streamA, (value) =>
    Task.tap(processA(value), () => {
      derived.aCount++;
    })
  );

  const processStreamB = Stream.runForEach(streamB, (value) =>
    Task.tap(processB(value), () => {
      derived.bLast = value;
    })
  );

  await Concurrent.allSettled([processStreamA, processStreamB])(ctx);
  return derived;
});
```

### Approach 4: Scoped Resources (Most Safe)

**When to use:** Complex resource management with multiple cleanup steps

```typescript
const result = scoped((scope) =>
  Task.of(async (ctx) => {
    const iteratorA = streamA(ctx);
    const iteratorB = streamB(ctx);

    // Register cleanup
    scope.add(async () => {
      await iteratorA.return?.().catch(() => {});
      await iteratorB.return?.().catch(() => {});
    });

    const derived = { aCount: 0, bLast: null };

    // ... process streams ...

    return derived;
  })
);
```

---

## Common Patterns

### Pattern: Retry with Backoff

#### Before

```typescript
async function withRetry(fn, maxRetries, signal) {
  let lastError;
  for (let i = 0; i <= maxRetries; i++) {
    try {
      return await fn(signal);
    } catch (err) {
      lastError = err;
      if (i < maxRetries) {
        await sleep(Math.pow(2, i) * 100, signal);
      }
    }
  }
  throw lastError;
}
```

#### After

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

const resilient = withRetry(fetchData, 3);
```

### Pattern: Timeout

#### Before

```typescript
async function withTimeout(fn, ms, signal) {
  const ac = new AbortController();
  const timeoutId = setTimeout(() => ac.abort(), ms);

  // Combine signals manually...
  const combined = /* complex signal combination */;

  try {
    return await fn(combined);
  } finally {
    clearTimeout(timeoutId);
  }
}
```

#### After

```typescript
const result = await Runtime.runWithTimeout(task, 5000, signal);
```

### Pattern: Multiple Abort Sources

#### Before

```typescript
async function multiAbort(fn) {
  const userAC = new AbortController();
  const timeoutAC = new AbortController();
  const parentSignal = /* from somewhere */;

  // Manual signal combination
  const combined = new AbortController();
  const cleanup = [];

  if (parentSignal) {
    const handler = () => combined.abort(parentSignal.reason);
    parentSignal.addEventListener("abort", handler);
    cleanup.push(() => parentSignal.removeEventListener("abort", handler));
  }

  const userHandler = () => combined.abort(userAC.signal.reason);
  userAC.signal.addEventListener("abort", userHandler);
  cleanup.push(() => userAC.signal.removeEventListener("abort", userHandler));

  // ... similar for timeout ...

  try {
    return await fn(combined.signal);
  } finally {
    cleanup.forEach(c => c());
  }
}
```

#### After

```typescript
const multiAbort = Task.of(async (ctx) => {
  const userAC = new AbortController();
  const timeoutAC = new AbortController();

  const signals = [ctx.signal, userAC.signal, timeoutAC.signal]
    .filter(Boolean) as AbortSignal[];

  const combined = combineSignals(signals);

  return someTask({ signal: combined });
});
```

---

## Migration Checklist

When migrating code to use the concurrency library:

- [ ] Replace `sleep(ms, signal)` with `Task.sleep(ms)`
- [ ] Convert async generators to `Stream<T>` type
- [ ] Wrap processing functions in `Task.of()` or make them return `Task<T>`
- [ ] Replace manual `for await` loops with `Stream.runForEach` or `Stream.runFold`
- [ ] Replace `Promise.all()` with `Concurrent.all()`
- [ ] Replace `Promise.race()` with `Concurrent.race()`
- [ ] Remove manual abort listener setup/cleanup
- [ ] Remove manual iterator cleanup (try/finally with `return?.()`)
- [ ] Remove manual inflight task tracking
- [ ] Use `scoped()` for complex resource management
- [ ] Replace manual signal combination with `combineSignals()`
- [ ] Use `Runtime.run()` to execute tasks

---

## Testing

### Before

```typescript
test("should abort correctly", async () => {
  const ac = new AbortController();
  const promise = iterateBothAndContinue({ signal: ac.signal });

  setTimeout(() => ac.abort(), 100);

  await expect(promise).rejects.toThrow("Aborted");
});
```

### After

```typescript
test("should abort correctly", async () => {
  const ac = new AbortController();
  const promise = Runtime.run(iterateBothAndContinue, ac.signal);

  setTimeout(() => ac.abort(), 100);

  await expect(promise).rejects.toThrow("Aborted");
});
```

Same pattern, cleaner implementation!

---

## Performance Considerations

The library adds minimal overhead:

- **Task creation**: ~no overhead (just function wrapper)
- **Stream processing**: Same as native async generators
- **Cleanup**: Slightly better (guaranteed cleanup vs manual)
- **Memory**: Less (no manual tracking Sets)

The main benefit is **correctness** and **maintainability**, not performance.

---

## Next Steps

1. Start with simple use cases (single tasks, basic streams)
2. Learn the core combinators (`map`, `flatMap`, `tap`)
3. Gradually migrate concurrent code to `Concurrent.*`
4. Use `scoped()` for complex resource management
5. Build custom combinators for your domain

Happy migrating! 🚀
