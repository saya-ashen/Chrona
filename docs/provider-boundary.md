# Provider Boundary

This document defines the refactor target for `packages/providers/*` and
`packages/providers/foundation`.

## Core Rule

Providers are protocol adapters. They do not implement Chrona workflow
semantics.

Provider code may know:

- how to authenticate with an external provider
- how to create or resume a provider session
- how to send a request
- how to stream a response
- how to normalize provider-native output
- how to list provider-native approvals, history, and run status

Provider code must not know:

- what a Chrona task means
- what a plan node means
- when a task should retry
- how approval changes Chrona task state
- how projections, block reasons, or workflow status are derived

## Session Ownership

`session` belongs to the provider boundary.

- If the provider has a native session concept, Chrona maps to it.
- If the provider has no native session concept, the provider layer may
  virtualize one.
- The provider may store provider-native continuity state that only exists to
  talk to the upstream API.

Examples:

- provider session id
- provider-native response id
- provider-native conversation continuation token

Chrona business execution state stays above this boundary.

Examples:

- task id
- execution session id
- plan run id
- task status
- block reason

## Standard Provider Surface

All providers should converge on the same capability groups:

1. identity and capability declaration
2. session creation or virtualization
3. request execution
4. streaming execution
5. message continuation inside a session
6. run or response lookup
7. history lookup
8. approval listing and approval resolution

This surface is defined in
`packages/providers/foundation/src/contracts/provider.ts`.

## What Moved Out

The provider layer must not expose high-level methods such as
`executeTask()` that imply Chrona business orchestration.

The following logic belongs in `packages/engine` instead:

- retry policy
- polling strategy
- wait-for-completion vs fire-and-forget decisions
- approval strategy
- task and plan lifecycle transitions

## Hermes-Specific Notes

Hermes is allowed to expose Hermes-native concepts such as:

- session key
- response id
- run ref
- approval id
- history entries
- tool calls

Hermes is not allowed to expose Chrona-specific business concepts such as:

- task execution
- plan progression
- task closure semantics

## Refactor Direction

Near-term target:

1. foundation exposes only provider-neutral contracts
2. Hermes adapter exposes only session/request/response/status primitives
3. engine owns orchestration and business state transitions

This boundary intentionally breaks old abstractions that mixed provider access
with Chrona runtime orchestration.
