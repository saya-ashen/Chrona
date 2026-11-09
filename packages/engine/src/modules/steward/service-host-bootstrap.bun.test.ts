import { expect, test } from "bun:test";
import { createStewardService } from "./service";
import { listLocalModules } from "./module-calls";
import type { StewardPorts } from "./ports";

test("service bootstraps private Agent admission before any Provider operation", () => {
  createStewardService({} as StewardPorts);
  const callback = listLocalModules().find(module => module.name === "runtime-callback");
  expect(callback?.tools.map(tool => tool.name)).toContain("agent-admit");
});
