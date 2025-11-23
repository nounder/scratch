/**
 * Wish - Core API
 *
 * Functions for creating, composing, and running async computations.
 */

import type { Wish } from './Core.js';
import { Fiber, Scope, AbortError } from './Core.js';

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
export const fromPromise = <A>(fn: (ctx: { signal: AbortSignal }) => Promise<A>): Wish<A> => {
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
  return (ctx) =>
    new Promise((resolve, reject) => {
      if (ctx.signal.aborted) {
        return reject(ctx.signal.reason ?? new AbortError());
      }

      const timeout = setTimeout(resolve, ms);

      const onAbort = () => {
        clearTimeout(timeout);
        reject(ctx.signal.reason ?? new AbortError());
      };

      ctx.signal.addEventListener('abort', onAbort, { once: true });
    });
};

/**
 * Transform the result of a Wish.
 */
export const map = <A, B>(wish: Wish<A>, fn: (a: A) => B): Wish<B> => {
  return async (ctx) => {
    const result = await wish(ctx);
    return fn(result);
  };
};

/**
 * Chain Wishes together (flatMap/bind).
 */
export const flatMap = <A, B>(wish: Wish<A>, fn: (a: A) => Wish<B>): Wish<B> => {
  return async (ctx) => {
    const result = await wish(ctx);
    return fn(result)(ctx);
  };
};

/**
 * Combine multiple Wishes, running them concurrently.
 * All must succeed for the result to succeed.
 */
export const all = <T extends readonly Wish<any>[]>(
  ...wishes: T
): Wish<{ [K in keyof T]: T[K] extends Wish<infer A> ? A : never }> => {
  return async (ctx) => {
    const results = await Promise.all(wishes.map((w) => w(ctx)));
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
  return async (ctx) => {
    const controllers = wishes.map(() => new AbortController());

    // Link parent ctx.signal
    const onAbort = () => {
      controllers.forEach((c) => c.abort(ctx.signal.reason));
    };
    ctx.signal.addEventListener('abort', onAbort, { once: true });

    try {
      const result = await Promise.race(
        wishes.map((w, i) => w({ signal: controllers[i].signal }))
      );

      // Cancel the losers
      controllers.forEach((c) => c.abort(new AbortError('Race lost')));

      return result;
    } finally {
      ctx.signal.removeEventListener('abort', onAbort);
    }
  };
};

/**
 * Run a Wish within a managed scope for structured concurrency.
 */
export const scoped = <A>(fn: (scope: Scope) => Promise<A>): Wish<A> => {
  return async (ctx) => {
    const scope = new Scope(ctx.signal);
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
  return async (ctx) => {
    const acquired = await resource(ctx);
    const cleanup = () => release(acquired);

    if (ctx.signal.aborted) {
      await cleanup();
      throw ctx.signal.reason ?? new AbortError();
    }

    ctx.signal.addEventListener('abort', cleanup, { once: true });

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
  return async (ctx) => {
    try {
      return await wish(ctx);
    } catch (error) {
      return handler(error as Error)(ctx);
    }
  };
};

/**
 * Run a Wish with a timeout. If it doesn't complete in time, it's cancelled.
 */
export const timeout = <A>(wish: Wish<A>, ms: number): Wish<A> => {
  return async (ctx) => {
    return race(
      wish,
      flatMap(sleep(ms), () => fail(new Error(`Timeout after ${ms}ms`)))
    )(ctx);
  };
};

/**
 * Retry a Wish up to n times on failure.
 */
export const retry = <A>(wish: Wish<A>, times: number, delay = 0): Wish<A> => {
  return async (ctx) => {
    let lastError: Error | undefined;

    for (let i = 0; i <= times; i++) {
      try {
        return await wish(ctx);
      } catch (error) {
        lastError = error as Error;
        if (i < times && delay > 0) {
          await sleep(delay)(ctx);
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

  const wish: Wish<A> = (ctx) =>
    new Promise<A>((res, rej) => {
      resolve = res;
      reject = rej;

      if (ctx.signal.aborted) {
        rej(ctx.signal.reason ?? new AbortError());
      }

      ctx.signal.addEventListener(
        'abort',
        () => rej(ctx.signal.reason ?? new AbortError()),
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

  return wish({ signal: effectiveSignal });
};

/**
 * Run a Wish and get a Fiber handle.
 */
export const fork = <A>(wish: Wish<A>, signal?: AbortSignal): Fiber<A> => {
  return new Fiber(wish, signal);
};
