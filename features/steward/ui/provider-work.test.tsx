import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { I18nProvider } from "@chrona/i18n/react";
import type { ProviderRunView } from "@chrona/contracts";
import en from "../../../packages/i18n/src/messages/en.json";
import { createStewardClient, StewardClientError } from "../model/client";
import { ProviderWork } from "./provider-work";
afterEach(cleanup);
const copy = en.steward.providerWork;
function run(method: "confirm" | "select" | "input" | "editor" = "confirm"): ProviderRunView {
  const now = new Date().toISOString();
  return { id: "run", sessionId: "session", sessionTitle: "Independent IELTS", active: true, status: "running", progress: { phase: "waiting", tool: null }, usage: null, resources: null, updatedAt: now,
    interactions: [{ id: "request", runId: "run", sessionId: "session", status: "pending", createdAt: now, expiresAt: new Date(Date.now() + 60_000).toISOString(), question: { method, title: "Fixture request", message: "Only this attempt", options: method === "select" ? ["First", "Second"] : [], timeoutMs: 60_000 } }] };
}
function show(items: ProviderRunView[] = [run()], error?: Error) {
  const client = createStewardClient("workspace");
  const load = vi.spyOn(client, "providerRuns").mockResolvedValue({ items });
  if (error) load.mockRejectedValueOnce(error);
  const answer = vi.spyOn(client, "answerProvider").mockResolvedValue({ ok: true });
  const stop = vi.spyOn(client, "cancelProviderRun").mockResolvedValue({ ok: true });
  render(<MemoryRouter><I18nProvider locale="en" messages={en}><ProviderWork client={client} sessionId="session" /></I18nProvider></MemoryRouter>);
  return { load, answer, stop };
}
it("shows safe current work and never approves on rendering", async () => {
  const { answer, load } = show(); await screen.findByText("Fixture request");
  expect(answer).not.toHaveBeenCalled(); expect(load).toHaveBeenCalledWith("session", expect.any(AbortSignal));
  expect(screen.getByText(copy.boundary)).toBeVisible(); expect(screen.getByRole("link", { name: "Independent IELTS" })).toHaveAttribute("href", "/en/chat?sessionId=session");
  await userEvent.click(screen.getByRole("button", { name: copy.deny }));
  expect(answer).toHaveBeenCalledWith("request", { decision: "submit", value: false });
});
it("requires an explicit selection and submission, not the first option by default", async () => {
  const { answer } = show([run("select")]); await screen.findByText("Fixture request");
  expect(screen.getByRole("button", { name: copy.send })).toBeDisabled();
  await userEvent.click(screen.getByRole("button", { name: "Second" })); expect(answer).not.toHaveBeenCalled();
  await userEvent.click(screen.getByRole("button", { name: copy.send }));
  expect(answer).toHaveBeenCalledWith("request", { decision: "submit", value: 1 });
});
it.each(["input", "editor"] as const)("%s preserves a draft on conflict, with no automatic resend", async method => {
  const { answer } = show([run(method)]); await screen.findByRole("textbox", { name: copy.answer });
  answer.mockRejectedValue(new StewardClientError("requestError", 409));
  expect(screen.getByRole("button", { name: copy.send })).toBeDisabled();
  await userEvent.type(screen.getByRole("textbox"), "My draft");
  await userEvent.click(screen.getByRole("button", { name: copy.send }));
  expect(await screen.findByText(copy.stale)).toBeVisible(); expect(screen.getByRole("textbox")).toHaveValue("My draft");
  expect(answer).toHaveBeenCalledTimes(1);
});
it("edits a live original without resetting the user's draft or submitting it automatically", async () => {
  const value = run("editor"); value.interactions[0]!.question.prefill = "Original draft\nSecond line";
  const { answer } = show([value]); const input = await screen.findByRole("textbox");
  expect(input).toHaveValue("Original draft\nSecond line"); expect(answer).not.toHaveBeenCalled();
  await userEvent.clear(input); await userEvent.type(input, "Complete replacement");
  await userEvent.click(screen.getByRole("button", { name: copy.send }));
  expect(answer).toHaveBeenCalledWith("request", { decision: "submit", value: "Complete replacement" });
});
it.each(["expired", "interrupted", "answered", "cancelled"] as const)("%s requests have no answering controls", async status => {
  const value = run(); value.active = false; value.interactions[0]!.status = status;
  const { answer } = show([value]); await screen.findByText(copy.details);
  expect(screen.queryByRole("button", { name: copy.allow })).not.toBeInTheDocument();
  await userEvent.click(screen.getByText(copy.details)); expect(screen.getByText(new RegExp(copy.states[status]))).toBeVisible();
  expect(answer).not.toHaveBeenCalled();
});
it("stop requires confirmation and does not silently submit a question", async () => {
  const value = run(); value.interactions = [];
  const { stop, answer } = show([value]); await screen.findByRole("button", { name: copy.stop });
  await userEvent.click(screen.getByRole("button", { name: copy.stop })); expect(stop).not.toHaveBeenCalled();
  const confirm = screen.getByRole("alert"); await userEvent.click(within(confirm).getByRole("button", { name: copy.stop }));
  expect(stop).toHaveBeenCalledWith("run"); expect(answer).not.toHaveBeenCalled();
});
it("shows session statistics as session totals, not this attempt or a bill", async () => {
  const value = run(); value.active = false; value.interactions = []; value.usage = { scope: "session", input: 9, output: 1, cacheRead: 0, cacheWrite: 0, total: 10, cost: 0.1, contextTokens: null, contextWindow: null };
  show([value]); await userEvent.click(await screen.findByText(copy.details));
  expect(screen.getByText(new RegExp("Session total"))).toBeVisible(); expect(screen.getByText(copy.estimate)).toBeVisible();
});
it("loads empty state without inventing activity",  async () => {
  const { load } = show([]); await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());
  expect(screen.queryByRole("button")).not.toBeInTheDocument(); expect(load).toHaveBeenCalledTimes(1);
});
it("offers retry when progress cannot be loaded", async () => {
  const { load } = show([], new Error("offline"));
  expect(await screen.findByText(en.steward.foundation.networkError)).toBeVisible();
  load.mockResolvedValue({ items: [run()] });
  await userEvent.click(screen.getByRole("button", { name: en.steward.foundation.retry }));
  expect(await screen.findByText("Fixture request")).toBeVisible();
});
