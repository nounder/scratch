/**
 * Fluent API Example - Showcasing the new method-chaining interface
 *
 * Before: Task.map(Task.flatMap(task, fn1), fn2)
 * After:  task.flatMap(fn1).map(fn2)
 */

import { Task, Channel, Deferred, Runtime } from "./concurrency";

console.log("=".repeat(70));
console.log("FLUENT API SHOWCASE");
console.log("=".repeat(70));

// ============================================================================
// EXAMPLE 1: Method Chaining vs Static Functions
// ============================================================================

console.log("\n🔗 Example 1: Beautiful Method Chaining\n");

// Old way (with static functions - still supported):
// const oldWay = Task.map(
//   Task.flatMap(
//     Task.succeed(5),
//     (n) => Task.succeed(n * 2)
//   ),
//   (n) => n + 10
// );

// New way (fluent API):
const newWay = Task.succeed(5)
  .tap((n) => console.log(`  Starting with: ${n}`))
  .flatMap((n) => Task.succeed(n * 2).tap((x) => console.log(`  Doubled: ${x}`)))
  .map((n) => n + 10)
  .tap((n) => console.log(`  Added 10: ${n}`));

const result1 = await newWay.run();
console.log(`  Final result: ${result1}\n`);

// ============================================================================
// EXAMPLE 2: Built-in Timeout, Retry, Delay
// ============================================================================

console.log("⏱️  Example 2: Timeout, Retry, and Delay\n");

let attempt = 0;
const unreliableTask = Task.of(async () => {
  attempt++;
  console.log(`  Attempt ${attempt}...`);
  if (attempt < 3) {
    throw new Error("Failed!");
  }
  return "Success!";
})
  .retry(3)
  .tap((result) => console.log(`  ${result}`));

await unreliableTask.run();

console.log();

// With timeout
const slowTask = Task.sleep(5000)
  .map(() => "This will timeout")
  .withTimeout(1000)
  .catchAll((err: any) => {
    console.log(`  Caught timeout: ${err.message}`);
    return Task.succeed("Fallback value");
  });

const result2 = await slowTask.run();
console.log(`  Result: ${result2}\n`);

// ============================================================================
// EXAMPLE 3: Composing with zip and zipWith
// ============================================================================

console.log("🤝 Example 3: Combining Tasks with zip/zipWith\n");

const fetchUser = Task.succeed({ id: 1, name: "Alice" }).tap((user) =>
  console.log(`  Fetched user: ${user.name}`)
);

const fetchPosts = Task.succeed(["Post 1", "Post 2", "Post 3"]).tap((posts) =>
  console.log(`  Fetched ${posts.length} posts`)
);

// Zip two tasks into a tuple
const zipped = fetchUser.zip(fetchPosts);
const [user, posts] = await zipped.run();
console.log(`  Combined: ${user.name} has ${posts.length} posts\n`);

// ZipWith for custom combination
const combined = fetchUser.zipWith(fetchPosts, (user, posts) => ({
  userName: user.name,
  postCount: posts.length,
}));

const result3 = await combined.run();
console.log(`  ZipWith result: ${JSON.stringify(result3)}\n`);

// ============================================================================
// EXAMPLE 4: Error Handling with catchTag
// ============================================================================

console.log("❌ Example 4: Tagged Error Handling\n");

class NetworkError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NetworkError";
  }
}

class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

const riskyOperation = Task.of(async () => {
  throw new NetworkError("Connection failed");
})
  .catchTag("NetworkError", (err) => {
    console.log(`  Caught network error: ${err.message}`);
    console.log(`  Retrying with fallback...`);
    return Task.succeed("Fallback data");
  })
  .catchTag("ValidationError", (err) => {
    console.log(`  Caught validation error: ${err.message}`);
    return Task.fail(err); // Re-throw
  });

const result4 = await riskyOperation.run();
console.log(`  Result: ${result4}\n`);

// ============================================================================
// EXAMPLE 5: Delay and Race
// ============================================================================

console.log("🏁 Example 5: Delay and Race\n");

const task1 = Task.succeed("Fast task").delay(100).tap(() => console.log("  Task 1 done"));

const task2 = Task.succeed("Slow task").delay(500).tap(() => console.log("  Task 2 done"));

const winner = task1.race(task2);
const result5 = await winner.run();
console.log(`  Winner: ${result5}\n`);

// ============================================================================
// EXAMPLE 6: Ensuring Cleanup
// ============================================================================

console.log("🧹 Example 6: Guaranteed Cleanup\n");

const resource = { name: "Database connection", closed: false };

const useResource = Task.succeed("Processing data...")
  .tap((msg) => console.log(`  ${msg}`))
  .delay(200)
  .map(() => "Done processing")
  .ensuring(
    Task.of(async () => {
      console.log(`  Cleaning up ${resource.name}...`);
      resource.closed = true;
    })
  );

const result6 = await useResource.run();
console.log(`  Result: ${result6}`);
console.log(`  Resource closed: ${resource.closed}\n`);

// ============================================================================
// EXAMPLE 7: Real-World Pipeline
// ============================================================================

console.log("🚀 Example 7: Real-World Data Pipeline\n");

interface User {
  id: number;
  name: string;
  email: string;
}

interface Post {
  userId: number;
  title: string;
  content: string;
}

const validateEmail = (email: string): Task<string> =>
  email.includes("@")
    ? Task.succeed(email)
    : Task.fail(new ValidationError("Invalid email"));

const createUser = (name: string, email: string): Task<User> =>
  validateEmail(email)
    .tap(() => console.log(`  ✓ Email validated: ${email}`))
    .map(() => ({
      id: Math.floor(Math.random() * 1000),
      name,
      email,
    }))
    .tap((user) => console.log(`  ✓ User created: ${user.name} (ID: ${user.id})`));

const createPost = (user: User, title: string): Task<Post> =>
  Task.succeed({
    userId: user.id,
    title,
    content: `Post by ${user.name}`,
  }).tap((post) => console.log(`  ✓ Post created: "${post.title}"`));

const saveToDatabase = <T>(data: T): Task<T> =>
  Task.sleep(100)
    .map(() => data)
    .tap(() => console.log(`  ✓ Saved to database`));

const sendNotification = (user: User): Task<void> =>
  Task.sleep(50)
    .map(() => undefined)
    .tap(() => console.log(`  ✓ Notification sent to ${user.email}`));

// Complete pipeline
const pipeline = createUser("Bob", "bob@example.com")
  .flatMap((user) =>
    createPost(user, "Hello World")
      .flatMap(saveToDatabase)
      .zip(sendNotification(user))
      .map(([post]) => ({ user, post }))
  )
  .tap(({ user, post }) => {
    console.log(`\n  🎉 Pipeline complete!`);
    console.log(`     User: ${user.name}`);
    console.log(`     Post: ${post.title}`);
  })
  .withTimeout(5000)
  .retry(2)
  .catchAll((err: any) => {
    console.log(`  ❌ Pipeline failed: ${err.message}`);
    return Task.succeed({ user: null, post: null });
  });

await pipeline.run();

// ============================================================================
// EXAMPLE 8: Task Communication with Fluent API
// ============================================================================

console.log("\n\n📡 Example 8: Fluent API + Channels\n");

const processWithChannel = async () => {
  const channel = new Channel<number>();
  const results = new Deferred<number[]>();

  const producer = Task.succeed("Starting producer")
    .tap((msg) => console.log(`  ${msg}`))
    .flatMap(() =>
      Task.of(async () => {
        for (let i = 1; i <= 5; i++) {
          await channel.send(i * i).run();
          console.log(`  Sent: ${i * i}`);
        }
        await channel.close().run();
      })
    );

  const consumer = Task.succeed("Starting consumer")
    .tap((msg) => console.log(`  ${msg}`))
    .flatMap(() =>
      Task.of(async () => {
        const collected: number[] = [];
        try {
          while (true) {
            const value = await channel.receive().run();
            collected.push(value);
            console.log(`  Received: ${value}`);
          }
        } catch (err: any) {
          if (
            err.message !== "Channel closed" &&
            err.message !== "Channel is closed and empty"
          ) {
            throw err;
          }
        }
        return collected;
      })
    )
    .tap((values) => console.log(`  All values: [${values.join(", ")}]`));

  const [, result] = await producer.zip(consumer).run();
  return result;
};

const channelResult = await processWithChannel();
console.log(`  Sum: ${channelResult.reduce((a, b) => a + b, 0)}`);

console.log("\n" + "=".repeat(70));
console.log("✅ FLUENT API SHOWCASE COMPLETE!");
console.log("=".repeat(70));
console.log("\nKey Benefits:");
console.log("  ✨ Method chaining for readable composition");
console.log("  🎯 Built-in timeout, retry, delay methods");
console.log("  🤝 Easy task combination with zip/zipWith");
console.log("  🏷️  Tagged error handling");
console.log("  🧹 Guaranteed cleanup with ensuring");
console.log("  📦 Works seamlessly with Channels/Deferred");
console.log("=".repeat(70) + "\n");
