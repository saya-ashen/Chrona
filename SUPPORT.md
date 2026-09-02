# Support

Chrona is alpha software. Support is best-effort and focused on reproducible bugs, setup failures, documentation gaps, and contributor questions.

## Where to ask

- Bug: open a GitHub issue with reproduction steps.
- Feature idea: open a GitHub issue describing the workflow and expected outcome.
- Provider setup: use the provider setup issue template and include the availability result or diagnosis output with secrets removed.
- Security issue: follow `SECURITY.md`; do not post exploit details or secrets publicly.

## Before opening an issue

1. Check `README.md`, `docs/en/quick-start.md`, and `docs/en/privacy.md`.
2. Run `chrona doctor` for local database, lock, permissions, and bind safety.
3. In `Settings -> AI Clients`, run the configured client's availability check. Codex, OMP, and Claude Code are the released providers; Hermes remains hidden.
4. If running from source, confirm Bun satisfies the version in `package.json`. Packaged releases do not require Bun.
5. Remove secrets from logs and screenshots.

## Useful details

Include when relevant:

- Chrona version or commit
- OS and architecture
- Bun version when running from source
- launch command
- whether running packaged release or source checkout
- browser and viewport for UI bugs
- relevant server log excerpt with secrets redacted

## Scope

Maintainers prioritize current `main`, the latest release, local-first usage, and the released Codex, OMP, and Claude Code provider flows. Production deployment, custom network exposure, hidden/internal providers, and unsupported integrations may need community help.
