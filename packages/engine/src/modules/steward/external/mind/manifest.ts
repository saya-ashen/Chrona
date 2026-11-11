import { z } from "zod";
import { inputs, outputs } from "./schema";
import type { Tool } from "./types";

// The current manifest subset has no numeric/string/array bounds keywords. Local Zod enforces them.
// Keep those bounds visible in descriptions while using only accepted structural keywords.
function structural(raw: Record<string, unknown>, describeBounds = false): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  const bounds = ["minLength", "maxLength", "minimum", "maximum", "minItems", "maxItems", "pattern", "format"].filter(k => raw[k] !== undefined).map(k => `${k}: ${raw[k]}`);
  if (describeBounds && bounds.length) result.description = bounds.join("; ");
  for (const name of ["type", "required", "enum", "const"] as const) if (raw[name] !== undefined) result[name] = raw[name];
  if (raw.properties) result.properties = Object.fromEntries(Object.entries(raw.properties as Record<string, Record<string, unknown>>).map(([k, v]) => [k, structural(v, describeBounds)]));
  if (raw.items) result.items = structural(raw.items as Record<string, unknown>, describeBounds);
  if (raw.additionalProperties !== undefined) result.additionalProperties = typeof raw.additionalProperties === "boolean" ? raw.additionalProperties : structural(raw.additionalProperties as Record<string, unknown>, describeBounds);
  if (raw.anyOf) result.anyOf = (raw.anyOf as Record<string, unknown>[]).map(item => structural(item, describeBounds));
  return result;
}
function parameters(raw: Record<string, unknown>) {
  const result = structural(raw, true);
  delete result.additionalProperties;
  result.properties = Object.fromEntries(Object.entries(result.properties as Record<string, Record<string, unknown>>).map(([name, field]) => {
    // Public tool arguments are scalar; structured arrays are explicitly JSON strings.
    const type = field.type === "integer" ? "number" : field.type ?? "string";
    const numericScalar = (field.anyOf as Record<string, unknown>[] | undefined)?.some(item => item.type === "integer" || item.type === "number");
    const description = numericScalar ? "Decimal integer string; local range is validated by Mind." : field.description;
    const entry = { type, ...(description ? { description: String(description).slice(0, 300) } : {}), ...(field.enum ? { enum: field.enum } : {}) };
    return [name, entry];
  }));
  return result;
}
const descriptions: Record<Tool, string> = {
  "ui-sources": "Owner: read or replace up to four Files source paths (one per line). Reads at most 2000 characters per file; exact Files identity and read contract are bound at configuration. Empty text pauses source reads.",
  agenda: "Mind reasoning only: read private concerns and suggestions with cursor pagination. Responses fit 230 KiB encoded including the result wrapper; follow nextCursor until limited is false. Refresh after a cursor conflict.",
  "ui-agenda": "Owner: private agenda with cursor pagination. Responses fit 230 KiB encoded including result. Follow nextCursor while limited; refresh after records change.",
  "ui-dismiss": "Owner: dismiss exactly one pending suggestion by id with a stable request-key. No operation selector or caller identity arguments.",
  decisions: "Owner: reasoning decisions newest first, verified reports and notification receipts; limit 1–100. Follow nextCursor while limited to read all records. Encoded result wrapper is bounded to 230 KiB; refresh after records change.",
  note: "Owner: create or edit a concern, stop it with done/dropped, or accept a proposal. request-key is required. Time fields are ISO or empty to clear; awaiting and links are strict JSON arrays. Links are evidence metadata, never permissions.",
  propose: "Authenticated modules suggest a bounded pending concern for owner review; no activation. request-key, title and reason required. signal-ids is a JSON array, max 20, limited to the source caller's own signals. This tool cannot dismiss suggestions.",
  signal: "Authenticated source modules push versioned observations. Real caller supplies source/moduleId; arguments cannot impersonate them. Exact event/ref/thread/from/domain matching with AND text conditions only requests verification. event-id dedupes within the caller.",
  report: "Current Mind reasoning only: submit one final structured report JSON with request-key and decision-id. Accepted candidates count only after this current Agent run's successful tool-result receipt and terminal success are verified. Owners cannot forge reports.",
  check: "Owner explicitly requests one bounded foreground review, or reconciles the outstanding reasoning run. Unknown work retains capacity; this does not create a parallel run.",
  "ui-settings": "Owner read {} or save scalar Mind preferences. Background starts disabled. interval-minutes 5–120, daily-wakes 1–24, quiet times HH:mm, IANA timezone. notify-enabled is optional and defaults false.",
};
export function buildManifest() {
  return {
    name: "mind", description: "Evidence-driven personal follow-up: private concerns and projects, exact source associations, bounded daily suggestions and restart-safe Agent reasoning.",
    entry: "index.ts", keepAlive: true, activated: true, effects: [], uses: ["modules.describe", "files.read", "timers.list", "timers.set", "timers.cancel", "agent.run", "agent.read", "web.page-set", "notify.send", "mind.agenda", "mind.propose", "mind.report"],
    data: { schema: 1 }, tests: ["test.ts"],
    tools: (Object.keys(inputs) as Tool[]).map(name => ({
      name, description: descriptions[name], visibility: ["signal", "agenda", "propose", "report"].includes(name) ? ["modules"] : ["owner"],
      idempotent: name !== "check", sideEffects: ["agenda", "ui-agenda", "decisions"].includes(name) ? [] : [name === "check" ? "May create or reconcile a durably keyed Agent reasoning run." : "Writes bounded private application state; suggestions grant no permission."],
      parameters: parameters(z.toJSONSchema(inputs[name], { io: "input" }) as Record<string, unknown>),
      output: structural(z.toJSONSchema(outputs[name]) as Record<string, unknown>),
    })),
  };
}
if (import.meta.main) await Bun.write(new URL("./module.json", import.meta.url), `${JSON.stringify(buildManifest(), null, 2)}\n`);
