# Backup, Restore, and Local Operations

Chrona is a single-user local application. Keep the server bound to `127.0.0.1` unless you have configured `API_KEY` and trusted network controls.

## Data locations

Packaged Chrona stores its SQLite database in the platform application data directory:

- Linux: `$XDG_DATA_HOME/chrona/chrona.db` or `~/.local/share/chrona/chrona.db`
- macOS: `~/Library/Application Support/chrona/chrona.db`
- Windows: `%APPDATA%\chrona\chrona.db`

Configuration is separate from the database: Linux uses `$XDG_CONFIG_HOME/chrona` or `~/.config/chrona`; macOS uses `~/Library/Preferences/chrona`; Windows uses `%APPDATA%\\chrona`. Set `CHRONA_DATA_DIR` or `CHRONA_CONFIG_DIR` to override these directories, or `DATABASE_URL=file:/path/to/chrona.db` to select an explicit database. Backups chosen with `chrona backup` are stored at the path you provide; automatic pre-upgrade backups and recovery artifacts stay under the data directory beside the selected database.

On Windows, Chrona creates its own data/config/backup directories with inheritance removed and grants full control only to the current user SID and `SYSTEM`; generated `.env`, SQLite, WAL/SHM, lock, backup, and restore files receive the same verified ACL. `chrona doctor` audits those ACLs. Chrona never rewrites an existing custom directory or database ACL: an existing `CHRONA_DATA_DIR`, `CHRONA_CONFIG_DIR`, or `DATABASE_URL` path must already be private to the current user and `SYSTEM`, otherwise startup fails closed. Use an empty directory for a new custom path or secure the existing one before use.

## Create a backup

Chrona uses SQLite `VACUUM INTO` so the backup is consistent even when the live database uses WAL mode:

```bash
chrona backup ./chrona-backup.db
```

The command validates the resulting database before reporting success. Chrona keeps a runtime lock while it is serving this database; backup remains safe online because it uses SQLite `VACUUM INTO`. Keep backups outside the active Chrona data directory and protect them like credentials: they can contain task context, provider configuration, execution history, and results.

## Restore a backup

Stop every Chrona process that uses the database, then run:

```bash
chrona restore ./chrona-backup.db --force
chrona start
```

Restore refuses to run while Chrona owns the database. It validates the backup, stages the replacement beside the active database, retains a verified `pre-restore` recovery copy until you remove it, retires the active main database before its WAL sidecars, and uses a recovery marker so an interrupted restore recovers the verified pre-restore snapshot on the next `chrona start` or `chrona restore`. It refuses to overwrite an existing database unless `--force` is supplied.

Recommended upgrade procedure:

1. Stop Chrona.
2. Run `chrona backup ./chrona-before-upgrade.db`.
3. Install the new release.
4. Run `chrona start`; before any pending migration or registered legacy-history normalization, Chrona creates and validates a bounded automatic recovery point under `backups/pre-upgrade/` beside the database.
5. Verify `/api/health`, Tasks, Schedule, and the latest Task Workspace result.
6. If verification fails, stop Chrona and restore either your manual backup or the newest automatic recovery point with `--force`.

## Diagnostics

- Server does not start: inspect the startup error before retrying. A running-process/maintenance-lock error means another Chrona instance still owns the database; stop it before retrying. Migration checksum mismatch means the database was created with different migration SQL and should not be forced forward. The public v0.2.0 baseline contains the exact historical `20260707000000_add_workspace_user_preferences` no-op history row (`applied_steps_count = 0`); Chrona recognizes only that registered checksum/rule and rejects all other duplicate-object or history drift.
- Scheduled work did not run: inspect Dashboard and Task Workspace for disabled automation, waiting input, approval, block, provider failure, or scheduler recovery state.
- Provider unavailable: open Settings / AI Clients and run its availability check; confirm credentials, working directory, feature bindings, and local provider installation.
- Public bind refused: configure `API_KEY`, return to `HOST=127.0.0.1`, or explicitly accept the risk with `CHRONA_UNSAFE_PUBLIC_BIND=1`.

Chrona does not currently support multiple users or multiple server processes sharing one SQLite database. Do not expose it directly to the public internet.
