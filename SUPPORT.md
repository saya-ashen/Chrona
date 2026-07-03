# Support

Chrona is alpha software. Support is best-effort and focused on reproducible bugs, setup failures, documentation gaps, and contributor questions.

## Where to ask

- Bug: open a GitHub issue with reproduction steps.
- Feature idea: open a GitHub issue describing the workflow and expected outcome.
- Hermes/provider setup: use the provider setup issue template and include diagnosis output with secrets removed.
- Security issue: follow `SECURITY.md`; do not post exploit details or secrets publicly.

## Before opening an issue

1. Check `README.md` and `docs/en/quick-start.md`.
2. Run `chrona hermes doctor` for Hermes setup problems.
3. Confirm Bun version satisfies `package.json`.
4. Remove secrets from logs and screenshots.

## Useful details

Include when relevant:

- Chrona version or commit
- OS and architecture
- Bun version
- launch command
- whether running packaged release or source checkout
- browser and viewport for UI bugs
- relevant server log excerpt with secrets redacted

## Scope

Maintainers prioritize current `main`, latest release, local-first usage, and documented Hermes/debug provider flows. Production deployment, custom network exposure, and unsupported provider integrations may need community help.
