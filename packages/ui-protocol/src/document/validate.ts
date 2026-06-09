import { validateSpec as coreValidateSpec, type Spec } from "@json-render/core";
import type { ZodType } from "zod";
import { chronaCatalog } from "../catalog/components";
import type { ChronaSpec } from "./document";

export interface ValidationIssue {
  path: string;
  message: string;
}

export type ValidateResult =
  | { ok: true; spec: ChronaSpec }
  | { ok: false; issues: ValidationIssue[] };

function isSpecLike(value: unknown): value is Spec {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.root === "string" &&
    typeof candidate.elements === "object" &&
    candidate.elements !== null
  );
}

const COMPONENT_TYPE_ALIASES: Record<string, string> = {
  heading: "heading",
  paragraph: "paragraph",
  table: "table",
  section: "section",
};

function normalizeElement(element: Spec["elements"][string]) {
  const type = COMPONENT_TYPE_ALIASES[element.type] ?? element.type;
  return type === element.type ? element : { ...element, type };
}

export function normalizeChronaSpec(input: unknown): Spec {
  if (!isSpecLike(input)) return input as Spec;
  const elements = Object.fromEntries(
    Object.entries(input.elements).map(([key, element]) => [key, normalizeElement(element)]),
  ) as Spec["elements"];

  if (elements[input.root]) {
    return elements === input.elements ? input : { ...input, elements };
  }

  const childKeys = Object.keys(elements);
  if (childKeys.length === 0) return { ...input, elements };
  return {
    ...input,
    root: input.root,
    elements: {
      ...elements,
      [input.root]: { type: "Stack", props: { gap: "md" }, children: childKeys },
    },
  };
}


/**
 * Strictly validate an unknown value as a Chrona UI document:
 *  1. structural shape (`{ root, elements }`);
 *  2. every element's `type` is a known catalog component, and its `props`
 *     satisfy that component's Zod schema (validated directly against the
 *     catalog — `catalog.validate()` is intentionally lenient for streaming);
 *  3. reference integrity via core `validateSpec` (root/children resolve, no
 *     orphans).
 *
 * Producers that fail validation fall back to typed rendering (plan §7). The
 * AI Node-result path MUST call this before persisting (plan §5.1).
 */
export function validateChronaSpec(input: unknown): ValidateResult {
  if (!isSpecLike(input)) {
    return { ok: false, issues: [{ path: "", message: "not a spec ({ root, elements })" }] };
  }

  const spec = normalizeChronaSpec(input);
  const issues: ValidationIssue[] = [];
  const components = chronaCatalog.data.components as Record<string, { props: ZodType }>;

  for (const [key, element] of Object.entries(spec.elements)) {
    const definition = components[element.type];
    if (!definition) {
      issues.push({ path: `elements.${key}.type`, message: `unknown component "${element.type}"` });
      continue;
    }

    // Presence-lenient, type-strict: relax required props (shadcn declares
    // optionals as `.nullable()` required keys) so omitting a prop is fine,
    // while a present prop with the wrong type is still rejected.
    const propsSchema = definition.props as ZodType & { partial?: () => ZodType };
    const validator = typeof propsSchema.partial === "function" ? propsSchema.partial() : propsSchema;
    const propsResult = validator.safeParse((element as { props?: unknown }).props ?? {});
    if (!propsResult.success) {
      for (const issue of propsResult.error.issues) {
        issues.push({
          path: `elements.${key}.props.${issue.path.join(".")}`,
          message: issue.message,
        });
      }
    }
  }

  for (const issue of coreValidateSpec(spec).issues) {
    if (issue.severity === "error") {
      issues.push({ path: issue.elementKey ?? "root", message: `${issue.code}: ${issue.message}` });
    }
  }

  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, spec: spec as ChronaSpec };
}
