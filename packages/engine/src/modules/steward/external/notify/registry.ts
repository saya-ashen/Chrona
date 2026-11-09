export type ModuleIdentity = { id: string; name: string; status: string; activeHash: string | null };
export type Callback = { target: string; moduleId?: string; hash?: string; contractHash?: string; inputSchema: Record<string, unknown>; outputSchema?: unknown };
export type Directory = { modules: ModuleIdentity[]; tools: Callback[] };

type OutcomeSchema = { type?: unknown; anyOf?: OutcomeSchema[]; properties?: Partial<Record<string, { type?: unknown; const?: unknown }>>; required?: string[] };
function deliveryContract(value: unknown) {
  if (!value || typeof value !== "object") return false;
  const schema = value as OutcomeSchema, variants = schema.anyOf ?? [schema];
  return variants.length > 0 && variants.every(deliveryVariant);
}
function deliveryVariant(variant: OutcomeSchema) {
  const properties = variant.properties, outcome = properties?.outcome?.const;
  const fields = outcome === "accepted" ? ["outcome", "receiptRef"] : outcome === "rejected" ? ["outcome", "retryable", "error"] : outcome === "uncertain" ? ["outcome", "error"] : null;
  if (variant.type !== "object" || !fields || !fields.every(field => variant.required?.includes(field))) return false;
  return deliveryProperties(properties, outcome);
}
function deliveryProperties(properties: OutcomeSchema["properties"], outcome: unknown) {
  if (outcome === "accepted") {
    const type = properties?.receiptRef?.type;
    return receiptType(type);
  }
  return properties?.error?.type === "string" && (outcome !== "rejected" || properties.retryable?.type === "boolean");
}

function receiptType(type: unknown) {
  return type === "string" || type === "null" || Array.isArray(type) && type.length > 0 && type.every(item => item === "string" || item === "null");
}

/** This is the fixed delivery protocol, not a general JSON Schema interpreter. */
export function callbackReady(directory: Directory, id: string, name: string, tool: string, contractHash: string) {
  const owner = directory.modules.find(module => module.id === id && module.name === name);
  if (owner?.status !== "active" || !owner.activeHash || !contractHash) return false;
  const reference = directory.tools.find(candidate => candidate.target === `${name}.${tool}` && candidate.moduleId === id && candidate.hash === owner.activeHash && candidate.contractHash === contractHash);
  if (!reference || !deliveryContract(reference.outputSchema)) return false;
  return deliveryInput(reference.inputSchema);
}
function deliveryInput(schema: Callback["inputSchema"]) {
  const properties = schema.properties as Partial<Record<string, { type?: unknown; enum?: unknown[] }>> | undefined;
  const fields = ["key", "title", "body", "format", "link", "recipient", "approval", "scoped"];
  return schema.type === "object" && ["key", "title", "body"].every(key => properties?.[key]?.type === "string")
    && (schema.required as string[] | undefined ?? []).every(key => ["key", "title", "body", "format"].includes(key))
    && fields.every(key => !properties?.[key] || properties[key]!.type === (key === "scoped" ? "boolean" : "string"))
    && fields.filter(key => key !== "format").every(key => !properties?.[key]?.enum)
    && (!properties?.format?.enum || ["text", "markdown"].every(value => properties.format!.enum!.includes(value)))
    && (schema.additionalProperties !== false || fields.every(key => properties?.[key]));
}
