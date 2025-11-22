/**
 * Refactored example using Wish
 *
 * This demonstrates how the original abortable.js code becomes
 * elegant and concise with Wish's structured concurrency.
 */

import { sleep, scoped, run, Wish } from '../src/index.js';
import { forEach } from '../src/stream.js';

// Example async generators (same as original)
async function* streamA({ signal }: { signal?: AbortSignal } = {}) {
  yield 'A: start';
  await sleep(50)(signal!);
  yield 'A: chunk 1';
  await sleep(80)(signal!);
  yield 'A: chunk 2';
}

async function* streamB({ signal }: { signal?: AbortSignal } = {}) {
  yield 'B: boot';
  await sleep(30)(signal!);
  yield 'B: piece 1';
  await sleep(120)(signal!);
  yield 'B: piece 2';
}

function stream(opts: { signal?: AbortSignal }) {
  return {
    a: streamA(opts),
    b: streamB(opts),
  };
}

// Example per-item work (same as original)
const doSomethingA = (v: string): Wish<void> => {
  return async (signal) => {
    console.log(v);
    await sleep(20)(signal);
  };
};

const doSomethingB = (v: string): Wish<void> => {
  return async (signal) => {
    console.log(v);
    await sleep(25)(signal);
  };
};

// ✨ THE ELEGANT WISH VERSION ✨
const iterateBothAndContinue = scoped(async (scope) => {
  const { a, b } = stream({ signal: scope.abortSignal });

  const derived = { aCount: 0, bLast: null as string | null };

  // Fork both stream processors concurrently
  const fiberA = scope.fork(
    forEach(a, async (v, signal) => {
      derived.aCount++;
      await doSomethingA(v)(signal);
    })
  );

  const fiberB = scope.fork(
    forEach(b, async (v, signal) => {
      derived.bLast = v;
      await doSomethingB(v)(signal);
    })
  );

  // Wait for both to complete
  await Promise.allSettled([fiberA.await(), fiberB.await()]);

  // Scope automatically cleans up on exit
  return derived;
});

// Demo: abort mid-flight
(async () => {
  const ac = new AbortController();

  const runTask = run(iterateBothAndContinue, ac.signal)
    .then((res) => console.log('derived:', res))
    .catch((err) => console.log('stopped:', String(err)));

  setTimeout(
    () => ac.abort(new DOMException('Aborted', 'AbortError')),
    120
  );

  await runTask;
})();
