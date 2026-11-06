import { z } from "zod";
/** Official coding/editor builds bundle this entry to package-local contract.js; no runtime repo imports. */
export * from "./execution";
export * from "./execution-events";
export * from "./execution-v2";
import { executionInputSchemas, executionResultSourceInputSchema, executionResultSourceSchema, executionViewSchema, executionIdSchema, type ExecutionCommand } from "./execution";
import { editorResponseDataSchemas } from "./execution-events";
import { executionStartV2Schema, executionPlacementViewSchema, workLocationSchema, workCleanupInputSchema, workCleanupReceiptSchema } from "./execution-v2";
import type { ModuleTool } from "./module-tool";

/** H implements protocol adaptation with these exact op success results; no second wire protocol. */
export type EditorCommandConsumer = {
  [K in ExecutionCommand["op"]]: (input: Omit<Extract<ExecutionCommand, { op: K }>, "op">) => Promise<z.infer<(typeof editorResponseDataSchemas)[K]>>;
};
/** coding owns work/results; executions owns the single Run-backed execution. */
export const CODING_TOOL_OPERATIONS = { create: "start", get: "get", list: "list", send: "send", answer: "answer", cancel: "cancel", results: "results", accept: "accept" } as const;
export const EXECUTION_TOOL_OPERATIONS = { start: "start", get: "get", "lookup-start": "lookup_start", list: "list", send: "send", answer: "answer", cancel: "cancel", events: "events", snapshot: "snapshot" } as const;
export const EXECUTION_UNRECORDED_TOOLS = ["start", "send", "answer", "start-v2", "workspace-cleanup"] as const;
export const executionToolContracts = [...Object.entries(EXECUTION_TOOL_OPERATIONS).map(([name, op]) => ({
  name, description: `Execution ${name}`, parameters: { type: "object" as const, properties: {}, required: [] },
  input: executionInputSchemas[op], output: editorResponseDataSchemas[op], visibility: ["owner", "modules"] as ("owner" | "modules")[], idempotent: true,
})), {
  name: "result-source", description: "Read admitted result provenance", parameters: { type: "object" as const, properties: {}, required: [] },
  input: executionResultSourceInputSchema, output: executionResultSourceSchema, visibility: ["owner", "modules"] as ("owner" | "modules")[], idempotent: true,
}, ...[
  { name: "start-v2", input: executionStartV2Schema, output: z.object({ execution: executionViewSchema, placement: executionPlacementViewSchema }).strict() },
  { name: "placement", input: z.object({ workId: executionIdSchema }).strict(), output: executionPlacementViewSchema },
  { name: "locations", input: z.object({ after: executionIdSchema.optional(), limit: z.number().int().min(1).max(100) }).strict(), output: z.object({ locations: z.array(workLocationSchema).max(100), after: executionIdSchema.nullable() }).strict() },
  { name: "workspace-cleanup", input: workCleanupInputSchema, output: workCleanupReceiptSchema },
].map(tool => ({ ...tool, description: `Execution ${tool.name}`, parameters: { type: "object" as const, properties: {}, required: [] }, visibility: ["owner", "modules"] as ("owner" | "modules")[], idempotent: true }))];

/** Manifest outputs support a structural JSON Schema subset. Derive it, rather than copy the wire schema. */
function manifestOutput(schema: z.ZodType): ModuleTool["output"] {
  const allowed = new Set(["type", "title", "description", "properties", "required", "additionalProperties", "items", "enum", "const", "anyOf", "allOf"]);
  const output = z.toJSONSchema(schema, { override: ({ jsonSchema }) => {
    for (const key of Object.keys(jsonSchema)) if (!allowed.has(key)) delete jsonSchema[key];
  } });
  delete output.$schema;
  return output as ModuleTool["output"];
}
/** Top-level manifest keys are slugs; one JSON string preserves camelCase fields and answer unions. */
export function codingToolDeclarations(): ModuleTool[] {
  return Object.entries(CODING_TOOL_OPERATIONS).map(([name, op]) => ({
    name, description: `Coding ${name}; input is JSON matching execution ${op}`,
    parameters: { type: "object", properties: { input: { type: "string", description: `JSON execution ${op} payload, without op` } }, required: ["input"] },
    visibility: name === "accept" ? ["owner"] : ["owner", "provider"], idempotent: true, output: manifestOutput(editorResponseDataSchemas[op]),
  }));
}
type CodingToolInput<K extends keyof typeof CODING_TOOL_OPERATIONS> = z.infer<(typeof executionInputSchemas)[(typeof CODING_TOOL_OPERATIONS)[K]]>;
export function parseCodingToolInput<K extends keyof typeof CODING_TOOL_OPERATIONS>(name: K, input: string): CodingToolInput<K> {
  return executionInputSchemas[CODING_TOOL_OPERATIONS[name]].parse(JSON.parse(input)) as CodingToolInput<K>;
}
