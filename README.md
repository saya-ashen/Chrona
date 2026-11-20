English | [中文](README.zh.md)

# Chrona

Chrona provides a general kernel, host runtime, CLI and SDK for independently maintained applications.

The kernel owns application lifecycle, tool routing, caller identity, approvals, credentials, a single Run queue, budgets, cancellation and durable timers. The host supplies local process execution and transport. The CLI starts the runtime, exposes the loopback HTTP kernel agent bridge and provides administration, diagnostics and backup commands. The SDK defines application transport and build contracts.

Application source, pages, Provider adapters, dependency bundles and release artifacts belong to their own repositories. Applications manage their own builds, releases and installation instructions. This repository and its distributions contain no default applications; starting a fresh kernel creates its database and default workspace without installing an application or calling a model.

## Run a release binary

Download and extract the archive for your platform from [GitHub Releases](https://github.com/saya-ashen/Chrona/releases). Verify it against `SHA256SUMS` and keep the extracted files together.

For the rebuilt kernel, choose a fresh data directory. From the extracted directory on Linux or macOS:

```bash
export CHRONA_DATA_DIR="$PWD/chrona-data"
export DATABASE_URL="file:$CHRONA_DATA_DIR/chrona.db"
./chrona start --no-open
```

On Windows, run the equivalent commands in PowerShell:

```powershell
$env:CHRONA_DATA_DIR = Join-Path $PWD chrona-data
$env:DATABASE_URL = "file:$env:CHRONA_DATA_DIR/chrona.db"
.\chrona.exe start --no-open
```

If you already use Chrona 0.3.x, keep its data directory and a complete backup. The rebuilt kernel requires a separate database and rejects the old schema.

Build the applications you want using their repository instructions. Place each application's complete release material in a subdirectory named after the application, such as `external/pi`. Set `CHRONA_MODULE_RESOURCES` to the absolute path of `external`. After the kernel has initialized its database, stop it and run `chrona admin install pi --request-key install-pi`. Restart Chrona to process the build. Use `chrona admin catalog` to check the receipt. If an approval is required, stop Chrona, review `chrona admin approvals`, approve the intended ID with `chrona admin approve <id>`, and restart. See [operations](docs/zh/operations.md) for recovery.

## Run from source

Requires **Bun ≥ 1.4.2**, **git**, and a native C compiler for the process guardian. Full backups also require GNU-compatible `tar`.

Use a fresh data directory:

```bash
bun install
export CHRONA_DATA_DIR="$PWD/.data/kernel-fresh"
export DATABASE_URL="file:$CHRONA_DATA_DIR/chrona.db"
bun scripts/chrona.ts build helper
bun run dev
```

`bun run dev` starts the kernel runtime in watch mode. Use `bun run server:start` without watch mode, or `chrona start --no-open` in a packaged release. The HTTP bridge listens on `127.0.0.1:3101` by default; `/health` reports runtime health. Application pages are supplied by applications installed separately.

The default SQLite database is `<dataDir>/chrona.db`; `DATABASE_URL` overrides it. Set `CHRONA_DATA_DIR` explicitly when developing or running multiple instances. `CHRONA_CONFIG_FILE` selects a configuration file; see [chrona.config.example.json](chrona.config.example.json).

Application processes use the service user's OS permissions. Kernel authorization, approvals and budgets govern routed actions; they do not isolate trusted local code from the host OS.

## Build and check

```bash
bun run verify:slice
bun run build
bun run build:smoke
```

Builds package the CLI/kernel, database migrations, SDK, runtime declarations and native process guardian under `dist/releases/`. Release smoke checks the packaged CLI and starts an empty kernel against temporary data. It requires no application, browser or model.

Applications must be built and released in their own repositories. Root install, lint, typecheck and verification commands operate on this source tree and do not restore application copies.

## Data

Stop the runtime before `chrona backup /absolute/private/path/backup.db` or `chrona restore /absolute/private/path/backup.db`. Keep the database backup and companion archive together and private. See [operations](docs/zh/operations.md) for backup contents and recovery constraints. Development checks use fresh temporary databases; there is no compatibility migration for pre-rebuild databases.

[Documentation](docs/README.md) · [Kernel API](docs/zh/kernel-api-design.md) · [Architecture](docs/zh/architecture.md) · [Contributing](CONTRIBUTING.md)

## License

[MIT](LICENSE).
