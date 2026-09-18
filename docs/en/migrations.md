# SQLite Release Lines and Upgrade Compatibility

`prisma/migrations/release-metadata.json` is the machine-readable release boundary.
Follow [AGENTS.md](../../AGENTS.md#database-migration-policy) before schema work.
A product architecture proposal does not authorize a production upgrade.

## Current boundary

The public **v0.3.1** release shipped on 2026-09-02. Its SQL resources are immutable,
including the normalizers bundled under the released repair directory.

| Migration | Status | SHA-256 |
| --- | --- | --- |
| `0001_initial` | Released | `15b1e8b07ba6dbbd351d5e43cedebefd7ce2d0bf2ef5b465bfd241357969971d` |
| `20260707000000_add_workspace_user_preferences` | Released historical no-op | `d4a4a0ef0ec277b4ecfe94e1840d7120076e18d55dfc4901febc724dbf1bc849` |
| `20260822000000_repair_release_line` | Released in v0.3.1 | `641aa4b5907177ca6857c659a3ddb8fa8b7ed3d14c975f026ba250296e36675e` |
| `20260917000000_add_work_management` | Sole mutable, next release | Computed from current SQL |

The mutable line contains Management MCP persistence, Task/WorkBlock
configuration revisions, the manual task discriminator, Goal revision, and the
B1 work-result foundation (`TaskResult`, immutable versions, reviews, receipts,
and version-artifact links). The earlier release-boundary repair alone did not
change the application schema; B1 subsequently added those five models. The
shared application API is now mounted to authenticated Web/MCP. B2b adds nullable
Artifact Run ownership plus explicit result ownership and three private-file
models: ResultArtifactBytes, ResultFileUpload and ResultFileChunk. B3 supplies the
review UI; see [current scope](./work-results.md).

B2b also registers the B1 checksum `201a64cf…` amendment, preserving old Artifact
IDs/AF references, version bindings, acceptance and GoalAsset references across
the parent-table rebuild. `fixtures/pre-result-files.sqlite` is a pristine B1
regression fixture, pinned by `result-files-migration.bun.test.ts`, not a user DB.
All earlier known-development amendments/normalizers target the current schema.
The runner disables FK enforcement before beginning a supported parent-table
rebuild transaction, then checks all FKs and the exact target fingerprint before
commit and restores FK enforcement. Unknown schema drift still fails closed.

`migrationSchemaTransitions` pins source and target fingerprints per migration.
The historical repair remains **v0.2.0 → v0.3.1**, even after `lastReleasedVersion`
advances. The new line starts at the v0.3.1 fingerprint. Startup checks the final
fingerprint even when all migrations are already recorded; history alone does
not authorize schema drift.

### Work-page development amendment (not deployed)

The current work-page slice adds `TaskResult.inputRevision`, `WorkPageInput` and
`WorkPageCommand` without rebuilding the result parent. The exact pre-page mutable
checksum `6ade2bf65d2ee94c5ecb3cefafec9f69b4831eb66d72b5729836b044717a01a0`
has a registered additive amendment. `fixtures/pre-work-pages.sqlite` is a
pristine disposable development fixture, not live data; its checksum is pinned
by `work-pages-migration.bun.test.ts`. The pre-library work-page fingerprint is
`8184e4892c3d7dc7edff5a6f62117e34954d1b5fcae76176948e639c3c6ec4fd`.
The test preserves existing result versions, review, attachment bytes/bindings
and work records, verifies new immutable/scope guards and repeated startup.
No published migration checksum or source fingerprint is changed. See
[work-page contracts](./work-pages.md); live upgrade remains separately authorized.

### Content-library development amendment (not deployed)

The grouped-classification slice adds `LibraryState`, `LibraryGroup`,
`LibraryFolder`, `LibraryAssignment` and `LibraryCommand`. Its checksum-keyed
`3c2eeb4f…` amendment starts from the exact pre-library schema above;
`fixtures/pre-library.sqlite` is pinned by `library-migration.bun.test.ts`.
All active amendments/normalizers now target
`ed14c227f83ab0247a6b269c13bb32ae95c61b2c6981a77fd66e432b7fd82f8f`.
Released SQL, source fingerprints and earlier development fixtures remain frozen.
Tests preserve all old columns and page/result/work data, enforce group/workspace
scope and exclusivity, and verify that deleting a folder preserves content and
other classifications. Receipt guards also allow owning-workspace deletion
without relying on child-cascade order. See [content library](./content-library.md).

## Release evidence and fixtures

The v0.3.1 fixture comes from the verified public
[`chrona-linux-x64.tar.gz`](https://github.com/saya-ashen/Chrona/releases/download/v0.3.1/chrona-linux-x64.tar.gz):

- Archive SHA-256: `04ebf9c781929d868a39de08db2f783229374fccbdce0e2e20a90f4076084fb0`.
- Digest matched both the GitHub asset digest and the release's `SHA256SUMS`.
- Packaged schema and migration SQL matched tag `v0.3.1` (commit `1cde6e17`).
- `fixtures/v0.3.1-linux-x64.sqlite` was **derived in an isolated database from
  those packaged migration resources**. It is not a copied user database or a
  claim that the release executable was run. The provenance JSON records this
  distinction, resource hashes, database checksum, and schema fingerprint.
- WAL was checkpointed and the fixture uses DELETE journal mode. Fixture
  verification opens disposable copies rather than changing fixture bytes.
- Keep the v0.2.0 and legacy-development fixtures for older upgrade regressions.

The previously stale metadata labelled the released repair line mutable. The
2026-09-17 reconciliation restored its published bytes, froze its checksum,
and moved only the subsequent changes to the new line. Do not trim published
SQL's trailing blank lines to satisfy formatting tools: its byte hash is part
of the compatibility contract.

## Known development-history recovery

Some development databases already applied variants of the old repair SQL.
They cannot run the new additive SQL again. Recovery uses the existing
`legacyHistoryNormalizations` mechanism, with SQL under the **new** line:

| Source checksum prefix | Exact recognized source |
| --- | --- |
| `52535a31…` | Registered pre-amendment nine-migration legacy history |
| `b46d742f…` | Registered full nine-migration development history |
| `54c4449d…` | Management persistence, before manual task discriminator |
| `5d2fdbd1…` | Manual task discriminator, before Goal revision |
| `7ae6d8ac…` | Has the reconciliation's target schema; applies B1 additions before normalization |

Each entry pins the **entire** checksum/applied-step history, exact source schema
fingerprint, normalizer path, and file hash. Before normalization, Chrona creates
a verified pre-upgrade backup retaining the original history. SQL, foreign-key
checks, target verification, and replacement history commit together; failure
rolls back. Unknown history, changed step counts, or matching history with schema
drift are rejected. Never manually overwrite checksums to bypass these checks.

The published `641aa4b5…` checksum is **not** a mutable amendment source or a
legacy normalizer: it upgrades through the ordinary new migration.
`mutableReleaseLineAmendments` is reserved for genuinely unpublished revisions
of the new line. Its `6a646400…` entry upgrades the pre-B1 schema (`41bb15e4…`)
to work-result storage. `fixtures/pre-work-results.sqlite` preserves that exact
four-row development history for upgrade/backup/no-op/drift tests; the fixture's
checksum is pinned by `work-results-migration.bun.test.ts`. Verification rejects
a released checksum registered as an amendment source.

`fixtures/development-work-management.sql` freezes the original development
suffix for tests. Together with the released SQL it reproduces all three
post-v0.3.1 development checksums; it is not an executable migration directory.

## Continuing development

1. Confirm the public release boundary before editing SQL. Do not trust stale
   metadata over attested release resources.
2. Accumulate unreleased schema changes in `20260917000000_add_work_management`;
   do not create another directory for every feature.
3. Update its target in `migrationSchemaTransitions` and the final
   `releaseLineSchemaFingerprint`. Do not change the released transition.
4. Bring every active legacy normalizer to that same target and update its file
   hash. Keep source fingerprints and full source histories fixed. Even a
   former history-only normalizer needs actual SQL when the target evolves.
5. For an already-applied revision of the new mutable line, register a
   checksum-keyed amendment, exact source fingerprint, and file checksum. Preserve
   non-disposable data; reset only explicitly disposable test databases.
6. Prove fresh install, v0.2.0 upgrade, latest released-fixture upgrade, all
   registered development histories, repeated startup, record preservation,
   rollback, and unknown-drift rejection. Existing result/attachment/acceptance
   records and Goal asset references must survive.
7. Run `bun test packages/db/src`, `bun run typecheck`,
   `bun run check:release-consistency`, `bun run check:boundaries`, lint, and
   `bun run chrona build linux-x64` plus `bun run build:smoke` on Linux x64.

Packaged smoke exercises an isolated v0.3.1 upgrade and backup/restore. Unit tests
retain the v0.2.0 runtime-selector archive regression. Neither is authorization
to change an actual user database or deploy a release. Binary downgrade is not
proven by forward-upgrade tests; use the [backup/restore procedure](./operations.md)
with an explicitly compatible binary and an approved recovery snapshot.
