import { CallError } from "../modules/module-call-error";
import { publicSystemTools } from "./tool-contract-declarations";
import type { SystemModule } from "../modules/module-system-types";
import { timerTool } from "../timers";
import { json } from "./shared";
export const timers: SystemModule = {
  name: "timers", description: "Application-owned persistent wakeups under kernel budgets.", tools: publicSystemTools.timers,
  async handle({ ports, workspaceId, caller, call }, name, args) {
    if (name !== "list" && !call?.key) throw new CallError("invalid", "Timer writes require a call key");
    return json(await timerTool(ports, workspaceId, caller, name, args));
  },
};
