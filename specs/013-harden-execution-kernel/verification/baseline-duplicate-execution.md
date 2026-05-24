# Baseline Duplicate Execution Evidence

## Command

```sh
bun test packages/engine/src/modules/plan-execution/plan-runner.task-executor.continuation.bun.test.ts
```

## Result

- Exit code: 1
- The focused continuation test file does not currently reach execution-kernel assertions in this shell because test runs require an explicit `DATABASE_URL`.

## Output Summary

```text
error: DATABASE_URL must be set explicitly in test runs.
0 pass
1 fail
1 error
Ran 1 tests across 1 files.
```

## Follow-Up

- Re-run the focused continuation tests with the repository's test database setup before using this file as behavioral baseline evidence.
- The implementation work still targets duplicate provider-side execution and overlapping advancement entry points identified in the spec.
