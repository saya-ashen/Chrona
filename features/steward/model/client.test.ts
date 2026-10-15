import { afterEach, describe, expect, it, vi } from "vitest";
import { apiJson } from "@shared/http";
import { createStewardClient, StewardClientError } from "./client";
import { chatFixture, questionFixture, todayFixture } from "./fixtures";
vi.mock("@shared/http", () => ({ apiJson: vi.fn() }));
afterEach(() => vi.resetAllMocks());
describe("steward contract client", () => {
  it("parses realistic Today data and encodes workspace scope", async () => {
    vi.mocked(apiJson).mockResolvedValue(todayFixture());
    expect(await createStewardClient("workspace /1").today()).toEqual(todayFixture());
    expect(apiJson).toHaveBeenCalledWith("/api/steward/today?workspaceId=workspace+%2F1", expect.objectContaining({ method: "GET" }));
  });
  it("posts chat without a short client timeout", async () => {
    vi.mocked(apiJson).mockResolvedValue(chatFixture);
    expect(await createStewardClient("ws").chat({ text: "预算 6000" })).toEqual(chatFixture);
    expect(apiJson).toHaveBeenCalledWith("/api/steward/chat?workspaceId=ws", expect.objectContaining({ method: "POST", body: '{"text":"预算 6000"}' }));
  });
  it.each([{ decision: "answer", text: "600 克以内" }, { decision: "approve", scope: "once" }, { decision: "approve", scope: "affair" }, { decision: "deny" }] as const)("resolves asks with %j", async input => {
    vi.mocked(apiJson).mockResolvedValue(questionFixture());
    await createStewardClient("ws").resolveAsk("ask/1", input);
    expect(apiJson).toHaveBeenCalledWith("/api/steward/asks/ask%2F1/resolve?workspaceId=ws", expect.objectContaining({ method: "POST", body: JSON.stringify(input) }));
  });
  it.each(["affairs", "connections", "tools", "preferences", "grants", "notifications"] as const)("validates %s envelopes", async name => {
    vi.mocked(apiJson).mockResolvedValue({ items: [] });
    expect(await createStewardClient("ws")[name]()).toEqual({ items: [] });
    vi.mocked(apiJson).mockResolvedValue({ items: [{ id: "incomplete" }] });
    await expect(createStewardClient("ws")[name]()).rejects.toMatchObject({ messageKey: "invalidResponse" });
  });
  it("handles DELETE's empty 204 response", async () => {
    vi.mocked(apiJson).mockResolvedValue(null);
    expect(await createStewardClient("ws").deletePreference("p/1")).toBeNull();
  });
  it("rejects invalid input before sending", async () => {
    await expect(createStewardClient("ws").chat({ text: " " })).rejects.toMatchObject({ messageKey: "invalidInput" });
    expect(apiJson).not.toHaveBeenCalled();
  });
  it("never exposes server prose as an error message", async () => {
    vi.mocked(apiJson).mockRejectedValue(Object.assign(new Error("private server details"), { status: 401 }));
    await expect(createStewardClient("ws").today()).rejects.toEqual(new StewardClientError("unauthorized", 401));
  });
});
