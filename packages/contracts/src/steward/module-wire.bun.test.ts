import { expect, test } from "bun:test";
import { z } from "zod";
import wire from "../../schemas/module-wire.json";
import { moduleWireMessageSchema, moduleWireTransport } from "./module-wire";

// Exercise the committed, language-neutral artifact, independently of its source schemas.
const committed = z.fromJSONSchema(wire as unknown as Parameters<typeof z.fromJSONSchema>[0]);
const token = "a".repeat(64), now = "2026-11-09T12:00:00.000Z";
const accepted = [
  { type: "auth", version: 1, token },
  { type: "ready", version: 1 },
  { type: "http-ready", endpoint: "http://127.0.0.1:1" },
  { type: "http-ready", endpoint: "http://127.0.0.1:65535" },
  { id: "ping-1", ping: true },
  { id: "event-1", event: { trigger: { kind: "tool", id: "echo", firedAt: now, args: { text: "世界", attachments: [{ mimeType: "image/png", data: "aGVsbG8=" }] } }, now, params: {} } },
  { id: "event-1", result: { result: { message: "世界" } } },
  { id: "event-1", error: "failed", errorCode: "failed" },
  { id: "call-1", method: "call", params: { target: "modules.list", args: {}, mode: "sync" } },
  { id: "call-1", method: "callStatus", params: { callId: "operation-1" } },
  { id: "call-1", result: { output: [{ id: "module-1" }] } },
  { id: "call-1", error: { code: "unavailable", message: "Not ready" } },
  ...["not_dispatched", "submission_refused"].flatMap(reason => [
    { id: "call-proof", error: { code: "unavailable", message: "Refused", reason } },
    { id: "event-proof", error: "Refused", errorCode: "unavailable", errorReason: reason },
  ]),
];
const rejected = [
  { type: "auth", version: 2, token },
  { type: "auth", version: 1, token: "A".repeat(64) },
  { type: "auth", version: 1, token: "a".repeat(63) },
  { type: "auth", version: 1, token, owner: "injected" },
  { type: "ready", version: 1, token },
  ...["http://localhost:80", "http://127.0.0.2:80", "http://127.0.0.1:0", "http://127.0.0.1:080", "http://127.0.0.1:65536", "http://127.0.0.1:80/", "http://127.0.0.1:80?q=1", "http://user@127.0.0.1:80", "https://127.0.0.1:80"].map(endpoint => ({ type: "http-ready", endpoint })),
  { type: "http-ready", endpoint: "http://127.0.0.1:80", token },
  { id: "", ping: true },
  { id: "call-1", method: "call", params: { target: "modules.list", owner: "injected" } },
  { id: "call-1", error: { code: "arbitrary", message: "Invalid error" } },
  { id: "call-proof", error: { code: "unavailable", message: "Refused", reason: "arbitrary" } },
  { id: "event-proof", error: "Refused", errorCode: "unavailable", errorReason: "arbitrary" },
];

test("committed wire JSON validates handshakes, HTTP origins and application messages", () => {
  for (const message of accepted) {
    expect(committed.safeParse(message).success, JSON.stringify(message)).toBe(true);
    expect(moduleWireMessageSchema.safeParse(message).success, JSON.stringify(message)).toBe(true);
  }
  for (const message of rejected) {
    expect(committed.safeParse(message).success, JSON.stringify(message)).toBe(false);
    expect(moduleWireMessageSchema.safeParse(message).success, JSON.stringify(message)).toBe(false);
  }
});

test("wire JSON publishes mandatory transport limits and credential environment", () => {
  expect(wire["x-chrona-transport"]).toEqual(moduleWireTransport);
  expect(moduleWireTransport).toMatchObject({ version: 1, tokenBytes: 32, maxLineBytes: 33554432, maxHandshakeBytes: 1024, handshakeDeadlineMs: 5000, maxPendingConnections: 16 });
});
