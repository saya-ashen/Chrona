import { defineCatalog } from "@json-render/core";
import { z } from "zod";
import { chronaSchema } from "../schema";
import { workPageProps, workPageSchema } from "./schema";
export * from "./schema";

export const workPageCatalog = defineCatalog(chronaSchema, {
  components: {
    Section: { props: workPageProps.Section, slots: ["default"], description: "Content section; optional collapse and responsive columns", example: { title: "Options", layout: "columns" } },
    Text: { props: workPageProps.Text, slots: [], description: "Plain escaped text. No HTML/Markdown execution", example: { text: "Waiting for your decision" } },
    Callout: { props: workPageProps.Callout, slots: [], description: "Attributed guidance, not system authority", example: { title: "Next step", text: "Discuss the budget" } },
    Table: { props: workPageProps.Table, slots: [], description: "Inline dataset with local filtering and sorting", example: { dataset: "parts" } },
    Comparison: { props: workPageProps.Comparison, slots: [], description: "Compare dataset rows as responsive cards", example: { dataset: "options" } },
    Metric: { props: workPageProps.Metric, slots: [], description: "Bounded pure aggregation over numeric dataset values", example: { label: "Total", dataset: "parts", column: "price", calculation: "sum" } },
    Link: { props: workPageProps.Link, slots: [], description: "User-activated HTTP(S) reference; never automatically fetched", example: { label: "Source", href: "https://example.com" } },
    Form: { props: workPageProps.Form, slots: [], description: "Version-bound user response, saved by host-owned control. No scheduling/execution/approval", example: { form: "decision" } },
  }, actions: {},
});
export function describeWorkPageCatalog() {
  return { schemaVersion: 1, schema: z.toJSONSchema(workPageSchema), components: Object.keys(workPageProps),
    rules: ["Literal props only; no on/watch/actions/expressions/HTML", "Publish as content.page of a result version", "Forms record answers only; no privileged actions", "Keep current outcome and next step short; collapse supporting detail", "Notes and responses are independent; read them before updating", "Dates in forms are not calendar events", "Never include secrets or raw conversation logs"] };
}
