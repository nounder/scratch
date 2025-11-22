/**
 * Effect-Lite: A lightweight, elegant concurrency API inspired by Effect.ts
 *
 * Core principles:
 * - AbortSignal-based cancellation
 * - Automatic resource cleanup
 * - Composable operations
 * - Type-safe error handling
 */

// ============================================================================
// Core Types
// ============================================================================

/**
 * An Effect represents an async computation that:
 * - Can succeed with value A
 * - Can fail with error E
 * - Respects AbortSignal for cancellation
 * - Automatically manages resources
 */
export type Effect<A, E = Error> = {
  readonly _tag: 'Effect';
  run(signal?: AbortSignal): Promise<A>;
};

/**
 * A Fiber represents a running Effect that can be awaited or interrupted
 */
export interface Fiber<A, E = Error> {
  readonly signal: AbortSignal;
  await(): Promise<A>;
  interrupt(): Promise<void>;
}

/**
 * A Scope manages the lifecycle of resources and fibers
 */
export interface Scope {
  readonly signal: AbortSignal;
  fork<A, E>(effect: Effect<A, E>): Fiber<A, E>;
  addFinalizer(finalizer: () => Promise<void> | void): void;
  close(): Promise<void>;
}

// ============================================================================
// Core Constructors
// ============================================================================

/**
 * Create an Effect that succeeds with a value
 */
export const succeed = <A>(value: A): Effect<A, never> => ({
  _tag: 'Effect',
  run: async () => value,
});

/**
 * Create an Effect that fails with an error
 */
export const fail = <E>(error: E): Effect<never, E> => ({
  _tag: 'Effect',
  run: async () => {
    throw error;
  },
});

/**
 * Create an Effect from a thunk (lazy evaluation)
 */
export const sync = <A>(thunk: () => A): Effect<A, never> => ({
  _tag: 'Effect',
  run: async () => thunk(),
});

/**
 * Create an Effect from an async function
 */
export const promise = <A>(
  thunk: (signal?: AbortSignal) => Promise<A>
): Effect<A, Error> => ({
  _tag: 'Effect',
  run: async (signal) => thunk(signal),
});

/**
 * Create an Effect that sleeps for a duration
 */
export const sleep = (ms: number): Effect<void, Error> => ({
  _tag: 'Effect',
  run: async (signal) => {
    if (signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    return new Promise((resolve, reject) => {
      const id = setTimeout(resolve, ms);
      const onAbort = () => {
        clearTimeout(id);
        reject(new DOMException('Aborted', 'AbortError'));
      };
      signal?.addEventListener('abort', onAbort, { once: true });
    });
  },
});

/**
 * Create an Effect that never completes
 */
export const never = (): Effect<never, never> => ({
  _tag: 'Effect',
  run: async (signal) => {
    return new Promise((_, reject) => {
      signal?.addEventListener('abort', () => {
        reject(new DOMException('Aborted', 'AbortError'));
      });
    });
  },
});

// ============================================================================
// Combinators
// ============================================================================

/**
 * Transform the success value of an Effect
 */
export const map = <A, B, E>(
  effect: Effect<A, E>,
  f: (a: A) => B
): Effect<B, E> => ({
  _tag: 'Effect',
  run: async (signal) => {
    const a = await effect.run(signal);
    return f(a);
  },
});

/**
 * Chain Effects together (flatMap/bind)
 */
export const flatMap = <A, B, E1, E2>(
  effect: Effect<A, E1>,
  f: (a: A) => Effect<B, E2>
): Effect<B, E1 | E2> => ({
  _tag: 'Effect',
  run: async (signal) => {
    const a = await effect.run(signal);
    return f(a).run(signal);
  },
});

/**
 * Tap into the success value without changing it (useful for side effects)
 */
export const tap = <A, E>(
  effect: Effect<A, E>,
  f: (a: A) => Effect<any, any> | void
): Effect<A, E> => ({
  _tag: 'Effect',
  run: async (signal) => {
    const a = await effect.run(signal);
    const result = f(a);
    if (result && typeof result === 'object' && '_tag' in result) {
      await (result as Effect<any, any>).run(signal);
    }
    return a;
  },
});

/**
 * Catch and recover from errors
 */
export const catchAll = <A, E1, E2>(
  effect: Effect<A, E1>,
  handler: (error: E1) => Effect<A, E2>
): Effect<A, E2> => ({
  _tag: 'Effect',
  run: async (signal) => {
    try {
      return await effect.run(signal);
    } catch (error) {
      return handler(error as E1).run(signal);
    }
  },
});

/**
 * Ensure cleanup runs regardless of success or failure
 */
export const ensuring = <A, E>(
  effect: Effect<A, E>,
  finalizer: Effect<any, any>
): Effect<A, E> => ({
  _tag: 'Effect',
  run: async (signal) => {
    try {
      return await effect.run(signal);
    } finally {
      await finalizer.run(signal).catch(() => {});
    }
  },
});

// ============================================================================
// Concurrency Primitives
// ============================================================================

/**
 * Run multiple Effects in parallel and wait for all to complete
 */
export const all = <Effects extends ReadonlyArray<Effect<any, any>>>(
  effects: Effects
): Effect<
  { [K in keyof Effects]: Effects[K] extends Effect<infer A, any> ? A : never },
  Effects[number] extends Effect<any, infer E> ? E : never
> => ({
  _tag: 'Effect',
  run: async (signal) => {
    const results = await Promise.all(effects.map((e) => e.run(signal)));
    return results as any;
  },
});

/**
 * Run multiple Effects in parallel and wait for all to settle
 */
export const allSettled = <A, E>(
  effects: ReadonlyArray<Effect<A, E>>
): Effect<ReadonlyArray<PromiseSettledResult<A>>, never> => ({
  _tag: 'Effect',
  run: async (signal) => {
    const promises = effects.map((e) => e.run(signal));
    return Promise.allSettled(promises);
  },
});

/**
 * Race multiple Effects and return the first to complete
 */
export const race = <A, E>(
  effects: ReadonlyArray<Effect<A, E>>
): Effect<A, E> => ({
  _tag: 'Effect',
  run: async (signal) => {
    return Promise.race(effects.map((e) => e.run(signal)));
  },
});

/**
 * Run an Effect with a timeout
 */
export const timeout = <A, E>(
  effect: Effect<A, E>,
  ms: number
): Effect<A, E | Error> => ({
  _tag: 'Effect',
  run: async (signal) => {
    return Promise.race([
      effect.run(signal),
      sleep(ms).run(signal).then(() => {
        throw new Error(`Timeout after ${ms}ms`);
      }),
    ]);
  },
});

// ============================================================================
// Async Iterators / Streams
// ============================================================================

/**
 * Convert an async generator into an Effect that processes each item
 */
export const forEach = <T, A, E>(
  iterator: AsyncIterable<T>,
  f: (item: T, signal?: AbortSignal) => Effect<A, E> | Promise<A>
): Effect<void, E> => ({
  _tag: 'Effect',
  run: async (signal) => {
    try {
      for await (const item of iterator) {
        if (signal?.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        const result = f(item, signal);
        if (result && typeof result === 'object' && '_tag' in result) {
          await (result as Effect<A, E>).run(signal);
        } else {
          await result;
        }
      }
    } finally {
      // Ensure iterator is properly closed
      if ('return' in iterator && typeof iterator.return === 'function') {
        await iterator.return().catch(() => {});
      }
    }
  },
});

/**
 * Collect all values from an async iterator into an array
 */
export const collectAll = <T>(
  iterator: AsyncIterable<T>
): Effect<T[], Error> => ({
  _tag: 'Effect',
  run: async (signal) => {
    const results: T[] = [];
    try {
      for await (const item of iterator) {
        if (signal?.aborted) {
          throw new DOMException('Aborted', 'AbortError');
        }
        results.push(item);
      }
      return results;
    } finally {
      if ('return' in iterator && typeof iterator.return === 'function') {
        await iterator.return().catch(() => {});
      }
    }
  },
});

// ============================================================================
// Scope & Resource Management
// ============================================================================

/**
 * Create a new Scope for managing concurrent operations and resources
 */
export const createScope = (parentSignal?: AbortSignal): Scope => {
  const controller = new AbortController();
  const fibers = new Set<Fiber<any, any>>();
  const finalizers: Array<() => Promise<void> | void> = [];
  let closed = false;

  // If parent is aborted, abort this scope
  parentSignal?.addEventListener('abort', () => controller.abort());

  const scope: Scope = {
    signal: controller.signal,

    fork<A, E>(effect: Effect<A, E>): Fiber<A, E> {
      if (closed) {
        throw new Error('Cannot fork on a closed scope');
      }

      const fiberController = new AbortController();

      // Abort fiber if scope is aborted
      scope.signal.addEventListener('abort', () => fiberController.abort());

      const promise = effect.run(fiberController.signal);

      const fiber: Fiber<A, E> = {
        signal: fiberController.signal,
        await: () => promise,
        interrupt: async () => {
          fiberController.abort();
          await promise.catch(() => {});
        },
      };

      fibers.add(fiber);
      promise.finally(() => fibers.delete(fiber));

      return fiber;
    },

    addFinalizer(finalizer: () => Promise<void> | void): void {
      if (closed) {
        throw new Error('Cannot add finalizer to closed scope');
      }
      finalizers.push(finalizer);
    },

    async close(): Promise<void> {
      if (closed) return;
      closed = true;

      // Abort all fibers
      controller.abort();

      // Wait for all fibers to complete
      await Promise.allSettled([...fibers].map((f) => f.await().catch(() => {})));

      // Run finalizers in reverse order
      for (const finalizer of finalizers.reverse()) {
        try {
          await finalizer();
        } catch {}
      }
    },
  };

  return scope;
};

/**
 * Run an Effect within a managed Scope
 */
export const scoped = <A, E>(
  f: (scope: Scope) => Effect<A, E>
): Effect<A, E> => ({
  _tag: 'Effect',
  run: async (signal) => {
    const scope = createScope(signal);
    try {
      return await f(scope).run(scope.signal);
    } finally {
      await scope.close();
    }
  },
});

// ============================================================================
// Runtime
// ============================================================================

/**
 * Run an Effect with optional AbortSignal
 */
export const runPromise = <A, E>(
  effect: Effect<A, E>,
  signal?: AbortSignal
): Promise<A> => {
  return effect.run(signal);
};

/**
 * Run an Effect and return a Fiber for managing its execution
 */
export const runFork = <A, E>(
  effect: Effect<A, E>,
  signal?: AbortSignal
): Fiber<A, E> => {
  const controller = new AbortController();
  signal?.addEventListener('abort', () => controller.abort());

  const promise = effect.run(controller.signal);

  return {
    signal: controller.signal,
    await: () => promise,
    interrupt: async () => {
      controller.abort();
      await promise.catch(() => {});
    },
  };
};

// ============================================================================
// Utilities
// ============================================================================

/**
 * Delay execution by a number of milliseconds
 */
export const delay = <A, E>(
  effect: Effect<A, E>,
  ms: number
): Effect<A, E> =>
  flatMap(sleep(ms), () => effect);

/**
 * Retry an Effect with exponential backoff
 */
export const retry = <A, E>(
  effect: Effect<A, E>,
  options: { times: number; delay?: number; backoff?: number }
): Effect<A, E> => ({
  _tag: 'Effect',
  run: async (signal) => {
    let lastError: any;
    const delayMs = options.delay ?? 100;
    const backoff = options.backoff ?? 2;

    for (let i = 0; i <= options.times; i++) {
      try {
        return await effect.run(signal);
      } catch (error) {
        lastError = error;
        if (i < options.times) {
          await sleep(delayMs * Math.pow(backoff, i)).run(signal);
        }
      }
    }
    throw lastError;
  },
});

/**
 * Log a message (useful for debugging)
 */
export const log = (message: string): Effect<void, never> =>
  sync(() => console.log(message));
