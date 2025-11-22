# Evolu Library - Usage Examples

Practical examples for each core interface and function in Evolu, excluding worker communication and sync layer.

---

## 1. Store - Reactive State Management

### Basic Store Usage

```typescript
import { createStore } from "@evolu/common";

// Create a store with initial state
const counterStore = createStore(0);

// Subscribe to changes
const unsubscribe = counterStore.subscribe(() => {
  console.log("Counter changed:", counterStore.get());
});

// Update state
counterStore.set(5);
// Output: Counter changed: 5

counterStore.modify((current) => current + 1);
// Output: Counter changed: 6

// Cleanup
unsubscribe();
```

### Store with Complex State

```typescript
interface User {
  id: string;
  name: string;
  email: string;
}

const userStore = createStore<User | null>(null);

// Subscribe to user changes
userStore.subscribe(() => {
  const user = userStore.get();
  if (user) {
    console.log(`User logged in: ${user.name}`);
  } else {
    console.log("User logged out");
  }
});

// Login
userStore.set({
  id: "123",
  name: "Alice",
  email: "alice@example.com",
});
// Output: User logged in: Alice

// Logout
userStore.set(null);
// Output: User logged out
```

### Store with Custom Equality

```typescript
import { createStore, Eq } from "@evolu/common";

interface Settings {
  theme: "light" | "dark";
  notifications: boolean;
}

// Custom equality: only compare theme
const themeEq: Eq<Settings> = (a, b) => a.theme === b.theme;

const settingsStore = createStore<Settings>(
  { theme: "light", notifications: true },
  themeEq
);

settingsStore.subscribe(() => {
  console.log("Theme changed!");
});

// This will NOT trigger subscription (theme unchanged)
settingsStore.set({ theme: "light", notifications: false });

// This WILL trigger subscription (theme changed)
settingsStore.set({ theme: "dark", notifications: false });
// Output: Theme changed!
```

### Multiple Subscribers

```typescript
const dataStore = createStore({ count: 0, label: "Counter" });

// First subscriber - logs count
const unsub1 = dataStore.subscribe(() => {
  console.log("Count:", dataStore.get().count);
});

// Second subscriber - logs label
const unsub2 = dataStore.subscribe(() => {
  console.log("Label:", dataStore.get().label);
});

dataStore.modify((state) => ({ ...state, count: state.count + 1 }));
// Output:
// Count: 1
// Label: Counter

// Cleanup both
unsub1();
unsub2();
```

---

## 2. Task System

### Basic Task Creation and Execution

```typescript
import { toTask, ok, err } from "@evolu/common";

// Simple task that always succeeds
const fetchUser = (id: string) =>
  toTask<User, Error>(async () => {
    const response = await fetch(`/api/users/${id}`);
    if (!response.ok) {
      return err(new Error("Failed to fetch user"));
    }
    const user = await response.json();
    return ok(user);
  });

// Execute the task
const result = await fetchUser("123")();
if (result.ok) {
  console.log("User:", result.value);
} else {
  console.error("Error:", result.error);
}
```

### Task with Cancellation

```typescript
import { toTask, ok, err, AbortError } from "@evolu/common";

const longRunningTask = toTask<string, Error>(async (context) => {
  for (let i = 0; i < 10; i++) {
    // Check if cancelled
    if (context?.signal?.aborted) {
      return err({ type: "AbortError", reason: context.signal.reason });
    }

    await new Promise((resolve) => setTimeout(resolve, 1000));
    console.log(`Step ${i + 1} completed`);
  }

  return ok("Task completed!");
});

// Run with cancellation
const controller = new AbortController();

// Cancel after 3 seconds
setTimeout(() => {
  controller.abort("User cancelled");
}, 3000);

const result = await longRunningTask({ signal: controller.signal });
if (result.ok) {
  console.log(result.value);
} else {
  console.log("Cancelled:", result.error.reason);
  // Output: Cancelled: User cancelled
}
```

### Task Composition

```typescript
import { toTask, ok, err } from "@evolu/common";

// Task 1: Fetch user
const fetchUser = (id: string) =>
  toTask<User, Error>(async () => {
    const user = await fetch(`/api/users/${id}`).then((r) => r.json());
    return ok(user);
  });

// Task 2: Fetch user's posts
const fetchPosts = (userId: string) =>
  toTask<Post[], Error>(async () => {
    const posts = await fetch(`/api/posts?userId=${userId}`).then((r) => r.json());
    return ok(posts);
  });

// Compose tasks
const fetchUserWithPosts = (id: string) =>
  toTask<{ user: User; posts: Post[] }, Error>(async (context) => {
    // Execute first task
    const userResult = await fetchUser(id)(context);
    if (!userResult.ok) return userResult;

    // Execute second task
    const postsResult = await fetchPosts(id)(context);
    if (!postsResult.ok) return postsResult;

    return ok({
      user: userResult.value,
      posts: postsResult.value,
    });
  });

// Execute composed task
const result = await fetchUserWithPosts("123")();
if (result.ok) {
  console.log("User:", result.value.user);
  console.log("Posts:", result.value.posts.length);
}
```

---

## 3. Retry - Exponential Backoff

### Basic Retry

```typescript
import { retry, toTask, ok, err } from "@evolu/common";

let attempts = 0;
const unreliableTask = toTask<string, Error>(async () => {
  attempts++;
  console.log(`Attempt ${attempts}`);

  if (attempts < 3) {
    return err(new Error("Service unavailable"));
  }

  return ok("Success!");
});

const taskWithRetry = retry(
  {
    retries: 5,
    initialDelay: "500ms",
    maxDelay: "5s",
    factor: 2,
  },
  unreliableTask
);

const result = await taskWithRetry();
// Output:
// Attempt 1
// (wait ~500ms)
// Attempt 2
// (wait ~1000ms)
// Attempt 3

if (result.ok) {
  console.log(result.value); // "Success!"
}
```

### Retry with Custom Retryable Logic

```typescript
import { retry, toTask, ok, err } from "@evolu/common";

type ApiError =
  | { type: "NetworkError"; message: string }
  | { type: "ValidationError"; message: string }
  | { type: "AuthError"; message: string };

const apiCall = toTask<Data, ApiError>(async () => {
  // Simulated API call
  return err({ type: "NetworkError", message: "Timeout" });
});

const taskWithSmartRetry = retry(
  {
    retries: 3,
    initialDelay: "1s",
    // Only retry network errors, not auth or validation errors
    retryable: (error) => {
      if ("type" in error && error.type === "NetworkError") {
        return true;
      }
      return false;
    },
  },
  apiCall
);

const result = await taskWithSmartRetry();
// Will retry on NetworkError but not on ValidationError or AuthError
```

### Retry with Progress Monitoring

```typescript
import { retry, toTask, ok, err } from "@evolu/common";

const apiCall = toTask<string, Error>(async () => {
  if (Math.random() > 0.3) {
    return err(new Error("Random failure"));
  }
  return ok("Success");
});

const taskWithMonitoring = retry(
  {
    retries: 5,
    initialDelay: "1s",
    maxDelay: "10s",
    factor: 2,
    jitter: 0.5,
    onRetry: (error, attempt, delay) => {
      console.log(`Retry ${attempt}/5 after ${delay}ms`);
      console.log(`Error: ${error.message}`);

      // Update UI or send to monitoring service
      updateProgressBar(attempt / 5);
    },
  },
  apiCall
);

const result = await taskWithMonitoring();
```

---

## 4. Semaphore - Concurrency Limiter

### Basic Semaphore Usage

```typescript
import { createSemaphore, toTask, ok, PositiveInt } from "@evolu/common";

// Allow maximum 3 concurrent operations
const semaphore = createSemaphore(PositiveInt.orThrow(3));

const fetchData = (id: number) =>
  toTask<number, never>(async () => {
    console.log(`Starting fetch ${id}`);
    await new Promise((resolve) => setTimeout(resolve, 1000));
    console.log(`Completed fetch ${id}`);
    return ok(id * 10);
  });

// Launch 10 tasks, but only 3 will run concurrently
const results = await Promise.all([
  semaphore.withPermit(fetchData(1))(),
  semaphore.withPermit(fetchData(2))(),
  semaphore.withPermit(fetchData(3))(),
  semaphore.withPermit(fetchData(4))(),
  semaphore.withPermit(fetchData(5))(),
  semaphore.withPermit(fetchData(6))(),
  semaphore.withPermit(fetchData(7))(),
  semaphore.withPermit(fetchData(8))(),
  semaphore.withPermit(fetchData(9))(),
  semaphore.withPermit(fetchData(10))(),
]);

// Output:
// Starting fetch 1
// Starting fetch 2
// Starting fetch 3
// (wait 1s)
// Completed fetch 1
// Starting fetch 4
// Completed fetch 2
// Starting fetch 5
// Completed fetch 3
// Starting fetch 6
// ... etc

console.log("All results:", results);

// Cleanup
semaphore[Symbol.dispose]();
```

### Rate Limiting API Calls

```typescript
import { createSemaphore, toTask, ok, wait, PositiveInt } from "@evolu/common";

// Limit to 5 concurrent API requests
const apiSemaphore = createSemaphore(PositiveInt.orThrow(5));

const callApi = (endpoint: string) =>
  toTask<Response, Error>(async () => {
    const response = await fetch(endpoint);
    return ok(response);
  });

// Process 100 items with max 5 concurrent
const items = Array.from({ length: 100 }, (_, i) => i);

const results = await Promise.all(
  items.map((item) =>
    apiSemaphore.withPermit(
      callApi(`/api/items/${item}`)
    )()
  )
);

console.log(`Processed ${results.length} items`);
```

### Semaphore with Resource Disposal

```typescript
import { createSemaphore, toTask, ok, PositiveInt } from "@evolu/common";

// Database connection pool with max 10 connections
const dbSemaphore = createSemaphore(PositiveInt.orThrow(10));

const queryDatabase = (sql: string) =>
  toTask<QueryResult, Error>(async () => {
    // Acquire connection from pool (via semaphore)
    const result = await db.query(sql);
    return ok(result);
  });

// Use with automatic cleanup
{
  using semaphore = dbSemaphore; // Automatic disposal at block end

  const results = await Promise.all([
    semaphore.withPermit(queryDatabase("SELECT * FROM users"))(),
    semaphore.withPermit(queryDatabase("SELECT * FROM posts"))(),
    semaphore.withPermit(queryDatabase("SELECT * FROM comments"))(),
  ]);
} // Semaphore disposed here, aborting all queued tasks
```

---

## 5. Mutex - Exclusive Lock

### Basic Mutex Usage

```typescript
import { createMutex, toTask, ok } from "@evolu/common";

const mutex = createMutex();
let sharedResource = 0;

const incrementTask = (id: number) =>
  toTask<number, never>(async () => {
    console.log(`Task ${id} waiting for lock`);
    const current = sharedResource;
    await new Promise((resolve) => setTimeout(resolve, 100));
    sharedResource = current + 1;
    console.log(`Task ${id} incremented to ${sharedResource}`);
    return ok(sharedResource);
  });

// All tasks will execute sequentially (mutex = semaphore with 1 permit)
const results = await Promise.all([
  mutex.withLock(incrementTask(1))(),
  mutex.withLock(incrementTask(2))(),
  mutex.withLock(incrementTask(3))(),
  mutex.withLock(incrementTask(4))(),
  mutex.withLock(incrementTask(5))(),
]);

console.log("Final value:", sharedResource); // 5

// Output:
// Task 1 waiting for lock
// Task 2 waiting for lock
// Task 3 waiting for lock
// Task 4 waiting for lock
// Task 5 waiting for lock
// Task 1 incremented to 1
// Task 2 incremented to 2
// Task 3 incremented to 3
// Task 4 incremented to 4
// Task 5 incremented to 5

mutex[Symbol.dispose]();
```

### File Write Protection

```typescript
import { createMutex, toTask, ok, err } from "@evolu/common";
import fs from "fs/promises";

const fileMutex = createMutex();

const writeToFile = (data: string) =>
  toTask<void, Error>(async () => {
    try {
      // Read current content
      let content = "";
      try {
        content = await fs.readFile("log.txt", "utf-8");
      } catch {
        // File doesn't exist yet
      }

      // Append new data
      content += data + "\n";

      // Write back
      await fs.writeFile("log.txt", content);

      return ok(undefined);
    } catch (error) {
      return err(error as Error);
    }
  });

// Multiple concurrent writes, but mutex ensures they don't corrupt the file
await Promise.all([
  fileMutex.withLock(writeToFile("Log entry 1"))(),
  fileMutex.withLock(writeToFile("Log entry 2"))(),
  fileMutex.withLock(writeToFile("Log entry 3"))(),
  fileMutex.withLock(writeToFile("Log entry 4"))(),
]);

// File will contain all 4 entries in order without corruption
```

### Critical Section Pattern

```typescript
import { createMutex, toTask, ok } from "@evolu/common";

class BankAccount {
  private balance = 1000;
  private mutex = createMutex();

  withdraw(amount: number) {
    return this.mutex.withLock(
      toTask<number, Error>(async () => {
        console.log(`Attempting to withdraw ${amount}`);

        // Critical section: check and update balance atomically
        if (this.balance < amount) {
          return err(new Error("Insufficient funds"));
        }

        // Simulate some processing time
        await new Promise((resolve) => setTimeout(resolve, 100));

        this.balance -= amount;
        console.log(`Withdrew ${amount}, new balance: ${this.balance}`);
        return ok(this.balance);
      })
    );
  }

  dispose() {
    this.mutex[Symbol.dispose]();
  }
}

const account = new BankAccount();

// Try to withdraw more than available concurrently
const results = await Promise.all([
  account.withdraw(300)(),
  account.withdraw(400)(),
  account.withdraw(500)(),
]);

// Only some will succeed due to mutex-protected balance checks
results.forEach((result, i) => {
  if (result.ok) {
    console.log(`Withdrawal ${i + 1} succeeded: ${result.value}`);
  } else {
    console.log(`Withdrawal ${i + 1} failed: ${result.error.message}`);
  }
});

account.dispose();
```

---

## 6. Callbacks - Request/Response Correlation

### Basic Callback Registry

```typescript
import { createCallbacks } from "@evolu/common";

const callbacks = createCallbacks<string>();

// Register a callback
const id = callbacks.register((message) => {
  console.log("Received:", message);
});

console.log("Callback ID:", id);

// Later, execute the callback
callbacks.execute(id, "Hello!");
// Output: Received: Hello!

// Trying to execute again does nothing (auto-cleanup)
callbacks.execute(id, "World!"); // No output
```

### Async Request Tracking

```typescript
import { createCallbacks, createId } from "@evolu/common";

interface ApiResponse {
  requestId: string;
  data: any;
}

const pendingRequests = createCallbacks<ApiResponse>();

// Simulated API client
class ApiClient {
  send(endpoint: string): Promise<any> {
    return new Promise((resolve, reject) => {
      // Register callback for this request
      const requestId = pendingRequests.register((response) => {
        if (response.data.error) {
          reject(new Error(response.data.error));
        } else {
          resolve(response.data);
        }
      });

      // Send request with ID
      websocket.send(JSON.stringify({
        id: requestId,
        endpoint,
      }));
    });
  }
}

// When response arrives from WebSocket
websocket.onmessage = (event) => {
  const response: ApiResponse = JSON.parse(event.data);

  // Execute the callback for this request
  pendingRequests.execute(response.requestId, response);
};

// Usage
const client = new ApiClient();
const data = await client.send("/api/users");
console.log("User data:", data);
```

### Callback Cleanup Pattern

```typescript
import { createCallbacks } from "@evolu/common";

const eventCallbacks = createCallbacks<{ type: string; data: any }>();

// Register multiple event handlers
const onUserLogin = eventCallbacks.register((event) => {
  if (event.type === "login") {
    console.log("User logged in:", event.data);
  }
});

const onUserLogout = eventCallbacks.register((event) => {
  if (event.type === "logout") {
    console.log("User logged out");
  }
});

// Trigger events
eventCallbacks.execute(onUserLogin, { type: "login", data: { userId: "123" } });
// Output: User logged in: { userId: "123" }

eventCallbacks.execute(onUserLogout, { type: "logout", data: null });
// Output: User logged out

// Callbacks are automatically removed after execution
// No memory leaks!
```

---

## 7. WebSocket - Auto-Reconnecting Communication

### Basic WebSocket with Auto-Reconnect

```typescript
import { createWebSocket } from "@evolu/common";

const ws = createWebSocket("wss://api.example.com/socket", {
  onOpen: () => {
    console.log("Connected!");
    // Send initial subscription message
    ws.send(JSON.stringify({ type: "subscribe", channel: "updates" }));
  },

  onMessage: (data) => {
    const message = JSON.parse(data as string);
    console.log("Received:", message);
  },

  onError: (error) => {
    console.error("WebSocket error:", error);
  },

  onClose: (event) => {
    console.log("Disconnected:", event.reason);
    // Will automatically retry connection
  },

  retryOptions: {
    retries: Infinity,
    initialDelay: "1s",
    maxDelay: "30s",
    factor: 2,
    onRetry: (error, attempt, delay) => {
      console.log(`Reconnecting (attempt ${attempt}) in ${delay}ms...`);
    },
  },
});

// Send messages
const result = ws.send(JSON.stringify({ type: "ping" }));
if (!result.ok) {
  console.error("Failed to send:", result.error);
}

// Check connection state
if (ws.isOpen()) {
  console.log("WebSocket is open");
}

// Cleanup (stops reconnection attempts)
ws[Symbol.dispose]();
```

### Binary Data WebSocket

```typescript
import { createWebSocket } from "@evolu/common";

const ws = createWebSocket("wss://api.example.com/binary", {
  binaryType: "arraybuffer",

  onOpen: () => {
    console.log("Binary WebSocket connected");

    // Send binary data
    const buffer = new Uint8Array([1, 2, 3, 4, 5]);
    ws.send(buffer);
  },

  onMessage: (data) => {
    if (data instanceof ArrayBuffer) {
      const view = new Uint8Array(data);
      console.log("Received binary:", Array.from(view));
    }
  },
});
```

### WebSocket with State Management

```typescript
import { createWebSocket, createStore } from "@evolu/common";

type ConnectionState = "connecting" | "connected" | "disconnected" | "error";

const connectionStore = createStore<ConnectionState>("connecting");

const ws = createWebSocket("wss://api.example.com/socket", {
  onOpen: () => {
    connectionStore.set("connected");
  },

  onError: (error) => {
    connectionStore.set("error");
    showNotification("Connection error", "error");
  },

  onClose: () => {
    connectionStore.set("disconnected");
  },

  onMessage: (data) => {
    const message = JSON.parse(data as string);
    handleMessage(message);
  },

  retryOptions: {
    retries: Infinity,
    initialDelay: "2s",
    maxDelay: "60s",
    onRetry: (error, attempt) => {
      connectionStore.set("connecting");
      showNotification(`Reconnecting (attempt ${attempt})...`, "info");
    },
  },
});

// Subscribe to connection state changes
connectionStore.subscribe(() => {
  const state = connectionStore.get();
  updateUIConnectionIndicator(state);
});
```

---

## 8. Resources - Reference-Counted Resource Management

### Basic Resource Management

```typescript
import { createResources } from "@evolu/common";

interface DatabaseConnection {
  query: (sql: string) => Promise<any>;
  [Symbol.dispose]: () => void;
}

type ConnectionKey = string & { readonly brand: unique symbol };
type ConsumerId = string & { readonly brand: unique symbol };

const dbConnections = createResources<
  DatabaseConnection,
  ConnectionKey,
  { host: string; database: string },
  { id: ConsumerId; name: string },
  ConsumerId
>({
  createResource: (config) => {
    console.log(`Creating connection to ${config.host}/${config.database}`);
    return createDatabaseConnection(config);
  },

  getResourceKey: (config) =>
    `${config.host}:${config.database}` as ConnectionKey,

  getConsumerId: (consumer) => consumer.id,

  disposalDelay: 100, // Wait 100ms before disposing unused resources

  onConsumerAdded: (consumer, connection) => {
    console.log(`${consumer.name} connected to database`);
  },

  onConsumerRemoved: (consumer, connection) => {
    console.log(`${consumer.name} disconnected from database`);
  },
});

// Add consumers
const service1 = { id: "svc1" as ConsumerId, name: "UserService" };
const service2 = { id: "svc2" as ConsumerId, name: "OrderService" };

dbConnections.addConsumer(service1, [
  { host: "localhost", database: "users" }
]);
// Output: Creating connection to localhost/users
// Output: UserService connected to database

dbConnections.addConsumer(service2, [
  { host: "localhost", database: "users" } // Same config, reuses connection
]);
// Output: OrderService connected to database

// Get shared resource
const connection = dbConnections.getResource("localhost:users" as ConnectionKey);
await connection?.query("SELECT * FROM users");

// Remove consumer
dbConnections.removeConsumer(service1, [
  { host: "localhost", database: "users" }
]);
// Output: UserService disconnected from database
// Connection still alive (service2 still using it)

dbConnections.removeConsumer(service2, [
  { host: "localhost", database: "users" }
]);
// Output: OrderService disconnected from database
// After 100ms: Connection disposed

dbConnections[Symbol.dispose]();
```

### WebSocket Connection Pool

```typescript
import { createResources, createWebSocket } from "@evolu/common";

interface WebSocketConfig {
  url: string;
}

interface Consumer {
  id: string;
  onMessage: (data: any) => void;
}

const wsPool = createResources<
  ReturnType<typeof createWebSocket>,
  string,
  WebSocketConfig,
  Consumer,
  string
>({
  createResource: (config) => {
    console.log(`Opening WebSocket to ${config.url}`);

    return createWebSocket(config.url, {
      onOpen: () => console.log(`WebSocket ${config.url} opened`),
      onClose: () => console.log(`WebSocket ${config.url} closed`),
      onMessage: (data) => {
        // Broadcast to all consumers
        const consumers = wsPool.getConsumersForResource(config.url);
        consumers.forEach((consumerId) => {
          // Notify each consumer (would need consumer registry)
        });
      },
    });
  },

  getResourceKey: (config) => config.url,
  getConsumerId: (consumer) => consumer.id,
  disposalDelay: 5000, // Keep WebSocket alive for 5s after last consumer

  onConsumerAdded: (consumer, ws) => {
    console.log(`Consumer ${consumer.id} subscribed`);
  },

  onConsumerRemoved: (consumer, ws) => {
    console.log(`Consumer ${consumer.id} unsubscribed`);
  },
});

// Multiple components sharing same WebSocket
const component1 = {
  id: "comp1",
  onMessage: (data: any) => console.log("Comp1:", data),
};

const component2 = {
  id: "comp2",
  onMessage: (data: any) => console.log("Comp2:", data),
};

// Both use same WebSocket URL
wsPool.addConsumer(component1, [{ url: "wss://api.example.com" }]);
// Output: Opening WebSocket to wss://api.example.com
// Output: WebSocket wss://api.example.com opened
// Output: Consumer comp1 subscribed

wsPool.addConsumer(component2, [{ url: "wss://api.example.com" }]);
// Output: Consumer comp2 subscribed (reuses existing WebSocket)

// Component1 unmounts
wsPool.removeConsumer(component1, [{ url: "wss://api.example.com" }]);
// Output: Consumer comp1 unsubscribed
// WebSocket stays open (component2 still using it)

// Component2 unmounts
wsPool.removeConsumer(component2, [{ url: "wss://api.example.com" }]);
// Output: Consumer comp2 unsubscribed
// After 5s: WebSocket wss://api.example.com closed

wsPool[Symbol.dispose]();
```

---

## 9. Query Subscriptions

### Basic Query Subscription

```typescript
import { createSubscribedQueries, createStore, Query } from "@evolu/common";

type QueryRowsMap = Map<Query, any[]>;
const rowsStore = createStore<QueryRowsMap>(new Map());

const subscribedQueries = createSubscribedQueries(rowsStore);

// Define a query
const todosQuery = "SELECT * FROM todos WHERE completed = 0" as Query;

// Subscribe to query
const unsubscribe = subscribedQueries.subscribe(todosQuery)(() => {
  console.log("Todos query data changed!");
  const rows = rowsStore.get().get(todosQuery);
  console.log("Current todos:", rows);
});

// Check if query is subscribed
console.log(subscribedQueries.has(todosQuery)); // true

// Simulate data change
rowsStore.modify((map) => {
  const newMap = new Map(map);
  newMap.set(todosQuery, [
    { id: 1, title: "Learn Evolu", completed: 0 },
    { id: 2, title: "Build app", completed: 0 },
  ]);
  return newMap;
});
// Output: Todos query data changed!
// Output: Current todos: [{ id: 1, ... }, { id: 2, ... }]

// Get all subscribed queries
console.log(subscribedQueries.get()); // [todosQuery]

unsubscribe();
```

### Multiple Subscriptions to Same Query

```typescript
import { createSubscribedQueries, createStore, Query } from "@evolu/common";

const rowsStore = createStore<Map<Query, any[]>>(new Map());
const subscribedQueries = createSubscribedQueries(rowsStore);

const usersQuery = "SELECT * FROM users" as Query;

// Component 1 subscribes
const unsub1 = subscribedQueries.subscribe(usersQuery)(() => {
  console.log("Component 1 notified");
});

// Component 2 subscribes (same query)
const unsub2 = subscribedQueries.subscribe(usersQuery)(() => {
  console.log("Component 2 notified");
});

// Component 3 subscribes (same query)
const unsub3 = subscribedQueries.subscribe(usersQuery)(() => {
  console.log("Component 3 notified");
});

// Query is tracked once with ref count = 3
console.log(subscribedQueries.has(usersQuery)); // true

// Trigger update
rowsStore.modify((map) => {
  const newMap = new Map(map);
  newMap.set(usersQuery, [{ id: 1, name: "Alice" }]);
  return newMap;
});
// Output:
// Component 1 notified
// Component 2 notified
// Component 3 notified

// Unsubscribe components
unsub1(); // Ref count: 2
console.log(subscribedQueries.has(usersQuery)); // still true

unsub2(); // Ref count: 1
console.log(subscribedQueries.has(usersQuery)); // still true

unsub3(); // Ref count: 0
console.log(subscribedQueries.has(usersQuery)); // false - query removed
```

---

## 10. React Integration

### useQuery Hook - Basic Usage

```typescript
import { useQuery } from "@evolu/react";
import { evolu } from "./evolu";

const TodoList: React.FC = () => {
  // Define query
  const todosQuery = evolu.createQuery((db) =>
    db
      .selectFrom("todo")
      .select(["id", "title", "isCompleted"])
      .where("isDeleted", "is not", true)
      .orderBy("createdAt", "desc")
  );

  // Subscribe to query (auto re-renders on changes)
  const todos = useQuery(todosQuery);

  return (
    <ul>
      {todos.map((todo) => (
        <li key={todo.id}>
          {todo.title} {todo.isCompleted ? "✓" : "○"}
        </li>
      ))}
    </ul>
  );
};
```

### useQuery with Loading State

```typescript
import { useQuery } from "@evolu/react";
import { Suspense } from "react";

const UserProfile: React.FC<{ userId: string }> = ({ userId }) => {
  const userQuery = evolu.createQuery((db) =>
    db
      .selectFrom("user")
      .select(["id", "name", "email"])
      .where("id", "=", userId)
  );

  const users = useQuery(userQuery);
  const user = users[0];

  if (!user) {
    return <div>User not found</div>;
  }

  return (
    <div>
      <h1>{user.name}</h1>
      <p>{user.email}</p>
    </div>
  );
};

// Wrap in Suspense for loading state
const App = () => (
  <Suspense fallback={<div>Loading user...</div>}>
    <UserProfile userId="123" />
  </Suspense>
);
```

### useQuery with "once" Option (No Re-renders)

```typescript
import { useQuery } from "@evolu/react";

const InitialDataLoader: React.FC = () => {
  // Load query once, don't re-render on changes
  const configQuery = evolu.createQuery((db) =>
    db.selectFrom("config").selectAll()
  );

  const config = useQuery(configQuery, { once: true });

  // This component won't re-render when config changes in DB
  // Useful for initial data that doesn't need reactivity

  return <div>App Version: {config[0]?.version}</div>;
};
```

### useQuerySubscription - Lower-Level Hook

```typescript
import { useQuerySubscription } from "@evolu/react";
import { useEffect } from "react";

const TodoCounter: React.FC = () => {
  const todosQuery = evolu.createQuery((db) =>
    db
      .selectFrom("todo")
      .select(["id"])
      .where("isCompleted", "=", false)
  );

  // Subscribe to query changes
  const todos = useQuerySubscription(todosQuery);

  // Run side effect when todos change
  useEffect(() => {
    if (todos.length > 10) {
      showNotification("You have many pending todos!");
    }
  }, [todos.length]);

  return <div>Pending todos: {todos.length}</div>;
};
```

### Multiple Queries in One Component

```typescript
import { useQuery } from "@evolu/react";

const Dashboard: React.FC = () => {
  const usersQuery = evolu.createQuery((db) =>
    db.selectFrom("user").select(["id", "name"])
  );

  const postsQuery = evolu.createQuery((db) =>
    db.selectFrom("post").select(["id", "title", "authorId"])
  );

  const commentsQuery = evolu.createQuery((db) =>
    db.selectFrom("comment").select(["id", "postId", "content"])
  );

  // All queries loaded and subscribed independently
  const users = useQuery(usersQuery);
  const posts = useQuery(postsQuery);
  const comments = useQuery(commentsQuery);

  return (
    <div>
      <h2>Users: {users.length}</h2>
      <h2>Posts: {posts.length}</h2>
      <h2>Comments: {comments.length}</h2>
    </div>
  );
};
```

### Query with Mutations

```typescript
import { useQuery, useEvolu } from "@evolu/react";

const TodoManager: React.FC = () => {
  const evolu = useEvolu();

  const todosQuery = evolu.createQuery((db) =>
    db
      .selectFrom("todo")
      .select(["id", "title", "isCompleted"])
      .orderBy("createdAt", "desc")
  );

  const todos = useQuery(todosQuery);

  const addTodo = (title: string) => {
    evolu.create("todo", { title, isCompleted: false });
  };

  const toggleTodo = (id: string, isCompleted: boolean) => {
    evolu.update("todo", { id, isCompleted: !isCompleted });
  };

  const deleteTodo = (id: string) => {
    evolu.update("todo", { id, isDeleted: true });
  };

  return (
    <div>
      <button onClick={() => addTodo("New task")}>Add Todo</button>

      <ul>
        {todos.map((todo) => (
          <li key={todo.id}>
            <input
              type="checkbox"
              checked={todo.isCompleted ?? false}
              onChange={() => toggleTodo(todo.id, todo.isCompleted ?? false)}
            />
            <span>{todo.title}</span>
            <button onClick={() => deleteTodo(todo.id)}>Delete</button>
          </li>
        ))}
      </ul>
    </div>
  );
};
```

### Query with Filtering and Sorting

```typescript
import { useQuery } from "@evolu/react";
import { useState } from "react";

const FilterableList: React.FC = () => {
  const [filter, setFilter] = useState<"all" | "completed" | "active">("all");
  const [sortBy, setSortBy] = useState<"title" | "createdAt">("createdAt");

  const todosQuery = evolu.createQuery((db) => {
    let query = db.selectFrom("todo").select(["id", "title", "isCompleted", "createdAt"]);

    // Apply filter
    if (filter === "completed") {
      query = query.where("isCompleted", "=", true);
    } else if (filter === "active") {
      query = query.where("isCompleted", "=", false);
    }

    // Apply sort
    query = query.orderBy(sortBy, "desc");

    return query;
  });

  const todos = useQuery(todosQuery);

  return (
    <div>
      <div>
        <button onClick={() => setFilter("all")}>All</button>
        <button onClick={() => setFilter("active")}>Active</button>
        <button onClick={() => setFilter("completed")}>Completed</button>
      </div>

      <div>
        <button onClick={() => setSortBy("title")}>Sort by Title</button>
        <button onClick={() => setSortBy("createdAt")}>Sort by Date</button>
      </div>

      <ul>
        {todos.map((todo) => (
          <li key={todo.id}>{todo.title}</li>
        ))}
      </ul>
    </div>
  );
};
```

---

## Summary

This document provides practical, runnable examples for:

1. **Store** - Reactive state with subscriptions
2. **Task** - Lazy, cancellable async operations
3. **Retry** - Exponential backoff with custom logic
4. **Semaphore** - Concurrency limiting
5. **Mutex** - Exclusive locks
6. **Callbacks** - Request/response correlation
7. **WebSocket** - Auto-reconnecting connections
8. **Resources** - Reference-counted resource management
9. **Query Subscriptions** - Reference-counted query tracking
10. **React Hooks** - useQuery and useQuerySubscription

Each example demonstrates real-world usage patterns and best practices for building local-first applications with Evolu.
