import { expect, test } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { testDb } from "../../../../../packages/engine/src/modules/steward/test-db";
import { createStewardService, type StewardPorts } from "@chrona/engine";
import { createStewardRoutes } from "../../routes/steward.routes";
test("HTTP chat drives a fake provider and returns only chrona_reply messages", async () => {
  const db = testDb(), saved = process.env.API_KEY; process.env.API_KEY = "test-owner";
  try {
    await db.workspace.create({ data: { id: "w", name: "Test" } });
    let service: ReturnType<typeof createStewardService>;
    const ports: StewardPorts = { db, dataDir: mkdtempSync(join(tmpdir(), "chrona-v4b-chat-")), now: () => new Date(), publicUrl: null, deliveries: [], chat: null, chatTimeoutMs: 2000,
      provider: { name: "fake", health: async () => ({ available: true, sandboxed: false, error: null }), start(input) {
        return { inject: async () => {}, abort: async () => {}, done: (async () => {
          await service.tools.call(input.token, "chrona_reply", { text: "Hello from Chrona" });
          return { outcome: "finished" as const, sessionId: null, error: null };
        })() };
      } },
    };
    service = createStewardService(ports);
    const app = createStewardRoutes(ports, service);
    const post = (body: unknown) => app.request("http://localhost/chat?workspaceId=w", { method: "POST", headers: { authorization: "Bearer test-owner", "content-type": "application/json" }, body: JSON.stringify(body) });
    const reply = await post({ text: "Hi" });
    expect(reply.status).toBe(200); expect((await reply.json()).messages.map((m: { text: string }) => m.text)).toEqual(["Hello from Chrona"]);
    expect((await post({ wrong: true })).status).toBe(400);
    expect((await post({ text: "Hi", affairId: "missing" })).status).toBe(404);
  } finally { await db.$disconnect(); if (saved === undefined) delete process.env.API_KEY; else process.env.API_KEY = saved; }
});
