import type { Tool } from "./module-call-types";

/** JSON Schema advertised to consumers mirrors runtime validation at every object boundary. */
export function normalizedToolInputSchema(tool: { parameters: Tool["parameters"] }) {
  const normalize = (parameter: import("@chrona/contracts/steward").ModuleToolParameter): Record<string, unknown> => {
    if ("anyOf" in parameter) return { anyOf: parameter.anyOf.map(normalize), ...(parameter.description ? { description: parameter.description } : {}) };
    if (parameter.type === "array") return { type: "array", ...(parameter.description ? { description: parameter.description } : {}), items: normalize(parameter.items) };
    if (parameter.type === "object") return { type: "object", ...(parameter.description ? { description: parameter.description } : {}), properties: Object.fromEntries(Object.entries(parameter.properties).map(([key, value]) => [key, normalize(value)])), required: parameter.required ?? [], additionalProperties: parameter.additionalProperties };
    return { ...parameter };
  };
  return { type: "object", properties: Object.fromEntries(Object.entries(tool.parameters.properties).map(([key, value]) => [key, normalize(value)])), required: tool.parameters.required, additionalProperties: false };
}
