# Chrona kernel

The kernel owns routed calls, caller identity, exact authorization, application lifecycle and approvals, credentials, timers, durable receipts, and the shared Agent Run queue. Application business data and policy belong to applications.

`src/index.ts` exposes the kernel's composition API. `src/api.ts` assembles the service and tool dispatch. Internal code is grouped by responsibility:

- `agent/`: generic Agent admission, Provider registration, configuration and recovery.
- `execution/`: Run admission, budgets, leases, cancellation, delivery and stop evidence.
- `modules/`: application materials, installation, activation, calls and lifecycle.
- `system/`: system tool declarations and handlers.

The server assembles the kernel with `packages/host` and Provider adapters. Kernel production code depends on contracts, domain policy, database access and SDK transport contracts; it does not import the host, Pi implementation, application business code or HTTP entry points. Tests may compose those components to exercise their behavior together.

Application conversation, memory, delivery, configuration, pages and Provider implementations live in independent application repositories. This repository carries no application source copies, fixed application releases or preinstall list; an empty kernel can start without a Provider.

See [current architecture](../../docs/zh/architecture.md) and [kernel API implementation](../../docs/zh/kernel-api-implementation.md).
