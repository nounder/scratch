/**
 * Wish - A lightweight, elegant concurrency library
 *
 * Core types and primitives for structured async programming with cancellation.
 */

/**
 * A Wish represents a cancellable async computation that produces a value of type A.
 * It's a function that accepts a context with an AbortSignal and returns a Promise.
 */
export type Wish<A> = (ctx: { signal: AbortSignal }) => Promise<A>;

/**
 * A Fiber represents a running computation that can be awaited or interrupted.
 */
export class Fiber<A> {
  private promise: Promise<A>;
  private abortController: AbortController;

  constructor(wish: Wish<A>, parentSignal?: AbortSignal) {
    this.abortController = new AbortController();

    // Link parent signal to child
    if (parentSignal) {
      if (parentSignal.aborted) {
        this.abortController.abort(parentSignal.reason);
      } else {
        parentSignal.addEventListener('abort', () => {
          this.abortController.abort(parentSignal.reason);
        }, { once: true });
      }
    }

    this.promise = wish({ signal: this.abortController.signal });
  }

  /**
   * Wait for the computation to complete and return its result.
   */
  async await(): Promise<A> {
    return this.promise;
  }

  /**
   * Interrupt the computation.
   */
  interrupt(reason?: any): void {
    this.abortController.abort(reason ?? new DOMException('Interrupted', 'AbortError'));
  }

  /**
   * Get the underlying promise (for advanced use cases).
   */
  get raw(): Promise<A> {
    return this.promise;
  }

  /**
   * Attach callbacks for the resolution and/or rejection of the computation.
   * Makes Fiber promise-like.
   */
  then<TResult1 = A, TResult2 = never>(
    onfulfilled?: ((value: A) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return this.promise.then(onfulfilled, onrejected);
  }

  /**
   * Attach a callback for only the rejection of the computation.
   */
  catch<TResult = never>(
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null
  ): Promise<A | TResult> {
    return this.promise.catch(onrejected);
  }

  /**
   * Attach a callback that is invoked when the computation settles.
   */
  finally(onfinally?: (() => void) | null): Promise<A> {
    return this.promise.finally(onfinally);
  }
}

/**
 * Scope manages the lifecycle of concurrent operations with structured concurrency.
 * All forked computations are tracked and properly cleaned up.
 */
export class Scope {
  private fibers = new Set<Fiber<any>>();
  private finalizers = new Set<() => Promise<void>>();
  private signal: AbortSignal;
  private closed = false;

  constructor(signal?: AbortSignal) {
    this.signal = signal ?? new AbortController().signal;
  }

  /**
   * Fork a computation to run concurrently within this scope.
   * The computation will be interrupted if the scope is closed.
   */
  fork<A>(wish: Wish<A>): Fiber<A> {
    if (this.closed) {
      throw new Error('Cannot fork on a closed scope');
    }

    const fiber = new Fiber(wish, this.signal);
    this.fibers.add(fiber);

    // Auto-remove on completion
    fiber.raw.finally(() => this.fibers.delete(fiber));

    return fiber;
  }

  /**
   * Add a finalizer that will run when the scope closes.
   * Useful for resource cleanup.
   */
  addFinalizer(finalizer: () => Promise<void>): void {
    this.finalizers.add(finalizer);
  }

  /**
   * Close the scope, interrupting all running fibers and waiting for cleanup.
   */
  async close(): Promise<void> {
    if (this.closed) return;
    this.closed = true;

    // Interrupt all running fibers
    for (const fiber of this.fibers) {
      fiber.interrupt();
    }

    // Wait for all fibers to settle
    await Promise.allSettled(Array.from(this.fibers).map(f => f.raw));

    // Run finalizers
    await Promise.allSettled(Array.from(this.finalizers).map(f => f()));
    this.finalizers.clear();
  }

  /**
   * Get the abort signal for this scope.
   */
  get abortSignal(): AbortSignal {
    return this.signal;
  }
}

/**
 * Error thrown when a Wish is aborted.
 */
export class AbortError extends DOMException {
  constructor(message = 'Aborted') {
    super(message, 'AbortError');
  }
}
