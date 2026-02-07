# effect-smol (Effect v4) HttpClient Research

## Overview

In effect-smol, the HTTP modules have been **moved into the core `effect` package** under an `unstable` namespace, rather than living in a separate `@effect/platform` package:

```typescript
import { HttpClient, HttpClientRequest, HttpClientResponse, FetchHttpClient } from "effect/unstable/http"
```

Repository: [Effect-TS/effect-smol](https://github.com/Effect-TS/effect-smol)

---

## File Structure

All core HTTP files live under `/packages/effect/src/unstable/http/`:

```
HttpClient.ts              -- Main client module (~1209 lines)
HttpClientError.ts         -- Error model
HttpClientRequest.ts       -- Request construction
HttpClientResponse.ts      -- Response handling
HttpBody.ts                -- Body types
Headers.ts                 -- Header types
HttpMethod.ts              -- Method definitions
FetchHttpClient.ts         -- Fetch-based implementation
HttpMiddleware.ts
HttpTraceContext.ts         -- W3C/B3 trace context propagation
HttpEffect.ts              -- Server-side handler utilities
HttpIncomingMessage.ts     -- Base incoming message interface
Cookies.ts
Etag.ts
UrlParams.ts
index.ts                   -- Barrel re-export
```

Platform-specific:
```
/packages/platform-node/src/NodeHttpClient.ts  -- Undici + node:http + Fetch
```

---

## Core HttpClient Interface

```typescript
export interface HttpClient extends HttpClient.With<Error.HttpClientError> {}

export declare namespace HttpClient {
  export interface With<E, R = never> extends Pipeable, Inspectable {
    readonly [TypeId]: typeof TypeId
    readonly preprocess: Preprocess<E, R>
    readonly postprocess: Postprocess<E, R>
    readonly execute: (
      request: HttpClientRequest
    ) => Effect<HttpClientResponse, E, R>

    readonly get: (url: string | URL, options?: Options.NoBody) => Effect<HttpClientResponse, E, R>
    readonly head: (url: string | URL, options?: Options.NoBody) => Effect<HttpClientResponse, E, R>
    readonly post: (url: string | URL, options?: Options.NoUrl) => Effect<HttpClientResponse, E, R>
    readonly patch: (url: string | URL, options?: Options.NoUrl) => Effect<HttpClientResponse, E, R>
    readonly put: (url: string | URL, options?: Options.NoUrl) => Effect<HttpClientResponse, E, R>
    readonly del: (url: string | URL, options?: Options.NoUrl) => Effect<HttpClientResponse, E, R>
    readonly options: (url: string | URL, options?: Options.NoUrl) => Effect<HttpClientResponse, E, R>
  }

  export type Preprocess<E, R> = (
    request: HttpClientRequest
  ) => Effect<HttpClientRequest, E, R>

  export type Postprocess<E, R> = (
    request: Effect<HttpClientRequest, E, R>
  ) => Effect<HttpClientResponse, E, R>
}
```

The client is fundamentally a **preprocess/postprocess pair**. All shorthand methods (`get`, `post`, etc.) create a request and call `execute`, which pipelines preprocess into postprocess.

### Service Registration (v4 paradigm)

Uses the new **`ServiceMap.Service`** pattern instead of `Context.Tag`:

```typescript
export const HttpClient: ServiceMap.Service<HttpClient, HttpClient> =
  ServiceMap.Service<HttpClient, HttpClient>("effect/HttpClient")
```

Access from within an Effect:

```typescript
const client = yield* HttpClient.HttpClient
// or use top-level accessors:
const response = yield* HttpClient.get("https://example.com/")
```

---

## Key Combinators

### Constructors

- **`make(f)`** -- Takes `(request, url, signal, fiber) => Effect<Response, Error>`. Handles URL resolution, abort signal management, tracing span creation, wraps response in `InterruptibleResponse` (uses `FinalizationRegistry` for GC-based abort cleanup).
- **`makeWith(postprocess, preprocess)`** -- Directly construct from preprocess/postprocess functions.

### Request Transformation

- **`mapRequest(self, f)`** -- Pure request transformation (appended to preprocess)
- **`mapRequestEffect(self, f)`** -- Effectful request transformation (appended)
- **`mapRequestInput(self, f)`** -- Pure transformation prepended to existing preprocess
- **`mapRequestInputEffect(self, f)`** -- Effectful transformation prepended
- **`transform(self, f)`** -- Transform both request and response
- **`transformResponse(self, f)`** -- Transform only the response

### Side Effects

- **`tap(self, f)`** -- Side-effect on successful response
- **`tapError(self, f)`** -- Side-effect on failed response
- **`tapRequest(self, f)`** -- Side-effect on request before sending

### Error Handling

- **`catch(self, f)`** -- Catch and recover from errors
- **`catchTag(self, tag, f)`** -- Catch errors by discriminant tag
- **`catchTags(self, cases)`** -- Catch multiple error tags

### Filtering

- **`filterOrElse(self, predicate, orElse)`** -- Filter with alternative
- **`filterOrFail(self, predicate, orFailWith)`** -- Filter or fail
- **`filterStatus(self, f)`** -- Filter by HTTP status code
- **`filterStatusOk(self)`** -- Filter to 2xx only

### Retry

- **`retry(self, options | schedule)`** -- Retry with options or schedule
- **`retryTransient(self, options)`** -- Smart retry for transient errors (408, 429, 500, 502, 503, 504, timeouts, transport errors). Three modes: `"errors-only"`, `"response-only"`, `"both"`

### Other

- **`withCookiesRef(self, ref)`** -- Automatic cookie management via `Ref<Cookies>`
- **`withScope(self)`** -- Tie request lifetime to a Scope
- **`followRedirects(self, maxRedirects?)`** -- Auto-follow 3xx redirects (default 10)
- **`layerMergedServices(effect)`** -- Create a `Layer<HttpClient>` from an Effect, merging surrounding services

### Configuration References

Uses `ServiceMap.Reference` (v4's replacement for `FiberRef`):

- **`TracerDisabledWhen`** -- Predicate to disable tracing for certain requests
- **`TracerPropagationEnabled`** -- Boolean to enable/disable trace context propagation (default: true)
- **`SpanNameGenerator`** -- Function to generate span names (default: `"http.client {METHOD}"`)

---

## Error Model

Single wrapper with typed reason classes (documented in `/.specs/http-client-error-reason-pattern.md`):

```typescript
export class HttpClientError extends Data.TaggedError("HttpClientError")<{
  readonly reason: HttpClientErrorReason
}> {
  get request(): HttpClientRequest { return this.reason.request }
  get response(): HttpClientResponse | undefined { /* ... */ }
  get message(): string { return this.reason.message }
}
```

### Reason Classes

**Request reasons:**
- `TransportError` -- network/transport failures
- `EncodeError` -- request body encoding failures
- `InvalidUrlError` -- invalid URL construction

**Response reasons:**
- `StatusCodeError` -- unexpected HTTP status codes
- `DecodeError` -- response body decoding failures
- `EmptyBodyError` -- attempted to read body from empty response

```typescript
export type RequestError = TransportError | EncodeError | InvalidUrlError
export type ResponseError = StatusCodeError | DecodeError | EmptyBodyError
export type HttpClientErrorReason = RequestError | ResponseError
```

Also includes `HttpClientErrorSchema` for serialization via the Schema system.

---

## HttpClientRequest

Plain data object:

```typescript
export interface HttpClientRequest extends Inspectable, Pipeable {
  readonly method: HttpMethod
  readonly url: string
  readonly urlParams: UrlParams.UrlParams
  readonly hash: string | undefined
  readonly headers: Headers.Headers
  readonly body: HttpBody.HttpBody
}
```

**Constructors:** `get`, `post`, `put`, `del`, `head`, `patch`, `options`, `make(method)`

**Combinators:** `modify`, `setMethod`, `setHeader`, `setHeaders`, `basicAuth`, `bearerToken`, `accept`, `acceptJson`, `setUrl`, `prependUrl`, `appendUrl`, `updateUrl`, `setUrlParam`, `setUrlParams`, `appendUrlParam`, `appendUrlParams`, `setHash`, `removeHash`, `setBody`, `bodyUint8Array`, `bodyText`, `bodyJson`, `bodyJsonUnsafe`, `schemaBodyJson`, `bodyUrlParams`, `bodyFormData`, `bodyStream`, `bodyFile`, `toUrl`

---

## HttpClientResponse

```typescript
export interface HttpClientResponse extends HttpIncomingMessage<HttpClientError> {
  readonly request: HttpClientRequest
  readonly status: number
  readonly cookies: Cookies.Cookies
  readonly formData: Effect<FormData, HttpClientError>
}
```

**Key functions:**
- **`fromWeb(request, source)`** -- From Web API `Response`
- **`schemaJson(schema)`** -- Decode response with Schema (status + headers + body)
- **`schemaNoBody(schema)`** -- Decode only status + headers
- **`schemaBodyJson(schema)`** -- Decode just the JSON body
- **`stream(effect)`** -- Extract response stream from Effect<Response>
- **`matchStatus(self, cases)`** -- Pattern match on status code with wildcard ranges (`"2xx"`, `"3xx"`, `"4xx"`, `"5xx"`, plus `orElse`)
- **`filterStatus(self, f)`** / **`filterStatusOk(self)`** -- Status filtering

---

## Platform Implementations

### FetchHttpClient (core package, ~70 lines)

- Backed by `globalThis.fetch`
- `Fetch` function reference is a `ServiceMap.Reference` (overridable)
- `RequestInit` is a `ServiceMap.Service` for default options
- Uses `HttpClient.layerMergedServices` for context propagation
- Supports streaming uploads via `duplex: "half"`

### NodeHttpClient (platform-node)

Three implementations:
1. **Fetch** -- Re-exports `FetchHttpClient`
2. **Undici** -- High-performance via Undici dispatcher. Has `Dispatcher` service, `UndiciOptions` reference
3. **node:http** -- Native `node:http`/`node:https` with `HttpAgent` service

---

## Built-in Tracing

The `make()` constructor has built-in OpenTelemetry-compatible tracing:

- Automatically creates a client span with kind `"client"`
- Sets standard attributes: `http.request.method`, `server.address`, `server.port`, `url.full`, `url.path`, `url.scheme`, `url.query`
- Propagates trace context via W3C Traceparent and B3 headers
- Records response attributes: `http.response.status_code` and response headers
- Supports header redaction for sensitive headers

---

## Usage Examples

```typescript
// Simple GET with accessor (resolves HttpClient from ServiceMap)
const response = yield* HttpClient.get("https://www.google.com/").pipe(
  Effect.flatMap((_) => _.text)
)

// Client instance with redirect following
const client = (yield* HttpClient.HttpClient).pipe(
  HttpClient.followRedirects()
)
const response = yield* client.get("http://google.com/").pipe(
  Effect.flatMap((_) => _.text)
)

// Schema decoding
const response = yield* client.get("/todos/1").pipe(
  Effect.flatMap(HttpClientResponse.schemaBodyJson(Todo))
)

// Schema-encoded POST body
const response = yield* HttpClientRequest.post("/todos").pipe(
  HttpClientRequest.schemaBodyJson(TodoWithoutId)(todo),
  Effect.flatMap(client.execute),
  Effect.flatMap(HttpClientResponse.schemaBodyJson(Todo))
)
```

---

## Key Differences from Effect v3 HttpClient

| Aspect | Effect v3 (`@effect/platform`) | Effect v4 (effect-smol) |
|--------|-------------------------------|------------------------|
| **Package** | `@effect/platform/HttpClient` | `effect/unstable/http/HttpClient` (core) |
| **Service system** | `Context.Tag` | `ServiceMap.Service` |
| **Config system** | `FiberRef` | `ServiceMap.Reference` |
| **Error model** | Two classes (`RequestError`, `ResponseError`) with string `reason` | Single `HttpClientError` wrapper with typed reason classes |
| **Architecture** | preprocess/postprocess (more complex) | Cleaner preprocess/postprocess pair, explicit in public interface |
| **Interrupt handling** | Various approaches | `InterruptibleResponse` with `FinalizationRegistry` for GC-based cleanup |
| **Retry** | Basic retry support | Dedicated `retryTransient` with mode control |
| **Response matching** | Limited | `matchStatus` with wildcard ranges (`"2xx"`, `"3xx"`, etc.) |
| **Response schema** | `schemaBodyJson` | `schemaBodyJson` + `schemaJson` (combined) + `schemaNoBody` |
| **Tracing** | Via middleware layer | Built directly into `make()` constructor |
| **File imports** | No `.ts` extensions | `.ts` extensions throughout (Deno-compatible) |
