import { publicSystemTools } from "./tool-contract-declarations";
import { createSettings } from "../settings";
import { CallError, type SystemModule } from "../modules/module-calls";
import { entry, json, requireOwner } from "./shared";

/** Kernel governance only. Applications own their settings and preferences. */
export const settings: SystemModule = {
  name: "settings",
  description: "内核模型预算与预算日界时区。应用配置由各应用管理。",
  tools: publicSystemTools.settings,
  async handle({ ports, workspaceId, caller }, name, args) {
    if (name === "update") await requireOwner(ports.db, workspaceId, caller);
    else entry(caller);
    const service = createSettings({ db: ports.db, workspaceId, now: ports.now });
    if (name === "get") return json(await service.get());
    if (name === "update") return json(await service.update(args));
    throw new CallError("not_found", `settings.${name} not found`);
  },
};
