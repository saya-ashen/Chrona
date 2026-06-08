---
description: AI-select source files and symbols for Chrona Feature Docs, write the explicit allowlist into rules, then scaffold/sync/index/check.
---

## User Input

```text
$ARGUMENTS
```

Use the user input as the target source area. If empty, default to:

```text
.
```

## Purpose

This command is the AI gate for Feature Docs. Do not document files
automatically from score alone. The command scans a scoped area, lets AI choose
files/symbols worth documenting, writes the explicit selection into
`docs/maps/feature-docs.rules.yaml`, then generates and validates docs.

## Required behavior

1. Load project Feature Docs skill if available:
   - `.omc/skills/feature-docs/SKILL.md`
2. Read current rules:
   - `docs/maps/feature-docs.rules.yaml`
3. Run candidate scan:
   ```bash
   bun run feature-docs:select --path <target-area>
   ```
4. Review candidate YAML and inspect source files when needed.
5. Choose only important files/symbols:
   - exported engine use cases
   - route handlers
   - provider boundaries
   - projection rebuilders
   - database-writing workflows
   - event-emitting workflows
   - graph transitions
   - public product components
6. Do not select:
   - barrel files
   - type/interface-only files
   - tests
   - small private helpers
   - files with only incidental imports/references
7. Update only the `selection` section in `docs/maps/feature-docs.rules.yaml`:
   ```yaml
   selection:
     mode: "explicit"
     files:
       - path: "path/to/source.ts"
         reason: "short-human-readable-reason"
         symbols:
           - "exportedSymbolName"
   ```
8. Preserve existing selected entries unless the source/symbol is gone or user
   explicitly asks to narrow/reset.
9. Run generation and validation:
   ```bash
   bun run feature-docs:scaffold --path <target-area>
   bun run feature-docs:sync --path <target-area>
   bun run feature-docs:index
   bun run feature-docs:check --path <target-area>
   ```
10. If scripts or rules changed while executing this command, also run:
    ```bash
    bun run typecheck
    ```

## Selection judgment

Treat `bun run feature-docs:select` output as candidate data, not final truth.
It uses deterministic scores and hints. AI must still choose. If uncertain, read
the source file and prefer not selecting the symbol.

Good reasons are stable and meaningful:

```yaml
reason: "task-management-create-use-case"
reason: "provider-boundary-runtime-client"
reason: "projection-rebuild-workflow"
```

Bad reasons are vague:

```yaml
reason: "important"
reason: "score-high"
reason: "ai-picked"
```

## Output

Report:

- target area scanned
- number of files/symbols selected
- rules file updated
- docs created/updated
- index status
- check/typecheck results

Keep output concise. Do not paste full generated YAML unless user asks.
