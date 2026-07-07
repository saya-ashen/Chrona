import { z } from "zod";
import type { UiDocument } from "../document/document";
import { validateChronaSpec, type ValidateResult } from "../document/validate";

const textProp = z.string().trim().min(1).max(500);
const childKeys = z.array(z.string().trim().min(1)).max(12).optional();

const stackElementSchema = z.object({
  type: z.literal("Stack"),
  props: z.object({
    gap: z.enum(["sm", "md", "lg"]).optional(),
    direction: z.enum(["vertical", "horizontal"]).optional(),
  }).strict().optional(),
  children: childKeys,
}).strict();

const cardElementSchema = z.object({
  type: z.literal("Card"),
  props: z.object({}).strict().optional(),
  children: childKeys,
}).strict();

const headingElementSchema = z.object({
  type: z.literal("Heading"),
  props: z.object({
    text: textProp.max(80),
    level: z.enum(["h2", "h3", "h4"]).optional(),
  }).strict(),
  children: childKeys,
}).strict();

const textElementSchema = z.object({
  type: z.literal("Text"),
  props: z.object({
    text: textProp.optional(),
    content: textProp.optional(),
    variant: z.enum(["default", "muted", "lead", "small"]).optional(),
  }).strict().refine((props) => Boolean(props.text ?? props.content), "text or content is required"),
  children: childKeys,
}).strict();

const alertElementSchema = z.object({
  type: z.literal("Alert"),
  props: z.object({
    title: textProp.max(80),
    description: textProp.max(240).optional(),
    variant: z.enum(["default", "destructive"]).optional(),
  }).strict(),
  children: childKeys,
}).strict();

const badgeElementSchema = z.object({
  type: z.literal("Badge"),
  props: z.object({
    label: textProp.max(40).optional(),
    text: textProp.max(40).optional(),
    variant: z.enum(["default", "secondary", "outline", "success", "warning", "info", "destructive"]).optional(),
  }).strict().refine((props) => Boolean(props.label ?? props.text), "label or text is required"),
  children: childKeys,
}).strict();

const separatorElementSchema = z.object({
  type: z.literal("Separator"),
  props: z.object({
    orientation: z.enum(["horizontal", "vertical"]).optional(),
  }).strict().optional(),
  children: z.array(z.string()).max(0).optional(),
}).strict();


const dashboardSummaryElementSchema = z.discriminatedUnion("type", [
  stackElementSchema,
  cardElementSchema,
  headingElementSchema,
  textElementSchema,
  alertElementSchema,
  badgeElementSchema,
  separatorElementSchema,
]);

export const dashboardSummarySpecSchema = z.object({
  root: z.string().trim().min(1),
  elements: z.record(z.string().trim().min(1), dashboardSummaryElementSchema),
}).strict().superRefine((spec, ctx) => {
  const keys = new Set(Object.keys(spec.elements));
  if (!keys.has(spec.root)) {
    ctx.addIssue({ code: "custom", path: ["root"], message: "root must reference an existing element" });
  }
  for (const [key, element] of Object.entries(spec.elements)) {
    for (const child of element.children ?? []) {
      if (!keys.has(child)) {
        ctx.addIssue({ code: "custom", path: ["elements", key, "children"], message: `missing child ${child}` });
      }
    }
  }
});

function toChronaCatalogElement(element: z.infer<typeof dashboardSummaryElementSchema>): UiDocument["elements"][string] {
  if (element.type === "Text") {
    return {
      type: "Text",
      props: {
        text: element.props.text ?? element.props.content,
        variant: element.props.variant === "small" ? "caption" : element.props.variant === "default" ? "body" : element.props.variant,
      },
      children: element.children ?? [],
    };
  }

  if (element.type === "Badge") {
    return {
      type: "Badge",
      props: {
        text: element.props.text ?? element.props.label,
        variant: element.props.variant === "success" || element.props.variant === "warning" || element.props.variant === "info" ? "secondary" : element.props.variant,
      },
      children: element.children ?? [],
    };
  }

  if (element.type === "Alert") {
    return {
      type: "Alert",
      props: {
        title: element.props.title,
        message: element.props.description ?? null,
        type: element.props.variant === "destructive" ? "error" : null,
      },
      children: element.children ?? [],
    };
  }

  return {
    type: element.type,
    props: element.props ?? {},
    children: element.children ?? [],
  };
}

export function validateDashboardSummarySpec(input: unknown): ValidateResult {
  const parsed = dashboardSummarySpecSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      issues: parsed.error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    };
  }
  const spec: UiDocument = { root: parsed.data.root, elements: {} };
  for (const [key, element] of Object.entries(parsed.data.elements)) {
    spec.elements[key] = toChronaCatalogElement(element);
  }
  return validateChronaSpec(spec);
}
