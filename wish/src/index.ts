/**
 * Wish - A lightweight, elegant concurrency library
 *
 * The async library we wish we had - playful, powerful, and practical.
 */

// Export core types and classes
export type { Wish as WishType } from './Core.js';
export { Fiber, Scope, AbortError } from './Core.js';

// Export namespaces
export * as Wish from './Wish.js';
export * as Stream from './Stream.js';
