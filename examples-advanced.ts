/**
 * Advanced Examples: Common Concurrency Patterns with Effect-Lite
 */

import * as E from './effect-lite';

// ============================================================================
// Pattern 1: Rate-Limited Concurrent Processing
// ============================================================================

/**
 * Process items with a maximum number of concurrent operations
 */
function mapConcurrent<T, A>(
  items: T[],
  concurrency: number,
  f: (item: T) => E.Effect<A, Error>
): E.Effect<A[], Error> {
  return E.scoped((scope) =>
    E.promise(async (signal) => {
      const results: A[] = [];
      const queue = [...items];
      const workers: Promise<void>[] = [];

      for (let i = 0; i < concurrency; i++) {
        const worker = async () => {
          while (queue.length > 0) {
            const item = queue.shift();
            if (!item) break;

            const fiber = scope.fork(f(item));
            const result = await fiber.await();
            results.push(result);
          }
        };
        workers.push(worker());
      }

      await Promise.all(workers);
      return results;
    })
  );
}

// Example usage:
const processBatch = (urls: string[]) =>
  mapConcurrent(urls, 5, (url) =>
    E.promise(async (signal) => {
      // Simulate HTTP fetch
      await E.sleep(100).run(signal);
      return `Response from ${url}`;
    })
  );

// ============================================================================
// Pattern 2: Debouncing and Throttling
// ============================================================================

/**
 * Debounce: Execute effect only after quiet period
 */
function debounce<A, E>(
  effect: E.Effect<A, E>,
  ms: number
): E.Effect<A, E> {
  return E.flatMap(E.sleep(ms), () => effect);
}

/**
 * Throttle: Execute at most once per time period
 */
function throttle<A, E>(
  effect: E.Effect<A, E>,
  ms: number
): E.Effect<A, E> {
  let lastRun = 0;
  return E.promise(async (signal) => {
    const now = Date.now();
    const timeSinceLastRun = now - lastRun;

    if (timeSinceLastRun < ms) {
      await E.sleep(ms - timeSinceLastRun).run(signal);
    }

    lastRun = Date.now();
    return effect.run(signal);
  });
}

// ============================================================================
// Pattern 3: Circuit Breaker
// ============================================================================

type CircuitState = 'closed' | 'open' | 'half-open';

class CircuitBreaker<A, E> {
  private state: CircuitState = 'closed';
  private failures = 0;
  private lastFailureTime = 0;

  constructor(
    private readonly threshold: number,
    private readonly timeout: number
  ) {}

  execute(effect: E.Effect<A, E>): E.Effect<A, E | Error> {
    return E.promise(async (signal) => {
      // Check if circuit should be reset
      if (
        this.state === 'open' &&
        Date.now() - this.lastFailureTime > this.timeout
      ) {
        this.state = 'half-open';
        this.failures = 0;
      }

      // Fail fast if circuit is open
      if (this.state === 'open') {
        throw new Error('Circuit breaker is OPEN');
      }

      try {
        const result = await effect.run(signal);

        // Success - reset on half-open
        if (this.state === 'half-open') {
          this.state = 'closed';
          this.failures = 0;
        }

        return result;
      } catch (error) {
        this.failures++;
        this.lastFailureTime = Date.now();

        // Open circuit if threshold exceeded
        if (this.failures >= this.threshold) {
          this.state = 'open';
        }

        throw error;
      }
    });
  }
}

// Example usage:
const unreliableAPI = E.promise<string, Error>(async (signal) => {
  if (Math.random() > 0.7) throw new Error('API failed');
  return 'Success';
});

const breaker = new CircuitBreaker<string, Error>(3, 5000);
const protectedAPI = breaker.execute(unreliableAPI);

// ============================================================================
// Pattern 4: Supervised Fibers (Restart on Failure)
// ============================================================================

/**
 * Run an effect and restart it if it fails
 */
function supervise<A, E>(
  effect: E.Effect<A, E>,
  options: {
    maxRestarts: number;
    restartDelay: number;
  }
): E.Effect<A, E | Error> {
  return E.scoped((scope) =>
    E.promise(async (signal) => {
      let restarts = 0;

      while (restarts <= options.maxRestarts) {
        const fiber = scope.fork(effect);

        try {
          return await fiber.await();
        } catch (error) {
          restarts++;

          if (restarts > options.maxRestarts) {
            throw new Error(
              `Effect failed after ${options.maxRestarts} restarts: ${error}`
            );
          }

          await E.sleep(options.restartDelay).run(signal);
          await E.log(
            `⚠️  Restarting failed effect (attempt ${restarts}/${options.maxRestarts})`
          ).run(signal);
        }
      }

      throw new Error('Supervision failed');
    })
  );
}

// Example usage:
const flaky = E.promise<string, Error>(async () => {
  if (Math.random() > 0.5) throw new Error('Flaky!');
  return 'Stable result';
});

const supervised = supervise(flaky, { maxRestarts: 5, restartDelay: 1000 });

// ============================================================================
// Pattern 5: Parallel Pipeline Processing
// ============================================================================

/**
 * Process items through multiple stages in parallel
 */
function pipeline<T, A, B, C>(
  items: T[],
  stage1: (item: T) => E.Effect<A, Error>,
  stage2: (item: A) => E.Effect<B, Error>,
  stage3: (item: B) => E.Effect<C, Error>
): E.Effect<C[], Error> {
  return E.scoped((scope) =>
    E.promise(async (signal) => {
      const results: C[] = [];

      // Process all items through pipeline
      const fibers = items.map((item) => {
        const pipelined = E.flatMap(stage1(item), (a) =>
          E.flatMap(stage2(a), (b) => stage3(b))
        );
        return scope.fork(pipelined);
      });

      // Collect results
      for (const fiber of fibers) {
        results.push(await fiber.await());
      }

      return results;
    })
  );
}

// Example usage:
const processData = pipeline(
  [1, 2, 3, 4, 5],
  (n) => E.succeed(n * 2),
  (n) => E.succeed(n + 1),
  (n) => E.succeed(String(n))
);

// ============================================================================
// Pattern 6: Timeout with Fallback
// ============================================================================

/**
 * Try an effect with timeout, falling back to alternative
 */
function withTimeoutFallback<A, E>(
  primary: E.Effect<A, E>,
  fallback: E.Effect<A, E>,
  ms: number
): E.Effect<A, E> {
  return E.catchAll(
    E.timeout(primary, ms),
    () => fallback
  );
}

// Example usage:
const slowAPI = E.flatMap(E.sleep(5000), () => E.succeed('slow'));
const fastCache = E.succeed('cached');
const withFallback = withTimeoutFallback(slowAPI, fastCache, 1000);

// ============================================================================
// Pattern 7: Fan-Out / Fan-In
// ============================================================================

/**
 * Send single input to multiple processors and collect results
 */
function fanOut<T, A>(
  input: T,
  processors: Array<(input: T) => E.Effect<A, Error>>
): E.Effect<A[], Error> {
  return E.all(processors.map((p) => p(input)));
}

// Example usage:
const analyzeText = (text: string) =>
  fanOut(text, [
    (t) => E.succeed(t.length),
    (t) => E.succeed(t.split(' ').length),
    (t) => E.succeed(t.split('\n').length),
  ]);

// ============================================================================
// Pattern 8: Cooperative Cancellation with Checkpoints
// ============================================================================

/**
 * Long-running computation with periodic cancellation checks
 */
function withCheckpoints<A>(
  f: (checkpoint: () => E.Effect<void, Error>) => Promise<A>
): E.Effect<A, Error> {
  return E.promise(async (signal) => {
    const checkpoint = () =>
      E.promise<void, Error>(async (sig) => {
        if (sig?.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
      });

    return f(checkpoint);
  });
}

// Example usage:
const longComputation = withCheckpoints(async (checkpoint) => {
  const results: number[] = [];

  for (let i = 0; i < 1000; i++) {
    // Perform work
    results.push(i * i);

    // Check for cancellation every 100 iterations
    if (i % 100 === 0) {
      await checkpoint().run();
    }
  }

  return results;
});

// ============================================================================
// Pattern 9: Background Jobs with Heartbeat
// ============================================================================

/**
 * Run a background job that reports progress
 */
function withHeartbeat<A, E>(
  effect: E.Effect<A, E>,
  onHeartbeat: () => void,
  intervalMs: number
): E.Effect<A, E> {
  return E.scoped((scope) =>
    E.promise(async (signal) => {
      // Start heartbeat fiber
      const heartbeat = E.promise(async (sig) => {
        while (!sig?.aborted) {
          await E.sleep(intervalMs).run(sig);
          onHeartbeat();
        }
      });

      scope.fork(heartbeat);

      // Run main effect
      return effect.run(signal);
    })
  );
}

// Example usage:
const longTask = E.flatMap(E.sleep(5000), () => E.succeed('done'));
const withProgress = withHeartbeat(
  longTask,
  () => console.log('💓 Still alive...'),
  1000
);

// ============================================================================
// Pattern 10: Batch Processing with Windows
// ============================================================================

/**
 * Process items in batches with time windows
 */
async function* batchWindow<T>(
  source: AsyncIterable<T>,
  batchSize: number,
  windowMs: number,
  signal?: AbortSignal
): AsyncGenerator<T[]> {
  let batch: T[] = [];
  let windowStart = Date.now();

  for await (const item of source) {
    if (signal?.aborted) break;

    batch.push(item);
    const now = Date.now();

    // Yield if batch is full or window elapsed
    if (batch.length >= batchSize || now - windowStart >= windowMs) {
      yield batch;
      batch = [];
      windowStart = now;
    }
  }

  // Yield remaining items
  if (batch.length > 0) {
    yield batch;
  }
}

// Export all patterns
export {
  mapConcurrent,
  debounce,
  throttle,
  CircuitBreaker,
  supervise,
  pipeline,
  withTimeoutFallback,
  fanOut,
  withCheckpoints,
  withHeartbeat,
  batchWindow,
};
