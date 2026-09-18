# Everyday Agent integration for work results

The user-authorized deployment was verified on 2026-09-17: migration, a separate
submit credential, the real Pi adapter, one external publication, idempotent
replay, attachment byte/hash readback and the Web review surface. **Human review
is still pending.** This is instance-specific evidence, not a public release or
a claim that every installation has result writes enabled.

## Newer work-page slice is not deployed

The working tree additionally supports Agent-authored declarative pages and
persistent owner notes/forms. It requires **new explicit** page capabilities;
this document's deployed `results-files-submit` token has not been widened.
See [work-page contract and isolated demo](./work-pages.md) and the repository
[page skill](../../packages/skills/chrona-pages/SKILL.md). Do not install/enroll or
migrate the live instance merely because the local implementation exists.

## Deploy safely

1. Freeze an exact source snapshot and manifest; exclude unrelated dirty changes.
   Build that snapshot, not an unreviewed working tree. Run typecheck, relevant
   result/migration tests and packaged fresh/upgrade/backup/restore smoke.
2. Identify the actual running package, database and service. Check for active
   executions before stopping it. Take a verified online backup, rehearse the
   registered migration on a copy, then take a stopped-service backup. Compare
   old data, integrity, foreign keys and target schema fingerprint.
3. Upgrade only the intended service. Explicitly set the server environment
   `CHRONA_RESULT_WRITES_ENABLED=true`; also preserve it in the next-boot config.
   Verify readiness, exact executable, write flag and data preservation.
4. Do not migrate or enroll against a guessed database. Use the instance's
   explicit `CHRONA_DATA_DIR`, `CHRONA_CONFIG_DIR` and `DATABASE_URL` with the new,
   schema-compatible CLI. Keep backups/private artifacts outside Git.

Old binaries assume non-null Artifact.runId. **Do not downgrade only the binary.**
Keep current data and recovery copies, stop the service and choose a compatible
recovery explicitly. Restoring an older backup discards newer results. Turning
writes off preserves compatible reads; it does not revert the schema.

## Enroll a separate contributor

With explicit owner approval, on the service machine:

```sh
chrona mcp enroll --name everyday-results \
  --public-url https://YOUR-CHRONA-ORIGIN --timezone YOUR-IANA-ZONE \
  --access results-files-submit --token-file /PRIVATE-DIRECTORY/results.token
```

The directory must be private (0700); the new token file is 0600. Transfer it
only through an approved private channel, never prompts, URLs or Git. Preserve
existing task/Goal credentials. Do not use `full` or `results-files-review` for
the everyday publishing Agent.

`results-files-submit` grants tasks:read, results:read/write and
artifacts:read/write. It does **not** grant task creation, execution, review or
completion. Tasks must exist; separately authorized creation uses explicit
`taskExecutionMode: manual`, `mode: todo`, not the server's planning default.

For Pi, add a separate `chrona-results` server to an appropriate config source:

```json
{
  "mcpServers": {
    "chrona-results": {
      "url": "https://YOUR-CHRONA-ORIGIN/api/mcp/management",
      "auth": "bearer",
      "bearerToken": "!cat /PRIVATE-DIRECTORY/results.token",
      "lifecycle": "lazy-keep-alive",
      "requestTimeoutMs": 30000,
      "directTools": true,
      "toolPrefix": "server",
      "includeTools": [
        "chrona_context_read", "chrona_task_search", "chrona_task_read",
        "chrona_result_read", "chrona_result_submit", "chrona_result_file"
      ]
    }
  }
}
```

Merge, do not overwrite existing servers or settings. Pi-owned overrides may
live at `~/.pi/agent/mcp.json`; shared configuration may be managed elsewhere.
Install the reviewed [result skill](../../packages/skills/chrona-results/SKILL.md)
at `~/.pi/agent/skills/chrona-results/SKILL.md`. Existing sessions need `/reload`.
Check the actual merged adapter configuration and skill loader inside and outside
the project; file existence alone is not a connection test.

## User workflow

1. Ask the Agent to perform work and save the approved outcome to a known task.
   `/skill:chrona-results` makes this explicit in Pi. It is not automatic consent
   to archive every conversation or upload unrelated files.
2. On the result connection, discover `capabilities.workResults` and effective
   scopes; lookup the task, current version and human feedback.
3. Work externally. Upload intended deliverables using begin/write/finish, then
   re-read the result revision and publish semantic content with returned AF refs.
4. Verify the exact version and file hash; return
   `/<language>/tasks/<taskId>/results` (with occurrenceId when explicitly scoped).
5. Human reviews in Web: accept, request changes or reject. The Agent does not
   review its own work. Later sessions explicitly read feedback and publish a new
   version. No automatic Agent wake or task/Goal completion occurs.

Review remains existing owner-Web authority. On a network-trusted installation
without an owner API key, every allowed network client has that owner boundary;
a restricted MCP token is not an OS/network sandbox or proof of human review.
Do not silently use owner HTTP as a scoped-token fallback. Preserve existing
network controls; public exposure needs a separately approved authentication design.

## Verification and limits

A bounded integration check should verify: no duplicate task; manual/no-automation
configuration; source attribution; one immutable version and verified attachment;
identical-request replay; unchanged task state; no Run/Plan/execution session;
visible human review controls; result token `canReview: false`. Leave acceptance
to the user rather than fabricating a human review event.

The deployed check completed those technical steps, not a real human-feedback /
external-revision cycle. Isolated E2E covers review/revision with managed execution
disabled. Existing managed execution remains enabled on the user's instance and
was not invoked by this check. Existing Run results, Goal Inbox convergence,
background wake and notifications are not added by this integration.

Exact API and quotas: [work results](./work-results.md). Product direction:
[architecture baseline](../zh/product-architecture.md).

A separate [work-records and meeting-follow-through slice](./work-records.md)
was subsequently deployed under separate user approval, including restricted
manual capture, source identity, progress receipts and a matter-first UI. It has
its own enabled write flag, new `chrona-work` Pi connection and installed skill.
The results credential remains results-only; do not infer work-capture authority
from result-publication access. The follow-up integration enrolled the existing
technical-validation Task and preserved its original result/attachment. Neither
integration performed human acceptance or real email/calendar operations.
