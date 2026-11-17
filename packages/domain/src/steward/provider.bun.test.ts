import { expect, test } from "bun:test";
import { providerRequestStatus, providerRunActive, providerText, validProviderAnswer } from "./provider";
import type { ProviderAnswer, ProviderQuestion } from "@chrona/contracts/steward";
const question = (method: ProviderQuestion["method"]): ProviderQuestion => ({ method, title: "Fixture", message: "", options: ["A", "B"], timeoutMs: 1000 });
test.each<[ProviderQuestion["method"], ProviderAnswer, boolean]>([
  ["confirm", { decision: "submit", value: true }, true], ["confirm", { decision: "submit", value: "true" }, false],
  ["select", { decision: "submit", value: 1 }, true], ["select", { decision: "submit", value: 2 }, false], ["select", { decision: "submit", value: -1 }, false], ["select", { decision: "submit", value: 0.5 }, false],
  ["input", { decision: "submit", value: "text" }, true], ["editor", { decision: "submit", value: false }, false],
  ["editor", { decision: "cancel" }, true],
])("%s validates response %j", (method, answer, valid) => expect(validProviderAnswer(question(method), answer)).toBe(valid));
test("secret and control text never crosses", () => {
  const text = providerText("\u001b[31mhello\u202e known-token password=hunter2 Bearer a-secret", ["known-token"]);
  expect(text).not.toContain("hunter2"); expect(text).not.toContain("a-secret"); expect(text).not.toContain("known-token"); expect(text).not.toContain("\u202e");
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

test.each([
  [null, null, true], [1000, null, true], [null, 1000, true],
  [0, null, false], [null, 0, false], [-1, 1000, false], [1000, -1, false],
] as const)("active run deadline=%s lease=%s", (deadline, lease, active) => {
  const now = new Date("2026-10-17T04:00:00Z");
  const run = { status: "running", deadlineAt: deadline === null ? null : new Date(now.getTime() + deadline), leaseUntil: lease === null ? null : new Date(now.getTime() + lease) };
  expect(providerRunActive(run, true, now)).toBe(active);
  expect(providerRunActive(run, false, now)).toBe(false);
});
