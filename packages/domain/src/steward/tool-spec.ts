import { z } from "zod";
import { CONNECTION_KINDS, type ConnectionKind } from "@chrona/contracts/steward";

const text = z.string().trim().min(1).max(200);
const key = z.enum(["title", "author", "occurredAt", "status", "note"]);
export const toolSpecSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("event_rule"),
    match: z.object({ anyKeywords: z.array(text).min(1).max(20), author: text.optional(), connectionKind: z.enum(CONNECTION_KINDS).optional() }).strict(),
    then: z.object({ disposition: z.enum(["retain", "digest", "await_decision"]), note: z.string().min(1).max(2000) }).strict(),
    cases: z.array(z.object({ title: z.string().max(500), body: z.string().max(8000), author: z.string().max(200), expectMatch: z.boolean() }).strict()).min(1).max(20),
  }).strict(),
  z.object({
    type: z.literal("table_panel"),
    columns: z.array(z.object({ key, label: text }).strict()).min(1).max(8),
    source: z.enum(["affair_events", "affair_attention"]),
    sort: z.object({ key, direction: z.enum(["asc", "desc"]) }).strict().optional(),
  }).strict(),
]);
export type ToolSpec = z.infer<typeof toolSpecSchema>;
export type RuleEvent = { title: string; body: string; author: string; connectionKind?: ConnectionKind };
export function evaluateEventRule(spec: Extract<ToolSpec, { type: "event_rule" }>, event: RuleEvent) {
  const content = `${event.title}\n${event.body}`.toLowerCase();
  const matched = spec.match.anyKeywords.some((word) => content.includes(word.toLowerCase()))
    && (spec.match.author === undefined || spec.match.author.toLowerCase() === event.author.toLowerCase())
    && (spec.match.connectionKind === undefined || spec.match.connectionKind === event.connectionKind);
  return matched ? { matched, ...spec.then } : { matched };
}
export function validateToolSpec(input: unknown): { passed: boolean; summary: string; failures: string[] } {
  const parsed = toolSpecSchema.safeParse(input);
  const failures: string[] = [];
  if (!parsed.success) failures.push("Invalid declarative tool schema.");
  else if (parsed.data.type === "event_rule") {
    const spec = parsed.data;
    if (!spec.cases.some((c) => c.expectMatch) || !spec.cases.some((c) => !c.expectMatch)) failures.push("Positive and negative sample cases are required.");
    spec.cases.forEach((sample, index) => {
      // Samples exercise the rule within its declared connection kind.
      if (evaluateEventRule(spec, { ...sample, connectionKind: spec.match.connectionKind }).matched !== sample.expectMatch) failures.push(`Sample ${index + 1} did not match its expectation.`);
    });
  } else if (new Set(parsed.data.columns.map((c) => c.key)).size !== parsed.data.columns.length) failures.push("Duplicate column keys.");
  return { passed: failures.length === 0, summary: failures.length ? failures.join(" ") : "Declarative tool validation passed.", failures };
}
