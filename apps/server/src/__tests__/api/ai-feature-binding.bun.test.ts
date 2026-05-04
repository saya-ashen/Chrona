import { beforeEach, describe, expect, it } from "bun:test";
import { Hono } from "hono";
import { randomUUID } from "node:crypto";

import { db } from "@chrona/db";
import { resetTestDb, seedWorkspace, expectApiError, json } from "../bun-test-helpers";
import { error, internalServerError, json as httpJson } from "../../lib/http";

// ---------------------------------------------------------------------------
// Inline AI feature binding router
// ---------------------------------------------------------------------------

const VALID_AI_FEATURES = ["suggest", "generate_plan", "conflicts", "timeslots", "chat"] as const;

function createBindingRouter() {
  const api = new Hono();

  api.put("/ai/clients/:clientId/bindings", async (c) => {
    try {
      const clientId = c.req.param("clientId");
      const body = await c.req.json();
      const features = body.features;

      if (!Array.isArray(features)) {
        return error(c, "features must be an array", 400);
      }

      const client = await db.aiClient.findUnique({ where: { id: clientId } });
      if (!client) {
        return error(c, "Client not found", 404);
      }

      const validFeatures = [...new Set(
        features.filter((feature: string) =>
          (VALID_AI_FEATURES as readonly string[]).includes(feature),
        ),
      )];

      await db.$transaction(async (tx) => {
        if (validFeatures.length > 0) {
          await tx.aiFeatureBinding.deleteMany({ where: { feature: { in: validFeatures } } });
        }

        await tx.aiFeatureBinding.deleteMany({
          where: { clientId, feature: { notIn: validFeatures } },
        });

        for (const feature of validFeatures) {
          await tx.aiFeatureBinding.create({
            data: {
              id: randomUUID().replace(/-/g, "").slice(0, 25),
              feature,
              clientId,
            },
          });
        }
      });

      return httpJson(c, { bindings: validFeatures });
    } catch (cause) {
      return internalServerError(c, "PUT /api/ai/clients/:clientId/bindings", cause, "Failed to update feature bindings");
    }
  });

  return api;
}

function app() {
  const a = new Hono();
  a.route("/api", createBindingRouter());
  return a;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function createClient(name: string = "Test Client") {
  const client = await db.aiClient.create({
    data: { name, type: "openclaw", config: {}, enabled: true },
  });
  return client;
}

async function putBindings(clientId: string, features: string[]) {
  return await app().request(`http://local/api/ai/clients/${clientId}/bindings`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ features }),
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("AI Feature Binding", () => {
  beforeEach(async () => {
    await resetTestDb();
    await db.aiFeatureBinding.deleteMany();
    await db.aiClient.deleteMany();
    await seedWorkspace("Binding Workspace");
  });

  // ──────────────────────────────────────────────
  // Happy path
  // ──────────────────────────────────────────────

  it("PUT bindings assigns valid features to client", async () => {
    const client = await createClient("Client A");

    const res = await putBindings(client.id, ["suggest", "chat"]);
    expect(res.status).toBe(200);
    const body = await json<{ bindings: string[] }>(res);
    expect(body.bindings).toEqual(["suggest", "chat"]);
  });

  it("transferring a feature from client A to client B removes it from client A", async () => {
    const clientA = await createClient("Client A");
    const clientB = await createClient("Client B");

    await putBindings(clientA.id, ["suggest", "chat"]);

    // Transfer "suggest" to client B
    await putBindings(clientB.id, ["suggest"]);

    const bindingsA = await db.aiFeatureBinding.findMany({ where: { clientId: clientA.id } });
    const bindingsB = await db.aiFeatureBinding.findMany({ where: { clientId: clientB.id } });
    expect(bindingsA.map((binding) => binding.feature)).not.toContain("suggest");
    expect(bindingsA.map((binding) => binding.feature)).toContain("chat");
    expect(bindingsB.map((binding) => binding.feature)).toContain("suggest");
  });

  it("PUT bindings with empty array clears all bindings", async () => {
    const client = await createClient("Client A");
    await putBindings(client.id, ["suggest", "chat"]);

    const res = await putBindings(client.id, []);
    expect(res.status).toBe(200);
    const body = await json<{ bindings: string[] }>(res);
    expect(body.bindings).toEqual([]);

    const bindings = await db.aiFeatureBinding.findMany({ where: { clientId: client.id } });
    expect(bindings).toEqual([]);
  });

  // ──────────────────────────────────────────────
  // Negative cases
  // ──────────────────────────────────────────────

  it("PUT bindings with non-array features returns 400", async () => {
    const client = await createClient("Client A");

    const res = await app().request(`http://local/api/ai/clients/${client.id}/bindings`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ features: "not-an-array" }),
    });

    await expectApiError(res, 400);
  });

  it("PUT bindings with nonexistent client returns 404", async () => {
    const res = await putBindings("nonexistent-id", ["suggest"]);
    await expectApiError(res, 404);
  });

  // ──────────────────────────────────────────────
  // Edge cases
  // ──────────────────────────────────────────────

  it("PUT bindings filters out invalid feature names, keeps valid ones", async () => {
    const client = await createClient("Client A");

    const res = await putBindings(client.id, ["suggest", "nonexistent_feature", "chat"]);
    expect(res.status).toBe(200);
    const body = await json<{ bindings: string[] }>(res);

    expect(body.bindings).toContain("suggest");
    expect(body.bindings).toContain("chat");
    expect(body.bindings).not.toContain("nonexistent_feature");
    expect(body.bindings.length).toBe(2);
  });

  it("PUT bindings idempotent: same feature bound twice does not duplicate", async () => {
    const client = await createClient("Client A");

    await putBindings(client.id, ["suggest"]);
    await putBindings(client.id, ["suggest", "suggest"]);

    const bindings = await db.aiFeatureBinding.findMany({
      where: { clientId: client.id, feature: "suggest" },
    });
    expect(bindings.length).toBe(1);
  });
});
