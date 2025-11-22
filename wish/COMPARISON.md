# Before & After: Raw Promises vs Wish

This document shows side-by-side comparisons of common async patterns implemented with raw Promises + AbortSignal versus Wish.

## Example 1: The Original Code

### Before: Raw Promises (80+ lines)

```typescript
async function iterateBothAndContinue({ signal } = {}) {
  const { a, b } = stream({ signal });

  // Track spawned subtasks for coordinated shutdown
  const inflight = new Set();
  const track = p => {
    inflight.add(p);
    p.finally(() => inflight.delete(p));
    return p;
  };

  // On abort: proactively close iterators
  const stopIterators = async () => {
    try { await a.return?.(); } catch {}
    try { await b.return?.(); } catch {}
  };
  const onAbort = () => { stopIterators(); };
  signal?.addEventListener('abort', onAbort, { once: true });

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
    signal?.removeEventListener('abort', onAbort);
    await stopIterators();
    await Promise.allSettled([...inflight]);
  }

  return derived;
}
```

**Issues:**
- Manual tracking of in-flight operations
- Manual iterator cleanup
- Manual event listener management
- Easy to forget cleanup steps
- Hard to reason about shutdown order
- Lots of boilerplate

### After: With Wish (20 lines)

```typescript
const iterateBothAndContinue = scoped(async (scope) => {
  const { a, b } = stream({ signal: scope.abortSignal });
  const derived = { aCount: 0, bLast: null };

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
```

**Benefits:**
- ✅ Automatic tracking via Scope
- ✅ Automatic cleanup via `forEach`
- ✅ Automatic event management
- ✅ Clear, linear code flow
- ✅ Structured concurrency guarantees
- ✅ 75% less code

---

## Example 2: Fetch with Timeout

### Before: Raw Promises

```typescript
async function fetchWithTimeout(url, ms, signal) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), ms);

  // Link parent signal
  const onParentAbort = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', onParentAbort, { once: true });

  try {
    const response = await fetch(url, { signal: controller.signal });
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onParentAbort);
    return response.json();
  } catch (error) {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onParentAbort);

    if (error.name === 'AbortError') {
      throw new Error('Timeout');
    }
    throw error;
  }
}
```

### After: With Wish

```typescript
const fetchWithTimeout = (url: string, ms: number): Wish<any> =>
  timeout(
    async (signal) => {
      const response = await fetch(url, { signal });
      return response.json();
    },
    ms
  );
```

**75% reduction in code, zero cleanup bugs.**

---

## Example 3: Parallel Operations with Cleanup

### Before: Raw Promises

```typescript
async function processMultiple(items, signal) {
  const controllers = [];
  const promises = [];

  for (const item of items) {
    const controller = new AbortController();
    controllers.push(controller);

    // Link to parent
    signal?.addEventListener('abort', () => {
      controller.abort(signal.reason);
    }, { once: true });

    promises.push(processItem(item, controller.signal));
  }

  try {
    return await Promise.all(promises);
  } finally {
    // Cleanup
    for (const controller of controllers) {
      if (!controller.signal.aborted) {
        controller.abort();
      }
    }
  }
}
```

### After: With Wish

```typescript
const processMultiple = (items: Item[]): Wish<Result[]> =>
  all(...items.map(item => processItem(item)));
```

**Single line. Automatic cleanup. No bugs.**

---

## Example 4: Resource Management

### Before: Raw Promises

```typescript
async function withConnection(fn, signal) {
  const conn = await createConnection();

  const cleanup = async () => {
    try {
      await conn.close();
    } catch (e) {
      console.error('Cleanup error:', e);
    }
  };

  if (signal?.aborted) {
    await cleanup();
    throw new AbortError();
  }

  signal?.addEventListener('abort', cleanup, { once: true });

  try {
    const result = await fn(conn, signal);
    return result;
  } finally {
    signal?.removeEventListener('abort', cleanup);
    await cleanup();
  }
}
```

### After: With Wish

```typescript
const withConnection = <A>(fn: (conn: Connection) => Wish<A>): Wish<A> =>
  acquire(
    async () => createConnection(),
    async (conn) => conn.close()
  ).then(fn);
```

**Clean, declarative, foolproof.**

---

## Example 5: Retry with Backoff

### Before: Raw Promises

```typescript
async function retryWithBackoff(fn, maxAttempts, signal) {
  let lastError;

  for (let i = 0; i < maxAttempts; i++) {
    if (signal?.aborted) {
      throw signal.reason ?? new AbortError();
    }

    try {
      return await fn(signal);
    } catch (error) {
      lastError = error;

      if (i < maxAttempts - 1) {
        const delay = Math.min(1000, 100 * Math.pow(2, i));

        await new Promise((resolve, reject) => {
          const timeout = setTimeout(resolve, delay);

          const onAbort = () => {
            clearTimeout(timeout);
            reject(signal.reason ?? new AbortError());
          };

          signal?.addEventListener('abort', onAbort, { once: true });
        });
      }
    }
  }

  throw lastError;
}
```

### After: With Wish

```typescript
const retryWithBackoff = <A>(wish: Wish<A>, maxAttempts: number): Wish<A> =>
  async (signal) => {
    let lastError: Error | undefined;

    for (let i = 0; i < maxAttempts; i++) {
      try {
        return await wish(signal);
      } catch (error) {
        lastError = error as Error;
        if (i < maxAttempts - 1) {
          const delay = Math.min(1000, 100 * Math.pow(2, i));
          await sleep(delay)(signal);
        }
      }
    }

    throw lastError;
  };
```

**Same logic, but sleep handles all the signal complexity.**

---

## Key Takeaways

| Aspect | Raw Promises | Wish |
|--------|-------------|------|
| **Lines of Code** | 100% | ~25% |
| **Cleanup Bugs** | Easy to introduce | Impossible |
| **Signal Threading** | Manual, error-prone | Automatic |
| **Resource Leaks** | Common | Prevented by design |
| **Readability** | Complex, imperative | Simple, declarative |
| **Composability** | Hard | Natural |
| **Learning Curve** | Steep for correct usage | Gentle |

## Why This Matters

The complexity of raw Promise + AbortSignal code isn't just aesthetic:

1. **Bugs are expensive** - Every manual cleanup is a potential leak
2. **Cognitive load** - Complex code is hard to review and maintain
3. **Velocity** - Simple code ships faster
4. **Confidence** - Structured concurrency gives guarantees

**Wish makes the right thing easy and the wrong thing hard.**

---

*"We don't need more complexity. We need better abstractions."*
