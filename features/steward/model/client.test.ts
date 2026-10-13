import { afterEach, describe, expect, it, vi } from "vitest";
import { createStewardClient } from "./client";
import { decisionItem, emptyToday } from "./fixtures";
import { apiJson } from "@shared/http";
vi.mock("@shared/http", () => ({ apiJson: vi.fn() }));
afterEach(() => vi.resetAllMocks());
describe("steward HTTP client", () => {
  it("uses the shared authenticated client and explicit workspace scope", async () => {
    vi.mocked(apiJson).mockResolvedValue(emptyToday());
    const signal = new AbortController().signal;
    expect(await createStewardClient("workspace /1").today(signal)).toEqual(emptyToday());
    expect(apiJson).toHaveBeenCalledWith("/api/steward/today?workspaceId=workspace+%2F1", expect.objectContaining({ method: "GET", signal }));
  });
  it("posts a typed decision with an escaped item ID", async () => {
    vi.mocked(apiJson).mockResolvedValue(decisionItem());
    await createStewardClient("ws").decideAttention("id/1", { decision: "approve" });
    expect(apiJson).toHaveBeenCalledWith("/api/steward/attention/id%2F1/decision?workspaceId=ws", expect.objectContaining({ method: "POST", body: '{"decision":"approve"}' }));
  });
  it("rejects malformed server data rather than presenting all-clear", async () => {
    vi.mocked(apiJson).mockResolvedValue({ decisions: [] });
    await expect(createStewardClient("ws").today()).rejects.toThrow();
  });
  it("encodes filters without allowing scope replacement", async () => {
    vi.mocked(apiJson).mockResolvedValue({ items: [] });
    await createStewardClient("ws").events({ status: "pending", connectionId: "source&workspaceId=other" });
    expect(apiJson).toHaveBeenCalledWith("/api/steward/events?workspaceId=ws&status=pending&connectionId=source%26workspaceId%3Dother", expect.anything());
  });
  it.each(["affairs", "delegations", "connections", "notifications", "tools"] as const)("validates %s list envelopes", async kind => {
    vi.mocked(apiJson).mockResolvedValue({ items: [] });
    expect(await createStewardClient("ws")[kind]()).toEqual({ items: [] });
    vi.mocked(apiJson).mockResolvedValue({ items: [{ id: "incomplete" }] });
    await expect(createStewardClient("ws")[kind]()).rejects.toThrow();
  });
});
