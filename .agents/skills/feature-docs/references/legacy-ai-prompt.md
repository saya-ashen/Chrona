# Feature Docs Skill

Use this skill when creating or maintaining `*.feature.md` docs beside Chrona source files.

## Selection workflow

1. Default policy: nothing is documented automatically. `docs/maps/feature-docs.rules.yaml` uses `selection.mode: "explicit"`; only files/symbols listed in `selection.files` are eligible for scaffold/sync/check.
2. To add an area, run:
   ```bash
   bun run feature-docs:select --path <source-area>
   ```
3. Review candidate YAML, read source where needed, then write only chosen files/symbols into `selection.files`.
4. Do not switch to broad score mode unless the user explicitly wants automatic scoring behavior.

## Fill workflow

1. Run `bun run feature-docs:sync --path <area>` before editing docs.
2. Open docs whose `<!-- ai:start -->` blocks contain TODO text or need review.
3. Read source file named by `source` front matter.
4. Read tests listed in each `generated:tests` block before claiming coverage.
5. Edit only `<!-- ai:start -->` / `<!-- ai:end -->` blocks.
6. AI prose is free-form. Suggested headings: Role, Behavior, Inputs/outputs, Invariants, Coverage.
7. Do not edit `generated:*` blocks. Regenerate them with `bun run feature-docs:sync`.
8. Do not invent behavior coverage. Import/reference facts are structural references, not proof of asserted behavior.
9. Run `bun run feature-docs:check --path <area>` after edits.

## Ownership

- `ai` blocks: AI/human reviewers own semantic explanation and coverage judgment.
- `generated:*` blocks: scripts own objective facts, symbol inventory, test references.
- `symbol:<id>` blocks: wrapper for one source symbol. Do not delete prior prose just because a symbol moved.
- YAML front matter: scripts own short machine metadata. Do not store reasons, per-symbol status, or coverage prose there.

## Coverage language

Separate facts from judgment.

- Structural fact: `create-task.bun.test.ts` imports `createTask`.
- Behavior judgment: direct tests assert duplicate task titles are rejected.

Never convert structural facts into behavior claims without reading assertions.

Coverage words inside AI prose:

- `good`: direct behavior tests cover main success and failure paths.
- `partial`: some key behavior tested, meaningful gaps remain.
- `weak`: structural/import tests exist, behavior assertions thin.
- `none`: no direct behavior coverage found.
- `unknown`: not inspected yet.

## Example completed function section

```md
<!-- symbol:createTask:start -->

### `createTask`

<!-- ai:start -->
Role: creates one task inside a workspace and records the event trail needed by task projections.

Behavior: validates caller input, writes the task row, emits creation activity, and returns the created task model. Failure before persistence leaves no partial task state.

Inputs/outputs: input is a workspace-scoped create-task command. Output is created task DTO. Throws validation or persistence errors from underlying engine/db layers.

Invariants:
- Task belongs to requested workspace.
- Created task has stable id before events reference it.
- Activity/event facts describe the same task id returned to caller.

Coverage: partial. Direct test covers no-auto-plan branch. Missing direct assertions for validation failures and event/activity consistency.
<!-- ai:end -->

<!-- generated:tests:start createTask -->
Direct tests:
- packages/engine/src/modules/tasks/create-task-no-auto-plan.bun.test.ts

Transitive tests:
- None found
<!-- generated:tests:end createTask -->

<!-- symbol:createTask:end -->
```
