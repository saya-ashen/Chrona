# Packages Hono Clean-Slate Rewrite Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Rewrite the entire `packages/` workspace as a clean-slate architecture centered on a Hono-based OpenClaw bridge, with no legacy package-interface compatibility inside `packages/`, and update app callers to the new package contracts.

**Architecture:** Keep the existing workspace package names so repo wiring remains simple, but replace their internals and exported surfaces with a new layered design: `runtime-core` for pure contracts, `openclaw-integration` for bridge/runtime/provider clients, `ai-features` for feature orchestration, `openclaw-bridge` for Hono HTTP routes + parsing/services, and `cli` as a thin client to the app API. The bridge becomes an explicit REST service with Hono route groups, zod schemas, typed service results, and isolated parser/process/logging modules.

**Tech Stack:** Bun, TypeScript, Hono, Zod, Vitest, Next.js app consumers, Prisma-backed app layer.

---

### Task 1: Document the target package map

**Objective:** Freeze the new package/module boundaries before code changes.

**Files:**
- Create: `docs/architecture/packages-clean-slate-rewrite.md`

**Step 1: Write the architecture document**
- Package purposes:
  - `packages/common/runtime-core`
  - `packages/common/ai-features`
  - `packages/common/cli`
  - `packages/providers/openclaw/integration`
  - `packages/providers/openclaw/bridge`
  - `packages/providers/openclaw/plugin-structured-result`
- For each package, define public exports and internal subfolders.
- Explicitly state that `bridge` owns HTTP contracts and `integration` owns provider/runtime contracts.

**Step 2: Verify**
- Read the document back and make sure every current caller category has a destination package.

### Task 2: Add Hono dependency and bridge package layout

**Objective:** Prepare the workspace for the new server implementation.

**Files:**
- Modify: `package.json`
- Modify: `tsconfig.json`
- Create: `packages/providers/openclaw/bridge/src/index.ts`
- Create: `packages/providers/openclaw/bridge/src/app.ts`
- Create: `packages/providers/openclaw/bridge/src/http/*`
- Create: `packages/providers/openclaw/bridge/src/features/*`
- Create: `packages/providers/openclaw/bridge/src/execution/*`
- Create: `packages/providers/openclaw/bridge/src/parse/*`
- Create: `packages/providers/openclaw/bridge/src/logging/*`
- Create: `packages/providers/openclaw/bridge/src/shared/*`

**Step 1: Write failing tests for the new bridge app shape**
- Health route responds through Hono app
- Explicit feature routes exist
- Execution route exists
- SSE endpoints emit done/error semantics

**Step 2: Implement the Hono bridge app**
- Export `createBridgeApp`, `startBridgeServer`
- Keep server startup in `index.ts`; keep app composition in `app.ts`
- Move route config, request parsing, OpenClaw execution, response shaping, and logging into separate modules

**Step 3: Run bridge tests**
- Target: `bun test packages/providers/openclaw/bridge/src`

### Task 3: Rewrite openclaw-integration around the new bridge contracts

**Objective:** Replace the old mixed transport/runtime contract set with a clearer provider integration package.

**Files:**
- Rewrite: `packages/providers/openclaw/integration/src/index.ts`
- Rewrite: `packages/providers/openclaw/integration/src/bridge/*`
- Rewrite: `packages/providers/openclaw/integration/src/runtime/*`
- Rewrite: `packages/providers/openclaw/integration/src/protocol/*`
- Rewrite: `packages/providers/openclaw/integration/src/config/*`
- Rewrite tests if needed

**Step 1: Define new protocol and bridge types**
- Explicit route-aligned request/response contracts
- Runtime snapshot/history/approval/session types
- Structured feature result types driven by business tools

**Step 2: Implement bridge HTTP client + runtime adapter**
- `OpenClawBridgeClient`
- `createRuntimeAdapter`
- `createMockOpenClawAdapter`
- `OpenClawOrchestrator`

**Step 3: Update scripts and app callers to new import paths/types**
- `scripts/openclaw/probe.ts`
- runtime execution modules in `src/modules/**`

### Task 4: Rewrite ai-features as a typed feature orchestration layer

**Objective:** Make `@chrona/ai-features` a clean client-agnostic feature package with clear feature APIs.

**Files:**
- Rewrite: `packages/common/ai-features/src/index.ts`
- Rewrite: `packages/common/ai-features/src/types.ts`
- Rewrite: `packages/common/ai-features/src/prompts.ts`
- Rewrite: `packages/common/ai-features/src/providers/*`
- Rewrite: `packages/common/ai-features/src/features/*`
- Rewrite: `packages/common/ai-features/src/streaming/*`

**Step 1: Flatten and simplify public exports**
- Avoid deep `core/*` public dependence where possible
- Expose feature request/response types from a small set of top-level modules

**Step 2: Implement provider runners**
- OpenClaw provider via `@chrona/openclaw-integration`
- LLM provider via plain fetch

**Step 3: Update app consumers**
- `src/modules/ai/ai-service.ts`
- `src/app/api/ai/*`
- command modules relying on dispatch types

### Task 5: Rewrite runtime-core as pure runtime contract utilities

**Objective:** Keep this package minimal and independent.

**Files:**
- Rewrite: `packages/common/runtime-core/src/index.ts`
- Rewrite: `packages/common/runtime-core/src/contracts.ts`
- Rewrite: `packages/common/runtime-core/src/config-spec.ts`

**Step 1: Preserve only pure runtime abstractions**
- Adapter definitions
- Runtime input/config spec helpers
- No OpenClaw-specific coupling

**Step 2: Update callers**
- `src/modules/task-execution/*`
- `src/modules/research-execution/*`
- `packages/providers/openclaw/integration/*`

### Task 6: Rewrite CLI package as a thin app-API client

**Objective:** Clean up package structure even if API semantics stay mostly the same.

**Files:**
- Rewrite: `packages/common/cli/src/index.ts`
- Rewrite: `packages/common/cli/src/client.ts`
- Rewrite: `packages/common/cli/src/commands/*`
- Rewrite: `packages/common/cli/src/output/*`

**Step 1: Keep CLI responsibilities narrow**
- Parse command-line flags
- Call app HTTP API
- Format output
- No embedded OpenClaw semantics

**Step 2: Verify CLI build/command parsing smoke tests if any**

### Task 7: Rewrite or re-home plugin package as explicit business-tool definitions

**Objective:** Keep the OpenClaw plugin package aligned with the new bridge parsing semantics.

**Files:**
- Rewrite: `packages/providers/openclaw/plugin-structured-result/src/index.ts`
- Update: `packages/providers/openclaw/plugin-structured-result/package.json`

**Step 1: Keep only business tools that the bridge depends on**
- `suggest_task_completions`
- `generate_task_plan_graph`
- `dispatch_next_task_action`

**Step 2: Keep deterministic fallback graph generation and normalized outputs**

### Task 8: Remove stale exports, paths, and old-structure assumptions

**Objective:** Complete the clean break.

**Files:**
- Modify: `tsconfig.json`
- Modify package `package.json` exports
- Update all app imports under `src/` and `scripts/`
- Update docs that point at obsolete bridge entry points

**Step 1: Search for stale subpath imports**
- `@chrona/ai-features/core/*`
- old bridge server paths
- old transport/protocol paths that no longer exist

**Step 2: Replace with new imports**

**Step 3: Verify with typecheck/search**
- `bunx tsc --noEmit --pretty false`
- targeted `search_files` for removed import patterns

### Task 9: Validate rewritten packages end-to-end

**Objective:** Prove the rewrite is coherent.

**Files:**
- Tests in rewritten packages
- app callers affected by packages

**Step 1: Targeted validation**
- `bun test packages/providers/openclaw/bridge/src`
- `bun test packages/providers/openclaw/plugin-structured-result/src`
- targeted tests for runtime sync / task lifecycle / AI stream routes if touched

**Step 2: Typecheck**
- `bunx tsc --noEmit --pretty false`

**Step 3: Smoke review**
- Confirm no remaining imports of removed package subpaths
- Confirm root scripts still point to a valid bridge entry file

### Task 10: Summarize architectural deltas and remaining risks

**Objective:** Leave a crisp engineering handoff.

**Files:**
- Update: `docs/architecture/packages-clean-slate-rewrite.md`

**Step 1: Document**
- New directory map
- Public package exports
- Deliberate non-compatibilities
- Validation status
- Known remaining app-level or environment-level risks
