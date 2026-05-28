# Provider Fixture Review

## Accepted Cassette Fields

- `schemaVersion: 1`
- `provider`
- `feature`
- `recordedAt` as `YYYY-MM-DD`
- `request.inputHash` with `sha256:` prefix
- `request.redactedInput` containing only sanitized provider request fields
- `response.provider`
- `response.runId`
- `response.sessionId` when available
- `response.status`
- `response.outputText` or `response.structuredPayload`
- `response.error` as `null` or sanitized error text

## Rejected Cassette Fields

- API keys or authorization headers
- Real user prompt content unless explicitly synthetic fixture input
- Real calendar, memory, inbox, or local developer data
- Local absolute paths
- Chain-of-thought or provider reasoning traces
- Normalized business outputs from feature services above the provider boundary

## Review Decision

The existing debug chat fixture stores provider-level `ProviderRunSnapshot` data and synthetic request fields. Foundational tests will assert the cassette contract and recorder sanitization behavior so future fixtures stay safe for replay.
