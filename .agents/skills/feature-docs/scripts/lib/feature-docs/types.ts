import { z } from "zod";

export const LAYERS = [
  "web",
  "server",
  "engine",
  "contracts",
  "graph-runtime",
  "db",
  "provider",
  "integration",
  "plugin",
  "unknown",
] as const;

export const SYMBOL_KINDS = ["function", "class", "component", "hook", "route", "schema", "const", "unknown"] as const;

export const FeatureDocSymbolSchema = z.object({
  id: z.string().min(1),
  source_name: z.string().min(1),
  kind: z.enum(SYMBOL_KINDS),
  describe: z.boolean(),
});

export const FeatureDocFrontMatterSchema = z.object({
  feature_doc_version: z.literal(1),
  scope: z.enum(["module", "file"]),
  source: z.string().min(1),
  owner_feature: z.string().min(1),
  owner_capability: z.string().optional(),
  layer: z.enum(LAYERS),
  status: z.enum(["active", "draft", "stale"]),
  sync: z.object({
    mode: z.enum(["scaffold-and-check", "manual", "generated-only"]),
    source_hash: z.string().optional(),
    last_scanned_commit: z.string().optional(),
  }),
  symbols: z.array(FeatureDocSymbolSchema),
  tests: z
    .object({
      direct: z.array(z.string()).optional(),
      transitive: z.array(z.string()).optional(),
    })
    .optional(),
  coverage: z
    .object({
      status: z.enum(["unknown", "good", "partial", "weak", "none"]),
      confidence: z.enum(["low", "medium", "high"]).optional(),
    })
    .optional(),
});

export type FeatureDocFrontMatter = z.infer<typeof FeatureDocFrontMatterSchema>;
export type FeatureDocSymbol = z.infer<typeof FeatureDocSymbolSchema>;
export type FeatureDocSymbolKind = (typeof SYMBOL_KINDS)[number];

export interface FeatureDocsRules {
  version: 1;
  document: {
    file_suffix: string;
    module_file_name: string;
    front_matter_required: boolean;
  };
  source: {
    include_globs: string[];
    exclude_globs: string[];
  };
  exclude: {
    path_globs: string[];
    symbol_kinds: string[];
    symbol_name_patterns: string[];
  };
  score: Record<string, number>;
  selection: {
    mode: "explicit" | "score";
    files: Array<{
      path: string;
      reason: string;
      symbols?: string[];
    }>;
  };
  describe_threshold: number;
}

export interface SourceSymbol {
  id: string;
  sourceName: string;
  kind: FeatureDocSymbolKind;
  exported: boolean;
  signature: string;
  hints: string[];
  score: number;
  reason: string;
  describe: boolean;
}

export interface SourceFileScan {
  filePath: string;
  sourceHash: string;
  layer: FeatureDocFrontMatter["layer"];
  ownerFeature: string;
  ownerCapability: string;
  symbols: SourceSymbol[];
}

export interface TestRefs {
  direct: string[];
  transitive: string[];
  bySymbol: Map<string, { direct: string[]; transitive: string[] }>;
}
