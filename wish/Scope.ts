/**
 * Scope - Resource management and cleanup
 */

import type { WishEffect } from './Wish'
import type { WishStream } from './Stream'

export interface Scope {
  readonly signal: AbortSignal
  readonly aborted: boolean

  /**
   * Add a cleanup function to run when scope closes
   */
  addFinalizer(finalizer: () => Promise<void> | void): void

  /**
   * Track a promise for coordinated shutdown
   */
  track<A>(promise: Promise<A>): Promise<A>

  /**
   * Close the scope and run all finalizers
   */
  close(): Promise<void>

  /**
   * Fork a child scope that inherits the parent's signal
   */
  fork(): Scope
}

class ScopeImpl implements Scope {
  private finalizers: Array<() => Promise<void> | void> = []
  private inflight = new Set<Promise<any>>()
  private closed = false
  private abortController: AbortController

  constructor(
    private parentSignal?: AbortSignal,
    private ownController?: AbortController
  ) {
    this.abortController = ownController ?? new AbortController()

    // If parent aborts, abort this scope too
    if (parentSignal) {
      const onParentAbort = () => this.abortController.abort()
      parentSignal.addEventListener('abort', onParentAbort, { once: true })

      // Cleanup listener when scope closes
      this.addFinalizer(() => {
        parentSignal.removeEventListener('abort', onParentAbort)
      })
    }
  }

  get signal(): AbortSignal {
    return this.abortController.signal
  }

  get aborted(): boolean {
    return this.abortController.signal.aborted
  }

  addFinalizer(finalizer: () => Promise<void> | void): void {
    if (this.closed) {
      throw new Error('Cannot add finalizer to closed scope')
    }
    this.finalizers.push(finalizer)
  }

  track<A>(promise: Promise<A>): Promise<A> {
    this.inflight.add(promise)
    promise.finally(() => this.inflight.delete(promise))
    return promise
  }

  async close(): Promise<void> {
    if (this.closed) return
    this.closed = true

    // Wait for all in-flight promises
    await Promise.allSettled([...this.inflight])

    // Run finalizers in reverse order (LIFO)
    const errors: unknown[] = []
    for (const finalizer of this.finalizers.reverse()) {
      try {
        await finalizer()
      } catch (error) {
        errors.push(error)
      }
    }

    if (errors.length > 0) {
      throw new AggregateError(errors, 'Errors during scope cleanup')
    }
  }

  fork(): Scope {
    return new ScopeImpl(this.signal)
  }
}

/**
 * Create a new scope
 */
export const make = (signal?: AbortSignal): Scope => {
  return new ScopeImpl(signal)
}

/**
 * Create a scope with its own AbortController
 */
export const controlled = (): { scope: Scope; abort: () => void } => {
  const controller = new AbortController()
  const scope = new ScopeImpl(undefined, controller)
  return {
    scope,
    abort: () => controller.abort(),
  }
}

/**
 * Run an effect within a scope
 */
export const run = <A>(
  f: (scope: Scope) => WishEffect<A>
): WishEffect<A> =>
  async (signal?: AbortSignal) => {
    const scope = make(signal)
    try {
      return await f(scope)(scope.signal)
    } finally {
      await scope.close()
    }
  }

/**
 * Acquire a resource with automatic cleanup
 */
export const acquire = <A>(
  acquire: WishEffect<A>,
  release: (resource: A) => WishEffect<void>
) =>
  (scope: Scope): WishEffect<A> =>
    async (signal?: AbortSignal) => {
      const resource = await acquire(signal)
      scope.addFinalizer(() => release(resource)(signal))
      return resource
    }

/**
 * Manage an async generator with automatic cleanup
 */
export const manageStream = <A>(stream: WishStream<A>) =>
  (scope: Scope): WishStream<A> => {
    return async function* (signal?: AbortSignal) {
      const gen = stream(signal ?? scope.signal)
      scope.addFinalizer(async () => {
        await gen.return?.().catch(() => {})
      })

      try {
        for await (const value of gen) {
          yield value
        }
      } finally {
        await gen.return?.().catch(() => {})
      }
    }
  }

/**
 * Extend a scope with a cleanup action when AbortSignal fires
 */
export const onAbort = (
  scope: Scope,
  cleanup: () => Promise<void> | void
): void => {
  if (scope.aborted) {
    cleanup()
    return
  }

  const onAbortEvent = () => {
    cleanup()
  }

  scope.signal.addEventListener('abort', onAbortEvent, { once: true })
  scope.addFinalizer(() => {
    scope.signal.removeEventListener('abort', onAbortEvent)
  })
}

/**
 * Use a scope for the duration of an async function
 */
export const use = async <A>(
  signal: AbortSignal | undefined,
  fn: (scope: Scope) => Promise<A>
): Promise<A> => {
  const scope = make(signal)
  try {
    return await fn(scope)
  } finally {
    await scope.close()
  }
}
