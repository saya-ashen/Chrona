# Research: Complete Test Coverage

## Decision: Keep Chrona's existing multi-runner testing strategy

**Rationale**: Chrona spans browser UI, Hono server, Bun-only runtime/database code, domain packages, graph runtime, providers, and e2e flows. Existing commands already separate these concerns, letting tests run at the narrowest effective level.

**Alternatives considered**: Collapse all tests into one runner. Rejected because Bun-only runtime and browser component tests have different environment needs, and a single runner would increase brittleness.

## Decision: Add tests beside owned behavior and use shared helpers only for repeated setup

**Rationale**: Co-locating tests with package behavior makes ownership clear and avoids a central test folder becoming a mixed concern. Shared builders and fixtures reduce duplication where multiple tests need the same task, plan, provider, or graph setup.

**Alternatives considered**: Create a new top-level test suite for all coverage work. Rejected because it would obscure package ownership and make impact analysis harder.

## Decision: Mock external dependencies through deterministic fakes or provider response fixtures

**Rationale**: Routine tests must not require network access, credentials, provider availability, or real user data. Deterministic fakes are best for behavior control; provider response fixtures are best for preserving external provider contract examples.

**Alternatives considered**: Live provider smoke tests in normal validation. Rejected because nondeterminism, rate limits, secrets, and network failures would make routine tests unreliable.

## Decision: Provider fixtures record provider-level response snapshots only

**Rationale**: The stable contract boundary for AI/provider replay is the provider's returned run snapshot. Recording upper-layer feature results would hide parsing and normalization bugs that tests should catch.

**Alternatives considered**: Record arbitrary business service outputs. Rejected because it bypasses production parsing behavior and creates false confidence.

## Decision: Prioritize coverage by business risk, not line percentage

**Rationale**: The user's requested coverage focuses on core behavior, key workflows, edge cases, known fragile logic, and external dependency isolation. Risk-based coverage provides better regression protection than chasing global coverage metrics.

**Alternatives considered**: Set a global coverage threshold immediately. Rejected because current value is less important than protecting critical workflows and could encourage low-value tests.

## Decision: Treat coverage summary as a required deliverable

**Rationale**: The user explicitly asked for a final summary of added tests, covered scenarios, and residual risks. A structured summary provides reviewer traceability and future planning input.

**Alternatives considered**: Rely on test names and command output only. Rejected because command output does not explain remaining risk or scenario mapping.
