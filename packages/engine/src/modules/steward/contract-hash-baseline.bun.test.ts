import { expect, test } from "bun:test";
import { createHash } from "node:crypto";
import hashes from "../../../../contracts/fixtures/contract-hashes.json";
import transitions from "../../../../contracts/fixtures/contract-hash-transitions.json";
import additions from "../../../../contracts/fixtures/contract-hash-additions.json";
import mainMerge from "../../../../contracts/fixtures/contract-hash-main-merge.json";
import migration from "../../../../contracts/fixtures/contract-hash-kernel-app-migration.json";
import api from "../../../../contracts/fixtures/contract-hash-kernel-api.json";
import journey from "../../../../contracts/fixtures/contract-hash-steward-journey.json";
import providerRegistration from "../../../../contracts/fixtures/contract-hash-provider-registration.json";
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
  for (const change of api.changes) {
    expect((expected as Record<string, string | null>)[change.target] ?? null).toBe(change.before);
    expect(change.reason.length).toBeGreaterThan(20);
    if (change.after === null) delete expected[change.target];
    else expected[change.target] = change.after;
  }
  expect(journey.changes.map(change => change.target)).toEqual([
    "activity.usage", "files.read", "memory-local.conversation-retain", "memory-local.correct-memory", "memory-local.correct-preference", "memory-local.recall",
    "mind.agenda", "mind.check", "mind.ui-agenda", "mind.ui-sources",
  ]);
  for (const change of journey.changes) {
    expect((expected as Record<string, string | null>)[change.target] ?? null).toBe(change.before);
    expect(change.reason.length).toBeGreaterThan(20);
    expect(change.after).toMatch(/^[a-f0-9]{64}$/);
    expected[change.target] = change.after;
  }
  for (const change of providerRegistration.changes) {
    expect(change.target).toMatch(/^(agent|pi)\./);
    expect((expected as Record<string, string | null>)[change.target] ?? null).toBe(change.before);
    expect(change.reason.length).toBeGreaterThan(20);
    if (change.after === null) delete expected[change.target];
    else expected[change.target] = change.after;
  }
  expect(current).toEqual(expected);
  expect([...new Set(Object.keys(hashes).map(target => target.split(".")[0]))].sort()).toEqual([
    "activity", "agent", "approvals", "author", "coding", "coding-web", "events", "files", "mcp", "memory-local", "mind", "modules", "notify", "qq", "remind", "secrets", "settings", "web",
  ]);
});

test("Agent preserves historical hashes through explicit migrations to the seven kernel tools", async () => {
  const changed = transitions.filter(transition => transition.stage === "S5").map(transition => transition.target);
  expect(changed.sort()).toEqual(["agent.cleanup", "agent.locations", "agent.placement", "agent.run"]);
  const current = await readAgentTools();
  expect(current.map(tool => tool.name).sort()).toEqual(["native", "providers", "read", "register", "run", "stop", "write"]);
  const expected = new Map(agentTools.map(tool => [tool.name, moduleCallbackContractHash(moduleManifestSchema.shape.tools.parse([tool])[0]!)]));
  for (const change of [...transitions, ...migration.changes, ...api.changes, ...providerRegistration.changes]) if (change.target.startsWith("agent.")) {
    const name = change.target.slice(6);
    if (change.after === null) expected.delete(name); else expected.set(name, change.after);
  }
  expect(current.map(tool => tool.name).sort()).toEqual([...expected.keys()].sort());
  for (const tool of current) expect(moduleCallbackContractHash(tool)).toBe(expected.get(tool.name)!);
});

for (const entry of cases) {
  test(`portable contract golden: ${entry.name}`, () => {
    if (!entry.tool.output) {
      expect(moduleManifestSchema.shape.tools.safeParse([entry.tool]).success).toBe(false);
      expect(createHash("sha256").update(entry.canonicalJson).digest("hex")).toBe(entry.contractHash);
      return;
    }
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
