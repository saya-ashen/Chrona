import type { Tool } from "../modules/module-call-types";
import type { SystemTool } from "../modules/module-system-tool-types";

type Properties = Tool["parameters"]["properties"];
export const tool = (name: string, description: string, properties: Properties, required: string[], extra: Partial<SystemTool> = {}): SystemTool =>
  ({ name, description, parameters: { type: "object", properties, required }, visibility: ["modules"], idempotent: false, ...extra });
export const text = (description?: string) => ({ type: "string" as const, ...(description ? { description } : {}) });

/** Public tools bind discovery and hashes to the committed target contract. */
export const declaredSystemTools = (namespace: string, tools: SystemTool[]): SystemTool[] => tools.map(tool => ({ ...tool, contractTarget: `${namespace}.${tool.name}` }));
