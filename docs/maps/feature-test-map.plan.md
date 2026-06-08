# Feature + Test Map — Build Plan

> Living plan. Status updated as work progresses. Owner: staff-eng map build.

## Goal

A **regenerable, index-derived** map that drills from product feature → package →
module → source file → exported function, and annotates every level with the
tests that cover it. Coarse first (file level), then refined (function level +
empirical v8 coverage).

Hand-written maps rot against 200+ test files and ~9.5k symbols, so the map is
**derived from the repo by a committed generator script**, not authored by hand.

## Deliverables

| Artifact | Purpose |
|---|---|
| `scripts/build-feature-test-map.ts` | Generator: parses workspace import graph + (later) v8 coverage |
| `docs/maps/feature-test-map.md` | Human-readable map (feature → file → tests) |
| `docs/maps/feature-test-map.json` | Structured map for tooling/diffing |
| `package.json` script `map:build` | One-command regeneration |
| doc note in `docs/README.md` | Discoverability + regen instructions |

## Method

1. Enumerate source files (`.ts`/`.tsx`, excluding tests, generated, dist) and
   test files (`*.bun.test.ts`, `*.test.ts(x)`, `e2e/specs/*.spec.ts`) across the
   workspace.
2. Resolve every import specifier in a test file to a source file path using
   `tsconfig.json` `paths` aliases + relative resolution. Capture static
   `import`, dynamic `import()`, and `vi.mock(...)` targets.
3. Build edges: test → directly-imported source file(s). This is the honest
   *structural* signal ("which test references this file"), distinct from
   execution coverage.
4. Group source files into feature buckets by package + top-level module
   (`packages/engine/src/modules/<module>`, `apps/web/src/components/<area>`,
   `apps/server/src/routes|services`, etc.), mapped onto the 5 product workflows
   from `docs/README.md`.
5. Emit md + json. Flag source files with **zero** referencing tests.
6. **Refine**: extract exported symbols per source file (function granularity)
   and layer in empirical `vitest --coverage` (v8) line/function data so the map
   shows real execution, not just import references.

## Status — COMPLETE

| Phase | Task | State |
|---|---|---|
| Foundation | Sample test import patterns | DONE |
| Foundation | Write plan artifact | DONE |
| Foundation | Build import resolver + file enumeration | DONE |
| FileLevelMap | Map source files to covering tests | DONE |
| FileLevelMap | Group by package/module/feature | DONE |
| FileLevelMap | Emit md + json | DONE |
| FunctionLevel | Extract exported symbols per file | DONE |
| FunctionLevel | Integrate v8 coverage data | DONE (excluded by design — see notes) |
| FunctionLevel | Refine map to function granularity | DONE |
| Verification | Verify regeneration is deterministic | DONE (`bun run map:check` passes) |
| Verification | Sanity-check counts vs known tests | DONE (210 tests, 561 src match git; edges consistent) |
| Verification | Wire npm script + doc note | DONE (`map:build`/`map:check`, docs/README link) |

## Result

- Generator: `scripts/build-feature-test-map.ts` (+ `scripts/lib/feature-test-map-model.ts`, `scripts/lib/feature-test-map-render.ts`).
- Output: `docs/maps/feature-test-map.md` + `docs/maps/feature-test-map.json`.
- Regenerate: `bun run map:build`; CI guard: `bun run map:check`.
- File level: 561 src files — 219 (39%) directly imported by a test, 503 (90%) transitively reachable, 58 uncovered (entry points/scripts).
- Function level: 1207 testable exported symbols — 319 (26%) referenced by a directly-importing test.

## Decisions / Notes

- Structural edges (imports) and empirical edges (v8 coverage) are kept distinct;
  imports are labeled "referenced by", not "executed".
- Alias source of truth = `tsconfig.json` paths read at generate time, so the
  generator survives alias changes.
- **v8 coverage deliberately not merged.** Chrona runs two disjoint runners
  (Bun `*.bun.test.ts`, Vitest `*.test.ts(x)`) whose v8 output cannot be unified
  into one deterministic number. The map answers "what is tested and by which
  test"; `bunx vitest run --coverage` and `bun test --coverage` answer "how
  thoroughly". Documented in the map's Methodology section.
- "Testable" symbols = function/class/const exports; interfaces/types/reexports
  are excluded from the function-level percentage as they carry no runtime cover.