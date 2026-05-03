import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";

import { taskWorkspaceChatSchema } from "../../routes/schemas";
import { error, json } from "../../lib/http";

function createChatRouter() {
  const api = new Hono();

  api.post("/ai/task-workspace/chat", async (c) => {
    try {
      const body = await c.req.json();

      const parsed = taskWorkspaceChatSchema.safeParse(body);
      if (!parsed.success) {
        return error(c, parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; "), 400);
      }

      // In real route this calls aiChat(); for validation tests we return OK
      return json(c, { ok: true });
    } catch (_cause) {
      return error(c, "Internal server error", 500);
    }
  });

  return api;
}

function app() {
  const a = new Hono();
  a.route("/api", createChatRouter());
  return a;
}

async function postChat(body: unknown) {
  return app().request("http://local/api/ai/task-workspace/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /ai/task-workspace/chat (Zod validation)", () => {
  beforeEach(() => {
    // no DB needed for Zod validation tests
  });

  it("returns 400 when taskId is missing", async () => {
    const res = await postChat({ message: "Hello" });
    expect(res.status).toBe(400);
    const b = await res.json() as { error: string };
    expect(b.error).toContain("taskId");
  });

  it("returns 400 when message is missing", async () => {
    const res = await postChat({ taskId: "task-1" });
    expect(res.status).toBe(400);
    const b = await res.json() as { error: string };
    expect(b.error).toContain("message");
  });

  it("returns 400 when message is an empty string", async () => {
    const res = await postChat({ taskId: "task-1", message: "" });
    expect(res.status).toBe(400);
    const b = await res.json() as { error: string };
    expect(b.error).toContain("message");
  });

  it("returns 400 when message is only whitespace", async () => {
    const res = await postChat({ taskId: "task-1", message: "   " });
    expect(res.status).toBe(400);
    const b = await res.json() as { error: string };
    expect(b.error).toContain("message");
  });

  it("returns 400 when history contains entry with invalid role", async () => {
    const res = await postChat({
      taskId: "task-1",
      message: "Hello",
      history: [
        { role: "system", content: "bad role" },
      ],
    });
    expect(res.status).toBe(400);
    const b = await res.json() as { error: string };
    expect(b.error).toContain("role");
  });

  it("returns 400 when history contains entry without content", async () => {
    const res = await postChat({
      taskId: "task-1",
      message: "Hello",
      history: [{ role: "user" }],
    });
    expect(res.status).toBe(400);
    const b = await res.json() as { error: string };
    expect(b.error).toContain("content");
  });

  it("returns 200 when all required fields are valid", async () => {
    const res = await postChat({
      taskId: "task-1",
      message: "Hello, AI",
      history: [
        { role: "user", content: "Previous message" },
        { role: "assistant", content: "Previous reply" },
      ],
    });
    expect(res.status).toBe(200);
  });
});
