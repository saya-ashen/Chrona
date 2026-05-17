# Orchestrator Test Support

Shared fixtures in this directory should build deterministic orchestration test
state for leases, graph versions, graph mutations, scheduler events, active
runs, and reconciliation inputs.

Keep fixtures small and explicit so tests can verify idempotency, ownership,
repair decisions, and event redaction without relying on production schedulers.
