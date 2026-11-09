# Local module wire protocol v1

`schemas/module-wire.json` is the generated, language-neutral JSON Schema for every wire message. Generate/check it with `bun scripts/generate-contract-schemas.ts` / `bun scripts/generate-contract-schemas.ts --check`. The source is `src/steward/module-wire.ts`; event/call schemas reuse the public steward contracts. JSON Schema describes individual messages; the ordering, deadlines and byte limits below are also mandatory.

## Connection and identity

For every process instance the kernel binds an ephemeral TCP listener on **127.0.0.1** and generates a cryptographically random **32-byte** secret, encoded as 64 lowercase hex digits. The launcher supplies exactly:

- `CHRONA_IPC_ENDPOINT=tcp://127.0.0.1:<port>`
- `CHRONA_IPC_TOKEN=<64 lowercase hex digits>`

There is no socket-path fallback or alias. Endpoint ports are decimal 1–65535 without leading zeroes. Hostnames, other IP addresses, credentials, paths, query strings and fragments are invalid. Loopback location alone never grants authority. The private channel and token belong to the supervisor's module ID, version hash and activation instance; replacing or restarting that instance creates a new pair. Do not log, expose to browsers or persist the secret as application state.

Frames are UTF-8 JSON followed by LF. Limits count **bytes excluding LF**, including all JSON syntax and attachments. Before authentication a frame is at most **1024 bytes**; the handshake must complete within **5000 ms**. The listener allows at most **16** pending unauthenticated connections; excess connections close immediately. Idle or invalid peers expire/close without claiming the module slot, failing its startup or dispatching calls. The first peer with the correct secret claims the one application connection. Other peers cannot replace it. A disconnect closes the instance channel; reconnecting requires a new process instance.

The module first sends:

```json
{"type":"auth","version":1,"token":"<64 lowercase hex digits>"}
```

The kernel responds only after validation:

```json
{"type":"ready","version":1}
```

The module waits for this ACK before flushing application messages. Its ACK wait is also bounded to 5000 ms and 1024 bytes. Repeated handshake messages, malformed JSON and oversized frames terminate an authenticated connection. Messages after authentication are at most **33554432 bytes (32 MiB)**. Both sender and receiver enforce that limit. Attachment content is transported inside the existing event JSON without a smaller transport limit. Invalid application schemas are rejected by their application handlers; a call never bypasses schema validation or routed authorization.

## Application messages

The kernel sends `{id,event}` (event delivery), `{id,ping:true}` (startup protocol check) and call replies. The module sends event replies and `{id,method,params}` routed calls. A ping replies `{id,result:{}}`; it does not execute a business event. See the JSON Schema for event, call and reply fields. Event exchanges remain serial; calls can complete while an event is pending. A disconnect rejects outstanding exchanges, and delivery already written to the wire remains an uncertain outcome rather than being silently replayed. Retirement still waits for in-flight calls before closing the old instance.

## Private HTTP listener

`chrona.serve` first binds **127.0.0.1:0**, with authentication already installed in its handler, then reports the chosen port through its authenticated channel:

```json
{"type":"http-ready","endpoint":"http://127.0.0.1:49152"}
```

The endpoint is an exact origin with no trailing slash and the same numeric-port rules. Only one readiness report is accepted. No unauthenticated readiness announcement or filesystem socket probe is accepted. The supervisor waits for this report and rechecks the current active instance before routing. Startup checks for manifests declaring `listen` require both the SDK ping and HTTP readiness, without sending a business HTTP request.

Each request to the private listener requires `x-chrona-module-token` equal to the same per-instance token. Missing or incorrect credentials get 401 before the application handler runs. The SDK removes this header before calling that handler. The kernel proxy overwrites any incoming value, removes owner `Authorization` and `Cookie` headers, preserves method/path/query/body and abort signals, and uses manual redirects. `Set-Cookie` and the transport token header are removed from proxied responses. Kernel owner authentication remains a separate check before the module proxy.

## Author testing and browser preview

`chrona/testing.startModule` uses the exact same authenticated loopback channel, handshake, ACK, framing and HTTP readiness implementation. Its `httpReady` promise resolves to the private `{endpoint,token}` pair for transport assertions. `module.fetch("/path", options)` waits for readiness, restricts requests to the reported origin, overwrites the token and strips owner authorization/cookies. The former `httpSocket` property is removed.

`chrona/preview` owns the browser-facing loopback server. It forwards through `module.fetch`, keeps the private token on the server side, strips incoming owner and transport credentials, strips `Set-Cookie` and transport credentials from responses, and does not follow private redirects. Preview/test paths do not use a weaker protocol.

## Platform evidence

The transport uses standard TCP, UTF-8 JSON and HTTP and can be implemented in Python or other languages. The repository's Python fixture performs this same auth/ACK handshake without importing TypeScript. Linux test runs are recorded by the implementation task. macOS and Windows runtime/process-tree acceptance remains pending until run on those hosts; selecting this protocol is not platform verification.
