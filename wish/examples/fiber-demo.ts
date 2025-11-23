/**
 * Fiber Demo - Demonstrating promise-like Fiber API
 */

import { Wish, Fiber } from '../src/index.js';

console.log('🧵 Fiber Demo - Promise-like API\n');

// Example 1: Using .then() on Fiber
console.log('1️⃣  Using .then() on Fiber:');
const fiber1 = Wish.fork(async (ctx) => {
  await Wish.sleep(50)(ctx);
  return 'Hello from Fiber!';
});

fiber1.then((result) => {
  console.log(`   Result: ${result} ✓\n`);
});

await Wish.sleep(100);

// Example 2: Using .catch() on Fiber
console.log('2️⃣  Using .catch() on Fiber:');
const fiber2 = Wish.fork(async (ctx) => {
  await Wish.sleep(50)(ctx);
  throw new Error('Oops!');
});

fiber2.catch((error) => {
  console.log(`   Caught error: ${error.message} ✓\n`);
});

await Wish.sleep(100);

// Example 3: Using .finally() on Fiber
console.log('3️⃣  Using .finally() on Fiber:');
const fiber3 = Wish.fork(async (ctx) => {
  await Wish.sleep(50)(ctx);
  return 'Done!';
});

fiber3.finally(() => {
  console.log('   Fiber completed (finally) ✓\n');
});

await Wish.sleep(100);

// Example 4: Chaining like a Promise
console.log('4️⃣  Chaining Fiber like a Promise:');
const fiber4 = Wish.fork(async (ctx) => {
  await Wish.sleep(50)(ctx);
  return 42;
});

fiber4
  .then((n) => n * 2)
  .then((n) => {
    console.log(`   Doubled: ${n} ✓\n`);
  });

await Wish.sleep(100);

// Example 5: Using await directly on Fiber
console.log('5️⃣  Using await directly on Fiber:');
const fiber5 = Wish.fork(async (ctx) => {
  await Wish.sleep(50)(ctx);
  return 'Direct await!';
});

const result5 = await fiber5;
console.log(`   Result: ${result5} ✓\n`);

// Example 6: Interrupting a Fiber
console.log('6️⃣  Interrupting a Fiber:');
const fiber6 = Wish.fork(async (ctx) => {
  await Wish.sleep(1000)(ctx);
  return 'This will not complete';
});

setTimeout(() => {
  console.log('   Interrupting...');
  fiber6.interrupt();
}, 50);

fiber6
  .catch((error) => {
    console.log(`   Fiber interrupted: ${error.name} ✓\n`);
  });

await Wish.sleep(100);

console.log('✨ All Fiber examples complete! ✨');
