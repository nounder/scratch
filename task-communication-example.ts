/**
 * Example: Task Communication with Channels, Queues, and Deferred
 *
 * Shows how to coordinate between multiple tasks using communication primitives
 */

import {
  Task,
  Channel,
  Queue,
  Deferred,
  Concurrent,
  Runtime,
  Stream,
} from "./concurrency";

console.log("=".repeat(70));
console.log("TASK COMMUNICATION EXAMPLES");
console.log("=".repeat(70));

// ============================================================================
// EXAMPLE 1: Basic Channel Communication (Producer/Consumer)
// ============================================================================

console.log("\n📡 Example 1: Producer-Consumer with Channel\n");

async function producerConsumerExample() {
  const channel = new Channel<number>();

  // Producer: sends numbers 1-5
  const producer = Task.of(async () => {
    for (let i = 1; i <= 5; i++) {
      console.log(`  Producer → Sending ${i}`);
      await channel.send(i).run();
      await Task.sleep(100).run();
    }
    await channel.close().run();
    console.log("  Producer → Done");
  });

  // Consumer: receives and processes numbers
  const consumer = Task.of(async () => {
    try {
      while (true) {
        const value = await channel.receive().run();
        console.log(`  Consumer ← Received ${value} (doubled: ${value * 2})`);
      }
    } catch (err: any) {
      if (
        err.message !== "Channel is closed and empty" &&
        err.message !== "Channel closed"
      ) {
        throw err;
      }
    }
    console.log("  Consumer → Done");
  });

  // Run both concurrently
  await Concurrent.all([producer, consumer]).run();
}

await producerConsumerExample();

// ============================================================================
// EXAMPLE 2: Queue with Capacity (Backpressure)
// ============================================================================

console.log("\n\n🚦 Example 2: Queue with Backpressure\n");

async function queueBackpressureExample() {
  const queue = new Queue<string>(2); // Capacity of 2

  // Fast producer: tries to send many items quickly
  const fastProducer = Task.of(async () => {
    const items = ["A", "B", "C", "D", "E"];
    for (const item of items) {
      console.log(`  Producer → Trying to send "${item}"...`);
      await queue.send(item).run(); // Blocks if queue is full
      console.log(`  Producer ✓ Sent "${item}"`);
    }
    await queue.close().run();
  });

  // Slow consumer: processes items slowly
  const slowConsumer = Task.of(async () => {
    try {
      while (true) {
        const value = await queue.receive().run();
        console.log(`  Consumer ← Processing "${value}"...`);
        await Task.sleep(200).run(); // Simulate slow processing
        console.log(`  Consumer ✓ Processed "${value}"`);
      }
    } catch (err: any) {
      if (
        err.message !== "Queue is closed and empty" &&
        err.message !== "Queue closed"
      ) {
        throw err;
      }
    }
  });

  await Concurrent.all([fastProducer, slowConsumer]).run();
}

await queueBackpressureExample();

// ============================================================================
// EXAMPLE 3: Deferred for Request/Response Pattern
// ============================================================================

console.log("\n\n🔄 Example 3: Request/Response with Deferred\n");

async function requestResponseExample() {
  const responseDeferred = new Deferred<string>();

  // Task 1: Sends a request and waits for response
  const requester = Task.of(async () => {
    console.log("  Requester → Sending request...");
    // In a real scenario, this would send over network/IPC
    console.log("  Requester ⏳ Waiting for response...");
    const response = await responseDeferred.task.run();
    console.log(`  Requester ✓ Got response: "${response}"`);
    return response;
  });

  // Task 2: Processes the request and sends response
  const responder = Task.of(async () => {
    console.log("  Responder ⏳ Simulating work...");
    await Task.sleep(500).run();
    const result = "Hello from responder!";
    console.log(`  Responder → Sending response: "${result}"`);
    await responseDeferred.succeed(result).run();
  });

  const [response] = await Concurrent.all([requester, responder]).run();
  console.log(`\n  Final result: "${response}"`);
}

await requestResponseExample();

// ============================================================================
// EXAMPLE 4: Pipeline with Multiple Channels
// ============================================================================

console.log("\n\n⚙️  Example 4: Multi-Stage Pipeline\n");

async function pipelineExample() {
  const inputChannel = new Channel<number>();
  const processedChannel = new Channel<number>();

  // Stage 1: Generate numbers
  const generator = Task.of(async () => {
    console.log("  Stage 1 → Generating numbers...");
    for (let i = 1; i <= 5; i++) {
      await inputChannel.send(i).run();
      console.log(`    Generated: ${i}`);
      await Task.sleep(80).run();
    }
    await inputChannel.close().run();
  });

  // Stage 2: Process (square the numbers)
  const processor = Task.of(async () => {
    console.log("  Stage 2 → Processing...");
    try {
      while (true) {
        const value = await inputChannel.receive().run();
        const squared = value * value;
        console.log(`    ${value} → ${squared}`);
        await processedChannel.send(squared).run();
      }
    } catch (err: any) {
      if (
        err.message !== "Channel is closed and empty" &&
        err.message !== "Channel closed"
      ) {
        throw err;
      }
    }
    await processedChannel.close().run();
  });

  // Stage 3: Collect results
  const collector = Task.of(async () => {
    console.log("  Stage 3 → Collecting...");
    const results: number[] = [];
    try {
      while (true) {
        const value = await processedChannel.receive().run();
        results.push(value);
        console.log(`    Collected: ${value}`);
      }
    } catch (err: any) {
      if (
        err.message !== "Channel is closed and empty" &&
        err.message !== "Channel closed"
      ) {
        throw err;
      }
    }
    return results;
  });

  const [, , results] = await Concurrent.all([
    generator,
    processor,
    collector,
  ]).run();
  console.log(`\n  Final results: [${results.join(", ")}]`);
}

await pipelineExample();

// ============================================================================
// EXAMPLE 5: Fan-Out/Fan-In Pattern
// ============================================================================

console.log("\n\n🌟 Example 5: Fan-Out/Fan-In Pattern\n");

async function fanOutFanInExample() {
  const workChannel = new Channel<number>();
  const resultsChannel = new Channel<number>();

  // Producer: sends work items
  const producer = Task.of(async () => {
    console.log("  Producer → Sending work items...");
    for (let i = 1; i <= 10; i++) {
      await workChannel.send(i).run();
    }
    await workChannel.close().run();
    console.log("  Producer → Done");
  });

  // Worker: processes items (we'll create 3 workers)
  const createWorker = (id: number) =>
    Task.of(async () => {
      console.log(`  Worker ${id} → Started`);
      let processed = 0;
      try {
        while (true) {
          const value = await workChannel.receive().run();
          console.log(`    Worker ${id} processing ${value}...`);
          await Task.sleep(Math.random() * 200).run(); // Random delay
          const result = value * 10;
          await resultsChannel.send(result).run();
          processed++;
        }
      } catch (err: any) {
        if (
          err.message !== "Channel is closed and empty" &&
          err.message !== "Channel closed"
        ) {
          throw err;
        }
      }
      console.log(`  Worker ${id} → Done (processed ${processed} items)`);
    });

  // Collector: gathers results
  const collector = Task.of(async () => {
    console.log("  Collector → Waiting for results...");
    const results: number[] = [];
    try {
      // Collect 10 results (we sent 10 work items)
      for (let i = 0; i < 10; i++) {
        const value = await resultsChannel.receive().run();
        results.push(value);
        console.log(`    Collected: ${value}`);
      }
    } catch (err: any) {
      throw err;
    }
    await resultsChannel.close().run();
    return results.sort((a, b) => a - b);
  });

  // Run producer, 3 workers, and collector concurrently
  const [, , , , results] = await Concurrent.all([
    producer,
    createWorker(1),
    createWorker(2),
    createWorker(3),
    collector,
  ]).run();

  console.log(`\n  All results: [${results.join(", ")}]`);
}

await fanOutFanInExample();

// ============================================================================
// EXAMPLE 6: Fluent API with Task Communication
// ============================================================================

console.log("\n\n✨ Example 6: Fluent API with Channels\n");

async function fluentApiExample() {
  const channel = new Channel<number>();

  const producer = Task.succeed("Starting producer")
    .tap((msg) => console.log(`  ${msg}`))
    .flatMap(() =>
      Task.of(async () => {
        for (let i = 1; i <= 3; i++) {
          await channel.send(i).run();
          console.log(`  Sent: ${i}`);
        }
        await channel.close().run();
      })
    );

  const consumer = Task.succeed("Starting consumer")
    .tap((msg) => console.log(`  ${msg}`))
    .flatMap(() =>
      Stream.runCollect(Stream.fromChannel(channel)).map((values) => {
        console.log(`  Received all: [${values.join(", ")}]`);
        return values.reduce((sum, v) => sum + v, 0);
      })
    );

  const [, sum] = await Concurrent.all([producer, consumer]).run();
  console.log(`  Sum: ${sum}`);
}

await fluentApiExample();

// ============================================================================
// EXAMPLE 7: Coordinating with Abort Signals
// ============================================================================

console.log("\n\n🛑 Example 7: Abort with Channel Communication\n");

async function abortWithChannelsExample() {
  const channel = new Channel<number>();
  const ac = new AbortController();

  const producer = Task.of(async ({ signal }) => {
    console.log("  Producer → Starting...");
    try {
      for (let i = 1; i <= 20; i++) {
        await channel.send(i).run({ signal });
        console.log(`  Sent: ${i}`);
        await Task.sleep(100).run({ signal });
      }
    } catch (err: any) {
      console.log(`  Producer ✗ Aborted: ${err.message}`);
    } finally {
      await channel.close().run();
    }
  });

  const consumer = Task.of(async ({ signal }) => {
    console.log("  Consumer → Starting...");
    try {
      while (true) {
        const value = await channel.receive().run({ signal });
        console.log(`  Received: ${value}`);
      }
    } catch (err: any) {
      if (
        err.message.includes("Aborted") ||
        err.message === "Channel closed" ||
        err.message === "Channel is closed and empty"
      ) {
        console.log(`  Consumer ✗ Aborted/Closed`);
      } else {
        throw err;
      }
    }
  });

  // Abort after 450ms
  setTimeout(() => {
    console.log("\n  🚨 ABORTING...\n");
    ac.abort();
  }, 450);

  await Concurrent.all([producer, consumer]).run({ signal: ac.signal });
  console.log("\n  Both tasks completed/aborted");
}

await abortWithChannelsExample();

console.log("\n" + "=".repeat(70));
console.log("✅ ALL COMMUNICATION EXAMPLES COMPLETED!");
console.log("=".repeat(70) + "\n");
