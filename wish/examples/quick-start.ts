/**
 * Quick Start - Get up and running with Wish in 5 minutes
 */

import { sleep, scoped, run, all, race } from '../src/index.js';

console.log('🌟 Welcome to Wish! 🌟\n');

// Example 1: Simple async operations
console.log('1️⃣  Simple sleep:');
await run(sleep(100));
console.log('   Slept for 100ms ✓\n');

// Example 2: Running multiple operations concurrently
console.log('2️⃣  Concurrent operations:');
const start = Date.now();
await run(all(sleep(100), sleep(100), sleep(100)));
const elapsed = Date.now() - start;
console.log(`   Three 100ms sleeps completed in ${elapsed}ms (ran in parallel!) ✓\n`);

// Example 3: Racing operations
console.log('3️⃣  Racing operations:');
const winner = await run(
  race(
    async (signal) => {
      await sleep(50)(signal);
      return 'Fast task';
    },
    async (signal) => {
      await sleep(200)(signal);
      return 'Slow task';
    }
  )
);
console.log(`   Winner: ${winner} ✓\n`);

// Example 4: Structured concurrency with automatic cleanup
console.log('4️⃣  Structured concurrency:');
const result = await run(
  scoped(async (scope) => {
    console.log('   Starting scope...');

    // Fork multiple concurrent tasks
    const fiber1 = scope.fork(async (signal) => {
      await sleep(50)(signal);
      console.log('   Task 1 completed');
      return 1;
    });

    const fiber2 = scope.fork(async (signal) => {
      await sleep(75)(signal);
      console.log('   Task 2 completed');
      return 2;
    });

    const fiber3 = scope.fork(async (signal) => {
      await sleep(100)(signal);
      console.log('   Task 3 completed');
      return 3;
    });

    // Wait for all to complete
    const results = await Promise.all([
      fiber1.await(),
      fiber2.await(),
      fiber3.await(),
    ]);

    console.log('   Scope closing (automatic cleanup)...');
    return results.reduce((a, b) => a + b, 0);
    // Scope automatically ensures all tasks are complete before returning
  })
);
console.log(`   Sum of results: ${result} ✓\n`);

// Example 5: Cancellation
console.log('5️⃣  Cancellation:');
const ac = new AbortController();

const cancelDemo = run(
  async (signal) => {
    console.log('   Starting cancellable task...');
    await sleep(1000)(signal);
    console.log('   This will never print!');
  },
  ac.signal
);

// Cancel after 100ms
setTimeout(() => {
  console.log('   Cancelling...');
  ac.abort();
}, 100);

await cancelDemo.catch(() => {
  console.log('   Task was cancelled ✓\n');
});

// Example 6: Real-world pattern - fetch with timeout and retry
console.log('6️⃣  Real-world pattern (simulated):');

const fetchData = async (signal: AbortSignal, url: string) => {
  // Simulate API call
  await sleep(Math.random() * 200)(signal);

  // Simulate occasional failure
  if (Math.random() < 0.3) {
    throw new Error('Network error');
  }

  return { data: `Data from ${url}` };
};

const fetchWithTimeout = async (signal: AbortSignal) => {
  return race(
    async (sig) => fetchData(sig, '/api/data'),
    async (sig) => {
      await sleep(500)(sig);
      throw new Error('Timeout after 500ms');
    }
  )(signal);
};

try {
  const data = await run(fetchWithTimeout);
  console.log(`   Fetched: ${data.data} ✓`);
} catch (error) {
  console.log(`   Error: ${(error as Error).message}`);
}

console.log('\n✨ Quick start complete! Check out the other examples for more. ✨');
