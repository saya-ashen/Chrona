import { z } from "zod";
import { defineCatalog } from "@json-render/core";
import { shadcnComponentDefinitions as shadcn } from "@json-render/shadcn/catalog";
import { chronaSchema } from "../schema";
import {
  UI_ACTION,
  commandCenterPrimaryPayloadSchema,
  acceptPlanPayloadSchema,
  dispatchExecutionPayloadSchema,
  locateWorkspaceNodePayloadSchema,
  generatePlanPayloadSchema,
  submitCheckpointPayloadSchema,
  recoveryRetryPayloadSchema,
  recoveryEditInstructionPayloadSchema,
  recoveryCancelPayloadSchema,
} from "../actions/actions";

const toneSchema = z
  .enum(["neutral", "info", "success", "warning", "danger"])
  .optional();

const activityToolSchema = z.object({
  name: z.string().optional(),
  label: z.string().optional(),
  preview: z.string().optional(),
  inputSummary: z.string().optional(),
  durationMs: z.number().optional(),
  error: z.string().optional(),
  state: z.enum(["started", "completed", "failed"]),
});

const activityGroupSchema = z.object({
  kind: z.enum(["plan_generation", "execution_node", "provider_run"]),
  id: z.string(),
});

const occurrenceOptionSchema = z.object({
  value: z.string(),
  label: z.string(),
  taskId: z.string(),
  date: z.string().nullable(),
  workBlockId: z.string().nullable(),
});

const activityItemSchema = z.object({
  id: z.string(),
  kind: z.string(),
  title: z.string(),
  summary: z.string().optional(),
  tone: toneSchema,
  timestamp: z.string().nullable().optional(),
  sourceNodeTitle: z.string().optional(),
  provider: z.string().optional(),
  runtimeName: z.string().optional(),
  tool: activityToolSchema.optional(),
  activityGroup: activityGroupSchema.optional(),
  assistant: z.object({ text: z.string() }).optional(),
});

const paragraphSchema = z.object({
  text: z.string().optional(),
  content: z.string().optional(),
  variant: z.string().optional(),
});

const tableColumnSchema = z.object({
  key: z.string(),
  label: z.string().optional(),
  type: z.enum(["text", "number", "link"]).optional(),
  hrefKey: z.string().optional(),
}).strict();

const tableComponentDefinition = {
  props: z.object({
    title: z.string().optional(),
    description: z.string().optional(),
    uri: z.string().optional(),
    path: z.string().optional(),
    displayPath: z.string().optional(),
    columns: z.array(z.union([z.string(), tableColumnSchema])).optional(),
    pageSize: z.number().int().positive().max(100).optional(),
    contentKind: z.enum(["json", "csv", "text", "markdown"]).optional(),
    contentPreview: z.string().optional(),
    contentTruncated: z.boolean().optional(),
    contentBytes: z.number().optional(),
    previewError: z.enum(["unsafe_path", "not_found", "unsupported_type", "read_failed"]).optional(),
  }).strict(),
  description:
    'File-backed data table. Reference a safe repo-relative JSON or CSV file with path or uri; do not inline rows. Optional columns may be strings or { key, label, type, hrefKey }. Use type: "link" or hrefKey for link cells. Prefer pageSize 10 for workspace readability; do not set pageSize equal to total rows merely to show everything. Use larger pageSize only for dense datasets or explicit user requests. Example: { path: ".chrona/outputs/N20260706-01/trending.json", columns: [{ key: "repo", label: "Repo" }, { key: "url", label: "URL", type: "link" }], pageSize: 10 }.',
  example: {
    path: ".chrona/outputs/N20260706-01/trending.json",
    columns: [{ key: "repo", label: "Repo" }, { key: "url", label: "URL", type: "link" }],
    pageSize: 10,
  },
};

const collapsibleTextComponentDefinition = {
  props: z.object({ text: z.string(), threshold: z.number().optional() }),
  description:
    'Long text with a show-more collapse. threshold MUST be a JSON number such as 800, not a string such as "800".',
  example: { text: "Long output...", threshold: 800 },
};

const sectionSchema = z.object({
  title: z.string().optional(),
});

const stateBindingSchema = z.object({ $bindState: z.string() });

const toolDetailLabelsSchema = z.object({
  tool: z.string(),
  input: z.string(),
  preview: z.string(),
  duration: z.string(),
  error: z.string(),
});
const filePreviewKindSchema = z.enum(["markdown", "json", "text", "csv"]);

const filePreviewErrorSchema = z.enum([
  "unsafe_path",
  "not_found",
  "unsupported_type",
  "read_failed",
]);

const fileViewPropsSchema = z.object({
  title: z.string().optional(),
  uri: z.string().optional(),
  path: z.string().optional(),
  displayPath: z.string().optional(),
  contentKind: filePreviewKindSchema.optional(),
  contentPreview: z.string().optional(),
  contentTruncated: z.boolean().optional(),
  contentBytes: z.number().optional(),
  previewError: filePreviewErrorSchema.optional(),
  description: z.string().optional(),
  language: z.string().optional(),
});


const bindableNumberSchema = z
  .union([z.number(), stateBindingSchema])
  .optional();
const bindableStringSchema = z
  .union([z.string(), stateBindingSchema])
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
    DropdownMenu: shadcn.DropdownMenu,
    Heading: shadcn.Heading,
    Badge: shadcn.Badge,
    Alert: shadcn.Alert,
    Button: shadcn.Button,
    Link: shadcn.Link,
    Input: shadcn.Input,
    Textarea: shadcn.Textarea,
    Select: shadcn.Select,
    Tabs: shadcn.Tabs,
    Table: tableComponentDefinition,

    // --- lowercase compatibility aliases for AI-produced json-render specs ---
    heading: shadcn.Heading,
    paragraph: {
      props: paragraphSchema,
      description:
        "Compatibility alias for text paragraphs in AI-produced result specs.",
    },
    table: tableComponentDefinition,
    section: {
      props: sectionSchema,
      slots: ["default"],
      description:
        "Compatibility section container for AI-produced result specs.",
    },
    // --- Chrona-custom domain components ---
    WorkspaceOccurrenceCalendar: {
      props: z.object({
        label: z.string(),
        value: z.string(),
        options: z.array(occurrenceOptionSchema),
      }),
      description:
        "Compact occurrence calendar picker for recurring task workspace header.",
    },
    Markdown: {
      props: z.object({ content: z.string(), title: z.string().optional() }),
      description: "Rendered markdown result content.",
    },
    JsonView: {
      props: z.object({ value: z.unknown(), title: z.string().optional() }),
      description: "Pretty-printed JSON result value.",
    },
    FileRef: {
      props: fileViewPropsSchema,
      description: "Reference to a produced file artifact, optionally hydrated with a safe server-side preview.",
    },
    FileView: {
      props: fileViewPropsSchema,
      description: "Produced file artifact preview hydrated server-side before browser rendering.",
    },
    ResultSummary: {
      props: z.object({
        text: z.string().optional(),
        copyText: z.string().optional(),
      }),
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
    ActivityStream: {
      props: z.object({
        items: z.union([z.array(activityItemSchema), stateBindingSchema]),
        liveCount: bindableNumberSchema,
        savedCount: bindableNumberSchema,
        provider: bindableStringSchema,
        emptyMessage: z.string().optional(),
        toolLabels: toolDetailLabelsSchema,
        density: z.enum(["rail"]).optional(),
        active: z.boolean().optional(),
      }),
      description: "Streaming activity feed backed by json-render state.",
    },
    ToolDetails: {
      props: z.object({
        rows: z.array(z.object({ label: z.string(), value: z.string() })),
      }),
      description: "Expandable tool invocation detail rows.",
    },
    CollapsibleText: collapsibleTextComponentDefinition,
    WorkspaceSummaryCard: {
      props: z.object({
        eyebrow: z.string().optional(),
        title: z.string(),
        description: z.string().optional(),
        statusLabel: z.string().optional(),
        sourceLabel: z.string().optional(),
        tone: toneSchema,
        icon: z
          .enum(["sparkles", "archive", "file", "warning", "check"])
          .optional(),
      }),
      slots: ["default"],
      description:
        "Compact Chrona workspace summary block with optional nested content.",
    },
    WorkspaceArtifactList: {
      props: z.object({
        emptyLabel: z.string(),
        maxCollapsed: z.number().optional(),
        showAllLabel: z.string().optional(),
        showFewerLabel: z.string().optional(),
      }),
      slots: ["default"],
      description:
        "Collapsible artifact index used by the task workspace command center.",
    },
    WorkspaceArtifactItem: {
      props: fileViewPropsSchema.extend({
        title: z.string(),
        type: z.string(),
        locateLabel: z.string().optional(),
      }),
      description: "One workspace artifact row with an optional locate action and server-hydrated preview.",
    },
    WorkspaceActionGroup: {
      props: z.object({
        label: z.string().optional(),
        layout: z.enum(["inline", "stack"]).optional(),
      }),
      slots: ["default"],
      description:
        "Compact action group used by command center checkpoint controls.",
    },
    WorkspaceActionCard: {
      props: z.object({
        title: z.string().optional(),
        tone: toneSchema,
      }),
      slots: ["default"],
      description: "Contained command center action with optional input field.",
    },
    WorkspaceDiffPreview: {
      props: z.object({
        summary: z.string(),
        confidence: z.string(),
        risks: z.array(z.string()),
        warnings: z.array(z.string()),
        taskDiffs: z.array(
          z.object({
            label: z.string(),
            key: z.string(),
            original: z.string(),
            proposed: z.string(),
          }),
        ),
        planSummary: z.array(z.string()),
        addedNodes: z.array(
          z.object({
            title: z.string(),
            estimatedMinutes: z.number().optional(),
          }),
        ),
        deletedNodeIds: z.array(z.string()),
      }),
      description: "Task workspace AI proposal diff preview display.",
    },
  },
  actions: {
    [UI_ACTION.commandCenterPrimary]: {
      params: commandCenterPrimaryPayloadSchema,
      description: "Run a host-owned primary command center action.",
    },
    [UI_ACTION.acceptPlan]: {
      params: acceptPlanPayloadSchema,
      description: "Accept the current generated plan.",
    },
    [UI_ACTION.generatePlan]: {
      params: generatePlanPayloadSchema,
      description: "Generate a plan for the current task.",
    },
    [UI_ACTION.dispatchExecution]: {
      params: dispatchExecutionPayloadSchema,
      description:
        "Dispatch a pre-defined execution action for the current node.",
    },
    [UI_ACTION.locateWorkspaceNode]: {
      params: locateWorkspaceNodePayloadSchema,
      description: "Select and reveal a task workspace plan node.",
    },
    [UI_ACTION.submitCheckpoint]: {
      params: submitCheckpointPayloadSchema,
      description:
        "Submit checkpoint form values (with an optional chosen action).",
    },
    [UI_ACTION.recoveryRetry]: {
      params: recoveryRetryPayloadSchema,
      description:
        "Retry the failed plan generation surfaced in the header error banner.",
    },
    [UI_ACTION.recoveryEditInstruction]: {
      params: recoveryEditInstructionPayloadSchema,
      description:
        "Open the plan regeneration instruction editor after a generation failure.",
    },
    [UI_ACTION.recoveryCancel]: {
      params: recoveryCancelPayloadSchema,
      description: "Dismiss the header error banner without retrying.",
    },
  },
});

export const chronaPlanOutputCatalog = defineCatalog(chronaSchema, {
  components: {
    Stack: shadcn.Stack,
    Card: shadcn.Card,
    Separator: shadcn.Separator,
    Heading: shadcn.Heading,
    Text: shadcn.Text,
    Badge: shadcn.Badge,
    Alert: shadcn.Alert,
    Table: tableComponentDefinition,
    Markdown: {
      props: z.object({ content: z.string(), title: z.string().optional() }),
      description:
        "Rendered markdown result content. Use for prose, bullets, checklists, command summaries, and compact technical reports.",
      example: {
        title: "Summary",
        content: "- Completed implementation\n- Ran focused tests",
      },
    },
    JsonView: {
      props: z.object({ value: z.unknown(), title: z.string().optional() }),
      description:
        "Pretty-printed JSON result value. Use only for diagnostics, API payloads, machine-readable evidence, or debugging details; prefer Markdown/Table/Card for user-facing reports and summaries.",
      example: { title: "Diagnostic payload", value: { status: "ok" } },
    },
    FileRef: {
      props: z.object({
        path: z.string(),
        title: z.string().optional(),
        language: z.string().optional(),
        description: z.string().optional(),
      }),
      description:
        "Reference to a produced or changed file artifact. path must be repo-relative; generated result artifacts should use .chrona/outputs/<node-ref>/ when not explicit repo/code changes.",
      example: {
        path: "packages/ui-protocol/src/catalog/components.ts",
        title: "Updated catalog",
        language: "ts",
      },
    },
    ResultSummary: {
      props: z.object({
        text: z.string().optional(),
        copyText: z.string().optional(),
      }),
      description:
        "Compact result summary header with optional copy text. Use once near the top of plan output.",
      example: { text: "Implementation complete; focused tests passed." },
    },
    CollapsibleText: collapsibleTextComponentDefinition,
  },
  actions: {},
});

const planOutputComponentEntries = Object.entries(
  chronaPlanOutputCatalog.data.components,
);


const planOutputComponentNames = planOutputComponentEntries.map(([name]) => name) as [
  string,
  ...string[],
];

export const chronaPlanOutputElementSchema = z
  .object({
    type: z.enum(planOutputComponentNames),
    props: z.record(z.string(), z.unknown()).optional(),
    children: z.array(z.string()).optional(),
    visible: z.unknown().optional(),
  })
  .strict();

function schemaVariants(schema: z.core.JSONSchema.JSONSchema) {
  if (schema && typeof schema === "object" && !Array.isArray(schema) && "anyOf" in schema) {
    const variants = (schema as { anyOf?: z.core.JSONSchema.JSONSchema[] }).anyOf;
    if (Array.isArray(variants)) return variants;
  }
  return [schema];
}

function mergeJsonSchemas(
  left: z.core.JSONSchema.JSONSchema | undefined,
  right: z.core.JSONSchema.JSONSchema,
): z.core.JSONSchema.JSONSchema {
  const variants = [...(left ? schemaVariants(left) : []), ...schemaVariants(right)];
  const unique = Array.from(new Map(variants.map((variant) => [JSON.stringify(variant), variant])).values());
  return unique.length === 1 ? unique[0]! : { anyOf: unique };
}

function planOutputPropsJsonSchema(): z.core.JSONSchema.JSONSchema {
  const properties: Record<string, z.core.JSONSchema.JSONSchema> = {};
  for (const [, component] of planOutputComponentEntries) {
    const schema = planOutputComponentPropsJsonSchema(component) as {
      properties?: Record<string, z.core.JSONSchema.JSONSchema>;
    };
    for (const [key, propSchema] of Object.entries(schema.properties ?? {})) {
      properties[key] = mergeJsonSchemas(properties[key], propSchema);
    }
  }

  return {
    type: "object",
    properties,
    additionalProperties: false,
  };
}

export function chronaPlanOutputCatalogPrompt() {
  return chronaPlanOutputCatalog.prompt({
    editModes: ["patch"],
    customRules: [
      "Each patch is a JSON Patch operation over the accumulated plan output Spec summarized by Current Node Context JSON.context.planOutput.",
      "planOutput is task-level storage shared by every node in this task run; every chrona_plan_output call modifies the same accumulated user-visible result, not a node-local document.",
      "Chrona does not accept raw JSONL text. Put the generated RFC 6902 patch objects in chrona_plan_output.patches.",
      "Use chrona_plan_output for shared task-level user-visible output only.",
      "Bootstrap /root only when Current Node Context JSON.context.planOutput.hasSpec is false. In that first call only, add /root and all referenced /elements/<id> entries together.",
      "When planOutput.hasSpec is true, never patch /root, /elements, or the existing root element as a replacement. Preserve the current root id from context.planOutput.root.",
      "For later updates, add node-specific sections under stable /elements/<id> paths, then append/reorder those ids inside an existing children array such as /elements/<currentRootId>/children/-. Use context.planOutput.rootChildren and context.planOutput.elementIds to avoid duplicate ids and preserve prior sections unless the user explicitly asks to remove them.",
      "User-facing reports should compose clear sections with Card containers around Markdown/Table/ResultSummary content so each major block has a visible background.",
      "Use JsonView sparingly: only for diagnostics, API payloads, machine-readable evidence, or debugging details. Do not show source data or report rationale as raw JSON when Markdown or Table would be readable.",
      "Do not submit legacy spec/mode fields, markdown-only text, backend IDs, node-local outputs, or complete replacement Specs after bootstrap.",
    ],
  });
}

function withoutSchemaKeyword(schema: z.core.JSONSchema.JSONSchema) {
  const { $schema: _schema, ...rest } = schema as Record<string, unknown>;
  return rest as z.core.JSONSchema.JSONSchema;
}

function planOutputComponentPropsJsonSchema(
  component: (typeof planOutputComponentEntries)[number][1],
): z.core.JSONSchema.JSONSchema {
  return withoutSchemaKeyword(
    z.toJSONSchema(component.props, {
      target: "draft-07",
      unrepresentable: "any",
    }) as z.core.JSONSchema.JSONSchema,
  );
}

export function chronaPlanOutputElementJsonSchema(): z.core.JSONSchema.JSONSchema {
  return {
    type: "object",
    properties: {
      type: { type: "string", enum: planOutputComponentNames },
      props: planOutputPropsJsonSchema(),
      children: { type: "array", items: { type: "string" } },
      visible: {},
    },
    required: ["type", "props"],
    additionalProperties: false,
  };
}

export function chronaPlanOutputPatchValueJsonSchema(): z.core.JSONSchema.JSONSchema {
  return {
    description:
      "Patch value. Required for add/replace/test; omit for remove/move/copy. Use element object for /elements/<id>, string[] for children arrays, string for scalar props or element ids appended to children, object for props/state/JsonView, or number/boolean/null for scalar values.",
  };
}

export function chronaPlanOutputSpecJsonSchemaFromCatalog(): z.core.JSONSchema.JSONSchema {
  return {
    type: "object",
    properties: {
      root: { type: "string" },
      elements: {
        type: "object",
        additionalProperties: chronaPlanOutputElementJsonSchema(),
      },
      state: { type: "object", additionalProperties: true },
    },
    required: ["root", "elements"],
    additionalProperties: false,
  };
}

export function chronaPlanOutputPatchJsonSchema(): z.core.JSONSchema.JSONSchema {
  const path: z.core.JSONSchema.JSONSchema = {
    type: "string",
    minLength: 1,
    description:
      "JSON Pointer into the plan-output Spec. Common update paths: /elements/<id>, /elements/<id>/children, /elements/<id>/children/<index>, /elements/<id>/children/-, or /elements/<id>/props/<prop>. Use /state/<key> only when the element uses json-render state expressions.",
  };
  const from: z.core.JSONSchema.JSONSchema = {
    ...path,
    description: "Source JSON Pointer. Required for move/copy; omit for add/replace/remove/test.",
  };
  const value = chronaPlanOutputPatchValueJsonSchema();

  return {
    type: "object",
    properties: {
      op: { type: "string", enum: ["add", "replace", "remove", "move", "copy", "test"] },
      path,
      from,
      value,
    },
    required: ["op", "path"],
    additionalProperties: false,
  };
}

export function chronaPlanOutputToolInputJsonSchema(): z.core.JSONSchema.JSONSchema {
  return {
    type: "object",
    properties: {
      patches: {
        type: "array",
        minItems: 1,
        items: chronaPlanOutputPatchJsonSchema(),
        description: "RFC 6902 patches over the shared plan-output Spec.",
      },
      summary: { type: "string", minLength: 1 },
    },
    required: ["patches"],
    additionalProperties: false,
  };
}

export const chronaPlanOutputSpecJsonSchema = chronaPlanOutputSpecJsonSchemaFromCatalog();
export const chronaPlanOutputSpecSchema = chronaPlanOutputCatalog.zodSchema();

export type ChronaPlanOutputCatalog = typeof chronaPlanOutputCatalog;
export type ChronaPlanOutputComponentName =
  keyof typeof chronaPlanOutputCatalog.data.components;
export type ChronaCatalog = typeof chronaCatalog;
export type ChronaComponentName = keyof typeof chronaCatalog.data.components;
