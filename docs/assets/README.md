# Docs asset pipeline

README and documentation media are generated assets. Do not edit `generated/` by hand.

## Layout

```text
docs/assets/
  raw/          Playwright screenshots captured from Chrona
  source/       normalized screenshot inputs
  generated/    README-ready PNG and animated GIF assets
  .tmp/         isolated database, logs, and WebM masters (ignored)
```

README files must reference `docs/assets/generated/*`. Raw screenshots, source inputs, recordings, local databases, and root-level screenshots are not publishing artifacts.

The pipeline requires Playwright Chromium, `ffmpeg`, and ImageMagick's `magick` command.

## Commands

```bash
bun run assets:capture   # capture deterministic English screenshots
bun run assets:motion    # record and optimize deterministic English README animations
bun run assets:import    # copy raw screenshots into source inputs
bun run assets:optimize  # resize, strip, and compress screenshot inputs
bun run assets:check     # verify references, dimensions, animation, and size limits
bun run assets           # regenerate and validate every README asset
```

Useful capture options:

```bash
bun run assets:motion -- --base-url http://127.0.0.1:3100  # use a prepared server
bun run assets:motion -- --no-start                        # use default local capture ports
bun run assets:motion -- --headed                          # show the recording browser
bun run assets:motion -- --skip-seed                       # keep an existing fixture DB
```

The default pipeline uses an isolated SQLite database at `docs/assets/.tmp/capture.db`, starts the API on `127.0.0.1:3171`, starts Vite on `127.0.0.1:3170`, and seeds deterministic documentation fixtures.

Motion capture records the English UI at `1440x900`, adds English guide captions and a visible cursor, keeps WebM masters under `.tmp/`, then uses ffmpeg palette optimization to publish:

- `generated/task-workflow.gif` — task discovery, plan progress, node inspection, and execution trace
- `generated/result-review.gif` — result evidence, confirmation, and accepted-result state

## Publishing rules

README files must not reference:

- `docs/assets/raw/*`
- `docs/assets/source/*`
- `docs/assets/.tmp/*`
- root-level screenshots in `docs/assets/`

Use generated paths instead:

```md
<img src="docs/assets/generated/task-workflow.gif" ... />
<img src="docs/assets/generated/result-review.gif" ... />
```

Only deterministic, reviewed, English-language demo media belongs in `generated/`. Never publish browser profiles, HAR files, provider credentials, real task data, or raw recordings.
