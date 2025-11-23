/**
 * Advanced Wish patterns
 *
 * Demonstrates complex real-world scenarios and patterns.
 */

import { Wish, Stream } from '../src/index.js';
import type { WishType } from '../src/index.js';
import { forEach, mapConcurrent } from '../src/index.js';

console.log('🚀 Advanced Wish Patterns\n');

// Pattern 1: Resource Management
console.log('═══ Pattern 1: Resource Management ═══');

class Database {
  constructor(public name: string) {}

  async connect() {
    console.log(`📊 Connecting to ${this.name}...`);
    await new Promise((r) => setTimeout(r, 50));
  }

  async close() {
    console.log(`📊 Closing ${this.name}...`);
    await new Promise((r) => setTimeout(r, 50));
  }

  async query(sql: string) {
    await new Promise((r) => setTimeout(r, 10));
    return `Result of: ${sql}`;
  }
}

const withDatabase = <A>(
  name: string,
  fn: (db: Database) => Wish<A>
): WishType<A> => {
  return Wish.acquire(
    async () => {
      const db = new Database(name);
      await db.connect();
      return db;
    },
    async (db) => {
      await db.close();
    }
  ).then((db) => fn(db));
};

// Using the resource
const result1 = await Wish.run(
  withDatabase('mydb', (db) =>
    Wish.flatMap(
      async (ctx) => db.query('SELECT * FROM users'),
      (result) => async () => {
        console.log(`📊 Query result: ${result}`);
        return result;
      }
    )
  )
);

console.log('✓ Database automatically closed\n');

// Pattern 2: Worker Pool
console.log('═══ Pattern 2: Worker Pool ═══');

async function* generateTasks() {
  for (let i = 1; i <= 10; i++) {
    yield { id: i, work: Math.random() * 100 };
  }
}

const processTask = async (task: { id: number; work: number }, ctx: { ctx.signal: AbortSignal }) => {
  console.log(`⚙️  Processing task ${task.id}...`);
  await Wish.sleep(task.work)(ctx);
  return { taskId: task.id, result: task.id * 2 };
};

const results = await Wish.run(
  Stream.mapConcurrent(generateTasks(), 3, processTask) // Max 3 concurrent
);

console.log(`✓ Processed ${results.length} tasks with concurrency limit of 3\n`);

// Pattern 3: Timeout with Fallback
console.log('═══ Pattern 3: Timeout with Fallback ═══');

const fetchWithFallback = async (ctx: { ctx.signal: AbortSignal }) => {
  const primary = async (sig: AbortSignal) => {
    await Wish.sleep(2000)(sig); // Too slow
    return 'primary data';
  };

  const fallback = async (sig: AbortSignal) => {
    await Wish.sleep(100)(sig);
    return 'cached data';
  };

  try {
    return await Wish.timeout(primary, 500)(ctx);
  } catch {
    console.log('⚠️  Primary timed out, using fallback...');
    return await fallback(ctx);
  }
};

const data = await Wish.run(fetchWithFallback);
console.log(`✓ Got: ${data}\n`);

// Pattern 4: Coordinated Shutdown
console.log('═══ Pattern 4: Coordinated Shutdown ═══');

const gracefulShutdown = Wish.scoped(async (scope) => {
  console.log('🚀 Starting services...');

  // Service 1: Message queue consumer
  const service1 = scope.Wish.fork(async (ctx) => {
    console.log('  📬 Message queue started');
    try {
      while (!ctx.ctx.signal.aborted) {
        await Wish.sleep(100)(ctx);
        // Process messages...
      }
    } catch (e) {
      console.log('  📬 Message queue stopping...');
    }
    console.log('  📬 Message queue stopped');
  });

  // Service 2: HTTP server
  const service2 = scope.Wish.fork(async (ctx) => {
    console.log('  🌐 HTTP server started');
    try {
      while (!ctx.ctx.signal.aborted) {
        await Wish.sleep(150)(ctx);
        // Handle requests...
      }
    } catch (e) {
      console.log('  🌐 HTTP server stopping...');
    }
    console.log('  🌐 HTTP server stopped');
  });

  // Simulate running for a bit, then shutdown
  await Wish.sleep(300)(scope.abortSignal);

  console.log('🛑 Initiating graceful shutdown...');
  // Scope.close() will interrupt all fibers and wait for cleanup
});

await Wish.run(gracefulShutdown);
console.log('✓ All services stopped gracefully\n');

// Pattern 5: Retry with Exponential Backoff
console.log('═══ Pattern 5: Retry with Exponential Backoff ═══');

let attempts = 0;
const unreliableOperation = async (ctx: { ctx.signal: AbortSignal }) => {
  attempts++;
  console.log(`  🔄 Attempt ${attempts}...`);
  await Wish.sleep(10)(ctx);

  if (attempts < 3) {
    throw new Error('Temporary failure');
  }

  return 'Success!';
};

const retryWithBackoff = async <A>(
  wish: WishType<A>,
  maxAttempts: number
): Promise<A> => {
  return Wish.run(async (ctx) => {
    let lastError: Error | undefined;

    for (let i = 0; i < maxAttempts; i++) {
      try {
        return await wish(ctx);
      } catch (error) {
        lastError = error as Error;
        if (i < maxAttempts - 1) {
          const delay = Math.min(1000, 100 * Math.pow(2, i));
          console.log(`  ⏳ Backing off for ${delay}ms...`);
          await Wish.sleep(delay)(ctx);
        }
      }
    }

    throw lastError;
  });
};

const retryResult = await retryWithBackoff(unreliableOperation, 5);
console.log(`✓ ${retryResult}\n`);

// Pattern 6: Deferred / Manual Promise Control
console.log('═══ Pattern 6: Deferred / Manual Control ═══');

const { wish: deferredWish, resolve: resolveWish } = defer<string>();

// Start the wish
const deferredTask = Wish.run(deferredWish);

// Resolve it later
setTimeout(() => {
  console.log('  📨 Resolving deferred wish...');
  resolveWish('Resolved from outside!');
}, 100);

const deferredResult = await deferredTask;
console.log(`✓ ${deferredResult}\n`);

// Pattern 7: Pipeline with Error Recovery
console.log('═══ Pattern 7: Pipeline with Error Recovery ═══');

const stage1 = async (ctx: { ctx.signal: AbortSignal }) => {
  console.log('  ➡️  Stage 1');
  await Wish.sleep(50)(ctx);
  return 10;
};

const stage2 = async (input: number, ctx: { ctx.signal: AbortSignal }) => {
  console.log('  ➡️  Stage 2');
  await Wish.sleep(50)(ctx);
  if (Math.random() < 0.5) {
    throw new Error('Stage 2 failed');
  }
  return input * 2;
};

const stage3 = async (input: number, ctx: { ctx.signal: AbortSignal }) => {
  console.log('  ➡️  Stage 3');
  await Wish.sleep(50)(ctx);
  return input + 5;
};

const pipeline = async (ctx: { ctx.signal: AbortSignal }) => {
  const v1 = await stage1(ctx);

  let v2: number;
  try {
    v2 = await stage2(v1, ctx.signal);
  } catch {
    console.log('  ⚠️  Stage 2 failed, using fallback value');
    v2 = v1; // Fallback
  }

  const v3 = await stage3(v2, ctx.signal);
  return v3;
};

const pipelineResult = await Wish.run(pipeline);
console.log(`✓ Pipeline result: ${pipelineResult}\n`);

console.log('✨ Advanced patterns complete! ✨');

// Helper
function flatMap<A, B>(wish: WishType<A>, fn: (a: A) => Wish<B>): WishType<B> {
  return async (ctx) => {
    const result = await wish(ctx);
    return fn(result)(ctx);
  };
}
