/**
 * Stream utilities for working with async iterables.
 */

import { Wish, Scope } from './core.js';

/**
 * Consume an async iterable, calling a function for each item.
 * Properly handles cancellation and cleanup.
 */
export const forEach = <A>(
  iterable: AsyncIterable<A>,
  fn: (value: A, signal: AbortSignal) => Promise<void>
): Wish<void> => {
  return async (signal) => {
    const iterator = iterable[Symbol.asyncIterator]();

    const cleanup = async () => {
      try {
        await iterator.return?.();
      } catch {}
    };

    if (signal.aborted) {
      await cleanup();
      throw signal.reason ?? new DOMException('Aborted', 'AbortError');
    }

    signal.addEventListener('abort', cleanup, { once: true });

    try {
      for await (const value of { [Symbol.asyncIterator]: () => iterator }) {
        if (signal.aborted) {
          throw signal.reason ?? new DOMException('Aborted', 'AbortError');
        }
        await fn(value, signal);
      }
    } finally {
      signal.removeEventListener('abort', cleanup);
      await cleanup();
    }
  };
};

/**
 * Collect all items from an async iterable into an array.
 */
export const toArray = <A>(iterable: AsyncIterable<A>): Wish<A[]> => {
  return async (signal) => {
    const result: A[] = [];
    await forEach(iterable, async (value) => {
      result.push(value);
    })(signal);
    return result;
  };
};

/**
 * Transform items in an async iterable.
 */
export async function* map<A, B>(
  iterable: AsyncIterable<A>,
  fn: (value: A) => B | Promise<B>
): AsyncIterable<B> {
  for await (const value of iterable) {
    yield await fn(value);
  }
}

/**
 * Filter items in an async iterable.
 */
export async function* filter<A>(
  iterable: AsyncIterable<A>,
  predicate: (value: A) => boolean | Promise<boolean>
): AsyncIterable<A> {
  for await (const value of iterable) {
    if (await predicate(value)) {
      yield value;
    }
  }
}

/**
 * Take the first n items from an async iterable.
 */
export async function* take<A>(
  iterable: AsyncIterable<A>,
  n: number
): AsyncIterable<A> {
  let count = 0;
  for await (const value of iterable) {
    if (count >= n) break;
    yield value;
    count++;
  }
}

/**
 * Merge multiple async iterables, yielding items as they arrive.
 */
export const merge = <A>(
  ...iterables: AsyncIterable<A>[]
): Wish<AsyncIterable<A>> => {
  return async (signal) => {
    return (async function* () {
      const scope = new Scope(signal);
      const queue: A[] = [];
      const deferred: Array<{
        resolve: (value: IteratorResult<A>) => void;
        reject: (error: Error) => void;
      }> = [];

      let activeCount = iterables.length;
      let done = false;

      const enqueue = (value: A) => {
        if (deferred.length > 0) {
          const { resolve } = deferred.shift()!;
          resolve({ value, done: false });
        } else {
          queue.push(value);
        }
      };

      const finish = () => {
        activeCount--;
        if (activeCount === 0) {
          done = true;
          while (deferred.length > 0) {
            const { resolve } = deferred.shift()!;
            resolve({ value: undefined as any, done: true });
          }
        }
      };

      // Start consuming all iterables
      for (const iterable of iterables) {
        scope.fork(async (sig) => {
          try {
            for await (const value of iterable) {
              if (sig.aborted) break;
              enqueue(value);
            }
          } finally {
            finish();
          }
        });
      }

      try {
        while (!done || queue.length > 0) {
          if (queue.length > 0) {
            yield queue.shift()!;
          } else if (!done) {
            const next = await new Promise<IteratorResult<A>>(
              (resolve, reject) => {
                deferred.push({ resolve, reject });
              }
            );
            if (!next.done) {
              yield next.value;
            }
          }
        }
      } finally {
        await scope.close();
      }
    })();
  };
};

/**
 * Process items from an async iterable with a maximum concurrency.
 */
export const mapConcurrent = <A, B>(
  iterable: AsyncIterable<A>,
  concurrency: number,
  fn: (value: A, signal: AbortSignal) => Promise<B>
): Wish<B[]> => {
  return async (signal) => {
    const results: B[] = [];
    const inFlight = new Set<Promise<void>>();
    const iterator = iterable[Symbol.asyncIterator]();

    const cleanup = async () => {
      try {
        await iterator.return?.();
      } catch {}
    };

    signal.addEventListener('abort', cleanup, { once: true });

    try {
      while (true) {
        if (signal.aborted) {
          throw signal.reason ?? new DOMException('Aborted', 'AbortError');
        }

        // Wait if at concurrency limit
        if (inFlight.size >= concurrency) {
          await Promise.race(inFlight);
        }

        const { value, done } = await iterator.next();
        if (done) break;

        const task = fn(value, signal).then(
          (result) => {
            results.push(result);
          },
          (error) => {
            throw error;
          }
        ).finally(() => {
          inFlight.delete(task);
        });

        inFlight.add(task);
      }

      // Wait for remaining tasks
      await Promise.all(inFlight);

      return results;
    } finally {
      signal.removeEventListener('abort', cleanup);
      await cleanup();
      await Promise.allSettled(inFlight);
    }
  };
};
