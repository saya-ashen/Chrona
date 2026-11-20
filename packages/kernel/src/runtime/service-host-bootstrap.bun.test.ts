import { expect, test } from "bun:test";
import { createStewardService } from "./service";
import { listLocalModules, listSystemModules } from "../modules/module-calls";
import type { StewardPorts } from "../ports";

test("service bootstraps kernel Agent and private event delivery before any Provider operation", () => {
  createStewardService({} as StewardPorts);
  const callback = listLocalModules().find(module => module.name === "runtime-callback");
  expect(callback?.tools.map(tool => tool.name)).toEqual(["event"]);
  const agent = listSystemModules().find(module => module.name === "agent");
  expect(agent?.tools.map(tool => tool.name).sort()).toEqual(["inspect", "native", "providers", "read", "register", "run", "stop", "write"]);
});
