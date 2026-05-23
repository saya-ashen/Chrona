# GitNexus Detect Changes

Command: `npx gitnexus detect-changes`

Result: failed in the available CLI before producing affected-scope output.

Output:

```text
npm warn exec The following package was not found and will be installed: gitnexus@1.6.5
npm error Cannot destructure property 'package' of 'node.target' as it is null.
```

Fallback scope from `git status --short`:

```text
Activity-feed implementation touched task activity contracts, engine task page/activity page mapping, server task activity route, web workspace activity model/rendering/tests, and verification artifacts.
Unrelated pre-existing worktree changes remain in .specify/feature.json, AGENTS.md, apps/server/src/__tests__/api/plan-execution-output.bun.test.ts, packages/engine/src/modules/plan-execution/ai-runtime-invoker.ts, and packages/engine/src/modules/plan-execution/node-ai-capabilities.ts.
```
