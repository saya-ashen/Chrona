import fs from "node:fs";
import { z } from "zod";
import { parseYamlLike } from "./markdown";
import type { FeatureDocsRules } from "./types";

const RulesSchema = z.object({
  version: z.literal(1),
  document: z.object({
    file_suffix: z.string(),
    module_file_name: z.string(),
    front_matter_required: z.boolean(),
  }),
  source: z.object({
    include_globs: z.array(z.string()),
    exclude_globs: z.array(z.string()),
  }),
  exclude: z.object({
    path_globs: z.array(z.string()),
    symbol_kinds: z.array(z.string()),
    symbol_name_patterns: z.array(z.string()),
  }),
  score: z.record(z.string(), z.number()),
  selection: z
    .object({
      mode: z.enum(["explicit", "score"]),
      files: z.array(
        z.object({
          path: z.string().min(1),
          reason: z.string().min(1),
          symbols: z.array(z.string()).optional(),
        }),
      ),
    })
    .default({ mode: "explicit", files: [] }),
  describe_threshold: z.number(),
});

export function loadRules(path = "docs/maps/feature-docs.rules.yaml"): FeatureDocsRules {
  return RulesSchema.parse(parseYamlLike(fs.readFileSync(path, "utf8"))) as FeatureDocsRules;
}
