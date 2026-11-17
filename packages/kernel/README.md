# Chrona kernel

The kernel owns routed calls, caller identity, exact authorization, application lifecycle and approvals, credentials, timers, durable receipts, and the shared Agent Run queue. Application business data and policy belong to applications.

`src/index.ts` exposes the kernel's composition API. `src/api.ts` assembles the service and tool dispatch. Internal code is grouped by responsibility:

- `agent/`: generic Agent admission, Provider registration, configuration and recovery.
- `execution/`: Run admission, budgets, leases, cancellation, delivery and stop evidence.
- `modules/`: application materials, installation, activation, calls and lifecycle.
- `system/`: system tool declarations and handlers.

The server assembles the kernel with `packages/host` and Provider adapters. Kernel production code depends on contracts, domain policy, database access and SDK transport contracts; it does not import the host, Pi implementation, application business code or HTTP entry points. Tests may compose those components to exercise their behavior together.

Shared conversation, memory and delivery sources live in `packages/app-common`. Independent application inputs are restored to `.generated/applications`; they are not kernel source.

See [current architecture](../../docs/zh/architecture.md) and [kernel API implementation](../../docs/zh/kernel-api-implementation.md).
