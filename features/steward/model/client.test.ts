import { afterEach, describe, expect, it, vi } from "vitest";
import { createStewardClient } from "./client";
import { decisionItem, emptyToday } from "./fixtures";
import { initialSignals } from "./tool-form";
import { parseKeywords } from "./affairs";
import { apiJson } from "@shared/http";
vi.mock("@shared/http", () => ({ apiJson: vi.fn() }));
afterEach(() => vi.resetAllMocks());
describe("steward HTTP client", () => {
  it("generates tools and accepts created=false with a rationale", async () => {
    const response = { created: false, choice: { mode: "direct_answer", rationale: "One question" } };
    vi.mocked(apiJson).mockResolvedValue(response);
    const input = { name: "Question", purpose: "Answer", signals: initialSignals, spec: {} };
    expect(await createStewardClient("ws").generateTool(input)).toEqual(response);
    expect(apiJson).toHaveBeenCalledWith("/api/steward/tools?workspaceId=ws", expect.objectContaining({ method: "POST", body: JSON.stringify({ name: input.name, purpose: input.purpose, dataScopes: [], signals: input.signals, spec: input.spec }) }));
  });
  it("runs a tool with encoded id and validated result", async () => {
    vi.mocked(apiJson).mockResolvedValue({ matches: [], rows: [] });
    expect(await createStewardClient("ws").runTool("t/1", {})).toEqual({ matches: [], rows: [] });
    expect(apiJson).toHaveBeenCalledWith("/api/steward/tools/t%2F1/run?workspaceId=ws", expect.objectContaining({ method: "POST", body: '{"events":[]}' }));
  });
  it.each(["complete", "cancel"] as const)("posts follow-up %s and validates response", async action => {
    const followUp = { id: "f/1", affairId: null, attentionItemId: null, note: "Check", dueAt: "2026-10-13T00:00:00Z", status: action === "complete" ? "done" : "cancelled", createdAt: "2026-10-13T00:00:00Z" };
    vi.mocked(apiJson).mockResolvedValue(followUp);
    const client = createStewardClient("ws");
    expect(await (action === "complete" ? client.completeFollowUp("f/1") : client.cancelFollowUp("f/1"))).toEqual(followUp);
    expect(apiJson).toHaveBeenCalledWith(`/api/steward/follow-ups/f%2F1/${action}?workspaceId=ws`, expect.objectContaining({ method: "POST" }));
  });
  it("retries a notification without reassessment payload", async () => {
    const notification = { id: "n/1", attentionItemId: null, channel: "in_app", status: "queued", title: "Notice", body: "Body", link: null, attempts: 1, lastError: null, nextAttemptAt: null, generatedAt: "2026-10-13T00:00:00Z", sentAt: null, acknowledgedAt: null };
    vi.mocked(apiJson).mockResolvedValue(notification);
    expect(await createStewardClient("ws").retryNotification("n/1")).toEqual(notification);
    expect(apiJson).toHaveBeenCalledWith("/api/steward/notifications/n%2F1/retry?workspaceId=ws", expect.objectContaining({ method: "POST" }));
  });
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
  it("posts parsed affair keywords with workspace scope", async () => {
    const input = { title: "Trip", summary: "Context", goal: "Choose dates", keywords: parseKeywords(" travel, dates, ,travel ") };
    vi.mocked(apiJson).mockResolvedValue({ ...input, id: "a1", status: "active", taskId: null, openAttentionCount: 0, createdAt: "2026-10-13T00:00:00Z", updatedAt: "2026-10-13T00:00:00Z" });
    await createStewardClient("ws").createAffair(input);
    expect(apiJson).toHaveBeenCalledWith("/api/steward/affairs?workspaceId=ws", expect.objectContaining({ method: "POST", body: JSON.stringify({ title: "Trip", summary: "Context", goal: "Choose dates", keywords: ["travel", "dates"] }) }));
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
