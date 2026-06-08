// Shared model for the feature+test map generator.
// Types + product-workflow taxonomy + tunables, imported by both the
// generator (build-feature-test-map.ts) and the renderer.

export const MAX_DEPTH = 6;

export type SymbolKind = "function" | "class" | "const" | "type" | "reexport";

/** A symbol whose coverage is meaningful at function level (runnable code, not a type/reexport). */
export function isTestableKind(kind: SymbolKind): boolean {
  return kind === "function" || kind === "class" || kind === "const";
}

export interface ExportedSymbol {
  name: string;
  kind: SymbolKind;
}

export interface SymbolEntry {
  name: string;
  kind: SymbolKind;
  tests: string[]; // direct tests that reference this symbol by name
}

export interface FileEntry {
  file: string;
  pkg: string;
  module: string;
  workflow: string;
  directTests: string[];
  transitiveTests: string[];
  symbols: SymbolEntry[];
}

export interface MapModel {
  generatedAt: string;
  granularity: "function";
  totals: {
    sourceFiles: number;
    testFiles: number;
    directCovered: number;
    transitiveCovered: number;
    uncovered: number;
    exportedSymbols: number;
    symbolsWithTest: number;
  };
  files: FileEntry[];
}

// product workflows from docs/README.md, mapped to feature buckets that serve them.
export const WORKFLOWS: Array<{ id: string; title: string; match: (pkg: string, mod: string) => boolean }> = [
  {
    id: "task-workspace-plan-execution",
    title: "Task workspace plan execution (workspace UI / graph / runner controls)",
    match: (p, m) =>
      (p === "web/components" && ["tasks/workspace", "tasks/plan"].includes(m)) ||
      (p === "engine" && ["plan-execution", "orchestration"].includes(m)),
  },
  {
    id: "task-management",
    title: "Task management (create/edit/complete/relate)",
    match: (p, m) =>
      (p === "engine" && ["tasks", "projections", "events"].includes(m)) ||
      (p === "web/components" && m === "tasks") ||
      (p === "domain" && ["task"].includes(m)),
  },
  {
    id: "plan-generation",
    title: "Plan generation (AI draft / review / accept / materialize)",
    match: (p, m) =>
      (p === "engine" && ["plans", "ai"].includes(m)) ||
      (p === "web/components" && m === "tasks") ||
      (p === "domain" && m === "plan"),
  },
  {
    id: "plan-execution",
    title: "Plan execution (task/checkpoint/condition/wait nodes)",
    match: (p, m) =>
      (p === "engine" && ["plan-execution", "orchestration", "agent-tools"].includes(m)) ||
      p === "graph-runtime" ||
      (p === "web/components" && m === "work"),
  },
  {
    id: "schedule-cockpit",
    title: "Schedule cockpit (time blocks / conflicts / proposals / auto-start)",
    match: (p, m) =>
      (p === "engine" && ["scheduling", "pages"].includes(m)) ||
      (p === "web/components" && m === "schedule") ||
      (p === "domain" && m === "calendar"),
  },
  {
    id: "work-page",
    title: "Work page (latest result / graph / records / context)",
    match: (p, m) => (p === "web/components" && m === "work") || (p === "engine" && m === "pages"),
  },
  {
    id: "external-calendar",
    title: "External calendar (sources / import / sync)",
    match: (p, m) => m === "calendar" || /calendar/i.test(m) || p === "integrations/calendar",
  },
  {
    id: "providers-runtime",
    title: "Providers / runtime boundary",
    match: (p) => p.startsWith("providers") || p === "runtime-core",
  },
  {
    id: "contracts",
    title: "Contracts (schemas / DTOs / MCP tool specs)",
    match: (p) => p === "contracts",
  },
  {
    id: "platform",
    title: "Platform (server routing, db, cli, i18n, shared, ui-protocol)",
    match: (p, m) =>
      p === "server" || p === "db" || p === "cli" || p === "i18n" || p === "shared" || p === "ui-protocol" || (p === "web/components" && m === "ui"),
  },
];

export function workflowFor(pkg: string, mod: string): string {
  for (const w of WORKFLOWS) if (w.match(pkg, mod)) return w.id;
  return "unmapped";
}
