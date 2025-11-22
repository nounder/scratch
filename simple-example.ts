/**
 * Simple, elegant example - the shortest path to concurrent stream processing
 */

import { Task, Stream, Concurrent, Runtime } from "./concurrency";

console.log("=".repeat(60));
console.log("SIMPLEST EXAMPLE - Concurrent Stream Processing");
console.log("=".repeat(60) + "\n");

// Define your streams
const numbers: Stream<number> = async function* ({ signal }) {
  for (let i = 1; i <= 5; i++) {
    console.log(`📊 Numbers: ${i}`);
    yield i;
    await Task.sleep(100)({ signal });
  }
};

const letters: Stream<string> = async function* ({ signal }) {
  for (const letter of ["A", "B", "C"]) {
    console.log(`🔤 Letters: ${letter}`);
    yield letter;
    await Task.sleep(150)({ signal });
  }
};

// Process both streams concurrently into a single result
const collectBoth = Concurrent.reduceStreams(
  [numbers, letters],
  { numbers: [] as number[], letters: [] as string[] },
  (state, value) => {
    if (typeof value === "number") {
      return { ...state, numbers: [...state.numbers, value] };
    } else {
      return { ...state, letters: [...state.letters, value] };
    }
  }
);

// Run it!
console.log("Starting concurrent processing...\n");
const result = await Runtime.run(collectBoth);

console.log("\n" + "─".repeat(60));
console.log("✅ Final Result:");
console.log(JSON.stringify(result, null, 2));
console.log("=".repeat(60) + "\n");

// With abort
console.log("Now with abort after 250ms...\n");
const ac = new AbortController();
setTimeout(() => {
  console.log("\n🛑 ABORTING!\n");
  ac.abort();
}, 250);

try {
  const partialResult = await Runtime.run(collectBoth, ac.signal);
  console.log("\n✅ Partial Result:");
  console.log(JSON.stringify(partialResult, null, 2));
} catch (err: any) {
  console.log(`\n✅ Aborted successfully: ${err.message}`);
}

console.log("\n" + "=".repeat(60));
console.log("That's it! Clean, composable, abortable. 🚀");
console.log("=".repeat(60) + "\n");
