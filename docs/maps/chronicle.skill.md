# Chronicle Skill

Use this skill when creating or maintaining `*.chron.md` docs beside Chrona source files.

## Selection workflow

1. Default policy: nothing is documented automatically. `docs/maps/chronicle.rules.yaml` uses `selection.mode: "explicit"`; only files/symbols listed in `selection.files` are eligible for scaffold/sync/check.
2. To add an area, run:
   ```bash
   bun run chronicle:select --path <source-area>
   ```
3. Review candidate YAML, read source where needed, then write only chosen files/symbols into `selection.files`.
4. Do not switch to broad score mode unless the user explicitly wants automatic scoring behavior.

## Fill workflow

1. Run `bun run chronicle:sync --path <area>` before editing docs.
2. Open docs whose front matter has symbol status `needs-ai-fill` or `needs-ai-review`.
3. Read source file named by `source` front matter.
4. Read tests listed in each `generated:tests` block.
5. Edit only `ai:*` blocks and front matter coverage/status fields that require human judgment.
6. Do not edit `generated:*` blocks. Regenerate them with `bun run chronicle:sync`.
7. Do not invent behavior coverage. Import/reference facts are structural references, not proof of asserted behavior.
8. Keep coverage status conservative:
   - `good`: direct behavior tests cover main success and failure paths.
   - `partial`: some key behavior tested, meaningful gaps remain.
   - `weak`: structural/import tests exist, behavior assertions thin.
   - `none`: no direct behavior coverage found.
   - `unknown`: not inspected yet.
9. Add missing test suggestions inside `ai:test-assessment` blocks.
10. Run `bun run chronicle:check --path <area>` after edits.

## Ownership

- `generated:*` blocks: scripts own objective facts, symbol inventory, test references.
- `ai:*` blocks: AI/human reviewers own semantic explanation and coverage judgment.
- `symbol:<id>` blocks: wrapper for one source symbol. Do not delete stale symbol sections; mark status `stale` in front matter and keep prior prose.
- YAML front matter: scripts update machine fields; humans may refine owner fields and coverage judgment.

## Coverage language

Separate facts from judgment.

- Structural fact: `create-task.bun.test.ts` imports `createTask`.
- Behavior judgment: direct tests assert duplicate task titles are rejected.

Never convert structural facts into behavior claims without reading assertions.

## Example completed function section

```md
<!-- symbol:createTask:start -->

### `createTask`

#### Role

<!-- ai:role:start createTask -->
Creates one task inside a workspace and records the event trail needed by task projections.
<!-- ai:role:end createTask -->

#### Behavior

<!-- ai:behavior:start createTask -->
Validates caller input, writes the task row, emits creation activity, and returns the created task model. Failure before persistence leaves no partial task state.
<!-- ai:behavior:end createTask -->

#### Inputs and outputs

<!-- ai:io:start createTask -->
Input is a workspace-scoped create-task command. Output is created task DTO. Throws validation or persistence errors from underlying engine/db layers.
<!-- ai:io:end createTask -->

#### Invariants

<!-- ai:invariants:start createTask -->
- Task belongs to requested workspace.
- Created task has stable id before events reference it.
- Activity/event facts describe the same task id returned to caller.
<!-- ai:invariants:end createTask -->

#### Test coverage

<!-- generated:tests:start createTask -->
Direct tests:
- packages/engine/src/modules/tasks/create-task-no-auto-plan.bun.test.ts

Transitive tests:
- None found
<!-- generated:tests:end createTask -->

<!-- ai:test-assessment:start createTask -->
Coverage status: Partial

Covered:
- Direct test covers no-auto-plan branch.

Missing or weak:
- Add direct assertions for validation failures and event/activity consistency.
<!-- ai:test-assessment:end createTask -->

<!-- symbol:createTask:end -->
```
