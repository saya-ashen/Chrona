import { z } from "zod";
export * from "./execution";
export * from "./execution-events";
export * from "./execution-v2";
import { executionInputSchemas, executionResultSourceInputSchema, executionResultSourceSchema, executionViewSchema, executionIdSchema } from "./execution";
import { executionResponseDataSchemas } from "./execution-events";
import { executionStartV2Schema, executionPlacementViewSchema, workLocationSchema, workCleanupInputSchema, workCleanupReceiptSchema } from "./execution-v2";
export const EXECUTION_TOOL_OPERATIONS = { start: "start", get: "get", "lookup-start": "lookup_start", list: "list", send: "send", answer: "answer", cancel: "cancel", events: "events", snapshot: "snapshot" } as const;
export const EXECUTION_UNRECORDED_TOOLS = ["start", "send", "answer", "start-v2", "workspace-cleanup"] as const;
export const executionToolContracts = [...Object.entries(EXECUTION_TOOL_OPERATIONS).map(([name, op]) => ({
  name, description: `Execution ${name}`, parameters: { type: "object" as const, properties: {}, required: [] },
  input: executionInputSchemas[op], output: executionResponseDataSchemas[op], visibility: ["owner", "modules"] as ("owner" | "modules")[], idempotent: true,
})), {
  name: "result-source", description: "Read admitted result provenance", parameters: { type: "object" as const, properties: {}, required: [] },
  input: executionResultSourceInputSchema, output: executionResultSourceSchema, visibility: ["owner", "modules"] as ("owner" | "modules")[], idempotent: true,
}, ...[
  { name: "start-v2", input: executionStartV2Schema, output: z.object({ execution: executionViewSchema, placement: executionPlacementViewSchema }).strict() },
  { name: "placement", input: z.object({ workId: executionIdSchema }).strict(), output: executionPlacementViewSchema },
  { name: "locations", input: z.object({ after: executionIdSchema.optional(), limit: z.number().int().min(1).max(100) }).strict(), output: z.object({ locations: z.array(workLocationSchema).max(100), after: executionIdSchema.nullable() }).strict() },
  { name: "workspace-cleanup", input: workCleanupInputSchema, output: workCleanupReceiptSchema },
].map(tool => ({ ...tool, description: `Execution ${tool.name}`, parameters: { type: "object" as const, properties: {}, required: [] }, visibility: ["owner", "modules"] as ("owner" | "modules")[], idempotent: true }))];
