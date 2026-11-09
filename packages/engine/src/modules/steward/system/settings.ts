import { z } from "zod";
import { createSettings, kernelSettingsSchema } from "../settings";
import { CallError, type SystemModule } from "../module-calls";
import { tool, text, entry, json, parsed, requireOwner } from "./shared";

/** Kernel governance only. Applications own their settings and preferences. */
export const settings: SystemModule = {
  name: "settings",
  description: "内核模型预算与预算日界时区。应用配置由各应用管理。",
  tools: [
    tool("get", "Model budgets, usage and governance timezone.", {}, [], { idempotent: true, output: z.lazy(() => kernelSettingsSchema) }),
    tool("update", "Update model budgets or governance timezone.", { settings: text('JSON {"timezone"?: IANA timezone, "moduleModel"?: {maxCallsPerEvent,maxOutputTokens,dailyCalls,eventTimeoutMs,moduleDailyCalls?} | null}') }, ["settings"], { visibility: ["owner"], idempotent: true, output: z.lazy(() => kernelSettingsSchema) }),
  ],
  async handle({ ports, workspaceId, caller }, name, args) {
    if (name === "update") await requireOwner(ports.db, workspaceId, caller);
    else entry(caller);
    const service = createSettings({ db: ports.db, workspaceId, now: ports.now });
    if (name === "get") return json(await service.get());
    if (name === "update") return json(await service.update(parsed(args.settings, "settings")));
    throw new CallError("not_found", `settings.${name} not found`);
  },
};
