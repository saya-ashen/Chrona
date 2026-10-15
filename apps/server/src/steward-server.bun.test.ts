import { afterEach, beforeEach, expect, test } from "bun:test";
import { createServerApp as createApp } from "./app";
import { createStewardRuntime } from "./steward-runtime";
const createServerApp = () => createApp({ steward: createStewardRuntime(db, { provider: null, chatTransport: null }) });
import { resetEnvCacheForTests } from "./config/env";
import { db, resetTestDb, seedWorkspace } from "./__tests__/bun-test-helpers";

const keys = ["API_KEY", "ALLOWED_ORIGINS", "CHRONA_E2E_TEST_ROUTES", "CHRONA_STEWARD_AGENT"] as const;
let saved: Record<string, string | undefined>;
beforeEach(async () => {
  saved = Object.fromEntries(keys.map(key => [key, process.env[key]]));
  Object.assign(process.env, { API_KEY: "steward-server-test", ALLOWED_ORIGINS: "https://trusted.example", CHRONA_E2E_TEST_ROUTES: "0", CHRONA_STEWARD_AGENT: "none" });
  resetEnvCacheForTests();
  await resetTestDb();
});
afterEach(async () => {
  await db.$disconnect();
  for (const key of keys) { if (saved[key] === undefined) delete process.env[key]; else process.env[key] = saved[key]; }
  resetEnvCacheForTests();
});
const owner = { authorization: "Bearer steward-server-test" };

test("health and database readiness do not require an execution engine", async () => {
  const app = await createServerApp();
  const health = await app.request("/health");
  expect(health.status).toBe(200);
  expect((await health.json()).provider).toEqual({ available: false, name: "unconfigured", sandboxed: false });
  expect(await (await app.request("/ready")).json()).toEqual({ status: "ready" });
});

test("workspace discovery is owner protected and returns only id and name", async () => {
  const { workspaceId } = await seedWorkspace("Steward");
  const app = await createServerApp();
  expect((await app.request("/api/workspaces")).status).toBe(401);
  const response = await app.request("/api/workspaces", { headers: owner });
  expect(response.status).toBe(200);
  expect(await response.json()).toEqual([{ id: workspaceId, name: "Steward" }]);
});

test("origin policy and body limit apply to steward routes", async () => {
  const app = await createServerApp();
  expect((await app.request("/api/steward/works", { method: "OPTIONS", headers: { origin: "https://untrusted.example" } })).status).toBe(403);
  expect((await app.request("/api/steward/works", { method: "OPTIONS", headers: { origin: "https://trusted.example" } })).status).toBe(204);
  expect((await app.request("/api/steward/works", { method: "POST", headers: owner, body: "x".repeat(21 * 1024 * 1024 + 1) })).status).toBe(413);
});

test("only exact capability endpoints bypass owner auth, retaining their own proxy guard", async () => {
  const app = await createServerApp();
  const headers = { authorization: "Bearer invalid-capability", "x-forwarded-for": "203.0.113.1" };
  for (const [path, method] of [["catalog", "GET"], ["tools/chrona_reply", "POST"]]) {
    expect((await app.request(`/api/steward-agent/${path}`, { method, headers })).status).toBe(403);
  }
  expect((await app.request("/api/steward-agent/catalog/extra", { headers })).status).toBe(401);
  expect((await app.request("/api/steward-agent/catalog")).status).toBe(401);
});

test("legacy routes and the disabled test seam are absent", async () => {
  const app = await createServerApp();
  for (const path of ["tasks", "pages", "goals", "runtime", "workspaces/default", "test/steward/delivery/sent"]) {
    expect((await app.request(`/api/${path}`, { headers: owner })).status).toBe(404);
  }
});
