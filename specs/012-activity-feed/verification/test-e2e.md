# E2E Test Suite

Command: `bun run test:e2e`

Result: failed in existing unrelated flows.

Output summary:

```text
Running 8 tests using 6 workers
3 failed
5 passed (32.4s)
```

Failures observed:

```text
ai-client-settings-flow: timed out waiting for page.waitForResponse during client creation with empty name.
task-plan-generation-hermes: expected getByTestId('task-plan-graph').first() to be visible; element not found.
task-workspace-chat: timed out on locator.click in the chat-aware assistant surface flow.
```

These failures are not in the new activity-feed endpoint/model/component tests. They predate or sit outside the activity-feed implementation area.
