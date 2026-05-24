# GitNexus Detect Changes

Command attempted: `npx gitnexus --help`

Result: BLOCKED.

The configured GitNexus skill path is missing in this checkout, and the CLI invocation failed before any detect-changes command could run:

```text
npm warn exec The following package was not found and will be installed: gitnexus@1.6.5
npm error Cannot destructure property 'package' of 'node.target' as it is null.
```

No commit was requested. Re-run GitNexus detect changes before committing if the CLI/skill is restored.
