import { compileSpecStream, validateSpec, type Spec, defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { shadcnComponentDefinitions as shadcn } from "@json-render/shadcn/catalog";
import { z } from "zod";
import { panelSpecSchema } from "@chrona/domain/steward/markdown";

/**
 * Building blocks the Provider composes app content areas from at runtime (json-render).
 * Generic layout/content comes from the shadcn set; Chrona adds components bound to
 * files inside the app's content area. Actions map to a closed set of Chrona capabilities.
 */
const generic = {
  Card: shadcn.Card, Stack: shadcn.Stack, Grid: shadcn.Grid, Separator: shadcn.Separator,
  Tabs: shadcn.Tabs, Accordion: shadcn.Accordion, Collapsible: shadcn.Collapsible,
  Table: { ...shadcn.Table, description: `${shadcn.Table.description} Cells may contain Markdown links, e.g. [owner/repo](https://github.com/owner/repo).` },
  Heading: shadcn.Heading,
  Text: { ...shadcn.Text, description: `${shadcn.Text.description} Supports Markdown (links, bold, line breaks, lists).` },
  Link: shadcn.Link, Badge: shadcn.Badge, Alert: shadcn.Alert, Progress: shadcn.Progress,
  Input: shadcn.Input, Textarea: shadcn.Textarea, Select: shadcn.Select, Radio: shadcn.Radio,
  Button: shadcn.Button,
};
const contentPath = z.string().min(1).max(500).describe("Path of a file inside this app's content area, e.g. 每日训练/Day01.md");

export const uiCatalog = defineCatalog(schema, {
  components: {
    ...generic,
    Panel: {
      props: panelSpecSchema,
      description: "For values the user records repeatedly (weight, sleep, spending): the form appends a row immediately without asking Chrona, and shows recent rows and a trend.",
    },
    TaskList: {
      props: z.object({
        path: contentPath.describe("Markdown page holding the `- [ ]` items; ticking writes back to it"),
        section: z.string().max(200).nullable().describe("Only items under this heading; null for the whole page"),
        title: z.string().max(80).nullable(),
        showProgress: z.boolean().nullable().describe("Show done/total and a progress bar"),
      }),
      description: "Checklist taken live from a Markdown page; the page stays the single source of truth for what is done.",
    },
    PageLink: {
      props: z.object({ label: z.string().max(80), path: contentPath, hint: z.string().max(120).nullable() }),
      description: "Link to a second-level page in this app's content area (plans, materials, records, history).",
    },
    Upload: {
      props: z.object({ label: z.string().max(40), folder: contentPath.describe("Folder the files go to"), note: z.string().max(200).nullable().describe("Message sent to Chrona after upload, e.g. 第1天录音") }),
      description: "Lets the user upload files (recordings, essays, photos) into the app's content area; Chrona is told so it can respond.",
    },
  },
  actions: {
    say: {
      params: z.object({ text: z.string().min(1).max(2000) }),
      description: "Send this text to Chrona as the user's chat message about this app (e.g. 今天做完了). Use with a Button.",
    },
    open: {
      params: z.object({ path: contentPath }),
      description: "Open a page in this app's content area.",
    },
  },
});

export function compileUiSpec(input: object | string): object {
  return typeof input === "string" ? compileSpecStream(input) : input;
}

export function safeUiPath(path: unknown): path is string {
  return typeof path === "string" && path.length > 0 && !path.startsWith("/") && !path.startsWith(".chrona") && !path.includes("..") && !/[\\\\\0]/.test(path) && !path.split("/").includes(".");
}

export function checkUiSpec(spec: unknown): { ok: boolean; issues: string[] } {
  const checked = uiCatalog.validate(spec);
  const issues = checked.success ? [] : checked.error!.issues.map(issue => `${issue.path.join(".")}: ${issue.message}`);
  // Structural validation assumes an element map; schema validation handles malformed input.
  const shape = z.object({ root: z.string().optional(), elements: z.record(z.string(), z.object({ type: z.string(), props: z.record(z.string(), z.unknown()), children: z.array(z.string()).optional() }).passthrough()) }).passthrough().safeParse(spec);
  if (shape.success) {
    issues.push(...validateSpec(shape.data as Spec).issues.map(issue => `${issue.elementKey ?? "spec"}: ${issue.message}`));
    for (const [id, element] of Object.entries(shape.data.elements)) {
      if (element.type === "Panel") {
        const panel = panelSpecSchema.safeParse(element.props);
        if (!panel.success) issues.push(...panel.error.issues.map(issue => `${id}.${issue.path.join(".")}: ${issue.message}`));
      }
      const key = element.type === "Panel" ? "data" : element.type === "Upload" ? "folder" : "path";
      if (["TaskList", "PageLink", "Upload", "Panel"].includes(element.type) && !safeUiPath(element.props[key])) issues.push(`${id}: ${key} must be a safe path relative to the app's content area`);
    }
  }
  return { ok: issues.length === 0, issues };
}

export function uiGuide(preferences: string[], usage: string[]): string {
  return uiCatalog.prompt({ customRules: [...uiRules, ...preferences.map(p => "User preference: " + p)] }) +
    "\nSave pages with chrona_ui_set (spec object or JSONL patches); never write *.ui.json directly.\nRecent usage (14 days):\n" + usage.slice(0, 10).join("\n");
}

/** Page-design rules handed to the Provider together with the catalog. */
export const uiRules = [
  "The entry page is what the user opens this app for. Decide from the request and the current state what they came to see or do, and put that itself on the entry page, laid out so it is quick to scan and use.",
  "If they asked to see or read something (a list, ranking, comparison, answer, digest), the content itself is the entry: render it fully with fitting components (Table, Cards in a Grid, Text), not a link to it. If they carry something out over time, lead with what to do now.",
  "Use second-level pages (PageLink) only for material that is long and only occasionally needed, such as history, methodology or raw notes. Never hide the main content behind a link.",
  "Chrona already shows the app title above the page: do not repeat the title.",
  "Keep it scannable: no disclaimers, no restating the request, no filler. Put what matters most first: the conclusion or the next step, then the detail. On a phone the page is read top to bottom; detail that only some readers need (full comparison tables, measurement caveats, method) goes inside Collapsible or Tabs, or on a second-level page.",
  "For values the user records repeatedly, use Panel: entries are saved at once and shown with a trend, without asking Chrona.",
  "Use TaskList for anything the user ticks off, pointing at the Markdown page that holds the items; never copy checklist items into Text.",
  "When an answer from the user is needed, give it an Input bound to state and a Button whose say action sends it.",
  "Use only real content from this app (its content files, conversation and schedules). Never invent sample data.",
  "Do not set className; layout comes from Stack, Grid and Card.",
  "Write in the user's language (default Chinese).",
];
