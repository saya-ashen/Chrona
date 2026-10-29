import { expect, test } from "bun:test";
import { z } from "zod";
import { registerSystemModules } from "./system-modules";
import { checkSystemOutput, listSystemModules } from "./module-calls";

test("every system tool a module or the owner can call declares its output (v2-25)", () => {
  registerSystemModules();
  const missing = listSystemModules().flatMap(module => module.tools
    .filter(tool => tool.visibility.some(who => who === "modules" || who === "owner") && !tool.output)
    .map(tool => `${module.name}.${tool.name}`));
  expect(missing).toEqual([]);
});

test("a system tool output that breaks its contract fails under test", () => {
  const tool = { name: "t", description: "t", parameters: { type: "object" as const, properties: {}, required: [] }, visibility: ["modules" as const], idempotent: true, output: z.object({ n: z.number() }) };
  expect(() => checkSystemOutput("x.t", tool, { n: 1 })).not.toThrow();
  expect(() => checkSystemOutput("x.t", tool, { n: "1" })).toThrow("x.t output does not match");
});
