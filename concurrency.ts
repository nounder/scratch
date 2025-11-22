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

type TaskFn<T> = (ctx: RunContext) => Promise<T>;
export type Stream<T> = (ctx: RunContext) => AsyncGenerator<T>;

// ============================================================================
// Task Class (Fluent API)
// ============================================================================

export class Task<T> {
  constructor(private readonly _run: TaskFn<T>) {}

  // Static constructors
  static succeed<T>(value: T): Task<T> {
    return new Task(async () => value);
  }

  static fail<E = Error>(error: E): Task<never> {
    return new Task(async () => {
      throw error;
    });
  }

  static of<T>(fn: TaskFn<T>): Task<T> {
    return new Task(fn);
  }

  static sleep(ms: number): Task<void> {
    return new Task(async ({ signal }) => {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError");
      }
      return new Promise<void>((res, rej) => {
        const id = setTimeout(res, ms);
        const onAbort = () => {
          clearTimeout(id);
          rej(new DOMException("Aborted", "AbortError"));
        };
        signal?.addEventListener("abort", onAbort, { once: true });
      });
    });
  }

  // Instance methods (fluent API)
  map<B>(fn: (a: T) => B | Promise<B>): Task<B> {
    return new Task(async (ctx) => fn(await this._run(ctx)));
  }

  flatMap<B>(fn: (a: T) => Task<B>): Task<B> {
    return new Task(async (ctx) => {
      const a = await this._run(ctx);
      return fn(a)._run(ctx);
    });
  }

  tap(fn: (t: T) => void | Promise<void>): Task<T> {
    return new Task(async (ctx) => {
      const result = await this._run(ctx);
      await fn(result);
      return result;
    });
  }

  catchAll(onError: (e: unknown) => Task<T>): Task<T> {
    return new Task(async (ctx) => {
      try {
        return await this._run(ctx);
      } catch (e) {
        return onError(e)._run(ctx);
      }
    });
  }

  catchTag<E extends Error>(
    tag: string,
    onError: (e: E) => Task<T>
  ): Task<T> {
    return this.catchAll((e) => {
      if (e instanceof Error && e.name === tag) {
        return onError(e as E);
      }
      throw e;
    });
  }

  ensuring(cleanup: Task<void>): Task<T> {
    return new Task(async (ctx) => {
      try {
        return await this._run(ctx);
      } finally {
        await cleanup._run(ctx).catch(() => {});
      }
    });
  }

  withTimeout(ms: number): Task<T> {
    return new Task(async (ctx) => {
      const ac = new AbortController();
      const combinedSignal = combineSignals(
        [ctx.signal, ac.signal].filter(Boolean) as AbortSignal[]
      );

      const timeoutId = setTimeout(() => ac.abort(), ms);

      try {
        return await this._run({ signal: combinedSignal });
      } finally {
        clearTimeout(timeoutId);
      }
    });
  }

  delay(ms: number): Task<T> {
    return Task.sleep(ms).flatMap(() => this);
  }

  retry(maxRetries: number): Task<T> {
    return new Task(async (ctx) => {
      let lastError: unknown;
      for (let i = 0; i <= maxRetries; i++) {
        try {
          return await this._run(ctx);
        } catch (err) {
          lastError = err;
          if (i < maxRetries) {
            await Task.sleep(Math.pow(2, i) * 100)._run(ctx);
          }
        }
      }
      throw lastError;
    });
  }

  race<B>(other: Task<B>): Task<T | B> {
    return new Task(async (ctx) => {
      return Promise.race([this._run(ctx), other._run(ctx)]);
    });
  }

  zip<B>(other: Task<B>): Task<[T, B]> {
    return new Task(async (ctx) => {
      const [a, b] = await Promise.all([this._run(ctx), other._run(ctx)]);
      return [a, b];
    });
  }

  zipWith<B, C>(other: Task<B>, fn: (a: T, b: B) => C): Task<C> {
    return this.zip(other).map(([a, b]) => fn(a, b));
  }

  // Run the task
  run(ctx: RunContext = {}): Promise<T> {
    return this._run(ctx);
  }

  // Internal accessor for combinators
  _unsafeRun(ctx: RunContext): Promise<T> {
    return this._run(ctx);
  }
}

// ============================================================================
// Channel (for task communication)
// ============================================================================

export class Channel<T> {
  private queue: T[] = [];
  private waiting: Array<{
    resolve: (value: T) => void;
    reject: (error: Error) => void;
  }> = [];
  private closed = false;

  send(value: T): Task<void> {
    return Task.of(async () => {
      if (this.closed) {
        throw new Error("Channel is closed");
      }

      if (this.waiting.length > 0) {
        const waiter = this.waiting.shift()!;
        waiter.resolve(value);
      } else {
        this.queue.push(value);
      }
    });
  }

  receive(): Task<T> {
    return Task.of(async ({ signal }) => {
      if (this.queue.length > 0) {
        return this.queue.shift()!;
      }

      if (this.closed && this.queue.length === 0) {
        throw new Error("Channel is closed and empty");
      }

      return new Promise<T>((resolve, reject) => {
        const waiter = { resolve, reject };
        this.waiting.push(waiter);

        const onAbort = () => {
          const idx = this.waiting.indexOf(waiter);
          if (idx !== -1) {
            this.waiting.splice(idx, 1);
          }
          reject(new DOMException("Aborted", "AbortError"));
        };

        signal?.addEventListener("abort", onAbort, { once: true });
      });
    });
  }

  close(): Task<void> {
    return Task.of(async () => {
      this.closed = true;
      // Reject all waiting receivers
      for (const waiter of this.waiting) {
        waiter.reject(new Error("Channel closed"));
      }
      this.waiting = [];
    });
  }

  get isClosed(): boolean {
    return this.closed;
  }

  get size(): number {
    return this.queue.length;
  }
}

// ============================================================================
// Queue (buffered channel with capacity)
// ============================================================================

export class Queue<T> {
  private queue: T[] = [];
  private waiting: Array<{
    resolve: (value: T) => void;
    reject: (error: Error) => void;
  }> = [];
  private blocked: Array<{
    value: T;
    resolve: () => void;
  }> = [];
  private closed = false;

  constructor(private capacity: number = Infinity) {}

  send(value: T): Task<void> {
    return Task.of(async ({ signal }) => {
      if (this.closed) {
        throw new Error("Queue is closed");
      }

      // If there are waiting receivers, give directly
      if (this.waiting.length > 0) {
        const waiter = this.waiting.shift()!;
        waiter.resolve(value);
        return;
      }

      // If queue has space, add to queue
      if (this.queue.length < this.capacity) {
        this.queue.push(value);
        return;
      }

      // Otherwise, block until space is available
      return new Promise<void>((resolve, reject) => {
        this.blocked.push({ value, resolve });

        const onAbort = () => {
          const idx = this.blocked.findIndex((b) => b.value === value);
          if (idx !== -1) {
            this.blocked.splice(idx, 1);
          }
          reject(new DOMException("Aborted", "AbortError"));
        };

        signal?.addEventListener("abort", onAbort, { once: true });
      });
    });
  }

  receive(): Task<T> {
    return Task.of(async ({ signal }) => {
      // If there are blocked senders, unblock one
      if (this.blocked.length > 0) {
        const blocked = this.blocked.shift()!;
        this.queue.push(blocked.value);
        blocked.resolve();
      }

      // If queue has items, return one
      if (this.queue.length > 0) {
        return this.queue.shift()!;
      }

      if (this.closed && this.queue.length === 0) {
        throw new Error("Queue is closed and empty");
      }

      // Otherwise, wait for a sender
      return new Promise<T>((resolve, reject) => {
        const waiter = { resolve, reject };
        this.waiting.push(waiter);

        const onAbort = () => {
          const idx = this.waiting.indexOf(waiter);
          if (idx !== -1) {
            this.waiting.splice(idx, 1);
          }
          reject(new DOMException("Aborted", "AbortError"));
        };

        signal?.addEventListener("abort", onAbort, { once: true });
      });
    });
  }

  close(): Task<void> {
    return Task.of(async () => {
      this.closed = true;
      // Reject all waiting receivers
      for (const waiter of this.waiting) {
        waiter.reject(new Error("Queue closed"));
      }
      this.waiting = [];
      this.blocked = [];
    });
  }

  get isClosed(): boolean {
    return this.closed;
  }

  get size(): number {
    return this.queue.length;
  }
}

// ============================================================================
// Deferred (like a Promise that can be completed externally)
// ============================================================================

export class Deferred<T> {
  readonly task: Task<T>;
  private _resolve!: (value: T) => void;
  private _reject!: (error: Error) => void;
  private _completed = false;

  constructor() {
    this.task = Task.of(
      () =>
        new Promise<T>((resolve, reject) => {
          this._resolve = resolve;
          this._reject = reject;
        })
    );
  }

  succeed(value: T): Task<void> {
    return Task.of(async () => {
      if (this._completed) {
        throw new Error("Deferred already completed");
      }
      this._completed = true;
      this._resolve(value);
    });
  }

  fail(error: Error): Task<void> {
    return Task.of(async () => {
      if (this._completed) {
        throw new Error("Deferred already completed");
      }
      this._completed = true;
      this._reject(error);
    });
  }

  get isCompleted(): boolean {
    return this._completed;
  }
}

// ============================================================================
// Stream Constructors
// ============================================================================

export const Stream = {
  /** Create a stream from an async generator function */
  of: <T>(gen: Stream<T>): Stream<T> => gen,

  /** Create a stream from values */
  fromIterable: <T>(values: Iterable<T>): Stream<T> =>
    async function* () {
      for (const v of values) {
        yield v;
      }
    },

  /** Create a stream from a channel */
  fromChannel: <T>(channel: Channel<T>): Stream<T> =>
    async function* (ctx) {
      try {
        while (!channel.isClosed) {
          const value = await channel.receive()._unsafeRun(ctx);
          yield value;
        }
      } catch (err: any) {
        if (err.message !== "Channel is closed and empty") {
          throw err;
        }
      }
    },

  /** Create a stream from a queue */
  fromQueue: <T>(queue: Queue<T>): Stream<T> =>
    async function* (ctx) {
      try {
        while (!queue.isClosed) {
          const value = await queue.receive()._unsafeRun(ctx);
          yield value;
        }
      } catch (err: any) {
        if (err.message !== "Queue is closed and empty") {
          throw err;
        }
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
        await fn(value)._unsafeRun(ctx);
        yield value;
      }
    },

  /** Run a task for each stream element and discard results */
  runForEach: <T>(stream: Stream<T>, fn: (t: T) => Task<void>): Task<void> =>
    Task.of(async (ctx) => {
      const iterator = stream(ctx);
      try {
        for await (const value of iterator) {
          await fn(value)._unsafeRun(ctx);
        }
      } finally {
        await iterator.return?.().catch(() => {});
      }
    }),

  /** Collect all stream elements into array */
  runCollect: <T>(stream: Stream<T>): Task<T[]> =>
    Task.of(async (ctx) => {
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
    }),

  /** Fold stream into a single value */
  runFold: <T, S>(stream: Stream<T>, seed: S, fn: (s: S, t: T) => S): Task<S> =>
    Task.of(async (ctx) => {
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
    }),
};

// ============================================================================
// Concurrency Combinators
// ============================================================================

export const Concurrent = {
  /** Run tasks in parallel, wait for all */
  all: <T extends readonly Task<any>[]>(
    tasks: T
  ): Task<{ [K in keyof T]: T[K] extends Task<infer R> ? R : never }> =>
    Task.of(async (ctx) => {
      const results = await Promise.all(tasks.map((t) => t._unsafeRun(ctx)));
      return results as any;
    }),

  /** Run tasks in parallel, return on first success or all failures */
  race: <T>(tasks: Task<T>[]): Task<T> =>
    Task.of(async (ctx) => {
      return Promise.race(tasks.map((t) => t._unsafeRun(ctx)));
    }),

  /** Run tasks in parallel, return all settled results */
  allSettled: <T extends readonly Task<any>[]>(
    tasks: T
  ): Task<PromiseSettledResult<any>[]> =>
    Task.of(async (ctx) => {
      return Promise.allSettled(tasks.map((t) => t._unsafeRun(ctx)));
    }),

  /** Run streams in parallel with a common reducer */
  reduceStreams: <T, S>(
    streams: Stream<T>[],
    seed: S,
    reducer: (s: S, t: T) => S
  ): Task<S> =>
    Task.of(async (ctx) => {
      const state = { value: seed };
      const iterators = streams.map((s) => s(ctx));

      const cleanupIterators = async () => {
        await Promise.all(iterators.map((it) => it.return?.().catch(() => {})));
      };

      // Register abort handler
      const onAbort = () => {
        cleanupIterators();
      };
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
    }),

  /**
   * Run multiple stream processors in parallel, each maintaining its own state.
   * Returns when all streams complete or abort.
   */
  allStreams: <
    T extends Record<string, { stream: Stream<any>; process: Task<any> }>
  >(
    processors: T
  ): Task<{ [K in keyof T]: T[K]["process"] extends Task<infer R> ? R : never }> =>
    Task.of(async (ctx) => {
      const results = {} as any;
      const inflight = new Set<Promise<any>>();
      const track = <P extends Promise<any>>(p: P): P => {
        inflight.add(p);
        p.finally(() => inflight.delete(p));
        return p;
      };

      const entries = Object.entries(processors);
      const workers = entries.map(([key, { process }]) =>
        process._unsafeRun(ctx).then((result) => {
          results[key] = result;
        })
      );

      try {
        await Promise.allSettled(workers);
      } finally {
        // Wait for all in-flight subtasks
        await Promise.allSettled([...inflight]);
      }

      return results;
    }),
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
    await Promise.all(this.children.map((c) => c.close()));

    // Run finalizers in reverse order
    for (const fin of this.finalizers.reverse()) {
      await fin().catch(() => {});
    }

    this.finalizers = [];
    this.children = [];
  }
}

export const scoped = <T>(fn: (scope: Scope) => Task<T>): Task<T> =>
  Task.of(async (ctx) => {
    const scope = new ScopeImpl(ctx.signal);
    try {
      return await fn(scope)._unsafeRun(ctx);
    } finally {
      await scope.close();
    }
  });

// ============================================================================
// Runtime
// ============================================================================

export const Runtime = {
  /** Run a task with optional abort signal */
  run: async <T>(task: Task<T>, signal?: AbortSignal): Promise<T> => {
    return task._unsafeRun({ signal });
  },

  /** Run a task with a timeout */
  runWithTimeout: async <T>(
    task: Task<T>,
    ms: number,
    signal?: AbortSignal
  ): Promise<T> => {
    return task.withTimeout(ms)._unsafeRun({ signal });
  },

  /** Create a new AbortController and run task */
  runAbortable: <T>(task: Task<T>): {
    result: Promise<T>;
    abort: (reason?: any) => void;
  } => {
    const ac = new AbortController();
    return {
      result: task._unsafeRun({ signal: ac.signal }),
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
    signal.addEventListener("abort", () => ac.abort(signal.reason), {
      once: true,
    });
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
