import { defineSchema } from "@json-render/core";

/**
 * Chrona's json-render schema. This mirrors the prebuilt `@json-render/react`
 * schema (a flat element tree) but is declared here in the core-only shared
 * layer so the engine can build catalogs, generate AI prompts, and validate
 * specs without depending on the React renderer. The web app renders specs
 * produced against this schema with `@json-render/react`.
 *
 * Spec shape: `{ root, elements: Record<key, { type, props, children, visible }> }`.
 */
export const chronaSchema = defineSchema((s) => ({
  spec: s.object({
    root: s.string(),
    elements: s.record(
      s.object({
        type: s.ref("catalog.components"),
        props: s.propsOf("catalog.components"),
        children: { ...s.array(s.string()), optional: true },
        visible: { ...s.any(), optional: true },
      }),
    ),
  }),
  catalog: s.object({
    components: s.map({
      props: s.zod(),
      slots: s.array(s.string()),
      description: s.string(),
      example: s.any(),
    }),
    actions: s.map({
      params: s.zod(),
      description: s.string(),
    }),
  }),
}));

export type ChronaSchema = typeof chronaSchema;
