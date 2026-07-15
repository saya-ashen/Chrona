# Backup, Restore, and Local Operations

Chrona is a single-user local application. Keep the server bound to `127.0.0.1` unless you have configured `API_KEY` and trusted network controls.

## Data locations

Packaged Chrona stores its SQLite database in the platform application data directory:

- Linux: `$XDG_DATA_HOME/chrona/chrona.db` or `~/.local/share/chrona/chrona.db`
- macOS: `~/Library/Application Support/chrona/chrona.db`
- Windows: `%APPDATA%\chrona\chrona.db`

Set `CHRONA_DATA_DIR` to override the directory or `DATABASE_URL=file:/path/to/chrona.db` to select an explicit database.

## Create a backup

Chrona uses SQLite `VACUUM INTO` so the backup is consistent even when the live database uses WAL mode:

```bash
chrona backup ./chrona-backup.db
```

The command validates the resulting database before reporting success. Keep backups outside the active Chrona data directory and protect them like credentials: they can contain task context, provider configuration, execution history, and results.

## Restore a backup

Stop every Chrona process that uses the database, then run:

```bash
chrona restore ./chrona-backup.db --force
chrona start
```

Restore validates the backup before replacing the active database and removes stale WAL/SHM sidecars. It refuses to overwrite an existing database unless `--force` is supplied.

Recommended upgrade procedure:

1. Stop Chrona.
2. Run `chrona backup ./chrona-before-upgrade.db`.
3. Install the new release.
4. Run `chrona start`; bundled migrations apply automatically.
5. Verify `/api/health`, Tasks, Schedule, and the latest Task Workspace result.
6. If verification fails, stop Chrona and restore the backup with `--force`.

## Diagnostics

- Server does not start: inspect the startup error before retrying; migration checksum mismatch means the database was created with different migration SQL and should not be forced forward.
- Scheduled work did not run: inspect Dashboard and Task Workspace for disabled automation, waiting input, approval, block, provider failure, or scheduler recovery state.
- Provider unavailable: open Settings / AI Clients and run its availability check; confirm credentials, working directory, feature bindings, and local provider installation.
- Public bind refused: configure `API_KEY`, return to `HOST=127.0.0.1`, or explicitly accept the risk with `CHRONA_UNSAFE_PUBLIC_BIND=1`.

Chrona does not currently support multiple users or multiple server processes sharing one SQLite database. Do not expose it directly to the public internet.
