# Evolu Library Architecture Analysis

**Date**: 2025-11-22
**Repository**: https://github.com/evoluhq/evolu
**Focus Areas**: Streams, Concurrency Control, and Inter-System Communication

---

## Executive Summary

Evolu is a local-first database library inspired by effect.ts, implementing lightweight utilities for reactive streams, concurrency control, and inter-system communication. Rather than using complex observable libraries, Evolu builds on minimalist primitives:

- **Streams**: Store-based pub/sub with reference counting and React integration
- **Concurrency**: Task system with semaphores, mutexes, and exponential backoff retry
- **Communication**: Callback registries, auto-reconnecting WebSockets, and resource management

---

## 1. STREAMS & REACTIVE DATA FLOW

### Core Primitive: Store

**Location**: `/packages/common/src/Store.ts`

Evolu's reactive foundation is a simple but powerful store implementation:

```typescript
export interface Store<T> {
  readonly subscribe: (listener: () => void) => () => void;
  readonly get: () => T;
  readonly set: (state: T) => void;
  readonly modify: (updater: (current: T) => T) => void;
}
```

**Design Pattern**: Minimal observer pattern
- Listeners tracked in a `Set<StoreListener>`
- Only notifies on actual state changes (uses equality checks)
- Returns unsubscribe function for cleanup
- No complex observable object overhead

**Implementation Highlights**:

```typescript
export const createStore = <T>(initialState: T, eq: Eq<T> = eqStrict): Store<T> => {
  const listeners = new Set<StoreListener>();
  let currentState = initialState;

  const updateState = (newState: T) => {
    if (eq(newState, currentState)) return; // Skip if unchanged
    currentState = newState;
    listeners.forEach((listener) => listener());
  };

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    get: () => currentState,
    set: updateState,
    modify: (updater) => updateState(updater(currentState)),
  };
};
```

### Query Subscriptions with Reference Counting

**Location**: `/packages/common/src/local-first/Query.ts`

Queries are SQL queries that can be subscribed to. The innovation is reference counting:

```typescript
export const createSubscribedQueries = (rowsStore: Store<QueryRowsMap>): SubscribedQueries => {
  const subscribedQueryMap = new Map<Query, number>();

  return {
    subscribe: (query) => (listener) => {
      // Increment reference count
      subscribedQueryMap.set(query, (subscribedQueryMap.get(query) ?? 0) + 1);
      const unsubscribe = rowsStore.subscribe(listener);

      return () => {
        // Decrement or remove on unsubscribe
        const count = subscribedQueryMap.get(query);
        if (count != null && count > 1) {
          subscribedQueryMap.set(query, count - 1);
        } else {
          subscribedQueryMap.delete(query);
        }
        unsubscribe();
      };
    },
    get: () => [...subscribedQueryMap.keys()],
    has: (query) => subscribedQueryMap.has(query),
  };
};
```

**Purpose**: The system can track which queries clients care about and only sync those changes, optimizing network traffic.

### React Integration

**Location**: `/packages/react/src/useQuerySubscription.ts`

Bridges store-based reactive system to React using `useSyncExternalStore`:

```typescript
export const useQuerySubscription = <R extends Row>(
  query: Query<R>,
  options: Partial<{ readonly once: boolean }> = {},
): QueryRows<R> => {
  const evolu = useEvolu();
  const { once } = useRef(options).current;

  if (once) {
    // One-time read: subscribe but don't re-render
    useEffect(() => evolu.subscribeQuery(query)(constVoid), [evolu, query]);
    return evolu.getQueryRows(query);
  }

  // Reactive query: use React's external store API
  return useSyncExternalStore(
    useMemo(() => evolu.subscribeQuery(query), [evolu, query]),
    useMemo(() => () => evolu.getQueryRows(query), [evolu, query]),
    () => emptyRows as QueryRows<R>,
  );
};
```

**Benefits**:
- Component re-renders only when query data actually changes
- Proper Suspense handling
- Compatible with React concurrent rendering

### High-Level Hook

**Location**: `/packages/react/src/useQuery.ts`

Combines loading and subscription:

```typescript
export const useQuery = <R extends Row>(query: Query<R>, options = {}): QueryRows<R> => {
  const evolu = useEvolu();
  const isSSR = useIsSsr();

  if (isSSR) {
    if (!options.promise) void evolu.loadQuery(query);
  } else {
    use(options.promise ?? evolu.loadQuery(query)); // Suspense support
  }

  return useQuerySubscription(query, options);
};
```

---

## 2. CONCURRENCY CONTROL

### Task System

**Location**: `/packages/common/src/Task.ts`

The foundation is the Task abstraction - a lazy, cancellable async operation:

```typescript
export interface Task<T, E> {
  <TContext extends TaskContext | undefined = undefined>(
    context?: TContext,
  ): Promise<Result<T, TContext extends { signal: AbortSignal } ? E | AbortError : E>>;
}
```

**Key Features**:
1. **Laziness**: Tasks don't execute until called
2. **Cancellation**: Optional `AbortSignal` with precise type tracking
3. **Error Handling**: Type-safe error unions via Result type

**Cancellation Implementation**:

```typescript
export const toTask = <T, E>(
  fn: (context?: TaskContext) => Promise<Result<T, E>>,
): Task<T, E> =>
  ((context) => {
    const signal = context?.signal;

    // Fast path: no signal, return promise directly
    if (!signal) return fn(context);

    if (signal.aborted) {
      return Promise.resolve(err({ type: "AbortError", reason: signal.reason }));
    }

    // Slow path: use Promise.race for clean abort handling
    const { promise: abortPromise, resolve: resolveAbort } = Promise.withResolvers();
    const handleAbort = () => resolveAbort(err({ type: "AbortError", reason: signal.reason }));

    signal.addEventListener("abort", handleAbort, { once: true });

    return Promise.race([
      abortPromise,
      fn(context).then((result) => {
        signal.removeEventListener("abort", handleAbort);
        return result;
      }),
    ]);
  }) as Task<T, E>;
```

### Semaphore - Concurrency Limiter

**Location**: `/packages/common/src/Task.ts` (lines 659-719)

Controls how many tasks can run concurrently:

```typescript
export const createSemaphore = (maxConcurrent: PositiveInt): Semaphore => {
  let isDisposed = false;
  let availablePermits = maxConcurrent;
  const waitingQueue: Array<() => void> = [];
  const semaphoreController = new AbortController();

  const acquire = (): Promise<void> => {
    if (availablePermits > 0) {
      availablePermits--;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => {
      waitingQueue.push(resolve);
    });
  };

  const release = (): void => {
    if (isNonEmptyArray(waitingQueue)) {
      shiftArray(waitingQueue)(); // Wake next waiter
    } else {
      availablePermits++;
    }
  };

  return {
    withPermit: <T, E>(task: Task<T, E>): Task<T, E | AbortError> =>
      toTask(async (context): Promise<Result<T, E | AbortError>> => {
        await acquire();

        if (isDisposed) {
          return err({ type: "AbortError", reason: "Semaphore disposed" });
        }

        const signal = combineSignal(context, semaphoreController.signal);
        const result = await task({ signal });
        release();
        return result;
      }),

    [Symbol.dispose]: () => {
      if (isDisposed) return;
      isDisposed = true;
      semaphoreController.abort("Semaphore disposed");
      while (isNonEmptyArray(waitingQueue)) {
        shiftArray(waitingQueue)();
      }
    },
  };
};
```

**Pattern**: Queue-based permit management
- Available permits tracked as counter
- Waiting tasks queued if no permits
- Release wakes next waiter or increments counter

### Usage Example

```typescript
// Allow maximum 3 concurrent tasks
const semaphore = createSemaphore(PositiveInt.orThrow(3));

let currentConcurrent = 0;
const fetchData = (id: number) =>
  toTask<number, never>(async (context) => {
    currentConcurrent++;
    console.log(`start ${id} (concurrent: ${currentConcurrent})`);
    await wait("10ms")(context);
    currentConcurrent--;
    console.log(`end ${id} (concurrent: ${currentConcurrent})`);
    return ok(id * 10);
  });

// Execute with at most 3 running concurrently
const results = await Promise.all([
  semaphore.withPermit(fetchData(1))(),
  semaphore.withPermit(fetchData(2))(),
  semaphore.withPermit(fetchData(3))(),
  semaphore.withPermit(fetchData(4))(), // waits
  semaphore.withPermit(fetchData(5))(), // waits
]);
```

**Output**:
```
start 1 (concurrent: 1)
start 2 (concurrent: 2)
start 3 (concurrent: 3)
end 1 (concurrent: 2)
start 4 (concurrent: 3)
end 2 (concurrent: 2)
start 5 (concurrent: 3)
end 3 (concurrent: 2)
end 4 (concurrent: 1)
end 5 (concurrent: 0)
```

### Mutex - Exclusive Lock

**Location**: `/packages/common/src/Task.ts` (lines 765-772)

Simple wrapper over semaphore with permit count of 1:

```typescript
export const createMutex = (): Mutex => {
  const mutex = createSemaphore(PositiveInt.orThrow(1));
  return {
    withLock: mutex.withPermit,
    [Symbol.dispose]: mutex[Symbol.dispose],
  };
};
```

### Retry with Exponential Backoff

**Location**: `/packages/common/src/Task.ts` (lines 518-579)

Resilience primitive with configurable retry strategy:

```typescript
export const retry = <T, E>(
  {
    retries,
    initialDelay = "1s",
    maxDelay = "30s",
    factor = 2,
    jitter = 0.5,
    retryable = (error: E | AbortError) => !isAbortError(error),
    onRetry,
  }: RetryOptions<E>,
  task: Task<T, E>,
): Task<T, E | RetryError<E>> =>
  toTask(async (context): Promise<Result<T, E | RetryError<E>>> => {
    const initialDelayMs = durationToNonNegativeInt(initialDelay);
    const maxDelayMs = durationToNonNegativeInt(maxDelay);
    const maxRetries = PositiveInt.orThrow(retries);

    let attempt = 0;

    while (true) {
      const result = await task(context);

      if (result.ok) return result;
      if (isAbortError(result.error)) return err(result.error);

      attempt += 1;

      if (attempt > maxRetries || !retryable(result.error)) {
        return err({
          type: "RetryError",
          cause: result.error,
          attempts: attempt,
        });
      }

      // Exponential backoff with jitter (prevents thundering herd)
      const exponentialDelay = initialDelayMs * Math.pow(factor, attempt - 1);
      const cappedDelay = Math.min(exponentialDelay, maxDelayMs);
      const randomFactor = 1 - jitter + Math.random() * jitter * 2;
      const delay = Math.floor(cappedDelay * randomFactor);

      if (onRetry) {
        onRetry(result.error, attempt, delay);
      }

      const delayResult = await wait(NonNegativeInt.orThrow(delay))(context);
      if (!delayResult.ok) return delayResult;
    }
  });
```

**Features**:
- Exponential backoff with configurable factor
- Jitter to prevent thundering herd
- Configurable retryable predicate
- onRetry callback for monitoring
- Never retries on AbortError

---

## 3. INTER-SYSTEM COMMUNICATION

### Callback Registry - Request/Response Correlation

**Location**: `/packages/common/src/Callbacks.ts`

For correlating async operations across boundaries (e.g., web workers):

```typescript
export interface Callbacks<T = undefined> {
  readonly register: (callback: (arg: T) => void) => CallbackId;
  readonly execute: T extends undefined
    ? (id: CallbackId) => undefined
    : (id: CallbackId, arg: T) => undefined;
}

export const createCallbacks = <T = undefined>(deps: RandomBytesDep): Callbacks<T> => {
  const callbackMap = new Map<CallbackId, (arg: T) => void>();

  return {
    register: (callback) => {
      const id = createId<"Callback">(deps);
      callbackMap.set(id, callback);
      return id;
    },

    execute: (id: CallbackId, ...args: T extends undefined ? [] : [T]) => {
      const callback = callbackMap.get(id);
      if (!callback) return;
      callbackMap.delete(id); // Auto-cleanup
      if (args.length === 0) {
        (callback as () => void)();
      } else {
        callback(args[0]);
      }
    },
  } as Callbacks<T>;
};
```

**Use Case**: Bridge web workers and main thread where function references can't be serialized.

### WebSocket - Auto-Reconnecting Communication

**Location**: `/packages/common/src/WebSocket.ts`

Full-duplex, auto-reconnecting WebSocket implementation:

```typescript
export interface WebSocket extends Disposable {
  send: (data: string | ArrayBufferLike | Blob | ArrayBufferView) =>
    Result<void, WebSocketSendError>;
  readonly getReadyState: () => WebSocketReadyState;
  readonly isOpen: () => boolean;
}

export interface WebSocketOptions {
  onOpen?: () => void;
  onError?: (error: WebSocketError) => void;
  onClose?: (event: CloseEvent) => void;
  onMessage?: (data: string | ArrayBuffer | Blob) => void;
  retryOptions?: Omit<RetryOptions<WebSocketRetryError>, "signal">;
  binaryType?: "blob" | "arraybuffer";
}
```

**Auto-reconnect Implementation**:

```typescript
void retry(
  {
    retries: maxPositiveInt, // Practically infinite retries
    ...retryOptions,
  },
  (): Promise<Result<void, WebSocketRetryError>> =>
    new Promise((resolve) => {
      socket = new WebSocketConstructor(url, protocols);

      socket.onopen = () => {
        isOpen = true;
        onOpen?.();
      };

      socket.onerror = (event) => {
        const error = isOpen
          ? { type: "WebSocketConnectionError", event }
          : { type: "WebSocketConnectError", event };
        onError?.(error);

        if (error.type === "WebSocketConnectError") {
          resolve(err(error)); // Trigger retry
        }
      };

      socket.onclose = (event) => {
        onClose?.(event);
        resolve(err({ type: "WebSocketConnectionCloseError", event }));
      };

      socket.onmessage = (event) => {
        onMessage?.(event.data as string | ArrayBuffer | Blob);
      };
    }),
)(reconnectController);
```

**Pattern**: Uses Task-based retry for resilient reconnection with exponential backoff.

### Resource Management - Reference Counting

**Location**: `/packages/common/src/Resources.ts`

Manages shared resources (like WebSocket connections) with reference counting:

```typescript
export interface Resources<
  TResource extends Disposable,
  TResourceKey extends string,
  TResourceConfig,
  TConsumer,
  TConsumerId extends string,
> extends Disposable {
  readonly addConsumer: (consumer: TConsumer, resourceConfigs: ReadonlyArray<TResourceConfig>) => void;
  readonly removeConsumer: (consumer: TConsumer, resourceConfigs: ReadonlyArray<TResourceConfig>) => Result<...>;
  readonly getResource: (key: TResourceKey) => TResource | null;
  readonly getConsumersForResource: (key: TResourceKey) => ReadonlyArray<TConsumerId>;
  readonly hasConsumerAnyResource: (consumer: TConsumer) => boolean;
}
```

**Key Feature**: Delayed disposal to avoid resource churn:

```typescript
const scheduleDisposal = (key: TResourceKey): void => {
  const timeout = setTimeout(() => {
    const resource = resourcesMap.get(key);
    if (resource) {
      resource[Symbol.dispose]();
      resourcesMap.delete(key);
    }
    disposalTimeouts.delete(key);
  }, disposalDelay); // Default 100ms

  disposalTimeouts.set(key, timeout);
};
```

**Real-world Usage**: WebSocket connection pooling in `/packages/common/src/local-first/Sync.ts`:

```typescript
const transports = createResources<
  WebSocket,
  TransportKey,
  OwnerTransport,
  SyncOwner,
  OwnerId
>({
  createResource: (transportConfig) => createWebSocket(...),
  getResourceKey: (config) => transportConfig.url,
  getConsumerId: (owner) => owner.id,
  disposalDelay: 100,
  onConsumerAdded: (owner, webSocket) => {
    if (webSocket.isOpen()) {
      const message = createProtocolMessageForSync({ storage })(
        owner.id,
        SubscriptionFlags.Subscribe,
      );
      webSocket.send(message);
    }
  },
  onConsumerRemoved: (owner, webSocket) => {
    const message = createProtocolMessageForUnsubscribe(owner.id);
    webSocket.send(message);
  },
});
```

### Sync Protocol - High-Level Communication

**Location**: `/packages/common/src/local-first/Sync.ts` (lines 164-316)

Orchestrates synchronization between client and server:

```typescript
export interface Sync extends Disposable {
  readonly useOwner: (use: boolean, owner: SyncOwner) => void;
  readonly applyChanges: (changes: NonEmptyReadonlyArray<MutationChange>) => Result<...>;
}

const createSync = (deps: ...) => (config: SyncConfig) => {
  const createResource = (transportConfig: OwnerTransport): WebSocket => {
    return deps.createWebSocket(transportConfig.url, {
      binaryType: "arraybuffer",

      onOpen: () => {
        const ownerIds = transports.getConsumersForResource(transportKey);
        for (const ownerId of ownerIds) {
          const message = createProtocolMessageForSync({ storage })(
            ownerId,
            SubscriptionFlags.Subscribe,
          );
          webSocket.send(message);
        }
      },

      onMessage: (data: ArrayBuffer) => {
        const input = new Uint8Array(data);
        applyProtocolMessageAsClient({ storage })(input, {
          getWriteKey: (ownerId) => getSyncOwner(ownerId)?.writeKey ?? null,
        })
          .then((message) => {
            switch (message.value.type) {
              case "response":
                webSocket.send(message.value.message);
                break;
              case "no-response":
                // Sync complete
                break;
              case "broadcast":
                // Broadcast message
                break;
            }
          });
      },
    });
  };

  const transports = createResources<...>({
    createResource,
    getResourceKey: createTransportKey,
    getConsumerId: (owner) => owner.id,
    disposalDelay: 100,
    onConsumerAdded: (owner, webSocket) => { /* subscribe */ },
    onConsumerRemoved: (owner, webSocket) => { /* unsubscribe */ },
  });

  return {
    useOwner: (use, owner) => {
      const transportsToUse = owner.transports ?? config.transports;
      if (use) {
        transports.addConsumer(owner, transportsToUse);
      } else {
        transports.removeConsumer(owner, transportsToUse);
      }
    },

    applyChanges: (changes) => {
      // Apply to local storage
      // Send to remote via open transports
    },
  };
};
```

### Worker Communication

**Location**: `/packages/common/src/Worker.ts`

Type-safe worker message passing with initialization:

```typescript
export interface Worker<Input, Output> {
  readonly postMessage: (message: Input) => void;
  readonly onMessage: (callback: (message: Output) => void) => void;
}

export const createInitializedWorker = <Input, Output, Deps>({
  init,
  onMessage,
}: {
  readonly init: (...) => Promise<Deps | null>;
  readonly onMessage: (deps: Deps) => (message: Exclude<Input, { type: "init" }>) => void;
}): Worker<Input, Output> => {
  let onMessageCallback: ((msg: Output) => void) | null = null;
  let deps: Deps | null = null;
  const pendingMessages: Array<Input> = [];

  return {
    postMessage: (message) => {
      if (message.type === "init") {
        init(message, postMessage, withErrorReporting)
          .then((newDeps) => {
            deps = newDeps;
            // Process queued messages
          });
      } else {
        if (deps) {
          onMessage(deps)(message);
        } else {
          pendingMessages.push(message); // Queue until initialized
        }
      }
    },
    onMessage: (callback) => {
      onMessageCallback = callback;
    },
  };
};
```

**Pattern**: Messages are queued until worker initialization completes, ensuring no messages are lost during startup.

---

## 4. DESIGN PATTERNS & ARCHITECTURE

### Pattern Summary

| Pattern | Purpose | Implementation |
|---------|---------|-----------------|
| **Pub/Sub Stores** | Reactive state management | Store with Set of listeners |
| **Task** | Lazy, cancellable async operations | Function returning Promise\<Result\> |
| **Semaphore/Mutex** | Concurrency control | Queue-based permit management |
| **Reference Counting** | Resource lifecycle | Resources with add/remove tracking |
| **Auto-reconnect** | Network resilience | Task retry with exponential backoff |
| **Callback Registry** | Request-response correlation | Map of unique IDs to handlers |
| **Store Subscriptions** | Query change notification | Reference-counted query tracking |
| **useSyncExternalStore** | React integration | Bridge external store to React rendering |

### Effect.ts Inspiration

While Evolu doesn't directly depend on effect.ts, it shares similar philosophical approaches:

1. **Type-Safe Error Handling**: Both use Result/Either types instead of exceptions
2. **Composable Primitives**: Tasks like retry, timeout compose cleanly
3. **Resource Management**: Disposable pattern similar to effect.ts resources
4. **Cancellation via AbortSignal**: Similar to effect.ts interrupt handling
5. **Lazy Evaluation**: Tasks don't execute until called

However, Evolu's approach is more minimalist and focused on local-first sync requirements rather than full effect system semantics.

### Key Architectural Decisions

1. **No Complex Observable Libraries**: Uses simple callback-based stores instead of RxJS
2. **Explicit Subscriptions**: Favors React hooks over magical dependency tracking
3. **Type-Safety First**: Error union types prevent unhandled errors at compile time
4. **Minimal Runtime Overhead**: Fast path for non-cancellable tasks
5. **Reference Counting**: Sophisticated resource management for shared connections
6. **Binary Protocol for Sync**: Efficient WebSocket communication with CRDT-aware merging
7. **Delayed Resource Disposal**: 100ms delay prevents thrashing on rapid subscribe/unsubscribe

---

## 5. COMPLETE EXAMPLE - EVENT FLOW

**Location**: `/examples/react-vite-pwa/src/components/EvoluMinimalExample.tsx`

Complete flow showing all three communication patterns:

```typescript
// 1. Error stream subscription
evolu.subscribeError(() => {
  const error = evolu.getError();
  if (!error) return;
  alert("Evolu error occurred!");
  console.error(error);
});

// 2. Query subscription (Store-based reactive stream)
const todosQuery = evolu.createQuery((db) =>
  db
    .selectFrom("todo")
    .select(["id", "title", "isCompleted"])
    .where("isDeleted", "is not", Evolu.sqliteTrue)
    .where("title", "is not", null)
    .orderBy("createdAt"),
);

// 3. Component using reactive query (triggers re-renders via useSyncExternalStore)
const Todos: FC = () => {
  const todos = useQuery(todosQuery); // Returns live data, updates on changes
  const { insert, update } = useEvolu();

  const addTodo = () => {
    const result = insert("todo", { title: newTodoTitle }, {
      onComplete: () => setNewTodoTitle(""), // Callback after mutation
    });
    if (!result.ok) {
      alert(formatTypeError(result.error));
    }
  };

  return (
    <div>
      {todos.map((todo) => (
        <TodoItem key={todo.id} row={todo} />
      ))}
    </div>
  );
};
```

**Flow Diagram**:

```
User Action (addTodo)
  ↓
insert mutation
  ↓
Local SQLite write
  ↓
Store notification (rowsStore.set)
  ↓
Query subscribers notified
  ↓
React re-render via useSyncExternalStore
  ↓
UI updated with new todo

(In parallel)
  ↓
Sync.applyChanges
  ↓
WebSocket.send (via Resources)
  ↓
Server receives change
  ↓
Server broadcasts to other clients
  ↓
Other clients receive via onMessage
  ↓
applyProtocolMessageAsClient
  ↓
Local storage updated
  ↓
Store notification
  ↓
React re-render
```

---

## 6. FILE REFERENCE

| File | Purpose | Key Components |
|------|---------|-----------------|
| `/packages/common/src/Task.ts` | Task system | Task, Semaphore, Mutex, retry, timeout, wait |
| `/packages/common/src/Store.ts` | Reactive state | Store with pub/sub |
| `/packages/common/src/Resources.ts` | Resource management | Reference counting, delayed disposal |
| `/packages/common/src/Callbacks.ts` | Correlation | Request-response ID mapping |
| `/packages/common/src/WebSocket.ts` | Network layer | Auto-reconnecting WebSocket |
| `/packages/common/src/local-first/Query.ts` | Query system | Subscribed queries with ref counting |
| `/packages/common/src/local-first/Sync.ts` | Synchronization | Protocol implementation, owner management |
| `/packages/react/src/useQuerySubscription.ts` | React binding | useSyncExternalStore integration |
| `/packages/react/src/useQuery.ts` | React hook | Loading + subscription combined |
| `/packages/common/src/local-first/Evolu.ts` | Main API | Evolu instance, mutations, queries |
| `/packages/common/src/Worker.ts` | Worker bridge | Type-safe message passing |

---

## Conclusion

Evolu demonstrates how to build a sophisticated local-first database with:

1. **Simple but Powerful Streams**: Store-based pub/sub beats complex observables for this use case
2. **Composable Concurrency**: Task primitives compose naturally without framework magic
3. **Robust Communication**: Auto-reconnecting WebSockets with reference-counted resource management

The architecture prioritizes type safety, composability, and minimal runtime overhead - making it an excellent study in effect-inspired functional programming for real-world applications.
