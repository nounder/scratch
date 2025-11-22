/**
 * Fiber - Concurrent execution primitives
 */

import type { WishEffect } from './Wish'
import type { Scope } from './Scope'

export interface Fiber<A> {
  /**
   * Wait for the fiber to complete and get its result
   */
  await(): Promise<A>

  /**
   * Interrupt the fiber
   */
  interrupt(): Promise<void>

  /**
   * Check if the fiber is done
   */
  isDone(): boolean
}

class FiberImpl<A> implements Fiber<A> {
  private promise: Promise<A>
  private result: A | undefined
  private error: unknown
  private done = false
  private abortController = new AbortController()

  constructor(
    effect: WishEffect<A>,
    parentSignal?: AbortSignal
  ) {
    // Link parent signal to fiber's abort controller
    if (parentSignal) {
      const onParentAbort = () => this.abortController.abort()
      parentSignal.addEventListener('abort', onParentAbort, { once: true })
    }

    this.promise = (async () => {
      try {
        const result = await effect(this.abortController.signal)
        this.result = result
        this.done = true
        return result
      } catch (error) {
        this.error = error
        this.done = true
        throw error
      }
    })()
  }

  async await(): Promise<A> {
    return this.promise
  }

  async interrupt(): Promise<void> {
    this.abortController.abort()
    try {
      await this.promise
    } catch {
      // Ignore errors on interrupt
    }
  }

  isDone(): boolean {
    return this.done
  }
}

/**
 * Fork an effect into a new fiber
 */
export const fork = <A>(
  effect: WishEffect<A>
): WishEffect<Fiber<A>> =>
  async (signal?: AbortSignal) => {
    return new FiberImpl(effect, signal)
  }

/**
 * Fork an effect within a scope (automatically managed)
 */
export const forkIn = <A>(
  scope: Scope,
  effect: WishEffect<A>
): Fiber<A> => {
  const fiber = new FiberImpl(effect, scope.signal)

  // Automatically interrupt fiber when scope closes
  scope.addFinalizer(async () => {
    await fiber.interrupt()
  })

  return fiber
}

/**
 * Fork multiple effects and wait for all to complete
 */
export const forkAll = <A>(
  effects: WishEffect<A>[]
): WishEffect<Fiber<A>[]> =>
  async (signal?: AbortSignal) => {
    return effects.map(effect => new FiberImpl(effect, signal))
  }

/**
 * Fork an effect and automatically join (await) it
 */
export const forkJoin = <A>(effect: WishEffect<A>): WishEffect<A> =>
  async (signal?: AbortSignal) => {
    const fiber = new FiberImpl(effect, signal)
    return fiber.await()
  }

/**
 * Join multiple fibers and return their results
 */
export const join = <A>(fibers: Fiber<A>[]): WishEffect<A[]> =>
  async () => {
    return Promise.all(fibers.map(f => f.await()))
  }

/**
 * Join multiple fibers with settled results
 */
export const joinSettled = <A>(
  fibers: Fiber<A>[]
): WishEffect<PromiseSettledResult<A>[]> =>
  async () => {
    return Promise.allSettled(fibers.map(f => f.await()))
  }

/**
 * Race multiple fibers, return the first to complete
 */
export const race = <A>(...fibers: Fiber<A>[]): WishEffect<A> =>
  async () => {
    return Promise.race(fibers.map(f => f.await()))
  }

/**
 * Interrupt all fibers
 */
export const interruptAll = (fibers: Fiber<any>[]): WishEffect<void> =>
  async () => {
    await Promise.allSettled(fibers.map(f => f.interrupt()))
  }

/**
 * Fork two effects and run them concurrently
 */
export const zipPar = <A, B>(
  fa: WishEffect<A>,
  fb: WishEffect<B>
): WishEffect<[A, B]> =>
  async (signal?: AbortSignal) => {
    const fiberA = new FiberImpl(fa, signal)
    const fiberB = new FiberImpl(fb, signal)

    try {
      const [a, b] = await Promise.all([fiberA.await(), fiberB.await()])
      return [a, b]
    } catch (error) {
      // If one fails, interrupt the other
      await Promise.allSettled([fiberA.interrupt(), fiberB.interrupt()])
      throw error
    }
  }

/**
 * Fork N effects and run them concurrently with a concurrency limit
 */
export const forEachPar = <A, B>(
  items: A[],
  f: (item: A, signal?: AbortSignal) => WishEffect<B>,
  options?: { concurrency?: number }
): WishEffect<B[]> => {
  const concurrency = options?.concurrency ?? Infinity

  return async (signal?: AbortSignal) => {
    const results: B[] = new Array(items.length)
    const executing: Promise<void>[] = []

    for (let i = 0; i < items.length; i++) {
      if (signal?.aborted) {
        throw new DOMException("Aborted", "AbortError")
      }

      const index = i
      const promise = (async () => {
        results[index] = await f(items[index], signal)(signal)
      })()

      executing.push(promise)

      if (executing.length >= concurrency) {
        await Promise.race(executing)
        // Remove completed promises
        const stillPending = executing.filter(p => {
          let isPending = true
          p.then(() => { isPending = false }).catch(() => { isPending = false })
          return isPending
        })
        executing.length = 0
        executing.push(...stillPending)
      }
    }

    await Promise.all(executing)
    return results
  }
}

/**
 * Create a supervised scope where fibers are automatically managed
 */
export const supervised = <A>(
  f: (fork: <B>(effect: WishEffect<B>) => Fiber<B>) => WishEffect<A>
): WishEffect<A> =>
  async (signal?: AbortSignal) => {
    const fibers: Fiber<any>[] = []

    const managedFork = <B>(effect: WishEffect<B>): Fiber<B> => {
      const fiber = new FiberImpl(effect, signal)
      fibers.push(fiber)
      return fiber
    }

    try {
      return await f(managedFork)(signal)
    } finally {
      // Interrupt all fibers on exit
      await Promise.allSettled(fibers.map(f => f.interrupt()))
    }
  }
