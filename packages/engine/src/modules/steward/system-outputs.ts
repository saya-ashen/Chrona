import { z } from "zod";
import { moduleHealthSummarySchema } from "./module-diagnostics";
import { appSchema, approvalSchema, providerRunViewSchema, healthSchema, APPROVAL_STATUSES, routedTargetSchema } from "@chrona/contracts/steward";

export const runtimeOutput = healthSchema.extend({ at: z.string().datetime() });
export const runsOutput = z.array(providerRunViewSchema);
export const approvalsListOutput = z.array(approvalSchema);
export const approvalOutput = approvalSchema;
export const approvalRequestOutput = z.object({ approval: z.string(), decision: z.enum(["approved", "denied"]) });
export const approvalStatusOutput = z.object({ approval: z.string(), status: z.enum(APPROVAL_STATUSES), hash: z.string(), resolvedAt: z.string().nullable() });
export const modulesListOutput = z.array(appSchema.extend({
  health: moduleHealthSummarySchema,
  versions: z.array(z.object({ hash: z.string(), status: z.string(), createdAt: z.string(), errors: z.array(z.string().max(300)).max(5).nullable(),
    git: z.object({ commit: z.string().regex(/^[a-f0-9]{40}$/), tree: z.string().regex(/^[a-f0-9]{40}$/) }).nullable().default(null) })).max(5),
  runs: z.array(z.object({ id: z.string(), hash: z.string(), triggerId: z.string(), firedAt: z.string(), exitCode: z.number(), error: z.string().max(1000).nullable(), createdAt: z.string() })).max(5),
}));
const toolExampleOutput = z.object({ description: z.string().optional(), args: z.record(z.string(), z.json()), result: z.json().optional() });
const toolErrorOutput = z.object({ code: z.string(), description: z.string(), recovery: z.string() });
export const modulesToolsOutput = z.array(z.object({ moduleId: z.string().optional(), hash: z.string().optional(), contractHash: z.string().optional(), target: routedTargetSchema, description: z.string(), inputSchema: z.record(z.string(), z.json()), outputSchema: z.json().nullable(), examples: z.array(toolExampleOutput).nullable(), sideEffects: z.array(z.string()).nullable(), errors: z.array(toolErrorOutput).nullable(), retry: z.string(), idempotent: z.boolean() }));
export const modulesRollbackOutput = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending_approval"), approvalId: z.string() }),
  z.object({ status: z.literal("active"), moduleId: z.string(), activeHash: z.string() }),
]);
export const modulesStatusOutput = z.discriminatedUnion("status", [
  z.object({ status: z.literal("pending_approval"), approvalId: z.string() }),
  z.object({ status: z.enum(["paused", "active"]), moduleId: z.string() }),
]);
export const secretGetOutput = z.object({ value: z.record(z.string(), z.string()) });
export const secretSetOutput = z.object({ name: z.string(), configured: z.literal(true) });
export const secretRemoveOutput = z.object({ name: z.string(), configured: z.boolean() });
export const secretAuthorizeOutput = z.object({ url: z.string(), redirectUri: z.string(), expiresAt: z.string() });
export const secretTokenOutput = z.object({ accessToken: z.string(), expiresAt: z.string() });
export const secretsListOutput = z.array(z.object({ name: z.string(), configured: z.boolean(), updatedAt: z.string().nullable(), modules: z.array(z.string()) }));

const referenceSource = z.object({ kind: z.enum(["system", "module"]), hash: z.string().nullable() });
const referenceIndex = z.object({ target: routedTargetSchema, source: referenceSource, description: z.string() });
export const modulesReferenceOutput = z.union([z.array(referenceIndex), referenceIndex.extend({
  inputSchema: z.record(z.string(), z.json()), outputSchema: z.json().nullable(),
  documentation: z.string().nullable(), examples: z.json().nullable(), sideEffects: z.array(z.string()).nullable(), errors: z.json().nullable(),
  retry: z.string(), admission: z.object({ visibility: z.array(z.enum(["kernel", "provider", "owner", "modules"])), uses: z.string(), idempotent: z.boolean() }),
  routingErrors: z.array(z.string()), contractHash: z.string().regex(/^[a-f0-9]{64}$/),
})]);
