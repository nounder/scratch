/**
 * Simple demo showing the concurrency library in action
 */

import { Task, Stream, Concurrent, Runtime } from "./concurrency";

console.log("=".repeat(60));
console.log("CONCURRENCY LIBRARY DEMO");
console.log("=".repeat(60));

// ============================================================================
// EXAMPLE 1: Basic Task Composition
// ============================================================================

console.log("\n📝 Example 1: Basic Task Composition\n");

const fetchUser = Task.of(async () => {
  console.log("  → Fetching user...");
  await new Promise((r) => setTimeout(r, 100));
  return { id: 1, name: "Alice" };
});

const fetchPosts = (userId: number) =>
  Task.of(async () => {
    console.log(`  → Fetching posts for user ${userId}...`);
    await new Promise((r) => setTimeout(r, 100));
    return ["Post 1", "Post 2", "Post 3"];
  });

const getUserWithPosts = Task.flatMap(fetchUser, (user) =>
  Task.map(fetchPosts(user.id), (posts) => ({ user, posts }))
);

const result1 = await Runtime.run(getUserWithPosts);
console.log("  ✓ Result:", result1);

// ============================================================================
// EXAMPLE 2: Concurrent Tasks
// ============================================================================

console.log("\n\n🚀 Example 2: Running Tasks in Parallel\n");

const task1 = Task.of(async () => {
  console.log("  → Task 1 starting...");
  await new Promise((r) => setTimeout(r, 150));
  console.log("  ✓ Task 1 done");
  return "Result 1";
});

const task2 = Task.of(async () => {
  console.log("  → Task 2 starting...");
  await new Promise((r) => setTimeout(r, 100));
  console.log("  ✓ Task 2 done");
  return "Result 2";
});

const task3 = Task.of(async () => {
  console.log("  → Task 3 starting...");
  await new Promise((r) => setTimeout(r, 80));
  console.log("  ✓ Task 3 done");
  return "Result 3";
});

const allTasks = Concurrent.all([task1, task2, task3]);
const results = await Runtime.run(allTasks);
console.log("  ✓ All results:", results);

// ============================================================================
// EXAMPLE 3: Streams
// ============================================================================

console.log("\n\n🌊 Example 3: Processing Streams\n");

const numberStream: Stream<number> = async function* () {
  for (let i = 1; i <= 5; i++) {
    console.log(`  → Yielding ${i}`);
    yield i;
    await new Promise((r) => setTimeout(r, 50));
  }
};

const doubledStream = Stream.map(numberStream, (n) => n * 2);

const sum = await Runtime.run(
  Stream.runFold(doubledStream, 0, (acc, n) => {
    console.log(`  + Adding ${n} to sum (${acc} + ${n} = ${acc + n})`);
    return acc + n;
  })
);

console.log("  ✓ Final sum:", sum);

// ============================================================================
// EXAMPLE 4: Concurrent Streams (Like the Original Code!)
// ============================================================================

console.log("\n\n⚡ Example 4: Concurrent Streams with Abort\n");

const streamA: Stream<string> = async function* ({ signal }) {
  yield "A: start";
  await Task.sleep(50)({ signal });
  yield "A: chunk 1";
  await Task.sleep(80)({ signal });
  yield "A: chunk 2";
};

const streamB: Stream<string> = async function* ({ signal }) {
  yield "B: boot";
  await Task.sleep(30)({ signal });
  yield "B: piece 1";
  await Task.sleep(120)({ signal });
  yield "B: piece 2";
};

const processA = (value: string): Task<void> =>
  Task.of(async ({ signal }) => {
    console.log(`  ${value}`);
    await Task.sleep(20)({ signal });
  });

const processB = (value: string): Task<void> =>
  Task.of(async ({ signal }) => {
    console.log(`  ${value}`);
    await Task.sleep(25)({ signal });
  });

// Process both streams concurrently with separate state
const processStreams: Task<{ aCount: number; bLast: string | null }> =
  Task.map(
    Concurrent.all([
      Stream.runFold(
        Stream.tap(streamA, processA),
        0,
        (count, _) => count + 1
      ),
      Stream.runFold(
        Stream.tap(streamB, processB),
        null as string | null,
        (_, value) => value
      ),
    ]),
    ([aCount, bLast]) => ({ aCount, bLast })
  );

console.log("  Starting concurrent stream processing...");
const result4 = await Runtime.run(processStreams);
console.log("  ✓ Result:", result4);

// ============================================================================
// EXAMPLE 5: Abort Signal in Action
// ============================================================================

console.log("\n\n🛑 Example 5: Aborting Mid-Flight\n");

const longRunningTask = Task.flatMap(
  Task.of(async ({ signal }) => {
    console.log("  → Starting long task...");
    for (let i = 1; i <= 10; i++) {
      console.log(`  → Step ${i}/10`);
      await Task.sleep(100)({ signal });
    }
    return "Completed!";
  }),
  (result) => Task.succeed(result)
);

const ac = new AbortController();

// Abort after 350ms
setTimeout(() => {
  console.log("\n  🚨 ABORTING...\n");
  ac.abort();
}, 350);

try {
  const result5 = await Runtime.run(longRunningTask, ac.signal);
  console.log("  ✓ Result:", result5);
} catch (err: any) {
  console.log("  ✓ Caught abort:", err.message);
}

// ============================================================================
// EXAMPLE 6: Timeout
// ============================================================================

console.log("\n\n⏱️  Example 6: Task with Timeout\n");

const slowTask = Task.of(async () => {
  console.log("  → Starting slow task (5 seconds)...");
  await new Promise((r) => setTimeout(r, 5000));
  return "Done";
});

console.log("  Setting 2-second timeout...");
try {
  await Runtime.runWithTimeout(slowTask, 2000);
} catch (err) {
  console.log("  ✓ Task timed out as expected!");
}

// ============================================================================
// EXAMPLE 7: Error Handling
// ============================================================================

console.log("\n\n❌ Example 7: Error Handling and Recovery\n");

const riskyTask = Task.of(async () => {
  console.log("  → Attempting risky operation...");
  await new Promise((r) => setTimeout(r, 100));
  throw new Error("Something went wrong!");
});

const safeTask = Task.catchAll(riskyTask, (error: any) => {
  console.log(`  ⚠️  Caught error: ${error.message}`);
  console.log("  → Recovering with fallback...");
  return Task.succeed("Fallback value");
});

const result7 = await Runtime.run(safeTask);
console.log("  ✓ Result:", result7);

// ============================================================================
// DONE!
// ============================================================================

console.log("\n" + "=".repeat(60));
console.log("✅ ALL EXAMPLES COMPLETED!");
console.log("=".repeat(60) + "\n");
