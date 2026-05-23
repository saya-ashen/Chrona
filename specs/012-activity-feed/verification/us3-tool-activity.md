# US3 Tool Activity Evidence

Result: passed in tests; browser evidence partial.

Automated coverage:

```text
Engine tests preserve tool started input/preview and tool completed duration/error/tone.
WorkspaceActivityFeed tests render started/completed/failed tool badges and expandable detail rows.
Node and task feed tests verify activity appears through shared feed surfaces.
```

Browser setup seeded provider tool activity for node `node-a` on task `cmphvgujo0007syfur415b555` and captured screenshots:

```text
specs/012-activity-feed/verification/browser/final-node-activity-desktop-1440x900.png
specs/012-activity-feed/verification/browser/final-node-activity-tablet-1024x768.png
specs/012-activity-feed/verification/browser/final-node-activity-mobile-390x844.png
```

Limitation: the seeded task page did not expose a selectable graph node in the browser because the app still showed the no-plan state. Tool detail UI is therefore verified by component tests rather than visual browser interaction.
