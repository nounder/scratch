/**
 * Basic Wish examples demonstrating core functionality
 */

import { Wish } from '../src/index.js';
import type { WishType } from '../src/index.js';

// 1. Simple async operations
console.log('\n=== Simple Operations ===');

const greet = Wish.succeed('Hello, Wish!');
Wish.run(greet).then(console.log);

// 2. Composition with map
console.log('\n=== Map ===');

const doubled = Wish.map(Wish.succeed(21), (n) => n * 2);
Wish.run(doubled).then(console.log); // 42

// 3. Chaining with flatMap
console.log('\n=== FlatMap ===');

const fetchUser = Wish.succeed({ id: 1, name: 'Alice' });
const fetchPosts = (userId: number) => Wish.succeed([`Post by user ${userId}`]);

const userWithPosts = Wish.flatMap(fetchUser, (user) =>
  Wish.map(fetchPosts(user.id), (posts) => ({ user, posts }))
);

Wish.run(userWithPosts).then(console.log);

// 4. Concurrent operations with all
console.log('\n=== All (Concurrent) ===');

const task1 = async (signal: AbortSignal) => {
  await Wish.sleep(100)(signal);
  return 'Task 1';
};

const task2 = async (signal: AbortSignal) => {
  await Wish.sleep(50)(signal);
  return 'Task 2';
};

Wish.run(Wish.all(task1, task2)).then(console.log);

// 5. Racing operations
console.log('\n=== Race ===');

const fast = async (signal: AbortSignal) => {
  await Wish.sleep(50)(signal);
  return 'Fast';
};

const slow = async (signal: AbortSignal) => {
  await Wish.sleep(200)(signal);
  return 'Slow';
};

Wish.run(Wish.race(fast, slow)).then((winner) => console.log('Winner:', winner));

// 6. Timeout
console.log('\n=== Timeout ===');

const slowTask = async (signal: AbortSignal) => {
  await Wish.sleep(1000)(signal);
  return 'Done';
};

Wish.run(Wish.timeout(slowTask, 100))
  .then(console.log)
  .catch((err) => console.log('Timeout error:', err.message));

// 7. Retry
console.log('\n=== Retry ===');

let attempts = 0;
const flakyTask = async (_signal: AbortSignal) => {
  attempts++;
  if (attempts < 3) {
    throw new Error(`Attempt ${attempts} failed`);
  }
  return 'Success!';
};

Wish.run(Wish.retry(flakyTask, 5, 10))
  .then(console.log)
  .catch((err) => console.log('Failed:', err.message));

// 8. Structured concurrency with scoped
console.log('\n=== Scoped (Structured Concurrency) ===');

const managedConcurrency = Wish.scoped(async (scope) => {
  // Fork multiple tasks
  const fiber1 = scope.Wish.fork(async (signal) => {
    await Wish.sleep(100)(signal);
    return 'Fiber 1';
  });

  const fiber2 = scope.Wish.fork(async (signal) => {
    await Wish.sleep(50)(signal);
    return 'Fiber 2';
  });

  // Wait for results
  const results = await Promise.Wish.all([fiber1.await(), fiber2.await()]);

  // Scope automatically cleans up when function returns
  return results;
});

Wish.run(managedConcurrency).then(console.log);

// 9. Manual fiber control
console.log('\n=== Fork & Interrupt ===');

const longRunning = async (signal: AbortSignal) => {
  console.log('Starting long task...');
  await Wish.sleep(5000)(signal);
  console.log('Long task completed');
  return 'Done';
};

const fiber = Wish.fork(longRunning);

setTimeout(() => {
  console.log('Interrupting...');
  fiber.interrupt();
}, 100);

fiber
  .await()
  .then(console.log)
  .catch((err) => console.log('Interrupted:', err.name));

// 10. Error handling
console.log('\n=== Error Handling ===');

const failingTask = Wish.fail(new Error('Something went wrong'));

Wish.run(failingTask)
  .then(console.log)
  .catch((err) => console.log('Caught error:', err.message));

// Wait a bit for async operations to complete
setTimeout(() => {
  console.log('\n=== All examples completed ===');
}, 1000);
