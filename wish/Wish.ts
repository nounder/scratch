/**
 * Core Wish effect primitives
 */

export type WishEffect<A> = (signal?: AbortSignal) => Promise<A>

/**
 * Create a Wish effect from a function
 */
export const make = <A>(fn: (signal?: AbortSignal) => Promise<A>): WishEffect<A> => fn

/**
 * Create a successful Wish effect
 */
export const succeed = <A>(value: A): WishEffect<A> =>
  async () => value

/**
 * Create a failed Wish effect
 */
export const fail = (error: unknown): WishEffect<never> =>
  async () => { throw error }

/**
 * Sleep for a duration with abort support
 */
export const sleep = (ms: number): WishEffect<void> =>
  async (signal?: AbortSignal) => {
    if (signal?.aborted) {
      throw new DOMException("Aborted", "AbortError")
    }

    return new Promise((resolve, reject) => {
      const id = setTimeout(resolve, ms)

      const onAbort = () => {
        clearTimeout(id)
        reject(new DOMException("Aborted", "AbortError"))
      }

      signal?.addEventListener("abort", onAbort, { once: true })
    })
  }

/**
 * Defer execution of an effect
 */
export const defer = <A>(fn: () => WishEffect<A>): WishEffect<A> =>
  async (signal?: AbortSignal) => fn()(signal)

/**
 * Map over a Wish effect
 */
export const map = <A, B>(
  fa: WishEffect<A>,
  f: (a: A) => B
): WishEffect<B> =>
  async (signal?: AbortSignal) => {
    const a = await fa(signal)
    return f(a)
  }

/**
 * FlatMap over a Wish effect
 */
export const flatMap = <A, B>(
  fa: WishEffect<A>,
  f: (a: A) => WishEffect<B>
): WishEffect<B> =>
  async (signal?: AbortSignal) => {
    const a = await fa(signal)
    return f(a)(signal)
  }

/**
 * Catch errors in a Wish effect
 */
export const catchAll = <A, B>(
  fa: WishEffect<A>,
  f: (error: unknown) => WishEffect<B>
): WishEffect<A | B> =>
  async (signal?: AbortSignal) => {
    try {
      return await fa(signal)
    } catch (error) {
      return await f(error)(signal)
    }
  }

/**
 * Run an effect and return the result
 */
export const runPromise = <A>(
  effect: WishEffect<A>,
  signal?: AbortSignal
): Promise<A> => effect(signal)

/**
 * Tap into a Wish effect for side effects
 */
export const tap = <A>(
  fa: WishEffect<A>,
  f: (a: A) => WishEffect<void> | void
): WishEffect<A> =>
  async (signal?: AbortSignal) => {
    const a = await fa(signal)
    const result = f(a)
    if (result && typeof result === 'function') {
      await result(signal)
    }
    return a
  }

/**
 * Race multiple effects, return the first to complete
 */
export const race = <A>(...effects: WishEffect<A>[]): WishEffect<A> =>
  async (signal?: AbortSignal) => {
    return Promise.race(effects.map(e => e(signal)))
  }

/**
 * Run all effects in parallel
 */
export const all = <A>(effects: WishEffect<A>[]): WishEffect<A[]> =>
  async (signal?: AbortSignal) => {
    return Promise.all(effects.map(e => e(signal)))
  }

/**
 * Run all effects and collect settled results
 */
export const allSettled = <A>(
  effects: WishEffect<A>[]
): WishEffect<PromiseSettledResult<A>[]> =>
  async (signal?: AbortSignal) => {
    return Promise.allSettled(effects.map(e => e(signal)))
  }

/**
 * Repeat an effect until it succeeds or signal aborts
 */
export const retry = <A>(
  effect: WishEffect<A>,
  options?: { maxAttempts?: number; delay?: number }
): WishEffect<A> => {
  const maxAttempts = options?.maxAttempts ?? Infinity
  const delay = options?.delay ?? 0

  return async (signal?: AbortSignal) => {
    let lastError: unknown

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      try {
        return await effect(signal)
      } catch (error) {
        lastError = error
        if (attempt < maxAttempts - 1 && delay > 0) {
          await sleep(delay)(signal)
        }
      }
    }

    throw lastError
  }
}

/**
 * Create a Wish from a Promise
 */
export const fromPromise = <A>(promise: Promise<A>): WishEffect<A> =>
  async () => promise

/**
 * Pipe operator for composing effects
 */
export const pipe = <A, B>(
  value: A,
  ...fns: Array<(arg: any) => any>
): B => {
  return fns.reduce((acc, fn) => fn(acc), value as any)
}
