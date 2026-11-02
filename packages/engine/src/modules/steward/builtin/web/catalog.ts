import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { shadcnComponentDefinitions } from "@json-render/shadcn/catalog";
import { z } from "zod";

/**
 * What apps may put on the pages they register (module-dependency-direction §4): the json-render shadcn components this
 * page draws in its own style, its Markdown, and one `call` action. src/pages.tsx implements exactly these.
 */
export const CATALOG_VERSION = "json-render@0.21.4";
const SHADCN = ["Card", "Stack", "Grid", "Separator", "Heading", "Text", "Badge", "Alert", "Table", "Button", "Link", "Input", "Textarea", "Select", "Checkbox", "Switch", "Spinner", "Progress", "Pagination", "Collapsible"] as const;
type Definition = { props: z.ZodObject<Record<string, z.ZodType>>; events?: string[]; slots?: string[]; description: string };
export const components: Record<string, Definition> = {
  ...Object.fromEntries(SHADCN.map(name => [name, (shadcnComponentDefinitions as Record<string, Definition>)[name]!])),
  Markdown: { props: z.object({ content: z.string() }), description: "Markdown text: headings, lists, tasks, code, bold and links (no HTML)" },
};
export const callParams = z.object({
  tool: z.string().regex(/^[a-z][a-z0-9-]{1,40}$/).describe("One of the registering app's own tools"),
  args: z.record(z.string(), z.unknown()).optional().describe("Arguments; values may be { $state: \"/path\" }"),
  result: z.string().startsWith("/").optional().describe("State path that receives the tool's result"),
  reload: z.boolean().optional().describe("Re-read the page's data afterwards (default true)"),
});
export const catalog = defineCatalog(schema, {
  components,
  actions: { call: { params: callParams, description: "Call one of this app's own tools for the user" } },
});
/** json-render's own state actions, handled by its runtime. */
export const BUILTIN_ACTIONS = new Set(["setState", "pushState", "removeState", "validateForm"]);
