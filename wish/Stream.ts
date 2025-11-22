/**
 * Stream - Async generator utilities with abort support
 */

import type { WishEffect } from './Wish'

export type WishStream<A> = (signal?: AbortSignal) => AsyncGenerator<A, void, unknown>

/**
 * Create a stream from an async generator function
 */
export const make = <A>(
  fn: (signal?: AbortSignal) => AsyncGenerator<A, void, unknown>
): WishStream<A> => fn

/**
 * Create a stream from an iterable
 */
export const fromIterable = <A>(iterable: Iterable<A>): WishStream<A> =>
  async function* (signal?: AbortSignal) {
    for (const item of iterable) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError")
      }
      yield item
    }
  }

/**
 * Create a stream from an async iterable
 */
export const fromAsyncIterable = <A>(
  iterable: AsyncIterable<A>
): WishStream<A> =>
  async function* (signal?: AbortSignal) {
    for await (const item of iterable) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError")
      }
      yield item
    }
  }

/**
 * Create a stream that emits a range of numbers
 */
export const range = (start: number, end: number): WishStream<number> =>
  async function* (signal?: AbortSignal) {
    for (let i = start; i < end; i++) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError")
      }
      yield i
    }
  }

/**
 * Map over a stream
 */
export const map = <A, B>(
  stream: WishStream<A>,
  f: (a: A) => B
): WishStream<B> =>
  async function* (signal?: AbortSignal) {
    const gen = stream(signal)
    try {
      for await (const value of gen) {
        yield f(value)
      }
    } finally {
      await gen.return?.()
    }
  }

/**
 * Filter a stream
 */
export const filter = <A>(
  stream: WishStream<A>,
  predicate: (a: A) => boolean
): WishStream<A> =>
  async function* (signal?: AbortSignal) {
    const gen = stream(signal)
    try {
      for await (const value of gen) {
        if (predicate(value)) {
          yield value
        }
      }
    } finally {
      await gen.return?.()
    }
  }

/**
 * Take the first n elements from a stream
 */
export const take = <A>(stream: WishStream<A>, n: number): WishStream<A> =>
  async function* (signal?: AbortSignal) {
    const gen = stream(signal)
    try {
      let count = 0
      for await (const value of gen) {
        if (count >= n) break
        yield value
        count++
      }
    } finally {
      await gen.return?.()
    }
  }

/**
 * Tap into each element for side effects
 */
export const tap = <A>(
  stream: WishStream<A>,
  f: (a: A, signal?: AbortSignal) => WishEffect<void> | void
): WishStream<A> =>
  async function* (signal?: AbortSignal) {
    const gen = stream(signal)
    try {
      for await (const value of gen) {
        const result = f(value, signal)
        if (result && typeof result === 'function') {
          await result(signal)
        }
        yield value
      }
    } finally {
      await gen.return?.()
    }
  }

/**
 * Run an effect for each element in the stream
 */
export const forEach = <A>(
  stream: WishStream<A>,
  f: (a: A, signal?: AbortSignal) => WishEffect<void>
): WishEffect<void> =>
  async (signal?: AbortSignal) => {
    const gen = stream(signal)
    try {
      for await (const value of gen) {
        await f(value, signal)(signal)
      }
    } finally {
      await gen.return?.()
    }
  }

/**
 * Collect all elements from a stream into an array
 */
export const toArray = <A>(stream: WishStream<A>): WishEffect<A[]> =>
  async (signal?: AbortSignal) => {
    const result: A[] = []
    const gen = stream(signal)
    try {
      for await (const value of gen) {
        result.push(value)
      }
    } finally {
      await gen.return?.()
    }
    return result
  }

/**
 * Reduce a stream to a single value
 */
export const reduce = <A, B>(
  stream: WishStream<A>,
  initial: B,
  f: (acc: B, value: A) => B
): WishEffect<B> =>
  async (signal?: AbortSignal) => {
    let acc = initial
    const gen = stream(signal)
    try {
      for await (const value of gen) {
        acc = f(acc, value)
      }
    } finally {
      await gen.return?.()
    }
    return acc
  }

/**
 * Merge multiple streams into one
 */
export const merge = <A>(...streams: WishStream<A>[]): WishStream<A> =>
  async function* (signal?: AbortSignal) {
    const generators = streams.map(s => s(signal))
    const pending = new Map<number, Promise<IteratorResult<A>>>()

    try {
      // Initialize all generators
      generators.forEach((gen, idx) => {
        pending.set(idx, gen.next())
      })

      while (pending.size > 0) {
        if (signal?.aborted) {
          throw new DOMException("Aborted", "AbortError")
        }

        // Race all pending promises
        const results = await Promise.race(
          Array.from(pending.entries()).map(async ([idx, promise]) => ({
            idx,
            result: await promise,
          }))
        )

        const { idx, result } = results

        if (result.done) {
          pending.delete(idx)
        } else {
          yield result.value
          pending.set(idx, generators[idx].next())
        }
      }
    } finally {
      // Cleanup all generators
      await Promise.allSettled(generators.map(g => g.return?.()))
    }
  }

/**
 * Concatenate multiple streams sequentially
 */
export const concat = <A>(...streams: WishStream<A>[]): WishStream<A> =>
  async function* (signal?: AbortSignal) {
    for (const stream of streams) {
      const gen = stream(signal)
      try {
        for await (const value of gen) {
          yield value
        }
      } finally {
        await gen.return?.()
      }
    }
  }

/**
 * Create a stream that repeats values with a delay
 */
export const interval = (ms: number): WishStream<number> =>
  async function* (signal?: AbortSignal) {
    let count = 0
    while (!signal?.aborted) {
      yield count++
      await new Promise((resolve, reject) => {
        if (signal?.aborted) {
          reject(new DOMException("Aborted", "AbortError"))
          return
        }
        const id = setTimeout(resolve, ms)
        signal?.addEventListener("abort", () => {
          clearTimeout(id)
          reject(new DOMException("Aborted", "AbortError"))
        }, { once: true })
      })
    }
  }
