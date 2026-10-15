import { expect, test } from "bun:test";
import { createChinoServiceHealthSource } from "./chino-health-source";
const url = "http://127.0.0.1:8082/api/dashboard";
test("Chino connector emits only state transitions, with stable cursors", async () => {
  let status = "offline";
  const source = createChinoServiceHealthSource({ url, fetch: async (_url, init) => {
    expect(init.credentials).toBe("omit"); expect(init.redirect).toBe("error");
    return Response.json({ version: 1, overallState: "normal", services: [{ id: "test", name: "Test", category: "test", status, httpStatus: null, checkedAt: "2031-01-01T00:00:00Z" }], network: { state: "unknown", stale: false, checkedAt: null } });
  } });
  const poll = (cursor: string | null = null) => source.poll({ settings: {}, secret: null, cursor });
  expect(await source.test({}, null)).toEqual({ ok: true });
  const first = await poll(); expect(first.items).toHaveLength(1);
  expect(first.items[0]).toMatchObject({ from: "Chino", subject: "Chino 服务 Test 不可用（offline）", receivedAt: "2031-01-01T00:00:00Z" });
  expect((await poll(first.cursor)).items).toEqual([]);
  status = "online"; const recovered = await poll(first.cursor);
  expect(recovered.items[0]!.subject).toContain("已恢复");
  expect((await poll(recovered.cursor)).items).toEqual([]);
});
test("Chino rejects non-loopback configuration and malformed responses", async () => {
  for (const url of [undefined, "https://example.com", "http://user:pass@localhost"]) {
    const source = createChinoServiceHealthSource({ url });
    expect((await source.test({}, null)).ok).toBe(false);
  }
  const source = createChinoServiceHealthSource({ url, fetch: async () => Response.json({ invalid: true }) });
  await expect(source.poll({ settings: {}, secret: null, cursor: null })).rejects.toThrow("Chino dashboard poll failed");
});
