import { expect, test } from "bun:test";
import { moduleManifestSchema } from "@chrona/contracts/steward";
import type { ModuleContext } from "./module-context";
import { smokeRun } from "./module-probe";
import { testModuleProcess } from "./module-test-process";

test("startup check connects without invoking tools that need configuration", async () => {
  let invoked = false;
  const peer = testModuleProcess(async () => { invoked = true; throw new Error("Configuration and caller required"); });
  const context = { ports: { sandbox: { available: true, startModule: peer.startModule } } } as unknown as ModuleContext;
  const manifest = moduleManifestSchema.parse({ name: "configured", entry: "index.ts", tests: ["test.ts"], effects: [], tools: [{ name: "send", description: "Requires credentials", parameters: { type: "object", properties: { input: { type: "string" } }, required: ["input"] } }] });
  expect(await smokeRun(context, "/staging", manifest)).toEqual([]);
  expect(invoked).toBe(false);
  expect(peer.processes).toHaveLength(1);
  expect(peer.processes[0]!.socket.destroyed).toBe(true);
});

test("startup check still rejects a module that cannot start", async () => {
  const context = { ports: { sandbox: { available: true, startModule() { throw new Error("Broken entry"); } } } } as unknown as ModuleContext;
  const manifest = moduleManifestSchema.parse({ name: "broken", entry: "index.ts", keepAlive: true, tests: ["test.ts"], effects: [] });
  expect(await smokeRun(context, "/staging", manifest)).toEqual(["Module startup or SDK connection failed"]);
});
