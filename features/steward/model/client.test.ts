import { afterEach, describe, expect, it, vi } from "vitest";
import { apiJson } from "@shared/http";
import { createStewardClient, StewardClientError } from "./client";
import { chatFixture, approvalFixture, fileFixture, todayFixture } from "./fixtures";
vi.mock("@shared/http", () => ({ apiJson: vi.fn(), buildAccessKeyHeaders: () => new Headers(), handleUnauthorizedResponse: vi.fn() }));
afterEach(() => { vi.resetAllMocks(); vi.unstubAllGlobals(); });
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
  it.each([{ decision: "approve", scope: "once" }, { decision: "approve", scope: "affair" }, { decision: "deny", scope: "once" }] as const)("resolves approvals with %j", async input => {
    vi.mocked(apiJson).mockResolvedValue(approvalFixture());
    await createStewardClient("ws").resolveApproval("ask/1", input);
    expect(apiJson).toHaveBeenCalledWith("/api/steward/approvals/ask%2F1/resolve?workspaceId=ws", expect.objectContaining({ method: "POST", body: JSON.stringify(input) }));
  });
  it.each(["affairs", "connectors", "approvals", "preferences", "grants", "notifications"] as const)("validates %s envelopes", async name => {
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
    await expect(createStewardClient("ws").chat({ text: "a".repeat(8001) })).rejects.toMatchObject({ messageKey: "invalidInput" });
    expect(apiJson).not.toHaveBeenCalled();
  });
  it("encodes file paths and parses workspace files", async () => {
    vi.mocked(apiJson).mockResolvedValue(fileFixture());
    expect(await createStewardClient("ws").file("a/1", "notes/a b.md")).toEqual(fileFixture());
    expect(apiJson).toHaveBeenCalledWith("/api/steward/affairs/a%2F1/file?workspaceId=ws&path=notes%2Fa+b.md", expect.anything());
  });
  it("sends checkbox revisions and retains conflict status", async () => {
    const client = createStewardClient("ws");
    const input = { path: "README.md", line: 3, checked: true, baseRevision: "abc123" };
    vi.mocked(apiJson).mockResolvedValue(fileFixture());
    await client.toggleCheckbox("camera", input);
    expect(apiJson).toHaveBeenCalledWith("/api/steward/affairs/camera/checkbox?workspaceId=ws", expect.objectContaining({ body: JSON.stringify(input) }));
    vi.mocked(apiJson).mockRejectedValue({ status: 409 });
    await expect(client.saveFile("camera", { path: input.path, content: "draft", baseRevision: input.baseRevision })).rejects.toMatchObject({ status: 409 });
  });
  it("uploads multipart without a JSON content type and parses file metadata", async () => {
    const node = { path: "notes/test.txt", kind: "file", size: 4, updatedAt: "2026-10-15T10:00:00Z" };
    const send = vi.fn().mockResolvedValue(new Response(JSON.stringify(node), { status: 200 }));
    vi.stubGlobal("fetch", send);
    expect(await createStewardClient("ws").upload("camera", new File(["test"], "test.txt"), "notes")).toEqual(node);
    const options = send.mock.calls[0]![1] as RequestInit;
    expect(options.body).toBeInstanceOf(FormData);
    expect(new Headers(options.headers).has("content-type")).toBe(false);
  });
  it("never exposes server prose as an error message", async () => {
    vi.mocked(apiJson).mockRejectedValue(Object.assign(new Error("private server details"), { status: 401 }));
    await expect(createStewardClient("ws").today()).rejects.toEqual(new StewardClientError("unauthorized", 401));
  });
});
