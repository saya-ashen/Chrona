import { z } from "zod";
import { defineCatalog } from "@json-render/core";
import { shadcnComponentDefinitions as shadcn } from "@json-render/shadcn/catalog";
import { chronaSchema } from "../schema";
import {
  UI_ACTION,
  dispatchExecutionPayloadSchema,
  locateWorkspaceNodePayloadSchema,
  submitCheckpointPayloadSchema,
} from "../actions/actions";

const toneSchema = z
  .enum(["neutral", "info", "success", "warning", "danger"])
  .optional();

/**
 * The Chrona workspace catalog: the single trust boundary shared by document
 * producers (AI for Node result; backend builders for Node action + Activity)
 * and the web renderer (plan §4.2).
 *
 * Standard primitives reuse the prebuilt, AI-tested `@json-render/shadcn`
 * definitions (server-safe `/catalog` entry — no React here). Only domain
 * components shadcn lacks (markdown/json/file result blocks, the activity row,
 * collapsible text) are defined locally. Form inputs reuse shadcn's
 * `Input`/`Textarea`/`Select`/`Button`, which already carry `name` (state
 * binding) and `checks`/`validateOn` (validation) — so the Node-action builder
 * composes these rather than bespoke field components.
 */
export const chronaCatalog = defineCatalog(chronaSchema, {
  components: {
    // --- shadcn primitives (prebuilt definitions) ---
    Card: shadcn.Card,
    Stack: shadcn.Stack,
    Separator: shadcn.Separator,
    Text: shadcn.Text,
    Heading: shadcn.Heading,
    Badge: shadcn.Badge,
    Alert: shadcn.Alert,
    Button: shadcn.Button,
    Link: shadcn.Link,
    Input: shadcn.Input,
    Textarea: shadcn.Textarea,
    Select: shadcn.Select,
    Tabs: shadcn.Tabs,
    Table: shadcn.Table,

    // --- Chrona-custom domain components ---
    Markdown: {
      props: z.object({ content: z.string(), title: z.string().optional() }),
      description: "Rendered markdown result content.",
    },
    JsonView: {
      props: z.object({ value: z.unknown(), title: z.string().optional() }),
      description: "Pretty-printed JSON result value.",
    },
    FileRef: {
      props: z.object({
        path: z.string(),
        title: z.string().optional(),
        language: z.string().optional(),
        description: z.string().optional(),
      }),
      description: "Reference to a produced file artifact.",
    },
    ResultSummary: {
      props: z.object({ text: z.string().optional(), copyText: z.string().optional() }),
      description: "Result summary header with an optional copy affordance.",
    },
    ActivityRow: {
      props: z.object({
        title: z.string(),
        text: z.string().optional(),
        time: z.string().optional(),
        tone: toneSchema,
        kind: z.string().optional(),
        sourceNodeTitle: z.string().optional(),
        provider: z.string().optional(),
        runtimeName: z.string().optional(),
        toolState: z.enum(["started", "completed", "failed"]).optional(),
        density: z.enum(["compact", "detailed"]).optional(),
      }),
      slots: ["default"],
      description: "A single activity entry; optional ToolDetails child.",
    },
    ToolDetails: {
      props: z.object({
        rows: z.array(z.object({ label: z.string(), value: z.string() })),
      }),
      description: "Expandable tool invocation detail rows.",
    },
    CollapsibleText: {
      props: z.object({ text: z.string(), threshold: z.number().optional() }),
      description: "Long text with a show-more collapse.",
    },
    WorkspaceSummaryCard: {
      props: z.object({
        eyebrow: z.string().optional(),
        title: z.string(),
        description: z.string().optional(),
        statusLabel: z.string().optional(),
        sourceLabel: z.string().optional(),
        tone: toneSchema,
        icon: z.enum(["sparkles", "archive", "file", "warning", "check"]).optional(),
      }),
      slots: ["default"],
      description: "Compact Chrona workspace summary block with optional nested content.",
    },
    WorkspaceArtifactList: {
      props: z.object({
        emptyLabel: z.string(),
        maxCollapsed: z.number().optional(),
        showAllLabel: z.string().optional(),
        showFewerLabel: z.string().optional(),
      }),
      slots: ["default"],
      description: "Collapsible artifact index used by the task workspace command center.",
    },
    WorkspaceArtifactItem: {
      props: z.object({
        title: z.string(),
        type: z.string(),
        uri: z.string().optional(),
        locateLabel: z.string().optional(),
      }),
      description: "One workspace artifact row with an optional locate action.",
    },
    WorkspaceDiffPreview: {
      props: z.object({
        summary: z.string(),
        confidence: z.string(),
        risks: z.array(z.string()),
        warnings: z.array(z.string()),
        taskDiffs: z.array(z.object({
          label: z.string(),
          key: z.string(),
          original: z.string(),
          proposed: z.string(),
        })),
        planSummary: z.array(z.string()),
        addedNodes: z.array(z.object({
          title: z.string(),
          estimatedMinutes: z.number().optional(),
        })),
        deletedNodeIds: z.array(z.string()),
      }),
      description: "Task workspace AI proposal diff preview display.",
    },
  },
  actions: {
    [UI_ACTION.dispatchExecution]: {
      params: dispatchExecutionPayloadSchema,
      description: "Dispatch a pre-defined execution action for the current node.",
    },
    [UI_ACTION.locateWorkspaceNode]: {
      params: locateWorkspaceNodePayloadSchema,
      description: "Select and reveal a task workspace plan node.",
    },
    [UI_ACTION.submitCheckpoint]: {
      params: submitCheckpointPayloadSchema,
      description: "Submit checkpoint form values (with an optional chosen action).",
    },
  },
});

export type ChronaCatalog = typeof chronaCatalog;
export type ChronaComponentName = keyof typeof chronaCatalog.data.components;
