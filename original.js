// Run with: node original.js  or  bun original.js
// This is the original code for comparison

// Abort-aware sleep
function sleep(ms, signal) {
  return new Promise((res, rej) => {
    if (signal?.aborted) return rej(new DOMException("Aborted", "AbortError"));
    const id = setTimeout(res, ms);
    const onAbort = () => { clearTimeout(id); rej(new DOMException("Aborted", "AbortError")); };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// Example async generators that cooperate with AbortSignal
async function* streamA({ signal } = {}) {
  yield "A: start";
  await sleep(50, signal);
  yield "A: chunk 1";
  await sleep(80, signal);
  yield "A: chunk 2";
}
async function* streamB({ signal } = {}) {
  yield "B: boot";
  await sleep(30, signal);
  yield "B: piece 1";
  await sleep(120, signal);
  yield "B: piece 2";
}

// stream() returns two async iterators; both receive the same AbortSignal
function stream(opts) {
  return { a: streamA(opts), b: streamB(opts) };
}

// Example per-item async work that also cooperates with AbortSignal
async function doSomethingA(v, signal) {
  // custom logic…
  console.log(v);
  await sleep(20, signal);
}
async function doSomethingB(v, signal) {
  // custom logic…
  console.log(v);
  await sleep(25, signal);
}

// Ensure all subtasks and iterators close when aborted.
// Disregards generators' return values; derives its own result.
async function iterateBothAndContinue({ signal } = {}) {
  const { a, b } = stream({ signal });

  // Track spawned subtasks for coordinated shutdown
  const inflight = new Set();
  const track = p => { inflight.add(p); p.finally(() => inflight.delete(p)); return p; };

  // On abort: proactively close iterators
  const stopIterators = async () => {
    try { await a.return?.(); } catch {}
    try { await b.return?.(); } catch {}
  };
  const onAbort = () => { stopIterators(); };
  signal?.addEventListener("abort", onAbort, { once: true });

  const derived = { aCount: 0, bLast: null };

  const doneA = (async () => {
    try {
      for await (const v of a) {
        derived.aCount++;
        await track(doSomethingA(v, signal));
      }
    } finally {
      // Ensure iterator is closed even on errors/abort
      await a.return?.().catch(() => {});
    }
  })();

  const doneB = (async () => {
    try {
      for await (const v of b) {
        derived.bLast = v;
        await track(doSomethingB(v, signal));
      }
    } finally {
      await b.return?.().catch(() => {});
    }
  })();

  try {
    await Promise.allSettled([doneA, doneB]);     // wait for both to finish or be aborted
  } finally {
    signal?.removeEventListener("abort", onAbort);
    await stopIterators();
    // Wait for all in-flight subtasks to settle
    await Promise.allSettled([...inflight]);
  }

  return derived;
}

// Demo: abort mid-flight
(async () => {
  const ac = new AbortController();

  const run = iterateBothAndContinue({ signal: ac.signal })
    .then(res => console.log("derived:", res))
    .catch(err => console.log("stopped:", String(err)));

  setTimeout(() => ac.abort(new DOMException("Aborted", "AbortError")), 120);

  await run;
})();
