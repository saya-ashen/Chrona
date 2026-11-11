import { strict as assert } from "node:assert";
import { workStartSchema, type WorkLeafStart } from "./contract.js";

// Dormant DAG schemas remain app-owned; the public command boundary has no DAG API.
const baseline = { kind: "commit" as const, digest: "a".repeat(40) };
function leaf(workId: string, dependsOnWorkIds: string[] = []): WorkLeafStart {
  return { kind: "execution", workId, commandKey: `start-${workId}`, goal: workId, placement: { executorId: "server", projectRef: "repo", mappingRevision: 1 }, workspace: { mode: "independent_worktree", baseline }, queueExpiresAt: new Date(Date.now() + 60000).toISOString(), budget: { timeoutMs: 1000, maxToolCalls: 1 }, dependsOnWorkIds };
}
const a = leaf("a"), b = leaf("b", ["a"]);
const group = workStartSchema.parse({ kind: "group", workId: "parent", commandKey: "group", goal: "Two changes", children: [a, b] });
assert.throws(() => workStartSchema.parse({ ...group, children: [a, { ...b, workId: "a" }] }));
assert.throws(() => workStartSchema.parse({ ...group, children: [{ ...a, dependsOnWorkIds: ["b"] }, b] }));
assert.ok(group.kind === "group");
assert.deepEqual(group.children.map(item => item.workId), ["a", "b"]);
