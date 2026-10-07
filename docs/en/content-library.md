# Organized content library

**Deployed to the authorized Chino instance and connected to everyday Pi on 2026-09-18.**
A separate `library-configure` credential preserves existing scopes; real adapter
reads passed. No default taxonomy was created. Classification writes were tested
in isolation, not by reorganizing the user's live content during deployment.
Approved after feedback that a recent-items feed was not an organized workspace.
This replaces that feed as the primary home, while preserving Calendar and advanced
work/execution/result controls. It is not an unrestricted filesystem or a second
Task/result hierarchy.

## Product model

- A **classification group** is a way of organizing, such as Topic or Ownership.
- A **folder** is a tag within that group. One Task has at most one folder in each
  group, and may have different folders in different groups. Missing membership is
  unclassified in that group, not globally lost content.
- All placements open the same Task and its existing result/page, notes, versions
  and schedule. New result versions do not create directory entries or move work.
- Folder/group rename keeps IDs. Folder deletion sets that group's membership to
  unclassified; it does not delete Tasks/results or other groups. Group deletion
  removes that way of organizing, never its content.
- Manual choices are protected by default, including explicitly unclassified
  choices. External organizers cannot override or unlock them. Owner can unlock
  one group explicitly. Protection survives folder deletion.
- Classifications have no lifecycle/approval semantics. “Completed” as a folder
  name does not complete a Task, accept a result or achieve a Goal.

Home `/:lang/home` shows all content, counts, classification groups, directory
browsing and bounded pagination; it does not select a few recently updated items.
`?group=ID` shows that group's folders and unclassified content; `&folder=ID` opens
one folder; `&unclassified=1` shows the group's unclassified content. Search `q` and
pagination `offset` are URL state. Names/IDs provide stable ordering instead of
an update-time feed. The sidebar uses the same group/folder directory. Mobile has
the same group selector and folder list in the main content, not a hidden desktop
sidebar as its only route. Calendar remains primary navigation.

The owner can create/edit group names, classification guidance and the permission
for Agents to create folders within it. No Topic/Ownership taxonomy is imposed by
the application. An Agent with the separately granted configuration capability
can implement a user-requested scheme; this is not permission to invent or
restructure the scheme on every save.

## Persistence and consistency

`LibraryState` holds a workspace classification revision. `LibraryGroup` and
`LibraryFolder` hold normalized unique names and descriptions/rules.
`LibraryAssignment` references the **existing Task**, with `(taskId, groupId)` as
its primary key. Nullable folder IDs retain protected unclassified choices.
SQLite scope triggers and FKs reject cross-workspace/group assignments and moves.
Folders use `SET NULL`; Task/group removal uses normal cascades. No Provider,
Plan, Run, fake result version or automatic executor is involved.

`LibraryCommand` is an immutable, actor-bound UUID/payload-hash receipt containing
the actual changes, created folder IDs/names and resulting revision. The same
request returns the same receipt; a changed payload conflicts. Transactions
reauthorize, check the workspace revision, apply all placements/folder creations,
advance the revision and save the receipt atomically. Failure rolls back the whole
organization command, including newly created folders. Concurrent writers cannot
silently overwrite one another.

The revision is `library-v1:<workspaceId>:<revision>`, starting at 0 before the
first command. It governs classification, not concurrent Task title/content edits.
Browse pages are not a frozen multi-request Task snapshot. The UI preserves drafts
on conflicts and requires an explicit reload/compare/save; unknown transport
outcomes retain their original request/UUID for identical replay.

Content publication/capture and classification are separate operations. New
content created inside a folder is captured once, then classified. If the second
operation fails, UI identifies the saved content and lets the user continue
organizing it; it does not capture again. Agent skills require the same behavior.

## Authority and transports

`CHRONA_LIBRARY_WRITES_ENABLED=true` enables organization writes; default off.
Reads remain available while disabled or the workspace is archived. Closed Tasks
can still be organized: organization never changes their content/lifecycle.

Explicit new scopes/presets only; **legacy full/read/work/results/pages presets
are unchanged**:

| Preset | Scopes |
| --- | --- |
| library-read | tasks:read, library:read |
| library-organize | tasks:read, library:read, library:organize |
| library-configure | tasks:read, library:read, library:organize, library:configure |

- `chrona_library_read`: `catalog`, `browse`, `item`, `history`. Catalog includes
  all groups and the selected group's folders. Task/occurrence result bodies and
  human inputs still require their separate capabilities.
- `chrona_library_update`: UUID + expectedRevision + one action. `assign` and
  `folder_create` require organize. Group create/update/delete and folder
  rename/delete require configure. No MCP actor/protection override exists.
- `assign.placements[]`: distinct group IDs, each with destination
  `{type:folder, folderId}`, `{type:create, name, description}` or
  `{type:unclassified}`. Omitted groups are unchanged. `protect` is owner-only.
- Creating a missing folder requires the group's `allowAgentFolders` for an
  external actor. Exact normalized-name matches reuse an existing folder;
  normalization is NFKC, trim/whitespace collapse and lowercase. Semantic synonyms
  are not automatically merged. Skills must inspect existing folders first.
- Guidance is data, not an authority grant. Capabilities and owner protection are
  enforced server-side, including fresh authorization on replay. An authorized
  organizer reports actual receipt paths/new folders, not an invented success.

Owner HTTP: `POST /api/library/read` and `/api/library/update`. Existing API-key
and trusted-origin checks are repeated in the transaction. “Owner” is authority,
not proof a human personally made the request. Management credentials do not
work as owner credentials. Network/auth redesign is not part of this slice.

Limits: 32 groups/workspace, 100 folders/group, 20,000 retained command receipts,
32 KiB request, names <=100 characters, group guidance <=2,000 and folder
explanations <=300. Browse/history <=50 entries; each entry list <=80 KiB with
actual `nextOffset` (no silent truncation). Group/folder catalogs are complete
within these enforced quotas. Receipt quota fails explicitly without pruning.

## Migration and validation

Five additive tables in the sole mutable release line. Checksum-keyed amendment
`3c2eeb4f…` starts from pre-library fingerprint `8184e489…`; released SQL bytes and
all previously recognized source fingerprints remain frozen. The pinned
`fixtures/pre-library.sqlite` is a pristine disposable fixture, not a user DB.
Fresh/upgrade tests preserve all old columns, page notes, results and records,
then exercise scope, uniqueness and folder-deletion behavior. Existing migration
fixtures and packaged release upgrade/backup/restore remain required.

Tests: engine organization/protection/CAS/replay/rollback/scope; owner HTTP and
real MCP least-privilege/revocation/default-off; dedicated
`bun run test:e2e:library` for desktop/tablet/mobile browsing, group/folder editing,
manual placement, two-group identity, delete preservation, uncertain replay,
conflict comparison, pagination, selected-folder creation and read recovery.

Final verification: 12 library browser cases across three sizes, 161 legacy E2E
passes (16 skipped), page/work/result suites, typecheck, UI foundation, boundary
and migration checks, Linux build and packaged upgrade/backup/restore smoke.
The whole-repo lint ratchet still has two unchanged-file blockers. Initial failed
runs and the final per-suite evidence are documented in the
[implementation record](../zh/content-library-implementation.md).

User workflow skill: `packages/skills/chrona-library/SKILL.md`; page authoring skill
links to it. No credential is issued or installed by this code change. Deployment,
live migration, flag activation and least-privilege enrollment require a separate
rollout decision. No background classification model, notification, external
Agent wake or provider protocol change is introduced.
