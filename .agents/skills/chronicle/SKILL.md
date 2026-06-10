---
name: chronicle
description: "Build, install, and maintain Chrona's Chronicle system: repository-local Markdown docs that live beside important source files, with YAML front matter for metadata and stable marker blocks split between script-generated facts and human/AI prose. Use this whenever the user mentions chronicle docs, .chron.md files, source-adjacent or per-symbol documentation, generated/ai marker blocks, docs/maps/chronicle files, or wants tooling/rules/scripts for maintaining these docs (formerly called \"feature docs\"). This skill includes bundled scripts, rules, references, and eval prompts; prefer the bundled resources instead of inventing a parallel workflow."
triggers:
  - chronicle
  - .chron.md
  - chronicle docs
  - source docs
  - feature docs
  - docs maps
argument-hint: "[--path <source-area>] [scaffold|sync|check|index]"
---

# Chronicle

Repository-local skill for Chrona Chronicle: Markdown-first documentation
beside important source files, with YAML front matter for metadata and stable
marker blocks for script/AI updates.

## Bundled resources

Use progressive disclosure. Read or copy only what task needs.

| Resource                             | Use when                                                                                                   |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------- |
| `scripts/chronicle.ts`            | Installing or repairing CLI entrypoint. Copy to repo `scripts/chronicle.ts` if missing/stale.           |
| `scripts/lib/chronicle/`          | Installing or repairing parser/scanner/test-map/rules libraries. Copy to repo `scripts/lib/chronicle/`. |
| `references/chronicle.rules.yaml` | Recreating/resetting rules file at `docs/maps/chronicle.rules.yaml`.                                    |
| `references/legacy-ai-prompt.md`     | Back-compatible AI-facing prompt text for `docs/maps/chronicle.skill.md` if project docs need it.       |
| `evals/evals.json`                   | Suggested prompts for testing skill behavior.                                                              |

## Expected repository layout

```text
.agents/skills/chronicle/
├── SKILL.md
├── scripts/
│   ├── chronicle.ts
│   └── lib/chronicle/
│       ├── markdown.ts
│       ├── rules.ts
│       ├── source-scan.ts
│       ├── test-map-adapter.ts
│       └── types.ts
├── references/
│   ├── chronicle.rules.yaml
│   └── legacy-ai-prompt.md
└── evals/
    └── evals.json
```

Installed project files:

```text
scripts/chronicle.ts
scripts/lib/chronicle/*.ts
docs/maps/chronicle.rules.yaml
docs/maps/chronicle.skill.md
docs/maps/chronicle.index.md
<source-dir>/*.chron.md
```

Package scripts expected in `package.json`:

```json
{
  "chronicle:select": "bun run scripts/chronicle.ts select",
  "chronicle:scaffold": "bun run scripts/chronicle.ts scaffold",
  "chronicle:sync": "bun run scripts/chronicle.ts sync",
  "chronicle:check": "bun run scripts/chronicle.ts check",
  "chronicle:index": "bun run scripts/chronicle.ts index"
}
```

## Install or repair workflow

Use this when repo lacks the tooling or user says the skill should include
scripts/structure.

1. Ensure directories exist:
   ```bash
   mkdir -p scripts/lib/chronicle docs/maps
   ```
2. Copy bundled script resources into repo:
   - `.agents/skills/chronicle/scripts/chronicle.ts` →
     `scripts/chronicle.ts`
   - `.agents/skills/chronicle/scripts/lib/chronicle/*` →
     `scripts/lib/chronicle/`
3. Copy bundled rules if missing or user wants reset:
   - `.agents/skills/chronicle/references/chronicle.rules.yaml` →
     `docs/maps/chronicle.rules.yaml`
4. Copy/update prompt doc if requested:
   - `.agents/skills/chronicle/references/legacy-ai-prompt.md` →
     `docs/maps/chronicle.skill.md`
5. AI selection is default-on conservative behavior:
   `docs/maps/chronicle.rules.yaml` should contain
   `selection.mode: "explicit"`. Empty `selection.files` means no files are
   documented. To add docs, run:
   ```bash
   bun run chronicle:select --path <source-area>
   ```
   Review printed candidate YAML, keep only files/symbols worth documenting,
   then write that allowlist into `selection.files`.
6. Add package scripts above if missing.
7. Run:
   ```bash
   bun run typecheck
   bun run chronicle:select --path packages/engine/src/modules/tasks
   bun run chronicle:scaffold --path packages/engine/src/modules/tasks
   bun run chronicle:sync --path packages/engine/src/modules/tasks
   bun run chronicle:index
   bun run chronicle:check --path packages/engine/src/modules/tasks
   ```

## Normal maintenance workflow

Default to scoped path. Do not scaffold whole repo unless user explicitly asks.

```bash
bun run chronicle:select --path <source-area>
# AI/human reviews output and writes chosen entries to docs/maps/chronicle.rules.yaml selection.files.
bun run chronicle:scaffold --path <source-area>
bun run chronicle:sync --path <source-area>
bun run chronicle:index
bun run chronicle:check --path <source-area>
```

Pilot path:

```bash
packages/engine/src/modules/tasks
```

`chronicle:check` without `--path` validates existing chronicles and global
index. With `--path`, it also fails if describable source files in that area
lack docs.

## AI selection protocol

Default policy: no file enters Chronicle just because it scores highly.
`selection.mode: "explicit"` means scripts only document entries in
`selection.files`.

When user asks to add an area:

1. Run candidate scan:
   ```bash
   bun run chronicle:select --path <source-area>
   ```
2. Read candidate source files if needed to judge importance.
3. Edit `docs/maps/chronicle.rules.yaml` and add only chosen files/symbols
   under `selection.files`.
4. Run scaffold/sync/index/check.

Use `selection.mode: "score"` only for temporary exploration or explicit
whole-repo experiments. Do not commit broad score mode unless user asked for
automatic scoring behavior.

If command files are available, use `/chronicle.select <source-area>` for
this whole workflow. Command definition lives at
`.opencode/command/chronicle.select.md`.

## Markdown contract

Each `.chron.md` uses short YAML front matter. Keep machine metadata small;
put semantic judgment in the AI block, not YAML.

```md
---
chronicle_version: 1
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
    signature_hash: "614df133636aba96"
    body_hash: "0aa48c7cf333f3ec"
---
```

`signature_hash` / `body_hash` are structural AST fingerprints stamped by
`sync`/`scaffold`. They are how Chronicle knows a documented function changed —
see "Staleness detection" below. Treat them as script-owned; never hand edit.

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

## Staleness detection (AST hashing)

Chronicle fingerprints each documented symbol with two structural hashes so it
can tell when prose has gone stale against the code it describes.

- `signature_hash` — the declaration head (name, params, return type).
- `body_hash` — the implementation (function/method/arrow body, or a const's
  initializer; falls back to the whole declaration).

Both are **structural AST hashes**, not text hashes: the scanner walks ts-morph
nodes and hashes their syntactic kinds plus identifier/literal text. Comments
and formatting are trivia (not nodes), so reflowing or commenting a function
does **not** change its hash; changing logic, identifiers, literals, or the
signature does.

`sync` and `scaffold` stamp the current hashes into front matter. `check`
recomputes them from a fresh scan and compares:

- signature mismatch → `symbol X signature changed — description likely stale`
  (high confidence: the interface moved).
- body mismatch only → `symbol X implementation changed — review description`
  (medium confidence: could be a pure refactor — glance, then re-stamp).
- missing hash (doc written before this feature) → `run chronicle:sync to stamp`.

Workflow when `check` reports drift: read the changed symbol, update its
`<!-- ai:start -->` prose if the behavior changed, then run `chronicle:sync` to
re-stamp the hash. Running `sync` blesses current code as documented, so do not
run it blindly in CI — CI should run `check` only.

Known limit: hashes catch **direct** edits to the documented symbol, not
**transitive** drift (a helper, type, or constant it depends on changing). A
green `check` means "the code you described hasn't been edited," not "the
description is still semantically perfect."

## Rules and scoring

Rules live at `docs/maps/chronicle.rules.yaml`; bundled default is
`references/chronicle.rules.yaml`.

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
bun run chronicle:scaffold --path packages/engine/src/modules/tasks
bun run chronicle:sync --path packages/engine/src/modules/tasks
bun run chronicle:index
bun run chronicle:check --path packages/engine/src/modules/tasks
bun run typecheck
```

Acceptance signs:

- scaffold repeat shows `changed=0 created=0`.
- sync repeat shows `changed=0`.
- index repeat says `fresh`.
- check catches stale generated symbol/test blocks and stale source hashes.
- non-TODO `<!-- ai:start -->` prose remains unchanged after sync.
