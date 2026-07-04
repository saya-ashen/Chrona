# Docs asset pipeline

README and documentation screenshots are generated assets. Do not edit `generated/` by hand.

## Layout

```text
docs/assets/
  raw/          Playwright screenshots captured from Chrona
  source/       normalized inputs for optimization
  generated/    README/docs-ready assets
```

README files must reference `docs/assets/generated/*`; root-level screenshots are obsolete after migration.

## Commands

```bash
bun run assets:capture   # start isolated Chrona, seed fixtures, capture raw screenshots
bun run assets:import    # copy raw screenshots into source inputs
bun run assets:optimize  # resize/strip/compress source screenshots into generated
bun run assets:check     # verify generated files, sizes, and README references
bun run assets           # capture + import + optimize + check
```

Useful capture options:

```bash
bun run assets:capture -- --base-url http://127.0.0.1:3100  # use an existing web server
bun run assets:capture -- --no-start                        # assume default local ports are already running
bun run assets:capture -- --headed                          # show browser while capturing
bun run assets:capture -- --skip-seed                       # do not reseed fixture DB
```

Default capture uses an isolated SQLite DB at `docs/assets/.tmp/capture.db`, starts API on `127.0.0.1:3171`, starts Vite on `127.0.0.1:3170`, seeds deterministic graph fixture tasks, then captures:

- `raw/task-workspace.png`
- `raw/node-detail.png`

## Publishing rule

README files must not reference:

- `docs/assets/raw/*`
- `docs/assets/source/*`
- root-level screenshots in `docs/assets/`

Use generated paths instead:

```md
<img src="docs/assets/generated/task-workspace.png" ... />
<img src="docs/assets/generated/node-detail.png" ... />
```
