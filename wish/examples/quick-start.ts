/**
 * Quick Start - Get up and running with Wish in 5 minutes
 */

import { Wish } from '../src/index.js';

console.log('🌟 Welcome to Wish! 🌟\n');

// Example 1: Simple async operations
console.log('1️⃣  Simple sleep:');
await Wish.run(Wish.sleep(100));
console.log('   Slept for 100ms ✓\n');

// Example 2: Running multiple operations concurrently
console.log('2️⃣  Concurrent operations:');
const start = Date.now();
await Wish.run(Wish.all(Wish.sleep(100), Wish.sleep(100), Wish.sleep(100)));
const elapsed = Date.now() - start;
console.log(`   Three 100ms sleeps completed in ${elapsed}ms (ran in parallel!) ✓\n`);

// Example 3: Racing operations
console.log('3️⃣  Racing operations:');
const winner = await Wish.run(
  Wish.race(
    async (ctx) => {
      await Wish.sleep(50)(ctx);
      return 'Fast task';
    },
    async (ctx) => {
      await Wish.sleep(200)(ctx);
      return 'Slow task';
    }
  )
);
console.log(`   Winner: ${winner} ✓\n`);

// Example 4: Structured concurrency with automatic cleanup
console.log('4️⃣  Structured concurrency:');
const result = await Wish.run(
  Wish.scoped(async (scope) => {
    console.log('   Starting scope...');

    // Fork multiple concurrent tasks
    const fiber1 = scope.fork(async (ctx) => {
      await Wish.sleep(50)(ctx);
      console.log('   Task 1 completed');
      return 1;
    });

    const fiber2 = scope.fork(async (ctx) => {
      await Wish.sleep(75)(ctx);
      console.log('   Task 2 completed');
      return 2;
    });

    const fiber3 = scope.fork(async (ctx) => {
      await Wish.sleep(100)(ctx);
      console.log('   Task 3 completed');
      return 3;
    });

    // Wait for all to complete (fibers are promise-like!)
    const results = await Promise.all([
      fiber1,
      fiber2,
      fiber3,
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

const cancelDemo = Wish.run(
  async (ctx) => {
    console.log('   Starting cancellable task...');
    await Wish.sleep(1000)(ctx);
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

const fetchData = async (ctx: { signal: AbortSignal }, url: string) => {
  // Simulate API call
  await Wish.sleep(Math.random() * 200)(ctx);

  // Simulate occasional failure
  if (Math.random() < 0.3) {
    throw new Error('Network error');
  }

  return { data: `Data from ${url}` };
};

const fetchWithTimeout = async (ctx: { signal: AbortSignal }) => {
  return Wish.race(
    async (ctx2) => fetchData(ctx2, '/api/data'),
    async (ctx2) => {
      await Wish.sleep(500)(ctx2);
      throw new Error('Timeout after 500ms');
    }
  )(ctx);
};

try {
  const data = await Wish.run(fetchWithTimeout);
  console.log(`   Fetched: ${data.data} ✓`);
} catch (error) {
  console.log(`   Error: ${(error as Error).message}`);
}

console.log('\n✨ Quick start complete! Check out the other examples for more. ✨');
