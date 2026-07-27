---
name: chrona-node
description: Execute a Chrona plan node. End the node by running the bundled `chrona` CLI; do not include task or node ids in shell commands.
allowed-tools: [Bash]
---

# chrona-node

You are executing one Chrona plan node. End the node by running the Chrona
control CLI (`$CHRONA_CLI` or `chrona` on your `PATH`); the engine binds
the run to your scope via the `CHRONA_RUN_TOKEN` env var (set for you at
run start; never copy it, never echo it, never pass it as a flag).

## Rules

- Do not include task, node, session, or attempt ids in your shell commands.
  Scope is fully resolved server-side from `CHRONA_RUN_TOKEN`.
- The runner sets `$CHRONA_CLI` to the absolute path of the unified `chrona`
  binary (from `@chrona/cli`). Prefer that explicit path. The launcher will
  also fall back to a globally-installed `chrona` on your `PATH`, then to
  the inlined skill-local implementation.
- Do not curl the HTTP route directly. Do not construct the bearer token
  yourself.
- `CHRONA_BASE_URL` and `CHRONA_RUN_TOKEN` are pre-set in the environment.
  Do not modify them.
## End the node

Pick the verb that matches the node type you were given in the prompt:

```sh
# Submit one semantic terminal result. --result-file is an optional JSON object
# with deliverables, findings, decisions, caveats, nextActions, and evidenceItems.
chrona node complete --summary "..." --result-file ./node-result.json

# Other terminal verbs (first one wins)
chrona node condition-select --branch <branchRef> --summary "..."
chrona node wait-complete    --summary "..."
chrona node block            --reason "..." --action-form '{...}'
chrona node fail             --error "..."
```

- Generated deliverables must be declared in `--result-file`; use only `generated://` URIs inside Chrona's generated-files root.
- Do not construct final json-render UI, download URLs, backend IDs, or file-system paths.
- The CLI exits non-zero with an actionable error if the env is missing or the engine rejects the action; read the message and adjust.

## Read-only context (optional)

```sh
chrona task read   # current task snapshot
chrona plan read   # current plan graph
```

These do not advance the node.
