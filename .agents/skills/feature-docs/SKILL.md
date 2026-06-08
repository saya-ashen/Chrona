---
name: feature-docs
description: "Build, install, and maintain Chrona's repository-local Markdown Feature Docs system. Use this whenever the user mentions feature docs, .feature.md files, feature documentation beside source files, generated marker blocks, ai marker blocks, docs/maps/feature-docs files, or wants tooling/rules/scripts for human-maintained feature documentation. This skill includes bundled scripts, rules, references, and eval prompts; prefer the bundled resources instead of inventing a parallel workflow."
triggers:
  - feature docs
  - feature-docs
  - .feature.md
  - feature documentation
  - docs maps
argument-hint: "[--path <source-area>] [scaffold|sync|check|index]"
---

# Feature Docs

Repository-local skill for Chrona Feature Docs: Markdown-first documentation
beside important source files, with YAML front matter for metadata and stable
marker blocks for script/AI updates.

## Bundled resources

Use progressive disclosure. Read or copy only what task needs.

| Resource                             | Use when                                                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `scripts/feature-docs.ts`            | Installing or repairing CLI entrypoint. Copy to repo `scripts/feature-docs.ts` if missing/stale.           |
| `scripts/lib/feature-docs/`          | Installing or repairing parser/scanner/test-map/rules libraries. Copy to repo `scripts/lib/feature-docs/`. |
| `references/feature-docs.rules.yaml` | Recreating/resetting rules file at `docs/maps/feature-docs.rules.yaml`.                                    |
| `references/legacy-ai-prompt.md`     | Back-compatible AI-facing prompt text for `docs/maps/feature-docs.skill.md` if project docs need it.       |
| `evals/evals.json`                   | Suggested prompts for testing skill behavior.                                                              |

## Expected repository layout

```text
.agents/skills/feature-docs/
├── SKILL.md
├── scripts/
│   ├── feature-docs.ts
│   └── lib/feature-docs/
│       ├── markdown.ts
│       ├── rules.ts
│       ├── source-scan.ts
│       ├── test-map-adapter.ts
│       └── types.ts
├── references/
│   ├── feature-docs.rules.yaml
│   └── legacy-ai-prompt.md
└── evals/
    └── evals.json
```

Installed project files:

```text
scripts/feature-docs.ts
scripts/lib/feature-docs/*.ts
docs/maps/feature-docs.rules.yaml
docs/maps/feature-docs.skill.md
docs/maps/feature-docs.index.md
<source-dir>/*.feature.md
```

Package scripts expected in `package.json`:

```json
{
  "feature-docs:select": "bun run scripts/feature-docs.ts select",
  "feature-docs:scaffold": "bun run scripts/feature-docs.ts scaffold",
  "feature-docs:sync": "bun run scripts/feature-docs.ts sync",
  "feature-docs:check": "bun run scripts/feature-docs.ts check",
  "feature-docs:index": "bun run scripts/feature-docs.ts index"
}
```

## Install or repair workflow

Use this when repo lacks the tooling or user says the skill should include
scripts/structure.

1. Ensure directories exist:
   ```bash
   mkdir -p scripts/lib/feature-docs docs/maps
   ```
2. Copy bundled script resources into repo:
   - `.agents/skills/feature-docs/scripts/feature-docs.ts` →
     `scripts/feature-docs.ts`
   - `.agents/skills/feature-docs/scripts/lib/feature-docs/*` →
     `scripts/lib/feature-docs/`
3. Copy bundled rules if missing or user wants reset:
   - `.agents/skills/feature-docs/references/feature-docs.rules.yaml` →
     `docs/maps/feature-docs.rules.yaml`
4. Copy/update prompt doc if requested:
   - `.agents/skills/feature-docs/references/legacy-ai-prompt.md` →
     `docs/maps/feature-docs.skill.md`
5. AI selection is default-on conservative behavior:
   `docs/maps/feature-docs.rules.yaml` should contain
   `selection.mode: "explicit"`. Empty `selection.files` means no files are
   documented. To add docs, run:
   ```bash
   bun run feature-docs:select --path <source-area>
   ```
   Review printed candidate YAML, keep only files/symbols worth documenting,
   then write that allowlist into `selection.files`.
6. Add package scripts above if missing.
7. Run:
   ```bash
   bun run typecheck
   bun run feature-docs:select --path packages/engine/src/modules/tasks
   bun run feature-docs:scaffold --path packages/engine/src/modules/tasks
   bun run feature-docs:sync --path packages/engine/src/modules/tasks
   bun run feature-docs:index
   bun run feature-docs:check --path packages/engine/src/modules/tasks
   ```

## Normal maintenance workflow

Default to scoped path. Do not scaffold whole repo unless user explicitly asks.

```bash
bun run feature-docs:select --path <source-area>
# AI/human reviews output and writes chosen entries to docs/maps/feature-docs.rules.yaml selection.files.
bun run feature-docs:scaffold --path <source-area>
bun run feature-docs:sync --path <source-area>
bun run feature-docs:index
bun run feature-docs:check --path <source-area>
```

Pilot path:

```bash
packages/engine/src/modules/tasks
```

`feature-docs:check` without `--path` validates existing feature docs and global
index. With `--path`, it also fails if describable source files in that area
lack docs.

## AI selection protocol

Default policy: no file enters Feature Docs just because it scores highly.
`selection.mode: "explicit"` means scripts only document entries in
`selection.files`.

When user asks to add an area:

1. Run candidate scan:
   ```bash
   bun run feature-docs:select --path <source-area>
   ```
2. Read candidate source files if needed to judge importance.
3. Edit `docs/maps/feature-docs.rules.yaml` and add only chosen files/symbols
   under `selection.files`.
4. Run scaffold/sync/index/check.

Use `selection.mode: "score"` only for temporary exploration or explicit
whole-repo experiments. Do not commit broad score mode unless user asked for
automatic scoring behavior.

If command files are available, use `/feature-docs.select <source-area>` for
this whole workflow. Command definition lives at
`.opencode/command/feature-docs.select.md`.

## Markdown contract

Each `.feature.md` uses short YAML front matter. Keep machine metadata small;
put semantic judgment in the AI block, not YAML.

```md
---
feature_doc_version: 1
scope: "file"
source: "create-task.ts"
owner_feature: "Task Management"
owner_capability: "Create Task"
layer: "engine"
status: "active"
sync:
  mode: "scaffold-and-check"
  source_hash: ""
  last_scanned_commit: ""
symbols:
  - id: "createTask"
    source_name: "createTask"
    kind: "function"
    describe: true
---
```

Marker forms:

```md
<!-- ai:start -->
<!-- ai:end -->

<!-- generated:name:start -->
<!-- generated:name:end -->

<!-- generated:name:start symbolId -->
<!-- generated:name:end symbolId -->

<!-- symbol:symbolId:start -->
<!-- symbol:symbolId:end -->
```

Ownership:

- `ai`: human/AI-owned prose. One free-form block per file and one free-form
  block per documented symbol. Script may create TODO blocks but must not
  overwrite non-TODO content.
- `generated:*`: script-owned objective facts. Never hand edit; run sync.
- `symbol:*`: wrapper for one source symbol. Keep prior prose if a symbol moves
  or becomes stale; do not auto-delete human explanation.
- YAML: script-owned machine metadata. Keep it short; do not store reasons,
  per-symbol status, coverage assessments, or long explanations there.

## Filling AI blocks

1. Run sync first.
2. Open docs whose `<!-- ai:start -->` blocks contain TODO text or need review.
3. Read source file named by `source`.
4. Read direct tests listed in generated test blocks before claiming coverage.
5. Fill only `<!-- ai:start -->` / `<!-- ai:end -->` blocks. AI may choose
   headings such as Role, Behavior, Inputs/outputs, Invariants, and Coverage;
   the scaffold does not pre-split these sections.
6. Do not invent coverage. Direct/transitive refs are structural facts, not
   behavior proof.
7. Run check.

Coverage language:

- `good`: direct behavior tests cover main success/failure paths.
- `partial`: meaningful behavior covered, gaps remain.
- `weak`: structural coverage or thin assertions.
- `none`: no direct behavior coverage.
- `unknown`: not inspected.

## Rules and scoring

Rules live at `docs/maps/feature-docs.rules.yaml`; bundled default is
`references/feature-docs.rules.yaml`.

V1 favors exported high-impact code:

- route handlers
- engine use cases
- database writers
- event emitters
- projection rebuilders
- provider boundaries
- graph transitions
- public components

V1 avoids docs for tests, barrels, generated/dist/node_modules,
type/interface-only definitions, and small private helpers.

## Example completed section

```md
<!-- symbol:createTask:start -->

### `createTask`

<!-- ai:start -->
Role: creates one task inside a workspace and records event/activity facts needed
by task projections.

Behavior: validates input, persists the task, records creation activity, and
returns the created task model. Failure before persistence leaves no partial task
row.

Inputs/outputs: input is a workspace-scoped create-task command. Output is the
created task DTO. Validation and persistence errors propagate from underlying
layers.

Invariants:
- Task belongs to requested workspace.
- Returned task id matches emitted activity/event facts.
- No plan is created unless caller requested or default behavior requires it.

Coverage: partial. Direct test covers the no-auto-plan branch. Missing direct
assertions for validation failures and event/activity consistency.
<!-- ai:end -->

<!-- generated:tests:start createTask -->
Direct tests:
- packages/engine/src/modules/tasks/create-task-no-auto-plan.bun.test.ts

Transitive tests:
- None found
<!-- generated:tests:end createTask -->

<!-- symbol:createTask:end -->
```

## Testing this skill

Use bundled eval prompts in `evals/evals.json` when improving this skill.
Practical checks for Chrona:

```bash
bun run feature-docs:scaffold --path packages/engine/src/modules/tasks
bun run feature-docs:sync --path packages/engine/src/modules/tasks
bun run feature-docs:index
bun run feature-docs:check --path packages/engine/src/modules/tasks
bun run typecheck
```

Acceptance signs:

- scaffold repeat shows `changed=0 created=0`.
- sync repeat shows `changed=0`.
- index repeat says `fresh`.
- check catches stale generated symbol/test blocks and stale source hashes.
- non-TODO `<!-- ai:start -->` prose remains unchanged after sync.
