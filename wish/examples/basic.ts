/**
 * Basic Wish examples demonstrating core functionality
 */

import {
  succeed,
  fail,
  sleep,
  map,
  flatMap,
  all,
  race,
  timeout,
  retry,
  scoped,
  run,
  fork,
} from '../src/index.js';

// 1. Simple async operations
console.log('\n=== Simple Operations ===');

const greet = succeed('Hello, Wish!');
run(greet).then(console.log);

// 2. Composition with map
console.log('\n=== Map ===');

const doubled = map(succeed(21), (n) => n * 2);
run(doubled).then(console.log); // 42

// 3. Chaining with flatMap
console.log('\n=== FlatMap ===');

const fetchUser = succeed({ id: 1, name: 'Alice' });
const fetchPosts = (userId: number) => succeed([`Post by user ${userId}`]);

const userWithPosts = flatMap(fetchUser, (user) =>
  map(fetchPosts(user.id), (posts) => ({ user, posts }))
);

run(userWithPosts).then(console.log);

// 4. Concurrent operations with all
console.log('\n=== All (Concurrent) ===');

const task1 = async (signal: AbortSignal) => {
  await sleep(100)(signal);
  return 'Task 1';
};

const task2 = async (signal: AbortSignal) => {
  await sleep(50)(signal);
  return 'Task 2';
};

run(all(task1, task2)).then(console.log);

// 5. Racing operations
console.log('\n=== Race ===');

const fast = async (signal: AbortSignal) => {
  await sleep(50)(signal);
  return 'Fast';
};

const slow = async (signal: AbortSignal) => {
  await sleep(200)(signal);
  return 'Slow';
};

run(race(fast, slow)).then((winner) => console.log('Winner:', winner));

// 6. Timeout
console.log('\n=== Timeout ===');

const slowTask = async (signal: AbortSignal) => {
  await sleep(1000)(signal);
  return 'Done';
};

run(timeout(slowTask, 100))
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

run(retry(flakyTask, 5, 10))
  .then(console.log)
  .catch((err) => console.log('Failed:', err.message));

// 8. Structured concurrency with scoped
console.log('\n=== Scoped (Structured Concurrency) ===');

const managedConcurrency = scoped(async (scope) => {
  // Fork multiple tasks
  const fiber1 = scope.fork(async (signal) => {
    await sleep(100)(signal);
    return 'Fiber 1';
  });

  const fiber2 = scope.fork(async (signal) => {
    await sleep(50)(signal);
    return 'Fiber 2';
  });

  // Wait for results
  const results = await Promise.all([fiber1.await(), fiber2.await()]);

  // Scope automatically cleans up when function returns
  return results;
});

run(managedConcurrency).then(console.log);

// 9. Manual fiber control
console.log('\n=== Fork & Interrupt ===');

const longRunning = async (signal: AbortSignal) => {
  console.log('Starting long task...');
  await sleep(5000)(signal);
  console.log('Long task completed');
  return 'Done';
};

const fiber = fork(longRunning);

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

const failingTask = fail(new Error('Something went wrong'));

run(failingTask)
  .then(console.log)
  .catch((err) => console.log('Caught error:', err.message));

// Wait a bit for async operations to complete
setTimeout(() => {
  console.log('\n=== All examples completed ===');
}, 1000);
