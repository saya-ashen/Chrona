import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import hashes from "../../../../contracts/fixtures/contract-hashes.json";
import transitions from "../../../../contracts/fixtures/contract-hash-transitions.json";
import additions from "../../../../contracts/fixtures/contract-hash-additions.json";
import mainMerge from "../../../../contracts/fixtures/contract-hash-main-merge.json";
import migration from "../../../../contracts/fixtures/contract-hash-kernel-app-migration.json";
import agentTools from "../../../../contracts/fixtures/agent-tools.json";
import cases from "../../../../contracts/fixtures/contract-hash-cases.json";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import { collectContractHashes, readAgentTools } from "./contract-hash-baseline.fixture";
import { moduleCallbackContractHash, normalizedToolInputSchema } from "./module-tool-contract";

test("all tool hashes preserve the baseline except explicitly enumerated plan changes", async () => {
  const current = await collectContractHashes();
  expect(Object.keys(hashes)).toHaveLength(125);
  expect(transitions.map(transition => transition.target).sort()).toEqual([
    "agent.cleanup", "agent.locations", "agent.placement", "agent.run", "modules.diagnostics",
  ]);
  const expected: Record<string, string> = { ...hashes };
  for (const transition of transitions) {
    expect(transition.reason.length).toBeGreaterThan(20);
    expect(expected[transition.target]).toBe(transition.before);
    expected[transition.target] = transition.after;
  }
  expect(mainMerge.sourceCommit).toBe("079daa24");
  expect(mainMerge.changes.map(change => change.target)).toEqual([
    "mind.agenda", "mind.check", "mind.decisions", "mind.note", "mind.propose", "mind.report", "mind.signal", "mind.ui-agenda", "mind.ui-dismiss", "mind.ui-settings",
  ]);
  for (const change of mainMerge.changes) {
    expect((expected as Record<string, string | null>)[change.target] ?? null).toBe(change.before);
    expect(change.after).toMatch(/^[a-f0-9]{64}$/);
    expected[change.target] = change.after;
  }
  const newTargets = Object.keys(current).filter(target => !Object.hasOwn(expected, target)).sort();
  expect(newTargets).toEqual([...additions.map(addition => addition.target), ...migration.changes.filter(change => change.before === null).map(change => change.target)].sort());
  for (const addition of additions) {
    expect(addition.hash).toMatch(/^[a-f0-9]{64}$/);
    expect(addition.stage).toBe("S5");
    expect(addition.target.startsWith("remote-execution.")).toBe(true);
    expect(addition.reason.length).toBeGreaterThan(20);
    expect(Object.hasOwn(expected, addition.target)).toBe(false);
    expected[addition.target] = addition.hash;
  }
  expect(migration.changes.map(change => change.target)).toEqual(["agent.complete", "agent.completion", "author.export", "author.import", "author.prepare", "remind.create", "web.component-remove", "web.component-set", "web.page-set"]);
  for (const change of migration.changes) {
    expect((expected as Record<string, string | null>)[change.target] ?? null).toBe(change.before);
    expect(change.reason.length).toBeGreaterThan(20);
    expect(change.after).toMatch(/^[a-f0-9]{64}$/);
    expected[change.target] = change.after;
  }
  expect(current).toEqual(expected);
  expect([...new Set(Object.keys(hashes).map(target => target.split(".")[0]))].sort()).toEqual([
    "activity", "agent", "approvals", "author", "coding", "coding-web", "events", "files", "mcp", "memory-local", "mind", "modules", "notify", "qq", "remind", "secrets", "settings", "web",
  ]);
});

test("Agent preserves snapshot tools except explicit placement and kernel/app migration changes", async () => {
  const changed = transitions.filter(transition => transition.stage === "S5").map(transition => transition.target);
  expect(changed.sort()).toEqual(["agent.cleanup", "agent.locations", "agent.placement", "agent.run"]);
  const current = moduleManifestSchema.shape.tools.parse(await readAgentTools());
  expect(current.map(tool => tool.name).sort()).toEqual(agentTools.map(tool => tool.name).sort());
  for (const original of agentTools) {
    const tool = current.find(tool => tool.name === original.name)!;
    const transition = migration.changes.find(change => change.target === `agent.${tool.name}`) ?? transitions.find(transition => transition.target === `agent.${tool.name}` && transition.stage === "S5");
    if (transition) expect(moduleCallbackContractHash(tool)).toBe(transition.after);
    else expect(tool).toEqual(moduleManifestSchema.shape.tools.parse([original])[0]);
  }
});

for (const entry of cases) {
  test(`portable contract golden: ${entry.name}`, () => {
    const tool = moduleManifestSchema.shape.tools.parse([entry.tool])[0]!;
    expect(normalizedToolInputSchema(tool)).toEqual(entry.contract.input);
    expect(moduleCallbackContractHash(tool)).toBe(entry.contractHash);
    expect(createHash("sha256").update(entry.canonicalJson).digest("hex")).toBe(entry.contractHash);
    expect(JSON.parse(entry.canonicalJson)).toEqual(entry.contract);
  });
}

test("golden vectors distinguish array order and normalize visibility order", () => {
  const digest = (name: string) => cases.find(entry => entry.name === name)!.contractHash;
  expect(digest("unicode-numbers-nested")).toBe(digest("visibility-reversed"));
  expect(digest("unicode-numbers-nested")).not.toBe(digest("required-reversed"));
  expect(digest("enum-forward")).not.toBe(digest("enum-reversed"));
});
