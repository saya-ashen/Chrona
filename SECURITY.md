# Security Policy

Chrona is an alpha local-first application. Treat local data, API keys, provider credentials, and MCP/runtime access as sensitive.

## Supported versions

Security fixes target the current `main` branch and the latest GitHub release. Older alpha releases may not receive backports.

## Reporting a vulnerability

Use GitHub private vulnerability reporting when available for this repository. If private reporting is unavailable, open a GitHub issue with a minimal description and do not include exploit details, secrets, tokens, private URLs, or database contents.

Include:

- affected version or commit
- operating system
- whether Chrona was bound to `127.0.0.1` or `0.0.0.0`
- whether `API_KEY` was configured
- impact summary

## Local deployment safety

Chrona binds to `127.0.0.1` by default. If you set `HOST=0.0.0.0`, configure `API_KEY` and put Chrona behind trusted network controls. Unsafe public bind without `API_KEY` requires explicit `CHRONA_UNSAFE_PUBLIC_BIND=1`.

Never share:

- `.env` files
- SQLite databases
- provider API keys
- Hermes gateway keys
- MCP bearer/run tokens
- raw provider request bodies
