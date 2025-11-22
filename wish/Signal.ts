/**
 * Signal - AbortSignal utilities
 */

/**
 * Create a new AbortController with signal
 */
export const make = (): {
  signal: AbortSignal
  abort: (reason?: any) => void
} => {
  const controller = new AbortController()
  return {
    signal: controller.signal,
    abort: (reason?: any) => controller.abort(reason),
  }
}

/**
 * Combine multiple signals into one
 */
export const any = (...signals: (AbortSignal | undefined)[]): AbortSignal => {
  const filtered = signals.filter((s): s is AbortSignal => s !== undefined)

  if (filtered.length === 0) {
    return new AbortController().signal
  }

  if (filtered.length === 1) {
    return filtered[0]
  }

  // Use AbortSignal.any if available (modern browsers/Node 20+)
  if (typeof AbortSignal !== 'undefined' && 'any' in AbortSignal) {
    return (AbortSignal as any).any(filtered)
  }

  // Fallback for older environments
  const controller = new AbortController()

  for (const signal of filtered) {
    if (signal.aborted) {
      controller.abort()
      break
    }

    signal.addEventListener('abort', () => controller.abort(), { once: true })
  }

  return controller.signal
}

/**
 * Create a signal that aborts after a timeout
 */
export const timeout = (ms: number): AbortSignal => {
  const controller = new AbortController()

  setTimeout(() => {
    controller.abort(new DOMException('Timeout', 'TimeoutError'))
  }, ms)

  return controller.signal
}

/**
 * Combine a signal with a timeout
 */
export const withTimeout = (
  signal: AbortSignal | undefined,
  ms: number
): AbortSignal => {
  return any(signal, timeout(ms))
}

/**
 * Check if an error is an AbortError
 */
export const isAbortError = (error: unknown): boolean => {
  return (
    error instanceof DOMException &&
    error.name === 'AbortError'
  )
}

/**
 * Throw if signal is aborted
 */
export const throwIfAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) {
    throw new DOMException('Aborted', 'AbortError')
  }
}

/**
 * Run a callback when signal aborts
 */
export const onAbort = (
  signal: AbortSignal,
  callback: () => void
): (() => void) => {
  if (signal.aborted) {
    callback()
    return () => {}
  }

  signal.addEventListener('abort', callback, { once: true })

  return () => {
    signal.removeEventListener('abort', callback)
  }
}

/**
 * Create a signal that never aborts (useful for testing)
 */
export const never = (): AbortSignal => {
  return new AbortController().signal
}

/**
 * Create an already-aborted signal
 */
export const aborted = (reason?: any): AbortSignal => {
  const controller = new AbortController()
  controller.abort(reason)
  return controller.signal
}
