import { expect, test } from "bun:test";
import { createChinoServiceHealthSource } from "./chino-health-source";

const url = "http://127.0.0.1:8082/api/dashboard";
const connection = { id: "test-only", config: {} };
const t1 = "2031-01-01T00:00:00Z", t2 = "2031-01-01T00:01:00Z", t3 = "2031-01-01T00:02:00Z";
const service = (id: string, status = "online", checkedAt = t1) => ({ id, name: `Test ${id}`, category: "test-only", status, checkedAt, httpStatus: status === "online" ? 200 : null });
const dashboard = (services = [service("a")], state = "healthy", checkedAt = t1) => ({ version: 1, overallState: "normal", services, network: { state, stale: false, checkedAt } });
// Test-only transport: no real requests, accounts, or host services.
function fixture(initial = dashboard()) {
  let data = initial;
  const requests: RequestInit[] = [];
  const fakeFetch = (async (_url: unknown, init: RequestInit) => { requests.push(init); return Response.json(data); });
  const source = createChinoServiceHealthSource({ url, fetch: fakeFetch });
  return { source, requests, set: (next: typeof initial) => { data = next; }, poll: (cursor: string | null = null) => source.poll(connection, cursor), restart: () => createChinoServiceHealthSource({ url, fetch: fakeFetch }) };
}

test("first attention observations are current, ok observations only enter cursor; identical polls and restart are stable", async () => {
  const f = fixture(dashboard([service("a", "offline"), service("b", "unhealthy"), service("c"), service("d", "reachable")]));
  expect(f.source).toMatchObject({ kind: "chino_service_health", mode: "poll", supportedActions: ["read_source"] });
  const first = await f.poll();
  expect(first.items).toHaveLength(2);
  expect(first.items[0]).toMatchObject({ externalId: `service:a:attention:${t1}`, threadId: "chino-service:a", title: "Chino 服务 Test a 不可用（offline）", author: "chino-dashboard", url: null, occurredAt: t1, current: true });
  expect(first.items.every(item => item.current)).toBe(true);
  expect(JSON.parse(first.nextCursor!)).toEqual({ v: 1, services: { a: { cls: "attention", since: t1 }, b: { cls: "attention", since: t1 }, c: { cls: "ok", since: t1 }, d: { cls: "ok", since: t1 } }, network: { cls: "ok", since: t1 } });
  expect(await f.poll(first.nextCursor)).toEqual({ items: [], nextCursor: first.nextCursor });
  expect(await f.restart().poll(connection, first.nextCursor)).toEqual({ items: [], nextCursor: first.nextCursor });
  expect(f.requests[0]).toMatchObject({ method: "GET", redirect: "error", credentials: "omit", headers: { Accept: "application/json" } });
});

test("outage then recovery have distinct stable ids, factual previous class, and first-observed since", async () => {
  const f = fixture(); const first = await f.poll();
  f.set(dashboard([service("a", "offline", t2)])); const outage = await f.poll(first.nextCursor);
  expect(outage.items).toHaveLength(1); expect(outage.items[0].externalId).toBe(`service:a:attention:${t2}`);
  expect(outage.items[0].body).toContain("ok -> offline"); expect(outage.items[0].current).toBeUndefined();
  f.set(dashboard([service("a", "unhealthy", t3)]));
  expect(await f.poll(outage.nextCursor)).toEqual({ items: [], nextCursor: outage.nextCursor });
  f.set(dashboard([service("a", "reachable", t3)])); const recovery = await f.poll(outage.nextCursor);
  expect(recovery.items).toHaveLength(1); expect(recovery.items[0].externalId).toBe(`service:a:ok:${t3}`);
  expect(recovery.items[0].title).toContain("已恢复（reachable）"); expect(recovery.items[0].body).toContain("attention -> reachable");
});

test("unknown services/network, stale network, and collecting preserve previous observations", async () => {
  const f = fixture(dashboard([service("a", "offline")], "down")); const first = await f.poll();
  f.set(dashboard([service("a", "unknown", t2)], "unknown", t2));
  expect(await f.poll(first.nextCursor)).toEqual({ items: [], nextCursor: first.nextCursor });
  const stale = dashboard([service("a", "unknown", t2)], "healthy", t2); stale.network.stale = true; f.set(stale);
  expect(await f.poll(first.nextCursor)).toEqual({ items: [], nextCursor: first.nextCursor });
  f.set({ ...dashboard([], "healthy", t2), overallState: "collecting" });
  expect(await f.poll(first.nextCursor)).toEqual({ items: [], nextCursor: first.nextCursor });
  expect(await f.poll()).toEqual({ items: [], nextCursor: null });
});

test("unobserved unknown subjects do not enter cursor; stale overall does not suppress fresh service observations", async () => {
  const f = fixture(dashboard([service("a", "unknown")], "unknown")); const first = await f.poll();
  expect(JSON.parse(first.nextCursor!)).toEqual({ v: 1, services: {}, network: null });
  f.set({ ...dashboard([service("a", "offline", t2)]), overallState: "stale" });
  expect((await f.poll(first.nextCursor)).items).toHaveLength(1);
});

test("network first attention, same class, outage and recovery transitions", async () => {
  const f = fixture(dashboard([], "down")); const first = await f.poll();
  expect(first.items).toHaveLength(1); expect(first.items[0]).toMatchObject({ current: true, externalId: `network:attention:${t1}`, threadId: "chino-network", title: "Chino 网络状态异常（down）" });
  f.set(dashboard([], "degraded", t2)); expect(await f.poll(first.nextCursor)).toEqual({ items: [], nextCursor: first.nextCursor });
  f.set(dashboard([], "healthy", t2)); const recovery = await f.poll(first.nextCursor);
  expect(recovery.items).toHaveLength(1); expect(recovery.items[0].externalId).toBe(`network:ok:${t2}`);
  expect(recovery.items[0].title).toBe("Chino 网络已恢复（healthy）");
  f.set(dashboard([], "degraded", t3)); const outage = await f.poll(recovery.nextCursor);
  expect(outage.items).toHaveLength(1); expect(outage.items[0].externalId).toBe(`network:attention:${t3}`);
});

test("new attention subjects emit; disappeared subjects are dropped silently", async () => {
  const f = fixture(); const first = await f.poll();
  f.set(dashboard([service("b", "offline", t2), service("c", "online", t2)])); const next = await f.poll(first.nextCursor);
  expect(next.items).toHaveLength(1); expect(next.items[0].externalId).toBe(`service:b:attention:${t2}`);
  expect(JSON.parse(next.nextCursor!).services).toEqual({ b: { cls: "attention", since: t2 }, c: { cls: "ok", since: t2 } });
});

test("dashboard and cursor fields outside the allowlist never escape", async () => {
  const forbidden = "PRIVATE_SENTINEL";
  const data = { ...dashboard([Object.assign(service("a", "offline"), { facts: forbidden, insight: forbidden, insightMessage: forbidden, quickActions: forbidden, href: forbidden, description: forbidden })]), layout: forbidden, resources: forbidden };
  Object.assign(data.network, { explanation: forbidden, cause: forbidden });
  const f = fixture(data);
  const first = await f.poll(); expect(JSON.stringify(first)).not.toContain(forbidden);
  const cursor = JSON.parse(first.nextCursor!); cursor.secret = forbidden; cursor.services.a.facts = forbidden; cursor.network.explanation = forbidden;
  expect(JSON.stringify(await f.poll(JSON.stringify(cursor)))).not.toContain(forbidden);
});

for (const cursor of ["not-json", "null", "{}", '{"v":2,"services":{},"network":null}', '{"v":1,"services":{"a":{"cls":"bad","since":"oops"}},"network":null}']) {
  test(`invalid cursor becomes first observation: ${cursor}`, async () => {
    const f = fixture(dashboard([service("a", "offline")]));
    expect(await f.poll(cursor)).toEqual(await f.poll());
  });
}

for (const candidate of [undefined, "", "not-url", "https://127.0.0.1:8082/api/dashboard", "http://example.com", "http://127.0.0.2", "http://localhost.evil.test", "http://user:pass@localhost", "http://[::2]"]) {
  test(`unsupported URL never fetches: ${candidate}`, async () => {
    let calls = 0;
    const source = createChinoServiceHealthSource({ url: candidate, fetch: (async () => { calls++; throw new Error("test-only"); }) });
    expect((await source.readiness(connection)).state).toBe("unsupported");
    if (!candidate) expect(await source.readiness(connection)).toEqual({ state: "unsupported", reason: "Chino dashboard URL is not configured on this host" });
    await expect(source.poll(connection, null)).rejects.toThrow(); expect(calls).toBe(0);
  });
}
for (const host of ["127.0.0.1", "localhost", "[::1]"]) {
  test(`loopback HTTP URL ready: ${host}`, async () => {
    const f = fixture();
    const source = createChinoServiceHealthSource({ url: `http://${host}:8082/api/dashboard`, fetch: (async () => Response.json(dashboard())) });
    expect(await source.readiness(connection)).toEqual({ state: "ready" });
    expect(await source.poll(connection, null)).toEqual(await f.poll());
  });
}

const invalidResponses: [string, () => Response][] = [
  ["non-200", () => Response.json(dashboard(), { status: 201 })],
  ["redirect", () => new Response(null, { status: 302, headers: { Location: "http://example.invalid" } })],
  ["non-JSON type", () => new Response(JSON.stringify(dashboard()), { headers: { "Content-Type": "text/html" } })],
  ["invalid JSON", () => new Response("{", { headers: { "Content-Type": "application/json" } })],
  ["wrong version", () => Response.json({ ...dashboard(), version: 2 })],
  ["oversized body", () => Response.json({ ...dashboard(), resources: "x".repeat(512 * 1024) })],
  ["oversized content length", () => Response.json(dashboard(), { headers: { "Content-Length": String(512 * 1024 + 1) } })],
  ["oversized multibyte body", () => Response.json({ ...dashboard(), resources: "中".repeat(180_000) })],
  ["long service id", () => Response.json(dashboard([service("x".repeat(65))]))],
  ["long service name", () => Response.json(dashboard([{ ...service("a"), name: "x".repeat(121) }]))],
  ["duplicate service ids", () => Response.json(dashboard([service("a"), service("a", "offline")]))],
];
for (const [label, response] of invalidResponses) {
  test(`${label} throws a sanitized failure`, async () => {
    const source = createChinoServiceHealthSource({ url, fetch: (async () => response()) });
    await expect(source.poll(connection, null)).rejects.toThrow("Chino dashboard poll failed");
  });
}

test("timeout aborts transport and response body reads", async () => {
  for (const body of [false, true]) {
    let signal: AbortSignal | undefined;
    const source = createChinoServiceHealthSource({ url, timeoutMs: 5, fetch: (async (_url: unknown, init: RequestInit) => {
      signal = init.signal as AbortSignal;
      if (body) return new Response(new ReadableStream({ start(controller) { signal!.addEventListener("abort", () => controller.error(new Error("test-only body timeout"))); } }), { headers: { "Content-Type": "application/json" } });
      return new Promise<Response>((_resolve, reject) => { signal!.addEventListener("abort", () => reject(new Error("test-only transport timeout"))); });
    }) });
    await expect(source.poll(connection, null)).rejects.toThrow("Chino dashboard poll failed");
    expect(signal?.aborted).toBe(true);
  }
});

test("50-item cap defers excess without silently advancing their cursor", async () => {
  const f = fixture(dashboard(Array.from({ length: 52 }, (_, i) => service(`s${i}`, "offline")), "down"));
  const first = await f.poll(); expect(first.items).toHaveLength(50);
  expect(Object.keys(JSON.parse(first.nextCursor!).services)).toHaveLength(50);
  const second = await f.poll(first.nextCursor); expect(second.items).toHaveLength(3);
  expect(await f.poll(second.nextCursor)).toEqual({ items: [], nextCursor: second.nextCursor });
  f.set(dashboard(Array.from({ length: 52 }, (_, i) => service(`s${i}`, "online", t2)), "healthy", t2));
  const recovered = await f.poll(second.nextCursor); expect(recovered.items).toHaveLength(50);
  expect(JSON.parse(recovered.nextCursor!).services.s51.cls).toBe("attention");
  expect((await f.poll(recovered.nextCursor)).items).toHaveLength(3);
});

test("service identifiers are data, not object prototype keys", async () => {
  const f = fixture(dashboard([service("__proto__", "offline"), service("constructor", "offline")]));
  const first = await f.poll(); expect(first.items).toHaveLength(2);
  expect(Object.keys(JSON.parse(first.nextCursor!).services)).toEqual(["__proto__", "constructor"]);
  expect(await f.poll(first.nextCursor)).toEqual({ items: [], nextCursor: first.nextCursor });
});
