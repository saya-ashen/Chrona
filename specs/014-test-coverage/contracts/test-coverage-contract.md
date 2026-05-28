# Contract: Test Coverage Deliverables

## Coverage Inventory Contract

Before adding tests, implementation must produce or update an internal working inventory with these fields:

```text
area: string
existing_tests: string[]
covered_workflows: string[]
known_gaps: string[]
planned_action: add | reorganize | document-risk | no-change
priority: P1 | P2 | P3
```

Acceptance:

- Inventory includes frontend, server API, domain, engine/runtime, graph runtime, provider, database, and e2e areas.
- Every P1 gap maps to a test addition unless explicitly documented as a residual risk.

Verification checklist:

- Each inventory row has all six required fields: `area`, `existing_tests`, `covered_workflows`, `known_gaps`, `planned_action`, and `priority`.
- `planned_action` is one of `add`, `reorganize`, `document-risk`, or `no-change`.
- `priority` is one of `P1`, `P2`, or `P3`.
- New test files added during implementation must be reflected in the relevant inventory row before final summary.
- Any `P1` row left with `document-risk` or unresolved `known_gaps` must have a matching entry in `coverage-summary.md`.

## Provider Response Fixture Contract

Provider fixture files must represent provider-level returned snapshots.

Required fields:

```text
schemaVersion: 1
provider: string
feature: string
recordedAt: YYYY-MM-DD
request.inputHash: sha256-prefixed string
request.redactedInput: object
response.provider: string
response.runId: string
response.status: string
response.outputText?: string
response.structuredPayload?: object | null
response.error?: string | null
```

Acceptance:

- Fixture replay does not access network.
- Fixture response is provider snapshot data, not normalized business output.
- Fixture contains no secrets, real user data, local absolute paths, or chain-of-thought traces.

## Regression Evidence Contract

Each regression test must make the protected risk explicit.

Required evidence:

```text
risk: string
test_file: string
scenario: string
expected_failure_if_regressed: string
validation_command: string
```

Acceptance:

- Risk is understandable without reading implementation internals.
- Scenario is deterministic and minimal.
- Validation command is part of the documented test workflow.

## Workflow Coverage Contract

Each critical workflow test must document the workflow outcome it protects.

Required evidence:

```text
workflow: string
entry_action: string
expected_outcome: string
negative_cases: string[]
external_dependencies: fake | fixture | none
viewport_checks?: desktop | tablet | mobile
```

Acceptance:

- Task, plan, schedule, execution, provider, and navigation workflows are either covered or listed as residual risks.
- Browser-facing workflow tests include responsive expectations when applicable.

## Final Report Contract

Final implementation response must include:

```text
new_tests: string[]
changed_tests: string[]
covered_scenarios: string[]
commands_run: string[]
remaining_risks: string[]
```

Acceptance:

- Every new or changed test maps to covered scenarios.
- Remaining risks include reason and recommended next step.
- Commands run include pass/fail status and any known warnings.
