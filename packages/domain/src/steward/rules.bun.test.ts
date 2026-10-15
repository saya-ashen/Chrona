import { expect, test } from "bun:test";
import { applyRules } from "./rules";
const item = { from: "Alice@example.com", subject: "Urgent invoice", body: "Please review" };
test.each([
  [null, "batch", ""],
  [{ rules: [] }, "batch", ""],
  [{ rules: [], default: "digest_only" }, "digest_only", ""],
  ["{", "batch", "rules.json 无效"],
  [{ rules: [{ match: {}, action: "allow" }] }, "batch", "rules.json 无效"],
  [{ rules: [{ match: { from: "ALICE", subject: "invoice", body: "REVIEW" }, action: "wake_now", note: "important" }, { match: {}, action: "ignore" }] }, "wake_now", "important"],
  [{ rules: [{ match: { from: "alice", subject: "missing" }, action: "ignore" }] }, "batch", ""],
  ['{"rules":[{"match":{},"action":"ignore"}]}', "ignore", ""],
] as const)("rules %j", (file, action, note) => expect(applyRules(file, item)).toEqual({ action, note }));
