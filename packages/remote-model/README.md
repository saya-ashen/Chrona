# Trusted remote model adapter

`startRemotePi` runs an explicitly configured Pi **1.5.0** binary with the public `@chrona/pi` RPC driver and native process guardian. Its only configured model is `chrona-remote/execution`, backed by a per-launch authenticated HTTP server on `127.0.0.1`. A private profile contains no provider credentials; the child environment is built from an allowlist. The caller supplies the reviewed Pi executable, bundled Chrona tool-budget extension, native guardian, and a private profile directory outside the approved workspace.

The trusted composition supplies `model(key, input)`, bound to the immutable delivery received from the app. Production must forward it through the authenticated device/app ingress and native carrier to kernel `execution.model`. The HTTP request cannot select a delivery, identity, model provider, or accounting principal. The kernel commits its reservation before provider I/O and retains unknown outcomes. The proxy also limits requests and output caps, serializes admission, and closes admission after an unknown, rejected, malformed, or timed-out completion. It never retries with another key. The device journal must retain uncertain process outcomes rather than launch a replacement.

## Supported completion protocol

The kernel currently accepts a single text `prompt`, optional `system`, and `maxOutputTokens`; it has no native chat/tool schema. This adapter therefore uses the explicit **`chrona.remote.text-tools.v1`** prompt protocol. It preserves the chronological text conversation, tool calls, tool results, and advertised function schemas in a JSON prompt. Its system instruction requires one JSON completion:

```json
{"version":1,"content":null,"tool_calls":[{"id":"read_1","name":"read","arguments":{"path":"README.md"}}]}
```

A final response uses a string `content` and an empty `tool_calls` array. The adapter validates the envelope, rejects duplicate/unadvertised calls, and converts it into the OpenAI completion stream consumed by Pi. All completion tokens, including the JSON envelope, count against the kernel cap. This supports text and native function tools through a prompt protocol; it does not assert native provider tool-calling semantics. Images, unsupported generation controls, invalid protocol output, and oversized transcripts fail closed. A small token cap can make even the envelope impossible; the adapter then fails the execution without another reservation.

The optional `events: ProviderEvents` argument forwards the public provider's progress, usage, resources, and live question/answer channel. The device owns question identifiers, bounded evidence, and delivery of validated `ProviderAnswer` controls; answers are live responses rather than replayable model requests.

Usage is never invented. Unknown token counts remain unknown in the kernel receipt; the loopback stream omits usage. The process's display counters are not budget evidence. Pi retries and compaction are disabled, the pre-tool hook admits at most `maxToolCalls`, and the guardian enforces the deadline. `done` resolves only after the provider confirms the owned process tree stopped; an unconfirmed stop rejects and retains the private profile for conservative recovery.

## Offline verification

```sh
bun test packages/remote-model/src/gateway.bun.test.ts
CHRONA_TEST_PI_COMMAND=/absolute/path/to/reviewed/pi-1.5.0 bun test packages/remote-model/src/pi.bun.test.ts
fixture_dir="$(mktemp -d /tmp/chrona-remote-model-test.XXXXXX)"
DATABASE_URL="file:$fixture_dir/global-test.db" CHRONA_TEST_PI_COMMAND=/absolute/path/to/reviewed/pi-1.5.0 bun test packages/remote-model/src
rm -rf "$fixture_dir"
bunx tsc --noEmit -p packages/remote-model/tsconfig.json
```

The Pi tests require a local C compiler for the Linux guardian and explicitly opt into a credential-free executable. They use deterministic fake completions and loopback HTTP only. Do not point them at a personal wrapper that injects extensions or credentials.

`pi.bun.test.ts` exercises actual Pi RPC, native read/write/bash tools, both call limits, timeout/tree stop, removal of ambient credentials, and an actual Pi UI question answered through `ProviderEvents`. `kernel.bun.test.ts` adds a temporary Prisma/SQLite kernel and real Agent SDK process with an owner-configured deterministic provider executable. It verifies that the provider's output-token hook receives the admitted cap, completed replay does not execute twice, unknown reservations survive service recreation and exhaust the budget, and a final result retains occupancy until independently signed stop evidence. The kernel fixture includes both direct public-service calls and a real remote-execution SDK application behind an authenticated HTTP fixture. It also recreates the actual application process twice to verify fixed pending receipts and no provider reissue. The production server/device ingress needs its own connected acceptance fixture. With no Pi opt-in, native-process tests skip and the loopback protocol tests still run.
