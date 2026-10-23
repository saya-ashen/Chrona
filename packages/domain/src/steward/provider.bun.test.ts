import { expect, test } from "bun:test";
import { providerRequestStatus, providerRunActive, providerText, providerToolPhase, providerUsage, validProviderAnswer } from "./provider";
import type { ProviderAnswer, ProviderQuestion } from "@chrona/contracts/steward";
const question = (method: ProviderQuestion["method"]): ProviderQuestion => ({ method, title: "Fixture", message: "", options: ["A", "B"], timeoutMs: 1000 });
test.each<[ProviderQuestion["method"], ProviderAnswer, boolean]>([
  ["confirm", { decision: "submit", value: true }, true], ["confirm", { decision: "submit", value: "true" }, false],
  ["select", { decision: "submit", value: 1 }, true], ["select", { decision: "submit", value: 2 }, false], ["select", { decision: "submit", value: -1 }, false], ["select", { decision: "submit", value: 0.5 }, false],
  ["input", { decision: "submit", value: "text" }, true], ["editor", { decision: "submit", value: false }, false],
  ["editor", { decision: "cancel" }, true],
])("%s validates response %j", (method, answer, valid) => expect(validProviderAnswer(question(method), answer)).toBe(valid));
test("progress uses names only; secret and control text never crosses", () => {
  expect(providerToolPhase("web_search")).toEqual({ phase: "searching", tool: "web_search" });
  expect(providerToolPhase("bad\narguments")).toEqual({ phase: "executing", tool: null });
  const text = providerText("\u001b[31mhello\u202e known-token password=hunter2 Bearer a-secret", ["known-token"]);
  expect(text).not.toContain("hunter2"); expect(text).not.toContain("a-secret"); expect(text).not.toContain("known-token"); expect(text).not.toContain("\u202e");
});
const stats = (total: number, cost: number) => ({ sessionId: "fixture", tokens: { input: total - 1, output: 1, cacheRead: 0, cacheWrite: 0, total }, cost, contextUsage: { tokens: 12, contextWindow: 100 } });
test("usage distinguishes delta, session total, reset and unknown", () => {
  expect(providerUsage(stats(20, 0.5), stats(10, 0.2))).toMatchObject({ scope: "run", total: 10, cost: 0.3 });
  expect(providerUsage(stats(20, 0.5))).toMatchObject({ scope: "session", total: 20 });
  expect(providerUsage(stats(2, 0.1), stats(10, 0.2))).toMatchObject({ scope: "session", total: 2 });
  expect(providerUsage({ ...stats(20, 0.5), sessionId: "different" }, stats(10, 0.2))).toMatchObject({ scope: "session", total: 20 });
  for (const invalid of [null, {}, stats(-1, 0), stats(10, -1), stats(10, Infinity)]) expect(providerUsage(invalid)).toBeNull();
});
test.each([
  ["running", true, true], ["running", false, false], ["finished", true, false],
])("run %s connected=%s", (status, connected, active) => {
  const now = new Date("2026-10-17T04:00:00Z");
  expect(providerRunActive({ status: String(status), deadlineAt: new Date(now.getTime() + 1000), leaseUntil: new Date(now.getTime() + 1000) }, Boolean(connected), now)).toBe(Boolean(active));
});
test.each([
  [undefined, true, true, "pending"], [undefined, false, true, "interrupted"], [undefined, true, false, "interrupted"], ["answered", false, false, "answered"], ["cancelled", false, false, "cancelled"],
] as const)("request receipt=%s live=%s waiting=%s -> %s", (receipt, alive, waiting, status) => {
  const request = { id: "id", runId: "run", sessionId: null, question: question("confirm"), status: "pending" as const, createdAt: "2026-10-17T04:00:00Z", expiresAt: "2026-10-17T04:01:00Z" };
  expect(providerRequestStatus(request, receipt, alive, waiting, new Date(request.createdAt))).toBe(status);
  if (!receipt) expect(providerRequestStatus(request, receipt, alive, waiting, new Date(request.expiresAt))).toBe("expired");
});
