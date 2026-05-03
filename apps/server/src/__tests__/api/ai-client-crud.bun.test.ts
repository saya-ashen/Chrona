import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";

import { db } from "@chrona/db";
import { createAiClientSchema } from "../../routes/schemas";
import {
  resetTestDb,
  seedWorkspace,
  expectApiError,
  json,
} from "../bun-test-helpers";
import { error, internalServerError, json as httpJson } from "../../lib/http";

// ---------------------------------------------------------------------------
// Inline AI client CRUD router (avoids full ai.routes.ts cascade import)
// ---------------------------------------------------------------------------

function createAiClientRouter() {
  const api = new Hono();

  api.get("/ai/clients", async (c) => {
    try {
      const clients = await db.aiClient.findMany({
        include: { bindings: true },
        orderBy: { createdAt: "asc" },
      });

      return httpJson(c, {
        clients: clients.map((client) => ({
          id: client.id,
          name: client.name,
          type: client.type,
          config: client.config,
          isDefault: client.isDefault,
          enabled: client.enabled,
          bindings: client.bindings.map((binding) => binding.feature),
          createdAt: client.createdAt.toISOString(),
        })),
      });
    } catch (cause) {
      return internalServerError(c, "GET /api/ai/clients", cause, "Failed to list AI clients");
    }
  });

  api.post("/ai/clients", async (c) => {
    try {
      const body = await c.req.json();

      const parsed = createAiClientSchema.safeParse(body);
      if (!parsed.success) {
        return error(c, parsed.error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join("; "), 400);
      }

      const { name, type, config, isDefault } = parsed.data;

      if (isDefault) {
        await db.aiClient.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      }

      const client = await db.aiClient.create({
        data: {
          name,
          type,
          config: (config ?? {}) as any,
          isDefault: isDefault ?? false,
          enabled: true,
        },
      });

      return httpJson(c, { client }, 201);
    } catch (cause) {
      return internalServerError(c, "POST /api/ai/clients", cause, "Failed to create AI client");
    }
  });

  api.get("/ai/clients/:clientId", async (c) => {
    try {
      const client = await db.aiClient.findUnique({
        where: { id: c.req.param("clientId") },
        include: { bindings: true },
      });

      if (!client) {
        return error(c, "Client not found", 404);
      }

      return httpJson(c, {
        id: client.id,
        name: client.name,
        type: client.type,
        config: client.config,
        isDefault: client.isDefault,
        enabled: client.enabled,
        bindings: client.bindings.map((binding) => binding.feature),
      });
    } catch (cause) {
      return internalServerError(c, "GET /api/ai/clients/:clientId", cause, "Failed to get AI client");
    }
  });

  api.patch("/ai/clients/:clientId", async (c) => {
    try {
      const clientId = c.req.param("clientId");
      const body = await c.req.json();
      const existing = await db.aiClient.findUnique({ where: { id: clientId } });

      if (!existing) {
        return error(c, "Client not found", 404);
      }

      if (body.isDefault === true) {
        await db.aiClient.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      }

      const updated = await db.aiClient.update({
        where: { id: clientId },
        data: {
          ...(body.name !== undefined && { name: body.name }),
          ...(body.config !== undefined && { config: body.config }),
          ...(body.isDefault !== undefined && { isDefault: body.isDefault }),
          ...(body.enabled !== undefined && { enabled: body.enabled }),
        },
      });

      return httpJson(c, { client: updated });
    } catch (cause) {
      return internalServerError(c, "PATCH /api/ai/clients/:clientId", cause, "Failed to update AI client");
    }
  });

  api.delete("/ai/clients/:clientId", async (c) => {
    try {
      await db.aiClient.delete({ where: { id: c.req.param("clientId") } });
      return httpJson(c, { success: true });
    } catch {
      return error(c, "Client not found", 404);
    }
  });

  return api;
}

function app() {
  const a = new Hono();
  a.route("/api", createAiClientRouter());
  return a;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createClient(body: Record<string, unknown>) {
  return await app().request("http://local/api/ai/clients", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AI Client CRUD", () => {
  beforeEach(async () => {
    await resetTestDb();
    await db.aiClient.deleteMany();
    await db.aiFeatureBinding.deleteMany();
    await seedWorkspace("AI Client CRUD Workspace");
  });

  // ──────────────────────────────────────────────
  // Happy path
  // ──────────────────────────────────────────────

  it("POST /ai/clients creates openclaw client and returns 201", async () => {
    const res = await createClient({ name: "My OpenClaw", type: "openclaw" });

    expect(res.status).toBe(201);
    const body = await json<{ client: { id: string; name: string; type: string; isDefault: boolean; enabled: boolean } }>(res);
    expect(body.client.name).toBe("My OpenClaw");
    expect(body.client.type).toBe("openclaw");
    expect(body.client.isDefault).toBe(false);
    expect(body.client.enabled).toBe(true);
  });

  it("POST /ai/clients creates llm client and returns 201", async () => {
    const res = await createClient({ name: "My LLM", type: "llm" });

    expect(res.status).toBe(201);
    const body = await json<{ client: { type: string } }>(res);
    expect(body.client.type).toBe("llm");
  });

  it("POST /ai/clients with isDefault=true unsets other defaults", async () => {
    await createClient({ name: "Client A", type: "openclaw", isDefault: true });
    await createClient({ name: "Client B", type: "llm", isDefault: true });

    const listRes = await app().request("http://local/api/ai/clients");
    const listBody = await json<{ clients: Array<{ name: string; isDefault: boolean }> }>(listRes);

    const clientA = listBody.clients.find((c) => c.name === "Client A");
    const clientB = listBody.clients.find((c) => c.name === "Client B");
    expect(clientA?.isDefault).toBe(false);
    expect(clientB?.isDefault).toBe(true);
  });

  it("GET /ai/clients lists all clients with bindings", async () => {
    await createClient({ name: "Client A", type: "openclaw" });
    await createClient({ name: "Client B", type: "llm" });

    const res = await app().request("http://local/api/ai/clients");
    expect(res.status).toBe(200);
    const body = await json<{ clients: Array<{ name: string; bindings: string[] }> }>(res);
    expect(body.clients.length).toBe(2);
    expect(body.clients[0].bindings).toEqual([]);
  });

  it("GET /ai/clients/:id returns single client", async () => {
    const createRes = await createClient({ name: "Single", type: "openclaw" });
    const created = await json<{ client: { id: string } }>(createRes);

    const res = await app().request(`http://local/api/ai/clients/${created.client.id}`);
    expect(res.status).toBe(200);
    const body = await json<{ id: string; name: string; type: string; bindings: string[] }>(res);
    expect(body.id).toBe(created.client.id);
    expect(body.name).toBe("Single");
    expect(body.type).toBe("openclaw");
  });

  it("PATCH /ai/clients/:id updates name and config", async () => {
    const createRes = await createClient({ name: "Old", type: "openclaw" });
    const created = await json<{ client: { id: string } }>(createRes);

    const res = await app().request(`http://local/api/ai/clients/${created.client.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "New Name", config: { key: "value" } }),
    });

    expect(res.status).toBe(200);
    const body = await json<{ client: { name: string; config: Record<string, unknown> } }>(res);
    expect(body.client.name).toBe("New Name");
    expect(body.client.config).toEqual({ key: "value" });
  });

  it("PATCH /ai/clients/:id sets enabled=false", async () => {
    const createRes = await createClient({ name: "Toggle Me", type: "openclaw" });
    const created = await json<{ client: { id: string } }>(createRes);

    const res = await app().request(`http://local/api/ai/clients/${created.client.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });

    expect(res.status).toBe(200);
    const body = await json<{ client: { enabled: boolean } }>(res);
    expect(body.client.enabled).toBe(false);
  });

  it("PATCH /ai/clients/:id sets isDefault=true and unsets others", async () => {
    const _aRes = await createClient({ name: "A", type: "openclaw", isDefault: true });
    const bRes = await createClient({ name: "B", type: "llm" });
    const b = await json<{ client: { id: string } }>(bRes);

    await app().request(`http://local/api/ai/clients/${b.client.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isDefault: true }),
    });

    const listRes = await app().request("http://local/api/ai/clients");
    const listBody = await json<{ clients: Array<{ name: string; isDefault: boolean }> }>(listRes);

    expect(listBody.clients.find((c) => c.name === "A")?.isDefault).toBe(false);
    expect(listBody.clients.find((c) => c.name === "B")?.isDefault).toBe(true);
  });

  it("DELETE /ai/clients/:id removes client, subsequent GET returns 404", async () => {
    const createRes = await createClient({ name: "Delete Me", type: "openclaw" });
    const created = await json<{ client: { id: string } }>(createRes);

    const delRes = await app().request(`http://local/api/ai/clients/${created.client.id}`, { method: "DELETE" });
    expect(delRes.status).toBe(200);

    const getRes = await app().request(`http://local/api/ai/clients/${created.client.id}`);
    await expectApiError(getRes, 404);
  });

  // ──────────────────────────────────────────────
  // Negative cases
  // ──────────────────────────────────────────────

  it("POST /ai/clients missing name returns 400", async () => {
    const res = await createClient({ type: "openclaw" });
    expect(res.status).toBe(400);
  });

  it("POST /ai/clients missing type returns 400", async () => {
    const res = await createClient({ name: "No Type" });
    await expectApiError(res, 400);
  });

  it("POST /ai/clients invalid type returns 400", async () => {
    const res = await createClient({ name: "Bad Type", type: "gpt" });
    await expectApiError(res, 400);
  });

  it("GET /ai/clients/:id nonexistent returns 404", async () => {
    const res = await app().request("http://local/api/ai/clients/nonexistent");
    await expectApiError(res, 404);
  });

  it("PATCH /ai/clients/:id nonexistent returns 404", async () => {
    const res = await app().request("http://local/api/ai/clients/nonexistent", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Ghost" }),
    });
    await expectApiError(res, 404);
  });

  it("DELETE /ai/clients/:id nonexistent returns 404", async () => {
    const res = await app().request("http://local/api/ai/clients/nonexistent", { method: "DELETE" });
    await expectApiError(res, 404);
  });

  // ──────────────────────────────────────────────
  // Zod validation
  // ──────────────────────────────────────────────

  it("POST /ai/clients config as string returns 400 with field info", async () => {
    const res = await createClient({ name: "Bad Config", type: "openclaw", config: "not-an-object" });
    expect(res.status).toBe(400);
    const body = await json<{ error: string }>(res);
    expect(body.error).toContain("config");
  });
});
