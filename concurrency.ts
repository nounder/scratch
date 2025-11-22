/**
 * Lightweight concurrency library inspired by Effect.ts
 * Provides composable primitives for abortable async operations
 */

// ============================================================================
// Core Types
// ============================================================================

export interface RunContext {
  readonly signal?: AbortSignal;
}

export type Task<T> = (ctx: RunContext) => Promise<T>;
export type Stream<T> = (ctx: RunContext) => AsyncGenerator<T>;

// ============================================================================
// Task Constructors
// ============================================================================

export const Task = {
  /** Create a task from a value */
  succeed: <T>(value: T): Task<T> =>
    async () => value,

  /** Create a task that fails */
  fail: <E = Error>(error: E): Task<never> =>
    async () => { throw error; },

  /** Create a task from a function */
  of: <T>(fn: (ctx: RunContext) => Promise<T>): Task<T> =>
    fn,

  /** Sleep for ms, abortable */
  sleep: (ms: number): Task<void> =>
    async ({ signal }) => {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      return new Promise((res, rej) => {
        const id = setTimeout(res, ms);
        const onAbort = () => {
          clearTimeout(id);
          rej(new DOMException("Aborted", "AbortError"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    },

  /** Map over a task result */
  map: <A, B>(task: Task<A>, fn: (a: A) => B): Task<B> =>
    async (ctx) => fn(await task(ctx)),

  /** FlatMap/chain tasks */
  flatMap: <A, B>(task: Task<A>, fn: (a: A) => Task<B>): Task<B> =>
    async (ctx) => {
      const a = await task(ctx);
      return fn(a)(ctx);
    },

  /** Catch errors and recover */
  catchAll: <T, E>(task: Task<T>, onError: (e: unknown) => Task<T>): Task<T> =>
    async (ctx) => {
      try {
        return await task(ctx);
      } catch (e) {
        return onError(e)(ctx);
      }
    },

  /** Execute with side effect, ignore result */
  tap: <T>(task: Task<T>, fn: (t: T) => void | Promise<void>): Task<T> =>
    async (ctx) => {
      const result = await task(ctx);
      await fn(result);
      return result;
    },

  /** Add cleanup logic that runs on success, failure, or abort */
  ensuring: <T>(task: Task<T>, cleanup: Task<void>): Task<T> =>
    async (ctx) => {
      try {
        return await task(ctx);
      } finally {
        await cleanup(ctx).catch(() => {});
      }
    },
};

// ============================================================================
// Stream Constructors
// ============================================================================

export const Stream = {
  /** Create a stream from an async generator function */
  of: <T>(gen: Stream<T>): Stream<T> =>
    gen,

  /** Create a stream from values */
  fromIterable: <T>(values: Iterable<T>): Stream<T> =>
    async function* () {
      for (const v of values) {
        yield v;
      }
    },

  /** Map over stream values */
  map: <A, B>(stream: Stream<A>, fn: (a: A) => B): Stream<B> =>
    async function* (ctx) {
      for await (const value of stream(ctx)) {
        yield fn(value);
      }
    },

  /** Execute effect for each element */
  tap: <T>(stream: Stream<T>, fn: (t: T) => Task<void>): Stream<T> =>
    async function* (ctx) {
      for await (const value of stream(ctx)) {
        await fn(value)(ctx);
        yield value;
      }
    },

  /** Run a task for each stream element and discard results */
  runForEach: <T>(stream: Stream<T>, fn: (t: T) => Task<void>): Task<void> =>
    async (ctx) => {
      const iterator = stream(ctx);
      try {
        for await (const value of iterator) {
          await fn(value)(ctx);
        }
      } finally {
        await iterator.return?.().catch(() => {});
      }
    },

  /** Collect all stream elements into array */
  runCollect: <T>(stream: Stream<T>): Task<T[]> =>
    async (ctx) => {
      const result: T[] = [];
      const iterator = stream(ctx);
      try {
        for await (const value of iterator) {
          result.push(value);
        }
      } finally {
        await iterator.return?.().catch(() => {});
      }
      return result;
    },

  /** Fold stream into a single value */
  runFold: <T, S>(stream: Stream<T>, seed: S, fn: (s: S, t: T) => S): Task<S> =>
    async (ctx) => {
      let state = seed;
      const iterator = stream(ctx);
      try {
        for await (const value of iterator) {
          state = fn(state, value);
        }
      } finally {
        await iterator.return?.().catch(() => {});
      }
      return state;
    },
};

// ============================================================================
// Concurrency Combinators
// ============================================================================

export const Concurrent = {
  /** Run tasks in parallel, wait for all */
  all: <T extends readonly Task<any>[]>(
    tasks: T
  ): Task<{ [K in keyof T]: T[K] extends Task<infer R> ? R : never }> =>
    async (ctx) => {
      const results = await Promise.all(tasks.map(t => t(ctx)));
      return results as any;
    },

  /** Run tasks in parallel, return on first success or all failures */
  race: <T>(tasks: Task<T>[]): Task<T> =>
    async (ctx) => {
      return Promise.race(tasks.map(t => t(ctx)));
    },

  /** Run tasks in parallel, return all settled results */
  allSettled: <T extends readonly Task<any>[]>(
    tasks: T
  ): Task<PromiseSettledResult<any>[]> =>
    async (ctx) => {
      return Promise.allSettled(tasks.map(t => t(ctx)));
    },

  /** Run streams in parallel with a common reducer */
  reduceStreams: <T, S>(
    streams: Stream<T>[],
    seed: S,
    reducer: (s: S, t: T) => S
  ): Task<S> =>
    async (ctx) => {
      const state = { value: seed };
      const iterators = streams.map(s => s(ctx));

      const cleanupIterators = async () => {
        await Promise.all(
          iterators.map(it => it.return?.().catch(() => {}))
        );
      };

      // Register abort handler
      const onAbort = () => { cleanupIterators(); };
      ctx.signal?.addEventListener("abort", onAbort, { once: true });

      try {
        const workers = iterators.map(async (iterator) => {
          try {
            for await (const value of iterator) {
              state.value = reducer(state.value, value);
            }
          } finally {
            await iterator.return?.().catch(() => {});
          }
        });

        await Promise.allSettled(workers);
      } finally {
        ctx.signal?.removeEventListener("abort", onAbort);
        await cleanupIterators();
      }

      return state.value;
    },

  /**
   * Run multiple stream processors in parallel, each maintaining its own state.
   * Returns when all streams complete or abort.
   */
  allStreams: <T extends Record<string, { stream: Stream<any>, process: Task<any> }>>(
    processors: T
  ): Task<{ [K in keyof T]: T[K]["process"] extends Task<infer R> ? R : never }> =>
    async (ctx) => {
      const results = {} as any;
      const inflight = new Set<Promise<any>>();
      const track = <P extends Promise<any>>(p: P): P => {
        inflight.add(p);
        p.finally(() => inflight.delete(p));
        return p;
      };

      const entries = Object.entries(processors);
      const workers = entries.map(([key, { process }]) =>
        process(ctx).then(result => { results[key] = result; })
      );

      try {
        await Promise.allSettled(workers);
      } finally {
        // Wait for all in-flight subtasks
        await Promise.allSettled([...inflight]);
      }

      return results;
    },
};

// ============================================================================
// Resource Management
// ============================================================================

export interface Scope {
  readonly signal: AbortSignal;
  add(cleanup: () => Promise<void>): void;
  fork(): Scope;
}

class ScopeImpl implements Scope {
  private finalizers: (() => Promise<void>)[] = [];
  private children: ScopeImpl[] = [];
  public readonly signal: AbortSignal;

  constructor(signal?: AbortSignal) {
    this.signal = signal ?? new AbortController().signal;
  }

  add(cleanup: () => Promise<void>): void {
    this.finalizers.push(cleanup);
  }

  fork(): Scope {
    const child = new ScopeImpl(this.signal);
    this.children.push(child);
    return child;
  }

  async close(): Promise<void> {
    // Close children first
    await Promise.all(this.children.map(c => c.close()));

    // Run finalizers in reverse order
    for (const fin of this.finalizers.reverse()) {
      await fin().catch(() => {});
    }

    this.finalizers = [];
    this.children = [];
  }
}

export const scoped = <T>(
  fn: (scope: Scope) => Task<T>
): Task<T> =>
  async (ctx) => {
    const scope = new ScopeImpl(ctx.signal);
    try {
      return await fn(scope)(ctx);
    } finally {
      await scope.close();
    }
  };

// ============================================================================
// Runtime
// ============================================================================

export const Runtime = {
  /** Run a task with optional abort signal */
  run: async <T>(task: Task<T>, signal?: AbortSignal): Promise<T> => {
    return task({ signal });
  },

  /** Run a task with a timeout */
  runWithTimeout: async <T>(
    task: Task<T>,
    ms: number,
    signal?: AbortSignal
  ): Promise<T> => {
    const ac = new AbortController();
    const combinedSignal = combineSignals([signal, ac.signal].filter(Boolean) as AbortSignal[]);

    const timeoutId = setTimeout(() => ac.abort(), ms);

    try {
      return await task({ signal: combinedSignal });
    } finally {
      clearTimeout(timeoutId);
    }
  },

  /** Create a new AbortController and run task */
  runAbortable: <T>(task: Task<T>): {
    result: Promise<T>;
    abort: (reason?: any) => void;
  } => {
    const ac = new AbortController();
    return {
      result: task({ signal: ac.signal }),
      abort: (reason?: any) => ac.abort(reason),
    };
  },
};

// ============================================================================
// Utilities
// ============================================================================

function combineSignals(signals: AbortSignal[]): AbortSignal {
  const ac = new AbortController();
  for (const signal of signals) {
    if (signal.aborted) {
      ac.abort(signal.reason);
      break;
    }
    signal.addEventListener("abort", () => ac.abort(signal.reason), { once: true });
  }
  return ac.signal;
}

// ============================================================================
// Derived Combinators
// ============================================================================

export const pipe = <A, B>(a: A, fn: (a: A) => B): B => fn(a);

export function flow<A extends any[], B>(ab: (...a: A) => B): (...a: A) => B;
export function flow<A extends any[], B, C>(
  ab: (...a: A) => B,
  bc: (b: B) => C
): (...a: A) => C;
export function flow<A extends any[], B, C, D>(
  ab: (...a: A) => B,
  bc: (b: B) => C,
  cd: (c: C) => D
): (...a: A) => D;
export function flow(...fns: Function[]): Function {
  return (...args: any[]) => fns.reduce((acc, fn) => [fn(...acc)], args)[0];
}
