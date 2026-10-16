import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { shadcnComponentDefinitions as shadcn } from "@json-render/shadcn/catalog";
import { z } from "zod";

/**
 * Building blocks the Provider composes affair pages from at runtime (json-render).
 * Generic layout/content comes from the shadcn set; Chrona adds components bound to
 * affair files. Actions are a closed set mapped to Chrona capabilities.
 */
const generic = {
  Card: shadcn.Card, Stack: shadcn.Stack, Grid: shadcn.Grid, Separator: shadcn.Separator,
  Tabs: shadcn.Tabs, Accordion: shadcn.Accordion, Collapsible: shadcn.Collapsible, Table: shadcn.Table,
  Heading: shadcn.Heading, Text: shadcn.Text, Badge: shadcn.Badge, Alert: shadcn.Alert, Progress: shadcn.Progress,
  Input: shadcn.Input, Textarea: shadcn.Textarea, Select: shadcn.Select, Radio: shadcn.Radio,
  Button: shadcn.Button,
};
const affairPath = z.string().min(1).max(500).describe("Path of a file inside this affair, e.g. 每日训练/Day01.md");

export const uiCatalog = defineCatalog(schema, {
  components: {
    ...generic,
    TaskList: {
      props: z.object({
        path: affairPath.describe("Markdown page holding the `- [ ]` items; ticking writes back to it"),
        section: z.string().max(200).nullable().describe("Only items under this heading; null for the whole page"),
        title: z.string().max(80).nullable(),
        showProgress: z.boolean().nullable().describe("Show done/total and a progress bar"),
      }),
      description: "Checklist taken live from a Markdown page; the page stays the single source of truth for what is done.",
    },
    PageLink: {
      props: z.object({ label: z.string().max(80), path: affairPath, hint: z.string().max(120).nullable() }),
      description: "Link to a second-level page of this affair (plans, materials, records, history).",
    },
    Upload: {
      props: z.object({ label: z.string().max(40), folder: affairPath.describe("Folder the files go to"), note: z.string().max(200).nullable().describe("Message sent to Chrona after upload, e.g. 第1天录音") }),
      description: "Lets the user upload files (recordings, essays, photos) into the affair; Chrona is told so it can respond.",
    },
  },
  actions: {
    say: {
      params: z.object({ text: z.string().min(1).max(2000) }),
      description: "Send this text to Chrona as the user's chat message about this affair (e.g. 今天做完了). Use with a Button.",
    },
    open: {
      params: z.object({ path: affairPath }),
      description: "Open a page of this affair.",
    },
  },
});

/** Page-design rules handed to the Provider together with the catalog. */
export const uiRules = [
  "This page is the affair's entry: show only what the user needs to handle now and can act on here. Everything else (plans, methods, materials, history) belongs on second-level pages reached via PageLink.",
  "Chrona already shows the affair title, its state and pause/end controls above the page: do not repeat the title.",
  "Lead with one short status line. Then the few things to do, each one sentence; put durations or counts at the end of the line.",
  "One primary action per area. No disclaimers, methodology or long paragraphs on the entry page.",
  "Use TaskList for anything the user ticks off, pointing at the Markdown page that holds the items; never copy checklist items into Text.",
  "Ask at most 2–3 open questions, each with an Input bound to state and a Button whose say action sends the answer.",
  "Use only real content from this affair (its files, conversation and schedules). Never invent sample data.",
  "Do not set className; layout comes from Stack, Grid and Card.",
  "Write in the user's language (default Chinese).",
];
