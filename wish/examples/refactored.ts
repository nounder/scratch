/**
 * Refactored example using Wish
 *
 * This demonstrates how the original abortable.js code becomes
 * elegant and concise with Wish's structured concurrency.
 */

import { Wish, Stream } from '../src/index.js';
import type { WishType } from '../src/index.js';

// Example async generators (same as original)
async function* streamA(ctx: { signal?: AbortSignal } = { signal: undefined }) {
  yield 'A: start';
  await Wish.sleep(50)({ signal: ctx.signal! });
  yield 'A: chunk 1';
  await Wish.sleep(80)({ signal: ctx.signal! });
  yield 'A: chunk 2';
}

async function* streamB(ctx: { signal?: AbortSignal } = { signal: undefined }) {
  yield 'B: boot';
  await Wish.sleep(30)({ signal: ctx.signal! });
  yield 'B: piece 1';
  await Wish.sleep(120)({ signal: ctx.signal! });
  yield 'B: piece 2';
}

function stream(ctx: { signal?: AbortSignal }) {
  return {
    a: streamA(ctx),
    b: streamB(ctx),
  };
}

// Example per-item work (same as original)
const doSomethingA = (v: string): WishType<void> => {
  return async (ctx) => {
    console.log(v);
    await Wish.sleep(20)(ctx);
  };
};

const doSomethingB = (v: string): WishType<void> => {
  return async (ctx) => {
    console.log(v);
    await Wish.sleep(25)(ctx);
  };
};

// ✨ THE ELEGANT WISH VERSION ✨
const iterateBothAndContinue = Wish.scoped(async (scope) => {
  const { a, b } = stream({ signal: scope.abortSignal });

  const derived = { aCount: 0, bLast: null as string | null };

  // Fork both stream processors concurrently
  const fiberA = scope.fork(
    Stream.forEach(a, async (v, ctx) => {
      derived.aCount++;
      await doSomethingA(v)(ctx);
    })
  );

  const fiberB = scope.fork(
    Stream.forEach(b, async (v, ctx) => {
      derived.bLast = v;
      await doSomethingB(v)(ctx);
    })
  );

  // Wait for both to complete (fibers are promise-like!)
  await Promise.allSettled([fiberA, fiberB]);

  // Scope automatically cleans up on exit
  return derived;
});

// Demo: abort mid-flight
(async () => {
  const ac = new AbortController();

  const runTask = Wish.run(iterateBothAndContinue, ac.signal)
    .then((res) => console.log('derived:', res))
    .catch((err) => console.log('stopped:', String(err)));

  setTimeout(
    () => ac.abort(new DOMException('Aborted', 'AbortError')),
    120
  );

  await runTask;
})();
