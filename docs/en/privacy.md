# Local privacy and data handling

Chrona is a local-first, single-user application. This document describes the data paths implemented by the current application; it is not a claim that an external AI provider has the same policy.

## Local data

Chrona stores its SQLite database, task plans, execution state, configured AI-client records, accepted results, artifacts, and imported external-calendar data on the machine running Chrona. Packaged builds use the platform data directory (or `CHRONA_DATA_DIR`); source development uses the configured `DATABASE_URL`. Configuration, including the generated `.env`, uses the platform config directory (or `CHRONA_CONFIG_DIR`).

SQLite backup and pre-upgrade recovery files are stored where you choose with `chrona backup`, or below the database `backups/pre-upgrade/` directory for automatic migration recovery. Restore markers, runtime locks, and recovery files stay next to that database. These files can contain private task and provider-related information. On POSIX systems Chrona creates new Chrona-owned data/config directories with `0700` and generated SQLite, `.env`, lock, marker, and backup files with `0600`; it never changes an existing user-selected parent directory. On Windows, Chrona removes inheritance from paths it creates, grants full control only to the current user SID and `SYSTEM`, and verifies the resulting ACL. Existing user-selected paths are audited without being rewritten; startup and `chrona doctor` fail closed if owner-only privacy cannot be verified. `chrona doctor` audits the data/config directories, database, SQLite sidecars, locks, restore artifacts, and automatic backups on every supported platform.

## External providers

Chrona sends data to an external provider only when you configure that provider and invoke an AI-backed action. Depending on the action and provider adapter, this can include the task title/description, accepted plan and active-node context, user input/approval responses, relevant prior run context, requested structured-output schema, and provider tool/control references needed to report a result. Provider output and status are returned to Chrona and persisted locally as part of task execution.

Do not configure a provider unless you accept that provider's terms and data handling. Chrona cannot prevent a configured remote provider from retaining data it receives. Remote Hermes endpoints require HTTPS; cleartext HTTP is limited to exact local loopback hosts.

## Credentials, logs, and diagnostics

Provider credentials are stored in the local Chrona configuration/database records needed to use the selected adapter. They are not sent to another provider by Chrona. Runtime run tokens are scoped to the active run and are distinct from `API_KEY` protection for the normal API.

Chrona's structured logging redacts credential-shaped fields, bearer values, URL credentials, sensitive URL query values, provider request/response bodies, and nested error causes before writing diagnostic output. Redaction reduces accidental disclosure but is not a substitute for reviewing logs before sharing them. Do not share `.env`, SQLite databases, backups, runtime locks, screenshots containing credentials, or raw provider traces.

Chrona does not include product telemetry or analytics uploads. Network traffic is limited to configured provider endpoints, explicit external-calendar sources, and user-initiated integration actions.

## External calendar data

When you add an external calendar source, Chrona fetches the source URL and stores imported event fields locally for scheduling. Calendar source URLs can themselves be sensitive. Removing a source stops it from being used by Chrona; remove local imported data through the product workflow or delete the local database only after backing up anything you need.

## Retention and deletion

Chrona retains local task, provider configuration, execution, artifact, backup, and diagnostic data until you delete it or remove the local data directory. To remove data:

1. Export or run `chrona backup <path>` for data you want to retain.
2. Stop Chrona. Confirm no process owns the database; `chrona doctor` reports a runtime lock. A confirmed stale lock can be quarantined with `chrona doctor --repair-stale-lock`; it never deletes a database.
3. Delete the selected tasks, providers, and calendar sources in Chrona, or remove the entire configured data directory and config directory for a complete local uninstall. Default locations are Linux `$XDG_DATA_HOME/chrona` (or `~/.local/share/chrona`) plus `$XDG_CONFIG_HOME/chrona` (or `~/.config/chrona`); macOS `~/Library/Application Support/chrona` plus `~/Library/Preferences/chrona`; Windows `%APPDATA%\\chrona` for both data and config.
4. Delete separately chosen backup files, pre-upgrade backups under `<data-dir>/backups/`, logs, and provider-side data according to the external provider's deletion process.

Removing Chrona's application files alone does not remove the local data/config directories or any backups you placed elsewhere.
