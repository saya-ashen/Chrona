import { expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { networkInterfaces } from "node:os";
import { isLoopbackPeer } from "../../request-peer";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createExecutorAuth } from "@chrona/engine";
import { testDb } from "@chrona/engine/test-support";
import { EXECUTOR_HTTP, EXECUTOR_PROTOCOL, EXECUTOR_LIMITS, executorErrorEnvelopeSchema, type ExecutorController, type ExecutorRequests } from "@chrona/contracts/steward";
import { createServerApp } from "../../app";
import { createStewardRuntime } from "../../steward-runtime";
import { resetEnvCacheForTests } from "../../config/env";

async function fixture(ownerKey: string | null = "owner-probe-key") {
  const prior = process.env.API_KEY;
  if (ownerKey === null) delete process.env.API_KEY; else process.env.API_KEY = ownerKey;
  resetEnvCacheForTests();
  const db = testDb(), dataDir = mkdtempSync(join(tmpdir(), "chrona-auth-http-"));
  const runtime = createStewardRuntime(db, { dataDir, provider: null });
  await runtime.initialize();
  await db.workspace.create({ data: { id: "ws_default", name: "Selected owner" } });
  await db.workspace.create({ data: { id: "http-w", name: "Temporary auth probe" } });
  const auth = createExecutorAuth(runtime.ports), credential = randomBytes(32).toString("hex");
  const pair = await auth.createPairing({ workspaceId: "http-w", ownerId: "owner" });
  const paired = await auth.pair(credential, { v: EXECUTOR_PROTOCOL, requestId: "pair", code: pair.code, label: "Probe" });
  const fence = { executorId: paired.executorId, generation: 1, incarnation: "probe-incarnation" };
  await db.executionExecutor.update({ where: { id: fence.executorId }, data: { incarnation: fence.incarnation, reconciledAt: new Date() } });
  const calls: string[] = [];
  const controller: ExecutorController = {
    ...auth,
    async poll(who) { calls.push("poll"); return { executorId: who.executorId, generation: who.generation, incarnation: who.incarnation, authorizedForMs: 0, launches: [], controls: [], questions: [] }; },
    async report() { calls.push("report"); return { acceptedThroughSourceSeq: 0, storedHighWatermark: 0 }; },
    async question(_who, input) { calls.push("question"); return { target: input.target, questionKey: input.questionKey, requestId: input.requestId, state: "pending" }; },
    async final(_who, input) { calls.push("final"); return { digest: input.digest, accepted: true, stopConfirmed: false }; },
    async reconcile(who) { calls.push("reconcile"); return { executorId: who.executorId, generation: who.generation, incarnation: who.incarnation, decisions: [], after: null, reconciled: false }; },
  };
  runtime.ports.executorController = controller;
  const app = await createServerApp({ steward: runtime });
  const poll = { v: EXECUTOR_PROTOCOL, requestId: "poll-request", ...fence, waitMs: 0 };
  const post = (path: string, body: unknown = poll, token = credential, extra: Record<string, string> = {}) => app.request(`http://localhost${path}`, { method: "POST", headers: { authorization: `Bearer ${token}`, ...extra }, body: typeof body === "string" ? body : JSON.stringify(body) });
  return { db, app, runtime, auth, credential, fence, controller, calls, poll, post, async close() { await db.$disconnect(); rmSync(dataDir, { recursive: true, force: true }); if (prior === undefined) delete process.env.API_KEY; else process.env.API_KEY = prior; resetEnvCacheForTests(); } };
}

test("real Hono app grants exactly six device POST exemptions; owner and device credentials stay separate", async () => {
  const f = await fixture();
  try {
    const response = await f.post(EXECUTOR_HTTP.poll.path);
    expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ requestId: f.poll.requestId, ok: true });
    expect((await f.post(EXECUTOR_HTTP.poll.path, f.poll, "owner-probe-key")).status).toBe(403);
    expect((await f.post(EXECUTOR_HTTP.poll.path, f.poll, randomBytes(32).toString("hex"))).status).toBe(403);
    for (const endpoint of Object.values(EXECUTOR_HTTP)) expect((await f.post(endpoint.path, {})).status).toBe(400);
    for (const path of ["/api/executor/v1/poll/", "/api/executor/v1/poll/extra", "/api/executor/v1/unknown", "/api/executor/v1/pairing-codes", "/api/executor/v1/revoke"]) expect((await f.post(path)).status).toBe(401);
    for (const method of ["GET", "PUT", "PATCH", "DELETE"]) expect((await f.app.request(`http://localhost${EXECUTOR_HTTP.poll.path}`, { method, headers: { authorization: `Bearer ${f.credential}` } })).status).toBe(401);
    expect((await f.post("/api/executor/v1/pairing-codes", {}, "owner-probe-key")).status).toBe(400);
    expect((await f.app.request(`http://localhost${EXECUTOR_HTTP.poll.path}?token=${f.credential}`, { method: "POST", headers: { cookie: `token=${f.credential}` }, body: JSON.stringify(f.poll) })).status).toBe(403);
    expect(f.calls).toEqual(["poll"]);
    delete f.runtime.ports.executorController;
    expect((await f.post(EXECUTOR_HTTP.poll.path)).status).toBe(503);
    expect((await f.post("/api/executor/v1/pair", { v: EXECUTOR_PROTOCOL, requestId: "pair", code: randomBytes(32).toString("hex"), label: "unavailable" })).status).toBe(503);
  } finally { await f.close(); }
});

test("real Hono pairing uses Authorization and the original DB receipt", async () => {
  const f = await fixture();
  try {
    const pairing = await f.auth.createPairing({ workspaceId: "http-w", ownerId: "owner" });
    const credential = randomBytes(32).toString("hex");
    const input = { v: EXECUTOR_PROTOCOL, requestId: "http-pair", code: pairing.code, label: "HTTP pair probe" };
    const first = await f.post(EXECUTOR_HTTP.pair.path, input, credential);
    expect(first.status).toBe(200);
    const receipt = await first.json();
    expect(receipt).toMatchObject({ requestId: "http-pair", ok: true, data: { generation: 1 } });
    expect(await (await f.post(EXECUTOR_HTTP.pair.path, input, credential)).json()).toEqual(receipt);
    expect((await f.post(EXECUTOR_HTTP.pair.path, input, randomBytes(32).toString("hex"))).status).toBe(409);
    expect((await f.post(EXECUTOR_HTTP.pair.path, { ...input, credential }, credential)).status).toBe(400);
    expect(await f.db.executionExecutor.count()).toBe(2);
    expect(f.calls).toEqual([]);
  } finally { await f.close(); }
});

test("owner management fails closed without configured API_KEY", async () => {
  for (const key of [null, "", "   "]) {
    const f = await fixture(key);
    try {
      for (const path of ["/api/executor/v1/pairing-codes", "/api/executor/v1/revoke", "/api/executor/v1/incarnation"]) {
        const response = await f.post(path, {});
        expect(response.status).toBe(503); expect(response.headers.get("cache-control")).toBe("no-store"); expect(await response.json()).toEqual({ code: "EXECUTOR_OWNER_AUTH_UNCONFIGURED" });
      }
    } finally { await f.close(); }
  }
});

test("bounded raw UTF8 read, strict operation parse and fixed error envelopes preserve request correlation", async () => {
  const f = await fixture();
  try {
    for (const body of ["{", { ...f.poll, caller: "owner" }, { ...f.poll, requestId: "bad id" }, { ...f.poll, credential: f.credential }]) {
      const response = await f.post(EXECUTOR_HTTP.poll.path, body); expect(response.status).toBe(400);
      expect(executorErrorEnvelopeSchema.safeParse(await response.json()).success).toBe(true);
    }
    const invalidUtf8 = await f.app.request(`http://localhost${EXECUTOR_HTTP.poll.path}`, { method: "POST", headers: { authorization: `Bearer ${f.credential}` }, body: new Uint8Array([0xff, 0xfe]) });
    expect(invalidUtf8.status).toBe(400);
    const unsupported = await f.post(EXECUTOR_HTTP.poll.path, { ...f.poll, v: "chrona.executor.future" });
    expect(unsupported.status).toBe(409); expect(await unsupported.json()).toMatchObject({ requestId: f.poll.requestId, error: { code: "unsupported_version" } });
    const oversized = await f.post(EXECUTOR_HTTP.poll.path, JSON.stringify({ ...f.poll, padding: "汉".repeat(2000) }), f.credential, { "content-length": "1" });
    expect(oversized.status).toBe(413);
    const chunks = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new TextEncoder().encode("x".repeat(5000))); controller.close(); } });
    const chunked = await f.app.request(`http://localhost${EXECUTOR_HTTP.poll.path}`, { method: "POST", headers: { authorization: `Bearer ${f.credential}` }, body: chunks, duplex: "half" } as RequestInit);
    expect(chunked.status).toBe(413);
    f.controller.poll = async () => { throw new Error(`Secret ${f.credential}`); };
    const failed = await f.post(EXECUTOR_HTTP.poll.path); expect(failed.status).toBe(503); expect(await failed.text()).not.toContain(f.credential);
    f.controller.poll = async () => ({ ...f.fence, authorizedForMs: 0, launches: [], controls: [], questions: [], leaked: f.credential } as never);
    expect((await f.post(EXECUTOR_HTTP.poll.path)).status).toBe(503);
    f.controller.poll = async () => ({ ...f.fence, incarnation: "wrong", authorizedForMs: 0, launches: [], controls: [], questions: [] });
    expect((await f.post(EXECUTOR_HTTP.poll.path)).status).toBe(503);
    f.controller.poll = async () => ({ ...f.fence, authorizedForMs: 0, launches: [], controls: Array.from({ length: 100 }, () => ({ op: "inject", target: { workId: "work", sessionId: "s", runId: "r", attemptId: "a", assignmentId: "assignment", generation: 1 }, commandKey: "key", text: "x".repeat(10000) })), questions: [] });
    expect((await f.post(EXECUTOR_HTTP.poll.path)).status).toBe(503);
    expect(f.calls).toEqual([]);
  } finally { await f.close(); }
});

test("revoked device can drain only original final/reconcile; DB stop/hold facts stay untouched", async () => {
  const f = await fixture();
  try {
    const session = await f.db.session.create({ data: { workspaceId: "http-w", key: "device-work", source: "web" } });
    const run = await f.db.run.create({ data: { workspaceId: "http-w", sessionId: session.id, lane: "background", trigger: "execution", provider: "probe", prompt: "probe", cwd: "/tmp/not-read", tokenHash: "probe-hash", startedAt: new Date() } });
    const attempt = await f.db.executionAttempt.create({ data: { workspaceId: "http-w", ownerId: "owner", callerKey: "owner", workId: "work", commandKey: "start", requestDigest: "d", runId: run.id, projectRef: "p", projectDigest: "d", resolvedCwd: null, logDir: run.cwd, baseline: "commit:fixture", budget: {}, executorId: f.fence.executorId, executorGeneration: 1, heldDirectory: "hold" } });
    await f.db.executorAssignment.create({ data: { ...f.fence, attemptId: attempt.id, assignmentId: "assignment", launchDigest: "a".repeat(64) } });
    const target = { workId: "work", sessionId: session.id, runId: run.id, attemptId: attempt.id, assignmentId: "assignment", generation: 1 };
    await f.auth.revoke({ workspaceId: "http-w", ownerId: "owner" }, { executorId: f.fence.executorId, generation: 1, commandKey: "revoke" });
    for (const op of ["poll", "report", "question"] as const) {
      const body = op === "poll" ? f.poll : op === "report" ? { ...f.fence, v: EXECUTOR_PROTOCOL, requestId: op, target, records: [] } : { ...f.fence, v: EXECUTOR_PROTOCOL, requestId: op, target, questionKey: "q", value: { method: "confirm", title: "Probe", message: "Probe", options: [], timeoutMs: 1000 } };
      const response = await f.post(EXECUTOR_HTTP[op].path, body);
      expect(response.status).toBe(403);
    }
    const reconcile: ExecutorRequests["reconcile"] = { v: EXECUTOR_PROTOCOL, requestId: "reconcile", ...f.fence, entries: [{ target, launchDigest: "a".repeat(64), phase: "unknown", sourceAck: 0, stop: { kind: "unknown", reason: "No observer" } }], after: null, complete: true };
    expect((await f.post(EXECUTOR_HTTP.reconcile.path, reconcile)).status).toBe(200);
    expect((await f.post(EXECUTOR_HTTP.reconcile.path, { ...reconcile, entries: [{ ...reconcile.entries[0]!, phase: "started" }] })).status).toBe(403);
    const identity = { bootId: "00000000-0000-4000-8000-000000000000", unit: "chrona-executor-ab.service", invocationId: "a".repeat(32), controlGroup: "/probe" };
    expect((await f.post(EXECUTOR_HTTP.reconcile.path, { ...reconcile, entries: [{ ...reconcile.entries[0]!, identity }] })).status).toBe(403);
    expect((await f.post(EXECUTOR_HTTP.reconcile.path, { ...reconcile, entries: [{ ...reconcile.entries[0]!, target: { ...target, runId: "other" } }] })).status).toBe(403);
    const final: ExecutorRequests["final"] = { v: EXECUTOR_PROTOCOL, requestId: "final", ...f.fence, digest: "b".repeat(64), final: { ...target, throughSourceSeq: 0, baseline: { kind: "snapshot", digest: "snapshot" }, launchDigest: "a".repeat(64), outcome: { outcome: "failed", sessionId: null, error: null }, finalMessage: { messageId: "message", text: "Probe", truncated: false }, missing: false, sourceReceipt: null, stop: { kind: "unknown", reason: "No observer" } } };
    expect((await f.post(EXECUTOR_HTTP.final.path, final)).status).toBe(200);
    const claimedStop = await f.post(EXECUTOR_HTTP.final.path, { ...final, final: { ...final.final, stop: { kind: "never_started", tombstoneDigest: "d".repeat(64) } } });
    expect(await claimedStop.json()).toMatchObject({ ok: true, data: { stopConfirmed: false } });
    f.controller.final = async () => ({ digest: "c".repeat(64), accepted: true, stopConfirmed: false });
    expect((await f.post(EXECUTOR_HTTP.final.path, final)).status).toBe(503);
    f.controller.reconcile = async who => ({ executorId: who.executorId, generation: who.generation, incarnation: who.incarnation, decisions: [{ target, action: "report" }], after: null, reconciled: true });
    expect((await f.post(EXECUTOR_HTTP.reconcile.path, reconcile)).status).toBe(503);
    expect(await f.db.executionExecutor.findUniqueOrThrow({ where: { id: f.fence.executorId } })).toMatchObject({ generation: 2, authorizedUntil: null, reconciledAt: null });
    expect(await f.db.executionAttempt.findUniqueOrThrow({ where: { id: attempt.id } })).toMatchObject({ stopConfirmedAt: null, heldDirectory: "hold" });
    expect(f.calls).toEqual(["reconcile", "final", "final"]);
    expect(EXECUTOR_LIMITS.graceMs).toBe(60000);
  } finally { await f.close(); }
});

test("owner management uses selected workspace and strictly parses no-store requests", async () => {
  const f = await fixture();
  try {
    const created = await f.post("/api/executor/v1/pairing-codes", { label: "Owner hint" }, "owner-probe-key");
    expect(created.status).toBe(200); expect(created.headers.get("cache-control")).toBe("no-store");
    const code = await created.json(); expect(code.label).toBe("Owner hint");
    const credential = randomBytes(32).toString("hex");
    const paired = await (await f.post(EXECUTOR_HTTP.pair.path, { v: EXECUTOR_PROTOCOL, requestId: "owner-pair", code: code.code, label: "Device label" }, credential)).json();
    expect(await f.db.executionExecutor.findUniqueOrThrow({ where: { id: paired.data.executorId } })).toMatchObject({ workspaceId: "ws_default", ownerId: "owner", label: "Device label" });
    const reconcile = { v: EXECUTOR_PROTOCOL, requestId: "first-reconcile", executorId: paired.data.executorId, generation: 1, incarnation: "first-daemon", entries: [], after: null, complete: true };
    expect((await f.post(EXECUTOR_HTTP.reconcile.path, reconcile, credential)).status).toBe(200);
    const firstPoll = { ...f.poll, executorId: paired.data.executorId, incarnation: "first-daemon" };
    expect((await f.post(EXECUTOR_HTTP.poll.path, firstPoll, credential)).status).toBe(403);
    f.controller.reconcile = async who => ({ executorId: who.executorId, generation: who.generation, incarnation: who.incarnation, decisions: [], after: null, reconciled: true });
    expect((await f.post(EXECUTOR_HTTP.reconcile.path, reconcile, credential)).status).toBe(503);
    // Controlled ingress substitute commits completion; real fixed-pagination reconciliation belongs to R.
    f.controller.reconcile = async who => {
      await f.db.executionExecutor.update({ where: { id: who.executorId }, data: { reconciledAt: new Date() } });
      return { executorId: who.executorId, generation: who.generation, incarnation: who.incarnation, decisions: [], after: null, reconciled: true };
    };
    expect((await f.post(EXECUTOR_HTTP.reconcile.path, reconcile, credential)).status).toBe(200);
    expect((await f.post(EXECUTOR_HTTP.poll.path, firstPoll, credential)).status).toBe(200);
    f.controller.reconcile = async who => ({ executorId: who.executorId, generation: who.generation, incarnation: who.incarnation, decisions: [], after: null, reconciled: false });
    const transition = { executorId: paired.data.executorId, generation: 1, expectedIncarnation: "first-daemon", nextIncarnation: "second-daemon", commandKey: "owner-handoff" };
    const denied = await f.post("/api/executor/v1/incarnation", transition, credential);
    expect(denied.status).toBe(401); expect(denied.headers.get("cache-control")).toBe("no-store");
    const moved = await f.post("/api/executor/v1/incarnation", transition, "owner-probe-key");
    expect(moved.status).toBe(200); expect(moved.headers.get("cache-control")).toBe("no-store");
    expect(await moved.json()).toMatchObject({ incarnation: "second-daemon", generation: 1, reconciled: false });
    expect((await f.post(EXECUTOR_HTTP.reconcile.path, reconcile, credential)).status).toBe(403);
    expect((await f.post(EXECUTOR_HTTP.reconcile.path, { ...reconcile, incarnation: "second-daemon" }, credential)).status).toBe(200);
    expect((await f.post("/api/executor/v1/incarnation", transition, "owner-probe-key")).status).toBe(200);
    expect((await f.post("/api/executor/v1/incarnation", { ...transition, nextIncarnation: "third" }, "owner-probe-key")).status).toBe(409);
    expect((await f.post("/api/executor/v1/pairing-codes", { label: "Injected", workspaceId: "http-w" }, "owner-probe-key")).status).toBe(400);
    const revoke = { executorId: paired.data.executorId, generation: 1, commandKey: "owner-revoke" };
    expect((await f.post("/api/executor/v1/revoke", revoke, "owner-probe-key")).status).toBe(200);
    expect((await f.post("/api/executor/v1/revoke", revoke, "owner-probe-key")).status).toBe(200);
    await f.db.workspace.delete({ where: { id: "ws_default" } });
    expect((await f.post("/api/executor/v1/pairing-codes", { label: "Unavailable" }, "owner-probe-key")).status).toBe(503);
  } finally { await f.close(); }
});

test("question HTTP request and ProviderInteraction identifiers remain distinct", async () => {
  const f = await fixture();
  try {
    const session = await f.db.session.create({ data: { workspaceId: "http-w", key: "question", source: "web" } });
    const run = await f.db.run.create({ data: { workspaceId: "http-w", sessionId: session.id, lane: "background", trigger: "execution", provider: "probe", prompt: "probe", cwd: "/tmp/not-read", tokenHash: "question" } });
    const attempt = await f.db.executionAttempt.create({ data: { workspaceId: "http-w", ownerId: "owner", callerKey: "owner", workId: "qwork", commandKey: "qstart", requestDigest: "d", runId: run.id, projectRef: "p", projectDigest: "d", resolvedCwd: null, logDir: run.cwd, baseline: "snapshot:fixture", budget: {}, executorId: f.fence.executorId } });
    await f.db.executorAssignment.create({ data: { ...f.fence, attemptId: attempt.id, assignmentId: "qassignment", launchDigest: "a".repeat(64) } });
    const target = { workId: "qwork", sessionId: session.id, runId: run.id, attemptId: attempt.id, assignmentId: "qassignment", generation: 1 };
    const question: ExecutorRequests["question"] = { v: EXECUTOR_PROTOCOL, requestId: "http-correlation", ...f.fence, target, questionKey: "local-question", value: { method: "confirm", title: "Probe", message: "Probe", options: [], timeoutMs: 1000 } };
    f.controller.question = async (_who, input) => ({ target: input.target, questionKey: input.questionKey, requestId: "provider-interaction", state: "pending" });
    const response = await f.post(EXECUTOR_HTTP.question.path, question);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ requestId: "http-correlation", data: { requestId: "provider-interaction" } });
    f.controller.poll = async () => ({ ...f.fence, authorizedForMs: 0, launches: [], controls: [], questions: [{ target, questionKey: "local-question", requestId: "provider-interaction", state: "answer", answer: { decision: "submit", value: true } }] });
    expect(await (await f.post(EXECUTOR_HTTP.poll.path)).json()).toMatchObject({ data: { questions: [{ requestId: "provider-interaction", state: "answer" }] } });
    f.controller.question = async (_who, input) => ({ target: input.target, questionKey: "wrong", requestId: "provider-interaction", state: "pending" });
    expect((await f.post(EXECUTOR_HTTP.question.path, question)).status).toBe(503);
  } finally { await f.close(); }
});

test("socket peers fail closed and actual Bun loopback accepts only Run capabilities", async () => {
  const f = await fixture();
  const server = Bun.serve({ hostname: "0.0.0.0", port: 0, fetch: (request, server) => f.app.fetch(request, { server }) });
  try {
    const session = await f.db.session.create({ data: { workspaceId: "http-w", key: "socket", source: "web" } });
    await f.runtime.service.forWorkspace("http-w").runs.enqueue({ sessionId: session.id, lane: "foreground", trigger: "message", prompt: "Probe" });
    const run = (await f.runtime.service.forWorkspace("http-w").runs.claimNext("foreground"))!;
    const headers = { authorization: `Bearer ${run.token}` };
    const path = "/api/steward-agent/catalog";
    for (const address of [undefined, "192.0.2.1", "127.evil", "::ffff:192.0.2.1"]) {
      expect((await f.app.request(`http://localhost${path}`, { headers }, { server: { requestIP: () => address ? { address } : null } })).status).toBe(403);
    }
    expect((await f.app.request(`http://localhost${path}`, { headers })).status).toBe(403);
    for (const address of ["127.0.0.1", "127.255.1.2", "::1", "::ffff:127.0.0.1", "::ffff:7f00:1", "0:0:0:0:0:ffff:7f00:1"]) expect(isLoopbackPeer(address)).toBe(true);
    const url = `http://127.0.0.1:${server.port}${path}`;
    expect((await fetch(url, { headers })).status).toBe(200);
    expect((await fetch(url, { headers: { ...headers, forwarded: "for=127.0.0.1" } })).status).toBe(403);
    expect((await fetch(url, { headers: { authorization: `Bearer ${f.credential}` } })).status).toBe(401);
    const local = Object.values(networkInterfaces()).flat().find(value => value?.family === "IPv4" && !value.internal)?.address;
    if (local) expect((await fetch(`http://${local}:${server.port}${path}`, { headers })).status).toBe(403);
  } finally { await server.stop(true); await f.close(); }
});

test("old scoped bridge remains rejected for forwarded traffic and has no executor tool routes", async () => {
  const f = await fixture();
  try {
    const session = await f.db.session.create({ data: { workspaceId: "http-w", key: "web:bridge", source: "web" } });
    await f.runtime.service.forWorkspace("http-w").runs.enqueue({ sessionId: session.id, lane: "foreground", trigger: "message", prompt: "Probe" });
    const run = (await f.runtime.service.forWorkspace("http-w").runs.claimNext("foreground"))!;
    expect((await f.app.request("http://localhost/api/steward-agent/catalog", { headers: { authorization: `Bearer ${run.token}` } }, { server: { requestIP: () => ({ address: "127.0.0.1" }) } })).status).toBe(200);
    expect((await f.app.request("http://localhost/api/steward-agent/catalog", { headers: { authorization: `Bearer ${run.token}`, forwarded: "for=127.0.0.1" } })).status).toBe(403);
    expect((await f.app.request("http://localhost/api/steward-agent/catalog", { headers: { authorization: `Bearer ${f.credential}` } }, { server: { requestIP: () => ({ address: "127.0.0.1" }) } })).status).toBe(401);
    expect((await f.post("/api/executor/v1/catalog")).status).toBe(401);
    expect((await f.post("/api/executor/v1/tools/shell")).status).toBe(401);
  } finally { await f.close(); }
});
