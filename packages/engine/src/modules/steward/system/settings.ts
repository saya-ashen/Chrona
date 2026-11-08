import { z } from "zod";
import * as outputs from "../system-outputs";
import { createSettings } from "../settings";
import { CallError, type SystemModule } from "../module-calls";
import { tool, text, entry, json, parsed } from "./shared";

/** Kernel governance only. Applications own their settings and preferences. */
export const settings: SystemModule = {
  name: "settings",
  description: "内核模型预算与预算日界时区。应用配置由各应用管理。",
  tools: [
    tool("get", "Model budgets, usage and governance timezone.", {}, [], { idempotent: true, output: z.lazy(() => outputs.settingsOutput) }),
    tool("update", "Update model budgets or governance timezone.", { settings: text('JSON {"timezone"?: IANA timezone, "moduleModel"?: model budget configuration | null}') }, ["settings"], { idempotent: true, output: z.lazy(() => outputs.settingsOutput) }),
  ],
  async handle({ ports, workspaceId, caller }, name, args) {
    entry(caller);
    const service = createSettings({ db: ports.db, workspaceId, now: ports.now });
    if (name === "get") return json(await service.get());
    if (name === "update") return json(await service.update(parsed(args.settings, "settings")));
    throw new CallError("not_found", `settings.${name} not found`);
  },
};
