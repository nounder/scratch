# Quick Start Guide

Get started with Effect-Lite in 5 minutes.

## Installation

```bash
# Copy effect-lite.ts into your project
cp effect-lite.ts your-project/src/

# Or install as dependency (if published)
npm install effect-lite
```

## Basic Usage

### 1. Create Your First Effect

```typescript
import * as E from './effect-lite';

// Simple value
const hello = E.succeed("Hello, World!");

// Run it
const result = await E.runPromise(hello);
console.log(result); // "Hello, World!"
```

### 2. Async Operations

```typescript
// Sleep for 1 second
const delayed = E.sleep(1000);

// Combine operations
const program = E.flatMap(
  E.sleep(1000),
  () => E.succeed("Done!")
);

await E.runPromise(program); // Waits 1s, returns "Done!"
```

### 3. Error Handling

```typescript
const risky = E.promise<string, Error>(async () => {
  if (Math.random() > 0.5) {
    throw new Error("Failed!");
  }
  return "Success!";
});

const safe = E.catchAll(risky, (error) =>
  E.succeed("Fallback value")
);

const result = await E.runPromise(safe);
// Always succeeds, either with "Success!" or "Fallback value"
```

### 4. Concurrent Operations

```typescript
const task1 = E.flatMap(E.sleep(100), () => E.succeed(1));
const task2 = E.flatMap(E.sleep(200), () => E.succeed(2));
const task3 = E.flatMap(E.sleep(150), () => E.succeed(3));

// Run all in parallel
const results = await E.runPromise(
  E.all([task1, task2, task3])
);
console.log(results); // [1, 2, 3]
```

### 5. Resource Management

```typescript
const program = E.scoped((scope) =>
  E.promise(async (signal) => {
    // Register cleanup
    scope.addFinalizer(() => console.log("Cleanup!"));

    // Fork concurrent work
    const fiber1 = scope.fork(task1);
    const fiber2 = scope.fork(task2);

    // Wait for completion
    const results = await Promise.all([
      fiber1.await(),
      fiber2.await(),
    ]);

    return results;
    // Cleanup runs automatically!
  })
);
```

### 6. Cancellation

```typescript
const controller = new AbortController();

// Long-running task
const longTask = E.flatMap(
  E.sleep(10000),
  () => E.succeed("Finally done!")
);

// Run with ability to cancel
const fiber = E.runFork(longTask, controller.signal);

// Cancel after 1 second
setTimeout(() => controller.abort(), 1000);

try {
  await fiber.await();
} catch (err) {
  console.log("Cancelled!"); // Will be called
}
```

## Common Patterns

### Pattern: Retry with Backoff

```typescript
const unreliable = E.promise<string, Error>(async () => {
  if (Math.random() > 0.7) throw new Error("Failed");
  return "Success";
});

const withRetry = E.retry(unreliable, {
  times: 3,
  delay: 100,
  backoff: 2
});

await E.runPromise(withRetry);
// Retries with delays: 100ms, 200ms, 400ms
```

### Pattern: Timeout

```typescript
const slow = E.sleep(10000);

const withTimeout = E.timeout(slow, 1000);

try {
  await E.runPromise(withTimeout);
} catch (err) {
  console.log("Timed out!"); // Called after 1s
}
```

### Pattern: Process Async Iterator

```typescript
async function* numbers() {
  yield 1;
  yield 2;
  yield 3;
}

const sum = E.promise(async (signal) => {
  let total = 0;
  await E.forEach(numbers(), (n) =>
    E.sync(() => total += n)
  ).run(signal);
  return total;
});

const result = await E.runPromise(sum); // 6
```

### Pattern: Race Multiple Tasks

```typescript
const api1 = E.flatMap(E.sleep(100), () => E.succeed("API 1"));
const api2 = E.flatMap(E.sleep(200), () => E.succeed("API 2"));

const fastest = E.race([api1, api2]);

const result = await E.runPromise(fastest);
console.log(result); // "API 1" (faster)
```

### Pattern: Map with Concurrency Limit

```typescript
import { mapConcurrent } from './examples-advanced';

const urls = [
  'https://api.example.com/1',
  'https://api.example.com/2',
  // ... 100 URLs
];

// Process max 5 at a time
const results = await E.runPromise(
  mapConcurrent(urls, 5, (url) =>
    E.promise(async (signal) => {
      const res = await fetch(url, { signal });
      return res.json();
    })
  )
);
```

## Converting Existing Code

### Before (Promise-based)

```typescript
async function processData(signal?: AbortSignal) {
  const data = await fetchData(signal);
  await sleep(1000, signal);
  return transform(data);
}

// Manual tracking for concurrency
const results = await Promise.all([
  processData(signal),
  processOther(signal),
]);
```

### After (Effect-based)

```typescript
const processData = E.promise(async (signal) => {
  const data = await fetchData(signal);
  await E.sleep(1000).run(signal);
  return transform(data);
});

const program = E.scoped((scope) =>
  E.promise(async (signal) => {
    const fiber1 = scope.fork(processData);
    const fiber2 = scope.fork(processOther);
    return await Promise.all([
      fiber1.await(),
      fiber2.await(),
    ]);
  })
);
```

## Tips

1. **Start with `promise`**: Wrap existing async functions
   ```typescript
   const myEffect = E.promise(async (signal) => {
     // Your existing async code
   });
   ```

2. **Use `scoped` for concurrency**: Let it handle cleanup
   ```typescript
   E.scoped((scope) => {
     const fiber = scope.fork(effect);
     // scope handles interruption automatically
   });
   ```

3. **Compose with combinators**: Build complex flows
   ```typescript
   E.flatMap(step1, (a) =>
     E.flatMap(step2(a), (b) =>
       E.succeed(b + 1)
     )
   );
   ```

4. **Always propagate signal**: Pass it to blocking operations
   ```typescript
   E.promise(async (signal) => {
     await fetch(url, { signal }); // ✅ Good
   });
   ```

5. **Use finalizers for cleanup**: Guaranteed to run
   ```typescript
   scope.addFinalizer(() => {
     // Cleanup code here
   });
   ```

## Next Steps

- 📖 Read the [full README](README.md)
- 🎯 See [advanced examples](examples-advanced.ts)
- 🚀 Run the [demo](demo.js): `node demo.js`
- 💡 Check the [comparison](SUMMARY.md)

## Need Help?

Common issues:

**Q: Effect doesn't run**
```typescript
// ❌ Wrong - creates Effect but doesn't run it
const effect = E.succeed(42);

// ✅ Right - runs the Effect
const result = await E.runPromise(effect);
```

**Q: How to handle errors?**
```typescript
// Use catchAll
const safe = E.catchAll(risky, (err) =>
  E.succeed(fallbackValue)
);
```

**Q: How to cancel?**
```typescript
// Pass AbortSignal to runPromise or runFork
const controller = new AbortController();
const fiber = E.runFork(effect, controller.signal);

// Later...
controller.abort();
```

**Q: Cleanup not running?**
```typescript
// Make sure you're using scoped
E.scoped((scope) => {
  scope.addFinalizer(() => console.log("Runs!"));
  // ...
});
```

Happy coding with Effect-Lite! 🚀
