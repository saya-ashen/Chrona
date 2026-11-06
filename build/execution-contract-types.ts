import { z } from "zod";
import * as contract from "../packages/contracts/src/steward/execution-tools";
import * as executor from "../packages/contracts/src/steward/executor";

type Schema = Record<string, unknown>;
/** Standalone DTO declarations from the same schemas; isolated packages need no repository or zod types. */
function typeOf(schema: Schema): string {
  if ("const" in schema) return JSON.stringify(schema.const);
  if (Array.isArray(schema.enum)) return schema.enum.map(value => JSON.stringify(value)).join(" | ");
  for (const [key, separator] of [["anyOf", " | "], ["oneOf", " | "], ["allOf", " & "]] as const) {
    if (Array.isArray(schema[key])) return `(${(schema[key] as Schema[]).map(typeOf).join(separator)})`;
  }
  if (Array.isArray(schema.type)) return schema.type.map(type => typeOf({ ...schema, type })).join(" | ");
  const primitive = new Map<unknown, string>([["string", "string"], ["number", "number"], ["integer", "number"], ["boolean", "boolean"], ["null", "null"]]).get(schema.type);
  if (primitive) return primitive;
  switch (schema.type) {
    case "array": return `Array<${typeOf(schema.items as Schema)}>`;
    case "object": return objectType(schema);
    default: throw new Error(`Unsupported execution declaration schema: ${JSON.stringify(schema)}`);
  }
}
function objectType(schema: Schema): string {
  const required = new Set(schema.required as string[] | undefined);
  return `{ ${Object.entries((schema.properties ?? {}) as Record<string, Schema>).map(([key, value]) => `${JSON.stringify(key)}${required.has(key) ? "" : "?"}: ${typeOf(value)}`).join("; ")} }`;
}
function schemaType(schema: z.ZodType) { return typeOf(z.toJSONSchema(schema, { io: "output" }) as Schema); }

export function executionContractDeclarations() {
  const lines = ["// Generated from execution-tools.ts. Do not edit.", "type ContractSchema<T> = { parse(value: unknown): T; safeParse(value: unknown): { success: true; data: T } | { success: false; error: { message: string; issues: { message: string; path: PropertyKey[] }[] } } };"];
  for (const [name, value] of Object.entries(contract)) {
    if (value instanceof z.ZodType) {
      const alias = name[0]!.toUpperCase() + name.slice(1).replace(/Schema$/, "");
      lines.push(`export type ${alias} = ${schemaType(value)};`, `export declare const ${name}: ContractSchema<${alias}>;`);
    }
  }
  for (const name of ["EXECUTION_PROTOCOL", "EXECUTION_CAPABILITIES", "EXECUTION_EVENT_LIMITS", "EXECUTION_CHANGES_LIMITS", "EXECUTION_HTTP_STATUS", "EDITOR_HTTP", "CODING_TOOL_OPERATIONS", "EXECUTION_TOOL_OPERATIONS", "EXECUTION_UNRECORDED_TOOLS", "WORK_PROTOCOL", "WORK_LIMITS", "WORK_HTTP"] as const) {
    lines.push(`export declare const ${name}: ${JSON.stringify(contract[name])};`);
  }
  const outputs = Object.entries(contract.editorResponseDataSchemas).map(([op, schema]) => `${JSON.stringify(op)}: ${schemaType(schema)}`).join("; ");
  const inputs = Object.entries(contract.executionInputSchemas).map(([op, schema]) => `${JSON.stringify(op)}: ContractSchema<${schemaType(schema)}>`).join("; ");
  const responseSchemas = Object.keys(contract.editorResponseDataSchemas).map(op => `${JSON.stringify(op)}: ContractSchema<Responses[${JSON.stringify(op)}]>`).join("; ");
  lines.push(`type Responses = { ${outputs} };`,
    `export declare const executionInputSchemas: { ${inputs} };`,
    `export declare const editorResponseDataSchemas: { ${responseSchemas} };`,
    'export type EditorCommandConsumer = { [K in ExecutionCommand["op"]]: (input: Omit<Extract<ExecutionCommand, { op: K }>, "op">) => Promise<Responses[K]> };',
    'export declare function parseCodingToolInput<K extends keyof typeof CODING_TOOL_OPERATIONS>(name: K, input: string): Parameters<EditorCommandConsumer[(typeof CODING_TOOL_OPERATIONS)[K]]>[0];',
    "export declare function executionJsonBytes(value: unknown): number;");
  const workOutputs = Object.entries(contract.workResponseDataSchemas).map(([op, schema]) => `${JSON.stringify(op)}: ${schemaType(schema)}`).join("; ");
  const workSchemas = Object.keys(contract.workResponseDataSchemas).map(op => `${JSON.stringify(op)}: ContractSchema<WorkResponses[${JSON.stringify(op)}]>`).join("; ");
  lines.push(`type WorkResponses = { ${workOutputs} };`, `export declare const workResponseDataSchemas: { ${workSchemas} };`,
    'export type WorkCommandConsumer = { [K in WorkCommand["op"]]: (input: Omit<Extract<WorkCommand, { op: K }>, "op">) => Promise<WorkResponses[K]> };',
    `export declare function parseWorkResponse(request: WorkRequest, raw: unknown): { v: "chrona.execution.v2"; requestId: string } & ({ ok: true; data: WorkResponses[keyof WorkResponses] } | { ok: false; error: ExecutionError });`);
  return lines.join("\n") + "\n";
}

/** Independent narrow device bundle; no dependency on the product's module runtime. */
export function executorContractDeclarations() {
  const lines = ["// Generated from executor.ts. Do not edit.", "type ContractSchema<T> = { parse(value: unknown): T; safeParse(value: unknown): { success: true; data: T } | { success: false; error: { message: string } } };"];
  for (const [name, value] of Object.entries(executor)) {
    if (!(value instanceof z.ZodType)) continue;
    const alias = name[0]!.toUpperCase() + name.slice(1).replace(/Schema$/, "");
    lines.push(`export type ${alias} = ${schemaType(value)};`, `export declare const ${name}: ContractSchema<${alias}>;`);
  }
  for (const name of ["EXECUTOR_PROTOCOL", "EXECUTOR_LIMITS", "EXECUTOR_HTTP", "EXECUTOR_OWNER_HTTP", "EXECUTOR_MODULE_CATALOG"] as const) lines.push(`export declare const ${name}: ${JSON.stringify(executor[name])};`);
  for (const [name, schemas] of [["executorRequestSchemas", executor.executorRequestSchemas], ["executorResponseDataSchemas", executor.executorResponseDataSchemas]] as const) {
    lines.push(`export declare const ${name}: { ${Object.entries(schemas).map(([op, schema]) => `${JSON.stringify(op)}: ContractSchema<${schemaType(schema)}>`).join("; ")} };`);
  }
  lines.push("export declare function executorCanonicalJson(input: unknown): string;", "export declare function executorDigest(input: unknown): Promise<string>;",
    'type SchemaOutput<S> = S extends ContractSchema<infer T> ? T : never;',
    'export type ExecutorOperation = keyof typeof executorRequestSchemas;',
    'export type ExecutorRequests = { [K in ExecutorOperation]: SchemaOutput<(typeof executorRequestSchemas)[K]> };',
    'export type ExecutorResponses = { [K in ExecutorOperation]: SchemaOutput<(typeof executorResponseDataSchemas)[K]> };',
    'export declare function parseExecutorResponse<K extends ExecutorOperation>(op: K, requestId: string, raw: unknown): { v: "chrona.executor.v1"; requestId: string } & ({ ok: true; data: ExecutorResponses[K] } | { ok: false; error: ExecutorErrorEnvelope["error"] });');
  return lines.join("\n") + "\n";
}
