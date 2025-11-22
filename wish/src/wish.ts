/**
 * Wish - Core API
 *
 * Functions for creating, composing, and running async computations.
 */

import { Wish, Fiber, Scope, AbortError } from './core.js';

/**
 * Create a Wish that succeeds with a value immediately.
 */
export const succeed = <A>(value: A): Wish<A> => {
  return async () => value;
};

/**
 * Create a Wish that fails with an error immediately.
 */
export const fail = (error: Error): Wish<never> => {
  return async () => {
    throw error;
  };
};

/**
 * Create a Wish from a function that returns a Promise.
 */
export const fromPromise = <A>(fn: (signal: AbortSignal) => Promise<A>): Wish<A> => {
  return fn;
};

/**
 * Create a Wish from a regular Promise (non-cancellable).
 */
export const fromPromiseK = <A>(promise: Promise<A>): Wish<A> => {
  return async () => promise;
};

/**
 * Sleep for a given number of milliseconds (cancellable).
 */
export const sleep = (ms: number): Wish<void> => {
  return (signal) =>
    new Promise((resolve, reject) => {
      if (signal.aborted) {
        return reject(signal.reason ?? new AbortError());
      }

      const timeout = setTimeout(resolve, ms);

      const onAbort = () => {
        clearTimeout(timeout);
        reject(signal.reason ?? new AbortError());
      };

      signal.addEventListener('abort', onAbort, { once: true });
    });
};

/**
 * Transform the result of a Wish.
 */
export const map = <A, B>(wish: Wish<A>, fn: (a: A) => B): Wish<B> => {
  return async (signal) => {
    const result = await wish(signal);
    return fn(result);
  };
};

/**
 * Chain Wishes together (flatMap/bind).
 */
export const flatMap = <A, B>(wish: Wish<A>, fn: (a: A) => Wish<B>): Wish<B> => {
  return async (signal) => {
    const result = await wish(signal);
    return fn(result)(signal);
  };
};

/**
 * Combine multiple Wishes, running them concurrently.
 * All must succeed for the result to succeed.
 */
export const all = <T extends readonly Wish<any>[]>(
  ...wishes: T
): Wish<{ [K in keyof T]: T[K] extends Wish<infer A> ? A : never }> => {
  return async (signal) => {
    const results = await Promise.all(wishes.map((w) => w(signal)));
    return results as any;
  };
};

/**
 * Race multiple Wishes, returning the first to complete.
 * The others are automatically cancelled.
 */
export const race = <T extends readonly Wish<any>[]>(
  ...wishes: T
): Wish<T[number] extends Wish<infer A> ? A : never> => {
  return async (signal) => {
    const controllers = wishes.map(() => new AbortController());

    // Link parent signal
    const onAbort = () => {
      controllers.forEach((c) => c.abort(signal.reason));
    };
    signal.addEventListener('abort', onAbort, { once: true });

    try {
      const result = await Promise.race(
        wishes.map((w, i) => w(controllers[i].signal))
      );

      // Cancel the losers
      controllers.forEach((c) => c.abort(new AbortError('Race lost')));

      return result;
    } finally {
      signal.removeEventListener('abort', onAbort);
    }
  };
};

/**
 * Run a Wish within a managed scope for structured concurrency.
 */
export const scoped = <A>(fn: (scope: Scope) => Promise<A>): Wish<A> => {
  return async (signal) => {
    const scope = new Scope(signal);
    try {
      return await fn(scope);
    } finally {
      await scope.close();
    }
  };
};

/**
 * Acquire a resource with automatic cleanup.
 */
export const acquire = <A>(
  resource: Wish<A>,
  release: (a: A) => Promise<void>
): Wish<A> => {
  return async (signal) => {
    const acquired = await resource(signal);
    const cleanup = () => release(acquired);

    if (signal.aborted) {
      await cleanup();
      throw signal.reason ?? new AbortError();
    }

    signal.addEventListener('abort', cleanup, { once: true });

    return acquired;
  };
};

/**
 * Catch and handle errors in a Wish.
 */
export const catchError = <A>(
  wish: Wish<A>,
  handler: (error: Error) => Wish<A>
): Wish<A> => {
  return async (signal) => {
    try {
      return await wish(signal);
    } catch (error) {
      return handler(error as Error)(signal);
    }
  };
};

/**
 * Run a Wish with a timeout. If it doesn't complete in time, it's cancelled.
 */
export const timeout = <A>(wish: Wish<A>, ms: number): Wish<A> => {
  return async (signal) => {
    return race(
      wish,
      flatMap(sleep(ms), () => fail(new Error(`Timeout after ${ms}ms`)))
    )(signal);
  };
};

/**
 * Retry a Wish up to n times on failure.
 */
export const retry = <A>(wish: Wish<A>, times: number, delay = 0): Wish<A> => {
  return async (signal) => {
    let lastError: Error | undefined;

    for (let i = 0; i <= times; i++) {
      try {
        return await wish(signal);
      } catch (error) {
        lastError = error as Error;
        if (i < times && delay > 0) {
          await sleep(delay)(signal);
        }
      }
    }

    throw lastError;
  };
};

/**
 * Create a deferred Wish that can be completed externally.
 */
export const defer = <A>(): {
  wish: Wish<A>;
  resolve: (value: A) => void;
  reject: (error: Error) => void;
} => {
  let resolve!: (value: A) => void;
  let reject!: (error: Error) => void;

  const wish: Wish<A> = (signal) =>
    new Promise<A>((res, rej) => {
      resolve = res;
      reject = rej;

      if (signal.aborted) {
        rej(signal.reason ?? new AbortError());
      }

      signal.addEventListener(
        'abort',
        () => rej(signal.reason ?? new AbortError()),
        { once: true }
      );
    });

  return { wish, resolve, reject };
};

/**
 * Run a Wish to completion (entry point).
 */
export const run = <A>(wish: Wish<A>, signal?: AbortSignal): Promise<A> => {
  const controller = new AbortController();
  const effectiveSignal = signal ?? controller.signal;

  return wish(effectiveSignal);
};

/**
 * Run a Wish and get a Fiber handle.
 */
export const fork = <A>(wish: Wish<A>, signal?: AbortSignal): Fiber<A> => {
  return new Fiber(wish, signal);
};
