# US1 Pre-Edit UI Observation

Captured: 2026-05-30 before adding the calendar source setup UI.

## Note

An agent-browser pre-edit capture was run before implementing US1, but the first script wrote `specs/015-external-calendar/verification/us1-pre-ui.md` relative to the context-mode sandbox working directory instead of the repository root. The generated file was not present under `/home/saya/workspace/Chrona` when verification artifacts were checked.

The observed pre-edit schedule surface had the existing Chrona schedule layout only:

- Main heading: `Schedule`.
- Existing schedule controls: `Today`, `Tomorrow`, `Timeline`, `List`.
- Existing timeline/list content and task details sidebar.
- No `Connect external calendar` heading.
- No external calendar source name, URL, color, validation, connected-source, or imported-event count UI.

Post-edit verification with saved screenshots and interaction evidence is recorded in `specs/015-external-calendar/verification/us1-post-ui.md`.
