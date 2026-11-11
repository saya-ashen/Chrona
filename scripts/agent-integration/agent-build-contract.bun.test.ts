import { expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { moduleManifestSchema, primitiveInput } from "@chrona/contracts/steward";
import { buildAgentApplication, parameters } from "../../packages/engine/src/modules/steward/builtin/agent/build";
import { validateToolArgs } from "../../packages/engine/src/modules/steward/module-tool-contract";

const local = {
  kind: "execution", "execution-id": "local-build-contract", "request-key": "local-build-contract", prompt: "bounded work",
  placement: { kind: "local", "project-ref": "project", "mapping-revision": 1 },
  workspace: { mode: "existing", baseline: { kind: "commit", digest: "a".repeat(40) } },
  "queue-expires-at": "2030-01-01T00:00:00.000Z", budget: { "timeout-ms": 5000, "max-tool-calls": 5 },
};
const application = {
  ...local, "execution-id": "application-build-contract", "request-key": "application-build-contract",
  placement: { kind: "application", "application-id": "runner", "target-ref": "target", "target-revision": 1, "project-ref": "project" },
  budget: { ...local.budget, "max-model-calls": 2, "max-output-tokens": 100 },
};

const publicInput = ({ ["request-key"]: _key, ...args }: Record<string, unknown>) => args;

test("generated Agent manifest admits local and application runs while SDK validation stays strict", async () => {
  const root = await mkdtemp(join(tmpdir(), "chrona-agent-build-contract-"));
  try {
    await buildAgentApplication(root);
    const generated = JSON.parse(await readFile(join(root, "module.json"), "utf8"));
    expect(generated).toEqual(JSON.parse(await readFile(join(import.meta.dir, "../../packages/engine/src/modules/steward/builtin/agent/module.json"), "utf8")));
    const run = moduleManifestSchema.parse(generated).tools.find(tool => tool.name === "work-run")!;
    for (const input of [local, application]) {
      expect(validateToolArgs(run, publicInput(input))).toEqual(publicInput(input));
      expect(() => primitiveInput("run", { ...validateToolArgs(run, publicInput(input)), "request-key": input["request-key"] })).not.toThrow();
    }
    // Branch-only requirements cannot be expressed by manifest parameters; the SDK still enforces them.
    const { "max-output-tokens": _tokens, ...incompleteBudget } = application.budget;
    const { "target-ref": _target, ...incompletePlacement } = application.placement;
    const { "mapping-revision": _revision, ...incompleteLocalPlacement } = local.placement;
    for (const input of [
      { ...application, budget: incompleteBudget },
      { ...application, placement: incompletePlacement },
      { ...local, placement: incompleteLocalPlacement },
      { ...local, placement: { ...local.placement, "application-id": "runner" } },
      { ...local, budget: { ...local.budget, "max-model-calls": 2 } },
    ]) {
      expect(() => validateToolArgs(run, publicInput(input))).not.toThrow();
      expect(() => primitiveInput("run", input)).toThrow();
    }
    const { "timeout-ms": _timeout, ...missingSharedLimit } = local.budget;
    for (const input of [
      { ...local, cwd: "/host" },
      { ...local, placement: { ...local.placement, unknown: true } },
      { ...local, budget: missingSharedLimit },
      { ...local, budget: { ...local.budget, "timeout-ms": "5000" } },
    ]) {
      expect(() => validateToolArgs(run, publicInput(input))).toThrow();
      expect(() => primitiveInput("run", input)).toThrow();
    }
  } finally { await rm(root, { recursive: true, force: true }); }
});

test("Agent input object unions merge recursively inside arrays and preserve mixed leaf unions", () => {
  const object = (properties: Record<string, ReturnType<typeof parameters>>, required = Object.keys(properties)) => ({ type: "object", properties, required });
  const string = { type: "string" }, number = { type: "number" };
  const union = (left: unknown, right: unknown) => ({ anyOf: [left, right] });
  expect(parameters(union(
    object({ entries: { type: "array", items: object({ shared: string, local: number }) } }),
    object({ entries: { type: "array", items: object({ shared: string, application: number }) } }),
  ))).toEqual(object({ entries: { type: "array", items: object({ shared: string, local: number, application: number }, ["shared"]) } }));
  expect(parameters(union(object({ field: string }), object({ field: number })))).toEqual(object({ field: { type: ["string", "number"] } }));
  expect(parameters(union(object({ field: string }), object({ field: object({}) })))).toEqual(object({ field: { anyOf: [string, object({})] } }));
});
