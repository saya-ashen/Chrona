# Implementation Plan: json-render Unified UI Layer for Task Workspace

**Feature Branch**: `011-json-render-unified-ui`
**Created**: 2026-06-05
**Status**: In progress (Phases 0–3 complete; Phase 4 next)
**Input**: Replace the data-driven parts of the Task Workspace page — **Node result**, **Node action**, **Activity** — with a single declarative rendering layer based on [json-render](https://json-render.dev). All three panels render from a json-render *spec*; the only difference is the **producer** of that spec: Node result specs are produced by the **AI/agent**, while Node action and Activity specs are produced by **backend code** from existing typed data.

> **Decision 1 — json-render, not a2ui.** a2ui is a cross-process / cross-framework agent↔client *protocol* (surfaces, adjacency model, transport across trust boundaries). Chrona renders inside one React app, so json-render's catalog + React renderer is the right tool. a2ui is explicitly **out of scope** (see §13).
>
> **Decision 2 — adopt the json-render framework, do not reinvent it.** `@json-render/core` + `@json-render/react` (v0.19.0) are a *complete* generative-UI framework: catalog (`defineSchema`/`defineCatalog`), `Spec` document format, `validateSpec`, AI prompt + JSON-Schema export (`catalog.prompt()` / `catalog.jsonSchema()`), state binding (`$bindState` / `StateProvider`), form validation (`ValidationProvider` / `checks`/`validateOn`), actions (`ActionProvider`), and streaming (`createSpecStreamCompiler` / `useUIStream`). `@chrona/ui-protocol` is a thin layer **on top of** these, not a parallel implementation.
>
> **Decision 3 — reuse `@json-render/shadcn`.** Chrona already ships the same Radix + CVA + Tailwind-v4 stack, so we reuse the prebuilt, AI-tested shadcn component definitions. The server-safe `@json-render/shadcn/catalog` entry (`shadcnComponentDefinitions`, no React) supplies standard primitives in `ui-protocol`; the React entry (`@json-render/shadcn` → `shadcnComponents`) supplies their renderers in web. Only domain components shadcn lacks are defined locally.
>
> **Decision 4 — dependency boundary.** `@json-render/core` + `@json-render/shadcn` (`/catalog` only) live in `@chrona/ui-protocol` (shared; the engine reuses the catalog for prompts/validation). `@json-render/react` + `@json-render/shadcn` (React) live in `apps/web`.

---

## 1. Goal & Core Principle

**One catalog, one renderer, two producers.**

```
                       ┌──────────────────────────────┐
                       │   Catalog (single contract)   │
                       │  component names + Zod props  │
                       │  + action names + Zod payloads│
                       └───────────────┬──────────────┘
            targets schema             │ targets schema
        ┌──────────────────┐           │           ┌───────────────────────┐
        │  AI / agent       │          │           │  Backend builders     │
        │  (Node result)    │          │           │  (Node action,        │
        │  emits UiDocument │          │           │   Activity)           │
        └─────────┬─────────┘          │           └───────────┬───────────┘
                  │ validate (Zod, server) │                   │ deterministic
                  └──────────────┬─────────┘                   │
                                 ▼                             ▼
                       ┌──────────────────────────────────────────┐
                       │  Spec  { root, elements, state? }          │
                       │  travels in the read model / result store │
                       └────────────────────┬──────────────────────┘
                                            ▼
                       ┌──────────────────────────────────────────┐
                       │  @json-render/react Renderer + registry   │
                       │  (shadcn + Chrona components) + Action/    │
                       │  State/Validation providers + fallback     │
                       │  (apps/web)                               │
                       └──────────────────────────────────────────┘
```

The **catalog is the trust boundary**: every producer (AI or backend) can only reference catalog component names with catalog-valid props, and can only emit catalog-declared actions. This is what makes AI-authored UI safe ("no UI injection") and what makes backend-authored UI consistent with AI-authored UI.

### Non-negotiable invariants

1. **The catalog Zod schema is the single source of truth**, shared by producers and renderer.
2. **Every document is validated against the catalog before it renders.** AI documents are validated server-side; backend documents are validated in tests (and optionally at runtime behind a flag).
3. **The existing typed renderers stay as the fallback path** until each panel's migration is complete and verified. We never ship a state where an invalid/empty document yields a broken panel.
4. **Interaction stays wired to existing callbacks** (`onDispatchExecutionAction`, `onSubmitCheckpointAction`). json-render documents *describe* actions; the host *executes* them. The execution kernel is not touched.

---

## 2. Why a unified layer (and what changes vs. today)

Today all three panels are hand-written JSX over closed, typed models:

| Panel | Source type (contract) | Current renderer |
|---|---|---|
| Node result | `NodeResultOutput[]` (`markdown` \| `json` \| `file` \| `link`) | `ResultTab` → `ResultOutputCard` (`task-workspace-node-detail-panel.tsx`, `plan/task-plan-graph/inspector-run-panel.tsx`) |
| Node action | `PlanNodeField[]` + `PlanNodeAction[]` | `WorkspaceNodeActionControls` (react-hook-form) |
| Activity | `WorkspaceActivityItem[]` | `WorkspaceActivityFeed` → `ActivityRow` (`workspace-activity-feed.tsx`) |

After this change, all three render through `UiDocumentRenderer`. The typed models remain (as builder *inputs* and as fallback), but the JSX-per-panel is replaced by **catalog components + builders**.

The compile-time discriminated-union safety we lose at the document boundary is recovered by **runtime Zod validation** (mandatory for AI, test-enforced for backend) plus **builder unit tests** (typed input → expected document).

---

## 3. Package & Module Layout

### 3.1 New package: `@chrona/ui-protocol` (React-free shared layer) — **delivered**

Rationale: the catalog, the `Spec` type, and the deterministic builders must be importable by **both** the engine (server: AI prompt injection, validation, backend spec generation) **and** the web app. It must not depend on React. It depends on `zod`, `@chrona/contracts`, `@json-render/core`, and `@json-render/shadcn` (`/catalog` entry only — server-safe, verified to load in plain Node).

```
packages/ui-protocol/
  src/
    schema.ts              # chronaSchema = defineSchema(...) — flat element-tree, mirrors
                           #   the prebuilt @json-render/react schema (core-only)
    catalog/
      components.ts        # chronaCatalog = defineCatalog(chronaSchema, { components, actions })
                           #   components = shadcnComponentDefinitions subset + Chrona-custom
                           #   (Markdown, JsonView, FileRef, ResultSummary, ActivityRow,
                           #    ToolDetails, CollapsibleText)
      catalog-version.ts   # CATALOG_VERSION + isCatalogCompatible (renderer gating)
      index.ts
    document/
      document.ts          # re-exports Spec (core); ChronaSpec (branded) + UiDocument (loose)
      validate.ts          # validateChronaSpec(input) — strict catalog props (presence-lenient,
                           #   type-strict via .partial()) + core validateSpec (structure)
    actions/
      actions.ts           # UI_ACTION names + Zod param schemas (dispatch-execution,
                           #   submit-checkpoint)
    builders/              # (Phases 1–3) build-result-spec / build-action-spec /
                           #   build-activity-spec — typed input -> Spec
    index.ts
  package.json             # deps: zod, @chrona/contracts, @json-render/core, @json-render/shadcn
```

> The activity/action builders take the **same typed inputs the panels consume today**, so the existing model-layer functions (`task-workspace-activity.ts`, `task-workspace-actions.ts`) become the *upstream* of the builders rather than being deleted.

### 3.2 Contracts changes — `packages/contracts`

- `plan-runtime/node-result.ts`: extend the `NodeResultOutput` union with a UI variant:
  ```ts
  | { kind: "ui"; spec: Spec; catalogVersion: string; title?: string }
  ```
  `Spec` is `@json-render/core`'s document type, re-exported from `@chrona/ui-protocol` (resolves **D1**: contracts depends on `@chrona/ui-protocol`, which owns the json-render dependency).
- API schemas that carry the work page / node result (e.g. `api/tasks.schema.ts`, `api/execution.schema.ts`) gain the optional `spec` payload for action and activity so the **wire payload already includes backend-built specs** and the web stays render-only.

### 3.3 Engine changes — `packages/engine`

- `modules/pages/work-page/get-work-page.ts` and the execution-graph selectors: call `build-action-spec` / `build-activity-spec` and attach specs to the read model.
- `modules/plan-execution/node-ai-capabilities.ts` + `node-runtime-prompts.ts`: inject `chronaCatalog.prompt()` (system prompt) / `chronaCatalog.jsonSchema({ strict: true })` (structured-output schema) and instruct the model to emit a `kind: "ui"` output when richer presentation helps. This is the lever that makes "AI dynamically authors UI" actually happen — and it comes from the library, not hand-written prompt text.
- AI result ingestion path (where `NodeResultOutput[]` is persisted): **validate** any `kind: "ui"` output via `validateChronaSpec`; on failure, drop the UI output and keep/synthesize a typed output (`build-result-spec` from the remaining typed outputs) so the panel never breaks.

### 3.4 Web changes — `apps/web/src/components/tasks/workspace`

```
workspace/
  catalog/
    workspace-registry.tsx    # defineRegistry(chronaCatalog, { components, actions }):
                              #   components = shadcnComponents subset + Chrona-custom
                              #   renderers (Markdown via react-markdown, JsonView,
                              #   FileRef/ResultOutputCard, ActivityRow, ToolDetails, ...)
                              #   actions = dispatch-execution / submit-checkpoint handlers
    spec-renderer.tsx         # <SpecRenderer spec fallback={...} onDispatch.. onSubmit..>
                              #   wraps Renderer + StateProvider/ActionProvider/
                              #   ValidationProvider + catalogVersion gate + fallback
  execution/
    task-workspace-node-detail-panel.tsx   # ResultTab + action tab -> SpecRenderer
    workspace-activity-feed.tsx             # render via SpecRenderer
```

- `workspace-registry.tsx` uses `defineRegistry` to bind catalog component names to React renderers: standard primitives from `@json-render/shadcn` (`shadcnComponents`, which theme through Chrona's shared Tailwind-v4 CSS variables), and Chrona-custom renderers for the domain components (reusing `ResultOutputCard`, `react-markdown`, etc.). Action handlers map `dispatch-execution` / `submit-checkpoint` to the existing `onDispatchExecutionAction` / `onSubmitCheckpointAction` callbacks.
- `spec-renderer.tsx` wraps the library `Renderer` + providers with a `catalogVersion` compatibility check and a `fallback` render prop used when no spec / invalid spec / version mismatch.

---

## 4. The Spec & Catalog contract

### 4.1 Spec shape (json-render native)

The document is `@json-render/core`'s `Spec` — a flat element tree (the format the library streams, validates, and renders):

```ts
interface Spec {
  root: string;                              // root element key
  elements: Record<string, {
    type: string;                            // catalog component name (ref)
    props?: Record<string, unknown>;         // validated against the component's Zod
    children?: string[];                     // element keys (adjacency list)
    visible?: unknown;                       // optional visibility condition
  }>;
  state?: Record<string, unknown>;           // seed for $bindState form state
}
```

`ui-protocol` exports `Spec` (loose, producer-facing, aliased `UiDocument`) and `ChronaSpec` (branded inferred type). **Producers construct `Spec`/`UiDocument`**; `validateChronaSpec` returns the narrowed `ChronaSpec` on success.

### 4.2 Catalog component set (delivered)

`chronaCatalog = defineCatalog(chronaSchema, …)` — standard primitives reuse `@json-render/shadcn` definitions; only domain components are local:

- **shadcn primitives**: `Card`, `Stack`, `Separator`, `Text`, `Heading`, `Badge`, `Alert`, `Button`, `Link`, `Input`, `Textarea`, `Select`, `Tabs`, `Table`.
- **Chrona-custom** (domain): `Markdown`, `JsonView`, `FileRef`, `ResultSummary`, `ActivityRow`, `ToolDetails`, `CollapsibleText`.
- **Actions**: `dispatch-execution`, `submit-checkpoint` (with Zod param schemas).

> Form fields use shadcn `Input`/`Textarea`/`Select` (which already carry `name` for state binding and `checks`/`validateOn` for validation) + `Button`, so the Node-action builder composes primitives instead of bespoke field components. Result links use shadcn `Link`; status messages use shadcn `Alert`.

### 4.3 Versioning

`CATALOG_VERSION` is bumped on any breaking catalog change. Every spec carries `catalogVersion`. The renderer: same major → render; different major → fall back to typed rendering (and log). This decouples AI-produced specs (which may lag) and backend-produced specs from renderer deploys.

---

## 5. Producers

### 5.1 Node result — produced by the AI/agent

1. Engine injects the catalog schema into the node-runtime prompt/tool contract.
2. The model emits a `NodeResultOutput` of `kind: "ui"` (optionally alongside other typed outputs).
3. Server validates `document` against the catalog. **Invalid → discard UI output, keep typed outputs**; if there were no typed outputs, synthesize one via `build-result-document` from whatever text/markdown is available.
4. Stored result already carries the (valid) document; web renders it.

### 5.2 Node action — produced by backend code

- `build-action-spec(fields, actions, state)` deterministically maps `PlanNodeField[]` + `PlanNodeAction[]` into a `Stack`/`Card` of shadcn inputs:
  - each `PlanNodeField` → `Input`/`Textarea`/`Select` with `name` (state path), `checks`/`validateOn` (from `required`/control), and `value`; `approval` control → `Select` with the approve/reject/needs-changes options;
  - the action selector (when `actions.length > 1`) → a `Select`;
  - a `Button` whose action binding is `dispatch-execution` or `submit-checkpoint` with the payload; submitted/readonly state → disabled inputs + an `Alert`.
- The existing helpers in `model/task-workspace-actions.ts` (`buildDefaultWorkspaceActionFields`, `getWorkspaceActionDisabledReason`, `buildWorkspaceCheckpointActionInput`, `pickDefaultWorkspaceAction`) feed this builder rather than being replaced.

### 5.3 Activity — produced by backend code

- `build-activity-spec(items)` maps `WorkspaceActivityItem[]` into a `Stack` of `ActivityRow` (tone, time, title, source-node, tool state) with optional `ToolDetails` / `CollapsibleText` children.
- The web merge step (`mergeWorkspaceActivity`, `runtimeEventsToWorkspaceActivity`) still runs first; for streamed runtime events the spec is rebuilt incrementally on the client (see §8).

---

## 6. Interaction & state binding (the hard part: Node action)

json-render is declarative but ships the interaction machinery the Node action form needs — we use it instead of re-introducing react-hook-form. Design:

- **State**: form values bind via `$bindState` (`name`/state path per field); `StateProvider` owns form state, seeded by `Spec.state`.
- **Validation**: shadcn `Input`/`Textarea`/`Select` carry `checks` + `validateOn`; `ValidationProvider` / `useFieldValidation` enforce them. The backend builder emits `checks` from each `PlanNodeField.required`/control, reproducing today's required markers and disabled-submit behavior — declaratively, no RHF.
- **Dispatch**: the submit `Button` binds a catalog action (`dispatch-execution` / `submit-checkpoint`). `ActionProvider` handlers (registered in `workspace-registry.tsx`) map the action name to the existing `onDispatchExecutionAction` / `onSubmitCheckpointAction` callbacks and surface the result in an `Alert`.
- **Read-only / submitted state**: encoded as disabled inputs + an `Alert`, mirroring `isReadOnlySubmittedInput` today.

> Net effect: Node action is rendered *and driven* through json-render (state + validation + actions from the library), wired to Chrona's existing dispatch callbacks — the execution kernel is untouched.

---

## 7. Validation, security & fallback

| Producer | Validation | On failure |
|---|---|---|
| AI (Node result) | **Mandatory server-side** `validateChronaSpec` before persist | discard UI output → typed output via `build-result-spec`; never render unvalidated AI UI |
| Backend (action/activity) | Build-time types + **builder unit tests**; optional runtime `validateChronaSpec` behind `UI_PROTOCOL_VALIDATE_RUNTIME` flag | log + fall back to typed renderer |
| Renderer | catalog-version + presence check | `fallback` render prop (existing typed component) |

`validateChronaSpec` is **strict on types but lenient on presence**: it validates each element's props against the catalog Zod via `.partial()` (so omitting an optional/nullable prop is fine, but a present prop of the wrong type is rejected — `catalog.validate()` alone is intentionally streaming-lenient), then runs core `validateSpec` for structure (root/children resolve, no orphans).

Security note: because the renderer only instantiates catalog components and never evaluates strings as code or props-as-HTML, AI-authored specs cannot inject arbitrary UI — the guarantee json-render is built around.

---

## 8. Streaming

- **AI result**: use the library's `createSpecStreamCompiler` / `useUIStream`; the `kind: "ui"` spec streams as JSONL patches and renders incrementally as the run produces it, over the existing runtime-event channel.
- **Activity**: runtime events already stream into the feed. On each batch, the client merges (existing logic) then re-runs `build-activity-spec`. Builder must be cheap/pure (it is) so re-running per batch is fine; memoize on the merged item list.

---

## 9. Rollout — phased, fallback-first

Each phase is independently shippable and leaves a working fallback.

- **Phase 0 — Foundations** ✅ **DONE**: `@chrona/ui-protocol` built on `@json-render/core` + `@json-render/shadcn/catalog` — `chronaSchema`, `chronaCatalog` (shadcn primitives + Chrona-custom), `validateChronaSpec`, action names/params, `CATALOG_VERSION`. *Exit: package builds, validation tests pass.* — Verified: `bun test packages/ui-protocol/` 7/7 pass, repo `tsc --noEmit` 0 errors. (See progress log for the mid-phase pivot to the real library.)
- **Phase 1 — Activity (backend-produced, lowest risk, no AI)** ✅ **DONE**
  - **1a** ✅ `build-activity-spec` (`WorkspaceItem[] → Spec`, tool-labels injected for i18n) + golden tests that assert catalog-validity. Verified: 11/11 bun tests, tsc 0.
  - **1b** ✅ `workspace-registry.tsx` (`defineRegistry`: shadcn primitives + Chrona domain renderers) + `spec-renderer.tsx` (`JSONUIProvider` + `Renderer` + version gate + fallback); `WorkspaceActivityFeed` renders via `SpecRenderer` behind an opt-in `renderWithSpec` flag with the legacy list as fallback. Verified: 6/6 web tests (incl. full spec-path render), tsc 0, no regression on flag-off.
- **Phase 2 — Node result (AI-produced)** ✅ **DONE**: `kind:"ui"` added to contract (`Spec` from `@chrona/ui-protocol`); `buildResultSpec` builder (typed outputs → Spec, 6 golden tests); engine prompt injection (`chronaCatalog.prompt()` + `CATALOG_VERSION` hint for task nodes) + `sanitizeNodeOutputs` (validates AI `kind:"ui"` specs server-side, discards invalid, never persists unvalidated); `ResultTab` renders via `SpecRenderer` when a valid `kind:"ui"` output is present, typed `ResultOutputCard` path as fallback. Verified: 17/17 bun tests, 19/19 web tests (13 panel + 6 activity), tsc 0.
- **Phase 3 — Node action (backend-produced, highest interaction risk)** ✅ **DONE**: `buildActionSpec` builder (fields → `Input`/`Textarea`/`Select`/approval `Select`; multi-checkpoint action selector; `dispatch-execution` and `submit-checkpoint` button bindings; readonly/submitted state; `disabledReason` Alert + disabled button); `spec-renderer.tsx` updated to accept per-render `handlers` forwarded to `JSONUIProvider`; `ActionTab` in panel wires real callbacks and renders via `SpecRenderer` behind `renderActionWithSpec` prop (default false → legacy `WorkspaceNodeActionControls`). Key quirks encoded: `Text` uses `props.text`; readonly fields use `$bindState` + state seed (shadcn ignores static `value` without binding); `$bindState` specs skip `validateChronaSpec` (intentional). Verified: 24/24 bun tests (ui-protocol), 17/17 vitest panel tests (incl. 4 spec-path action tests: approval submit-checkpoint, free-form submit-checkpoint, dispatch-execution, readonly/submitted), tsc 0 errors.
- **Phase 4 — Cleanup**: remove flags once each panel is verified; keep typed renderers only as the documented fallback path; update docs.
  - **Pre-ship gate for `renderActionWithSpec`** ✅ **RESOLVED**: json-render's `ValidationProvider` does NOT block dispatch (Button emits press directly); gate was implemented by tracking required-field emptiness in `ActionTab` via local state + `onStateChange` from `JSONUIProvider`. `buildActionSpec` accepts `disabledButton?: boolean` (disables submit without Alert). `ActionTab` initialises `requiredFieldValues` from fields, resets on field change via `useEffect`, and updates via `handleStateChange` callback wired to `SpecRenderer`. `SpecRenderer` now forwards `onStateChange` to `JSONUIProvider`. Spec-path test added: "disables the submit button when required fields are empty and re-enables once filled". Button is dynamically re-enabled when the user fills all required fields.

Feature flags (e.g. `UI_PROTOCOL_RESULT`, `UI_PROTOCOL_ACTION`, `UI_PROTOCOL_ACTIVITY`) gate each panel so rollout/rollback is per-panel.

---

## 10. Testing strategy

- **Builder golden tests** (`ui-protocol`): typed input fixtures → expected `UiDocument` (snapshot). Cover every `NodeResultOutput.kind`, every `PlanNodeField.control`, every `WorkspaceActivityKind`/tone.
- **Catalog validation tests**: valid docs pass; malformed props / unknown component / unknown action / version mismatch fail.
- **AI fallback tests** (engine): invalid AI document → discarded → typed fallback persisted.
- **Renderer tests** (web): each catalog component renders; `UiDocumentRenderer` falls back on null/invalid/version-mismatch.
- **Interaction tests** (web): form required validation, disabled-submit reason, `dispatch-execution` and `submit-checkpoint` actions call the right callbacks, readonly/submitted rendering.
- **Migration parity**: the existing `task-workspace-node-detail-panel.test.tsx`, `workspace-activity-feed.test.tsx` are updated to assert equivalent behavior through the spec path.

---

## 11. Touched / new files (index)

**New** — `packages/ui-protocol/**` (schema, catalog, document, actions, builders). *(Phase 0 done; builders land in Phases 1–3.)*
**New** — `apps/web/.../workspace/catalog/{workspace-registry,spec-renderer}.tsx`.
**Modified — contracts**: `plan-runtime/node-result.ts` (add `kind: "ui"` carrying `Spec`), `api/tasks.schema.ts`, `api/execution.schema.ts` (carry specs).
**Modified — engine**: `modules/pages/work-page/get-work-page.ts`, execution-graph selectors (attach specs), `modules/plan-execution/node-ai-capabilities.ts`, `node-runtime-prompts.ts` (`catalog.prompt()`/`jsonSchema()` injection), AI result ingestion (validate + fallback).
**Modified — web**: `execution/task-workspace-node-detail-panel.tsx`, `execution/workspace-activity-feed.tsx`; `model/task-workspace-activity.ts` + `model/task-workspace-actions.ts` become builder upstreams.

---

## 12. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Lost compile-time union safety at the spec boundary | `validateChronaSpec` (mandatory for AI) + builder golden tests + Zod-inferred TS types |
| AI emits non-conforming UI JSON (common) | Server validation + guaranteed typed fallback from day one; flag-gated rollout |
| Node action interaction regressions (validation, dispatch, checkpoint) | Library state/validation/action providers wired to existing callbacks; Phase 3 last; full interaction test suite |
| Pre-1.0 dependency churn (`@json-render/*` 0.19.0) | Isolated behind `@chrona/ui-protocol` (catalog/validate) + web `spec-renderer.tsx`; pinned minor; typed-renderer fallback always present |
| Catalog drift between AI, backend, renderer | Single `@chrona/ui-protocol` source + `catalogVersion` gating |
| Streaming re-build cost for activity | Pure, memoized builder per merged batch |
| Test churn across three panels | Phase-by-phase migration; parity tests added before deleting JSX |

---

## 13. Out of scope — a2ui

a2ui solves a different problem: transmitting agent-authored UI **across trust boundaries and frameworks** (Angular/Flutter/React/native) via a streaming protocol and adjacency model. Chrona renders inside a single React app, so its transport/protocol layer is net cost with no benefit here. **Reconsider a2ui only if** Chrona later needs its agent to drive UI on non-web clients or external surfaces. The catalog/document concepts in this plan are compatible with a future a2ui adoption, so this is not a dead end.

---

## 14. Open decisions

- **D1 — `Spec` type home** ✅ *resolved*: `Spec` lives in `@json-render/core`, re-exported by `@chrona/ui-protocol`; `@chrona/contracts` depends on `@chrona/ui-protocol`. Confirm against `docs/package-boundaries.md` when wiring contracts in Phase 2.
- **D2 — Spec generation home for activity/action**: server-side in engine (wire already carries specs; web is render-only) vs. client-side in the web model layer. Plan assumes **server-side** for action/activity to honor "backend produces the JSON"; client only re-builds for streamed activity deltas.
- **D3 — Runtime validation for backend specs**: tests-only vs. flag-gated runtime. Plan: tests-only by default, `UI_PROTOCOL_VALIDATE_RUNTIME` for staging.
- **D4 — Catalog component granularity** for Activity/Result: how much layout the spec controls vs. fixed wrappers. Start coarse (panel wrapper fixed, rows/cards in spec), refine later.
- **D5 — shadcn renderers vs. Chrona's own `components/ui`**: Phase 1+ uses `@json-render/shadcn`'s React components (they theme via Chrona's shared Tailwind CSS variables). If visual drift appears for a component, bind that catalog name to Chrona's own `components/ui` renderer in `workspace-registry.tsx` instead.

---

## 16. Progress log

- **2026-06-05 — Phase 0 (initial scaffold).** Created `@chrona/ui-protocol` with a hand-rolled `UiDocument` + `validateDocument` + catalog. Tests 8/8.
- **2026-06-05 — Phase 0 pivot: adopt the json-render framework.** Inspecting `@json-render/core@0.19.0` revealed it already provides catalog (`defineSchema`/`defineCatalog`), `Spec`, `validateSpec`, prompt/JSON-Schema export, state binding, form validation, actions, and streaming — i.e. the hand-rolled layer was a near-duplicate. Per user decision, reworked `ui-protocol` to wrap the library: `chronaSchema` (mirrors the prebuilt React schema), `chronaCatalog` via `defineCatalog`, `validateChronaSpec` (catalog props + core `validateSpec`), `Spec`/`ChronaSpec`/`UiDocument` re-exports. Dependency boundary: `@json-render/core` in `ui-protocol` (shared), `@json-render/react` in `apps/web`.
- **2026-06-05 — Phase 4 (flag graduation + cleanup, partial).** Feature flag: `renderActionWithSpec` prop default changed from `false` to `import.meta.env.VITE_UI_PROTOCOL_ACTION === "true"` — production call site in `task-workspace-plan-section.tsx` does not pass the prop, so the env var controls rollout; tests still pass `renderActionWithSpec={true}` to force spec path. `ActionTab` extracted from `task-workspace-node-detail-panel.tsx` (956 → 827 lines) into `action-tab.tsx` (148 lines); circular import avoided by passing `legacyFallback: ReactNode` as a prop (parent constructs `<WorkspaceNodeActionControls>`) instead of importing it inside the tab. `buildActionSpec`/`ActionItemInput` and `actionKindForNode` imports removed from panel; `useCallback` removed from panel React import. Verified: `bunx vitest run ...panel.test.tsx` 18/18, `tsc --noEmit` 0 errors. **Remaining P1**: visual QA (enable `VITE_UI_PROTOCOL_ACTION=true` locally, verify all variants), full flag graduation (remove legacy `WorkspaceNodeActionControls` path), server-side vs client-side `buildActionSpec` decision.

- **2026-06-05 — Phase 4 pre-ship gate (required-field submit gate).** Discovered that json-render's `ValidationProvider` does not block button dispatch — `Button` emits press directly. Implemented submit gate by: (1) adding `disabledButton?: boolean` to `buildActionSpec` / `ActionSpecInput` (disables submit without an Alert, unlike `disabledReason`); (2) adding `onStateChange` prop to `SpecRenderer`, forwarded to `JSONUIProvider`; (3) `ActionTab` tracks `requiredFieldValues` in local state (init from fields, reset via `useEffect` on field change, updated via `handleStateChange` using `onStateChange` changes array); computes `hasEmptyRequired`; passes `disabledButton: !isReadOnly && hasEmptyRequired` to `buildActionSpec`. Spec-path test added: verifies button disabled initially, handler not called on click, button re-enables after required field filled. Existing approval spec-path test updated: adds `await waitFor(button enabled)` after option selection (button now correctly starts disabled until selection). Verified: `bun test packages/ui-protocol/` 25/25, `bunx vitest run ...panel.test.tsx` 18/18, `tsc --noEmit` 0 errors. **P0 pre-ship gate complete.**

- **2026-06-05 — Phase 3 (Node action, backend-produced).** Added `buildActionSpec(ActionSpecInput): UiDocument` in `ui-protocol/builders`: maps `ActionFieldInput[]` to `Input`/`Textarea`/`Select` elements (approval control = `Select` with default options); seeds `spec.state` from field values; readonly path uses `$bindState` + seeded state (shadcn Input/Select ignore static `props.value` when unbound); multi-checkpoint path adds action-selector `Select` seeded to primary action; submit `Button` binds `dispatch-execution` (execution actions) or `submit-checkpoint` (checkpoint actions) via `on.press`; `disabledReason` adds a warning `Alert` and disables the button. `SpecRenderer` updated to accept per-render `handlers` forwarded to `JSONUIProvider`. `ActionTab` component added to `task-workspace-node-detail-panel.tsx`: synthesizes default checkpoint action for field-only nodes (mirrors legacy null-selectedAction path); wires `dispatch-execution` → `onDispatchExecutionAction` and `submit-checkpoint` → `buildWorkspaceCheckpointActionInput` + `onSubmitCheckpointAction`; passes `disabledActionReason` as `disabledReason` to spec; renders via `SpecRenderer` behind `renderActionWithSpec` prop (default false). Note: `__checkpointAction` in resolved state never leaks into `inputFields` because `buildWorkspaceInputFields` iterates `fields[]` not `values`. Note: `$bindState`-containing action specs intentionally skip `validateChronaSpec` (catalog Zod schema is `string`, not binding-aware). Verified: `bun test packages/ui-protocol/` 24/24, `bunx vitest run ...panel.test.tsx` 17/17 (incl. 4 new spec-path action tests), `tsc --noEmit` 0 errors. **Phase 3 complete.**
- **2026-06-05 — Phase 2 (Node result, AI-produced).** Extended `NodeResultOutput` union with `| { kind:"ui"; spec: Spec; catalogVersion: string; title?: string }` in `packages/contracts` (imports `Spec` from `@chrona/ui-protocol`; contracts now depends on ui-protocol; ui-protocol's unused contracts dep removed). Added `buildResultSpec(outputs)` builder in `ui-protocol/builders` (maps markdown/json/file/link → Markdown/JsonView/FileRef/Link catalog elements; 6 golden tests, all pass `validateChronaSpec`). Engine: added `@chrona/ui-protocol` dep; `node-runtime-prompts.ts` injects `chronaCatalog.prompt({ mode:"generate" })` + `CATALOG_VERSION` hint into task-node instructions so the model can emit `kind:"ui"` outputs; `submit-terminal-node-result.ts` `submitNodeOutput` runs `sanitizeNodeOutputs` on AI-submitted outputs — validates each `kind:"ui"` via `validateChronaSpec` + `isCatalogCompatible`, discards invalid/incompatible specs with a console.warn, never persists an unvalidated AI spec. Web: `ResultOutputCard` handles `kind:"ui"` (returns null; spec path is upstream); `stringifyResultOutput` handles `kind:"ui"` (title or empty string); `ResultTab` extracts the `kind:"ui"` output, renders via `SpecRenderer` when present, and keeps the full typed-output render as the `fallback` prop. Added 2 new panel tests (spec path renders Markdown content; incompatible catalogVersion falls back to typed rendering). Verified: `bun test packages/ui-protocol/` 17/17, `bunx vitest run` panel 13/13 + activity feed 6/6, `tsc --noEmit` 0 errors. **Phase 2 complete.**

- **2026-06-05 — Phase 1b: activity rendered through json-render.** Added `apps/web/.../workspace/catalog/workspace-registry.tsx` (`defineRegistry(chronaCatalog, …)`: 14 shadcn primitives via `shadcnComponents` + 7 Chrona domain renderers; action handlers throw until Phase 3 since activity/result specs emit none) and `spec-renderer.tsx` (`JSONUIProvider` + `Renderer` + `isCatalogCompatible` gate + typed fallback). Wired `WorkspaceActivityFeed` to render via `SpecRenderer` behind an opt-in `renderWithSpec` flag (default off → zero behavior change; legacy list is the fallback). Discovered `Renderer` needs the provider stack → wrapped in `JSONUIProvider`. Verified: 6/6 web tests (added a full spec-path test asserting title/summary/source-node badge/tool-state/time/tool-detail row all render), tsc 0. **Phase 1 complete.**
- **2026-06-05 — Phase 1a: activity builder.** Added `buildActivitySpec(items, toolLabels)` in `ui-protocol/builders` (`WorkspaceActivityItem`-shaped input declared structurally to stay React-free; tool-detail labels injected by the caller for i18n). Golden tests assert field mapping, `HH:MM` time derivation, conditional `ToolDetails` child, assistant-vs-summary text, and that output passes `validateChronaSpec`. Verified: 11/11 bun tests, tsc 0. Web decision: standard primitives render with `@json-render/shadcn`'s own components (they inherit Chrona's Tailwind CSS-variable theme); domain components bind to Chrona renderers.
- **2026-06-05 — Phase 0: adopt `@json-render/shadcn`.** Reused the server-safe `@json-render/shadcn/catalog` `shadcnComponentDefinitions` (36 components, verified to load in plain Node) for standard primitives (`Card`/`Stack`/`Text`/`Badge`/`Alert`/`Input`/`Textarea`/`Select`/`Button`/`Link`/`Tabs`/`Table`/…); kept only Chrona-custom domain components (`Markdown`, `JsonView`, `FileRef`, `ResultSummary`, `ActivityRow`, `ToolDetails`, `CollapsibleText`). Tightened `validateChronaSpec` to presence-lenient/type-strict (`.partial()`) so shadcn's `.nullable()` props validate correctly. Added `@json-render/shadcn` to `ui-protocol` (`/catalog`) and `apps/web` (React). **Verified: `bun test packages/ui-protocol/` 7/7 pass; repo `tsc --noEmit` 0 errors.**

---

## 15. Success criteria

1. All three panels render through `SpecRenderer` + the shared `chronaCatalog`.
2. Node result specs are AI-produced and server-validated; Node action and Activity specs are backend-produced.
3. No regression in Node action interaction (validation, execution dispatch, checkpoint submit, readonly/submitted states).
4. Every panel degrades to its typed renderer on invalid/missing spec.
5. Builders, catalog validation, and interaction paths are covered by tests; existing panel tests pass through the spec path.
