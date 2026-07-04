import { beforeEach, describe, expect, it } from "bun:test";

import { db } from "@/lib/db";
import { createAiClient } from "./create-ai-client";
import { deleteAiClient } from "./delete-ai-client";
import { updateAiClient } from "./update-ai-client";
import { aiClientRegistry } from "../runtime/client-registry";
import { resetTestDb, seedWorkspace } from "../../../apps/server/src/__tests__/bun-test-helpers";

async function listDefaults() {
  return db.aiClient.findMany({
    where: { isDefault: true },
    orderBy: { createdAt: "asc" },
    select: { id: true, name: true, enabled: true },
  });
}

describe("AI client default selection", () => {
  beforeEach(async () => {
    await resetTestDb();
    await seedWorkspace("AI client defaults");
    await aiClientRegistry.refresh();
  });

  it("makes the first enabled client default", async () => {
    const client = await createAiClient({ name: "First", type: "codex" });

    expect(client.isDefault).toBe(true);
    expect(await listDefaults()).toEqual([
      { id: client.id, name: "First", enabled: true },
    ]);
  });

  it("keeps the current default when creating another non-default client", async () => {
    const first = await createAiClient({ name: "First", type: "codex" });
    const second = await createAiClient({ name: "Second", type: "claude_code" });

    expect(second.isDefault).toBe(false);
    expect(await listDefaults()).toEqual([
      { id: first.id, name: "First", enabled: true },
    ]);
  });

  it("moves the default when creating an explicit default client", async () => {
    await createAiClient({ name: "First", type: "codex" });
    const second = await createAiClient({ name: "Second", type: "claude_code", isDefault: true });

    expect(await listDefaults()).toEqual([
      { id: second.id, name: "Second", enabled: true },
    ]);
  });

  it("promotes the oldest remaining enabled client when disabling the default", async () => {
    const first = await createAiClient({ name: "First", type: "codex" });
    const second = await createAiClient({ name: "Second", type: "claude_code" });

    const updated = await updateAiClient(first.id, { enabled: false });

    expect(updated.enabled).toBe(false);
    expect(updated.isDefault).toBe(false);
    expect(await listDefaults()).toEqual([
      { id: second.id, name: "Second", enabled: true },
    ]);
  });

  it("promotes the oldest remaining enabled client when deleting the default", async () => {
    const first = await createAiClient({ name: "First", type: "codex" });
    const second = await createAiClient({ name: "Second", type: "claude_code" });

    await deleteAiClient(first.id);

    expect(await listDefaults()).toEqual([
      { id: second.id, name: "Second", enabled: true },
    ]);
  });

  it("registry falls back to the oldest enabled client for legacy data with no default", async () => {
    const client = await createAiClient({ name: "Legacy", type: "codex" });
    await db.aiClient.update({ where: { id: client.id }, data: { isDefault: false } });
    await aiClientRegistry.refresh();

    const resolved = await aiClientRegistry.get();

    expect(resolved?.record.id).toBe(client.id);
  });
});
