import { expect, test } from "bun:test";
import { Hono } from "hono";
import { loopbackHostGuard } from "./host";

for (const { url, extraHosts, status } of [
  { url: "http://127.0.0.1/x", extraHosts: [], status: 200 },
  { url: "http://localhost/x", extraHosts: [], status: 200 },
  { url: "http://[::1]/x", extraHosts: [], status: 200 },
  { url: "http://evil.example/x", extraHosts: [], status: 421 },
  { url: "http://chrona.example/x", extraHosts: ["chrona.example"], status: 200 },
]) {
  test(`loopback Host guard returns ${status} for ${url}`, async () => {
    const server = new Hono();
    server.use("*", loopbackHostGuard(extraHosts));
    server.get("/x", c => c.json({ ok: true }));
    const response = await server.request(url);
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual(status === 200 ? { ok: true } : { error: "Unknown Host" });
  });
}
