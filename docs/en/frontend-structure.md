# Frontend Structure (`apps/web` + `features/*`)

Chrona's web SPA is a Vite + React 19 + React Router 7 app served by
`apps/server`. Root `features/` owns product UI; `apps/web` owns browser
bootstrap, routing, app shell, shared browser infrastructure, and composition
of browser-safe feature public entrypoints. For backend placement, see
[Package Boundaries](./package-boundaries.md); for the whole system, see
[Architecture](./architecture.md).

## Entry and shell

| File | Role |
| --- | --- |
| `src/main.tsx` | App bootstrap: mounts React, providers (query client, i18n), and the router |
| `src/router.tsx` | `createBrowserRouter` route tree under a `/:lang` locale prefix; attaches per-route `loader`s |
| `src/loaders.ts` | Route data loaders that prefetch page data before composing feature pages |
| `src/pages.tsx` | Route-level composition of feature public APIs; it does not own product UI |
| `src/app-shell.tsx` | `AppShell` layout (nav/chrome) wrapping locale routes |

Routes today: `/:lang` landing, `dashboard`, `schedule`, `tasks`,
`tasks/:taskId` (task workspace), `action-center`, and `settings`. Routing is
locale-prefixed; the default locale redirects from `/`. Action Center owns the
explicit attention queue for approvals, input requests, schedule proposals,
recovery work, and notifications. Memory remains hidden until it has actionable
product value.

## Directories

| `src/components/` | App-wide shell, access/error/i18n components, and generic composition support; feature UI belongs in `features/*/ui/` |
| `src/components/ui/` | Legacy location while primitives move to `shared/ui`; use `@shared/ui` for generic controls |
| `src/hooks/` | Cross-cutting React hooks that span features (`use-ai`, `use-mobile`, `ai/`) |
| `src/lib/` | App-level browser infrastructure and compatibility clients; feature-specific clients belong with their feature |
| `src/styles/` | Global styles / Tailwind entry |
| `src/test/`, `src/__tests__/` | Test setup and app-composition tests; feature tests live with their feature |

### Feature UI

Product UI is grouped by root feature: `features/dashboard`,
`features/action-center`, `features/task-management`, `features/task-workspace`,
`features/schedule`, and the other vertical slices documented in
[Package Boundaries](./package-boundaries.md#feature-slices). Each feature
exports its supported browser API from `index.ts`; app composition and sibling
features MUST use that public entrypoint rather than feature internals. A
feature's `server.ts` is server-only and MUST NOT be imported into the Vite
browser graph. Optional `ui.ts` and `test.ts` entrypoints are browser-safe and
test-specific surfaces respectively.


## Server communication

`shared/http` owns generic browser and transport helpers: the typed API/RPC
clients, `fetch-json-event-source.ts`, access-key helpers, and compatible server
transport utilities. Features own product-specific browser clients and streaming
state. App-level compatibility clients remain under `apps/web/src/lib` only
while callers migrate; new feature code should use its feature surface or
`shared/http`.

Data flow: route `loader` (or React Query) fetches through a browser-safe
feature API or `shared/http` → feature UI renders projections → mutations call
the feature's public command API → live updates use
`shared/http/fetch-json-event-source.ts`.

## Conventions (enforced / expected)

These are the rules an agent must follow when editing the web composition layer
or a browser feature:

- **Public feature API:** compose feature UI through its `index.ts`; never
  import feature internals or server-only entrypoints into `apps/web`.
- **SSE:** use `@microsoft/fetch-event-source` through
  `shared/http/fetch-json-event-source.ts`. Do not hand-roll
  `ReadableStream`/`TextDecoder`/manual `event:`/`data:` parsing.
- **UI foundation:** use/generate shadcn primitives in `shared/ui` before
  creating custom buttons, badges, cards, fields, inputs, dialogs, etc. Chrona
  wrappers are allowed only when they add product/domain meaning.
- **No business logic in React** — workflow/state-machine logic belongs in
  features, `packages/engine`, or `packages/domain` according to its boundary.
- **i18n:** all user-facing strings live in i18n message files, not inline.
- **Responsive:** validate desktop `1440x900`, tablet `1024x768`, mobile
  `390x844`; mobile must not horizontally scroll.

## Where to start for a task

| Goal | Start here |
| --- | --- |
| Add/change a page | `router.tsx` + `loaders.ts` + the matching `features/<feature>/index.ts` public API |
| Change how the app talks to the server | `src/api.ts`, `shared/http`, or the matching feature's browser-safe API |
| Add a reusable control | `shared/ui` (shadcn) first, then compose in the feature |
| Task workspace work | `features/task-workspace/` |
