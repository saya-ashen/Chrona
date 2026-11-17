import { expect, test } from "bun:test";
import { z } from "zod";
import { ACTIONS, APPROVAL_SCOPES, approvalSchema, resolveApprovalSchema } from "@chrona/contracts/steward";
import { approvals } from "./system/approvals";
import { registerSystemModules } from "./system-modules";
import { checkSystemOutput, listSystemModules } from "./modules/module-calls";

test("every system tool a module or the owner can call declares its output (v2-25)", () => {
  registerSystemModules();
  const missing = listSystemModules().flatMap(module => module.tools
    .filter(tool => tool.visibility.some(who => who === "modules" || who === "owner") && !tool.output)
    .map(tool => `${module.name}.${tool.name}`));
  expect(missing).toEqual([]);
});

test("approvals expose exactly four tools and resolve accepts only identity and decision", () => {
  expect(approvals.tools.map(tool => tool.name)).toEqual(["list", "resolve", "request", "status"]);
  const resolve = approvals.tools.find(tool => tool.name === "resolve")!;
  expect(Object.keys(resolve.parameters.properties)).toEqual(["approval", "decision"]);
  expect(resolve.parameters.required).toEqual(["approval", "decision"]);
});

test("approval records have only current actions and private resolution defaults to once", () => {
  expect(ACTIONS).toEqual(["activate_module", "delete_data", "modify_external"]);
  expect(approvalSchema.shape.action.options).toEqual([...ACTIONS]);
  expect(APPROVAL_SCOPES).toEqual(["once"]);
  expect(resolveApprovalSchema.parse({ decision: "approve" })).toEqual({ decision: "approve", scope: "once" });
  expect(resolveApprovalSchema.safeParse({ decision: "approve", scope: "always" }).success).toBe(false);
});

test("a system tool output that breaks its contract fails under test", () => {
  const tool = { name: "t", description: "t", parameters: { type: "object" as const, properties: {}, required: [] }, visibility: ["modules" as const], idempotent: true, output: z.object({ n: z.number() }) };
  expect(() => checkSystemOutput("x.t", tool, { n: 1 })).not.toThrow();
  expect(() => checkSystemOutput("x.t", tool, { n: "1" })).toThrow("x.t output does not match");
});
