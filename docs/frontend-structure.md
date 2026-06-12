# Frontend Structure (`apps/web`)

How the Chrona web SPA is organized, so humans and agents can find the right
file without reading the whole tree. `apps/web` is a Vite + React 19 + React
Router 7 single-page app served by `apps/server`. For where frontend code
belongs versus the backend, see [Package Boundaries](./package-boundaries.md);
for the system as a whole, see [Architecture](./architecture.md).

## Entry and shell

| File | Role |
| --- | --- |
| `src/main.tsx` | App bootstrap: mounts React, providers (query client, i18n), and the router |
| `src/router.tsx` | `createBrowserRouter` route tree under a `/:lang` locale prefix; attaches per-route `loader`s |
| `src/loaders.ts` | React Router data loaders (`loadScheduleRouteData`, `loadInboxRouteData`, `loadTaskPageData`, …) that prefetch page data before render |
| `src/pages.tsx` | Top-level route page components wired in `router.tsx` |
| `src/app-shell.tsx` | `AppShell` layout (nav/chrome) wrapping all locale routes |

Routes today: `/:lang` landing, `schedule`, `inbox`, `memory`, `tasks`,
`tasks/:taskId` (task workspace), `settings`. Routing is locale-prefixed; the
default locale redirects from `/`.

## Directories

| Path | Contents |
| --- | --- |
| `src/components/` | Feature-grouped UI: `schedule`, `inbox`, `memory`, `tasks`, `work`, `settings`, `assistant-surface`, `global-ai-sidebar`, `i18n`, plus shared shell/error components |
| `src/components/ui/` | shadcn/ui primitives — the foundation for basic controls (see UI foundation rule below) |
| `src/hooks/` | Cross-cutting React hooks (`use-ai`, `use-mobile`, `ai/`) |
| `src/lib/` | Framework-agnostic client/infra code (HTTP, SSE, query client, i18n, domain action clients) |
| `src/styles/` | Global styles / Tailwind entry |
| `src/test/`, `src/__tests__/` | Test setup and app-level tests (component tests live next to components) |

### Feature component dirs

A feature dir (e.g. `components/tasks/`) is self-contained and exposes a public
`index.ts` barrel. Typical shape:

- a route-level page component (`task-list-page.tsx`, `task-workspace-page.tsx`)
- a co-located query module (`task-workspace-query.ts`)
- subfolders for internal composition (`workspace/`, `panels/`, `plan/`,
  `shared/`, `ai/`)
- `*.test.tsx` next to the component it covers

`components/work/` (the Work page execution cockpit) follows the same pattern:
page client, timeline, inspector, side panels, each with adjacent tests.

## Server communication (`src/lib`)

| File | Role |
| --- | --- |
| `api.ts` | `apiJson<T>()` typed fetch wrapper: attaches access-key headers, parses JSON, handles 401 |
| `lib/http-client.ts` / `lib/rpc-client.ts` | Shared HTTP client and the typed `hono/client` RPC client against the server `ApiType` |
| `lib/fetch-json-event-source.ts` | **The** SSE helper. All Server-Sent Events go through it (see SSE rule) |
| `lib/query-client.ts` | TanStack Query client; pages read via React Query, loaders prefetch |
| `lib/access-key.ts` | Access-key header construction and unauthorized handling |
| `lib/task-actions-client.ts`, `lib/external-calendar-client.ts`, `lib/schedule-ai-preferences.ts`, `lib/recurrence-presets.ts` | Domain-specific command/query clients |
| `lib/i18n/` | Locale messages and translation helpers |
| `lib/logger.ts`, `lib/router.ts`, `lib/utils.ts` | Logging, route helpers, misc utilities |

Data flow: route `loader` (or React Query) fetches via `api.ts`/RPC →
components render projections → mutations dispatch through `lib/*-client.ts` →
live updates arrive over SSE through `fetch-json-event-source.ts`.

## Conventions (enforced / expected)

These are the rules an agent must follow when editing `apps/web` (mirrored from
`AGENTS.md`):

- **SSE:** use `@microsoft/fetch-event-source` via `lib/fetch-json-event-source.ts`.
  Do not hand-roll `ReadableStream`/`TextDecoder`/manual `event:`/`data:` parsing.
- **UI foundation:** use/generate shadcn primitives in `components/ui` before
  creating custom buttons, badges, cards, fields, inputs, dialogs, etc. Chrona
  wrappers are allowed only when they add product/domain meaning. Run
  `bun run check:ui-foundation` before accepting UI foundation changes.
- **No business logic in components** — workflow/state-machine logic belongs in
  `packages/engine`, not React.
- **i18n:** all user-facing strings live in i18n message files, not inline.
- **Responsive:** validate desktop `1440x900`, tablet `1024x768`, mobile
  `390x844`; mobile must not horizontally scroll.

## Where to start for a task

| Goal | Start here |
| --- | --- |
| Add/change a page | `router.tsx` + `loaders.ts` + the matching `components/<feature>/` dir |
| Change how the app talks to the server | `src/api.ts`, `lib/rpc-client.ts`, `lib/fetch-json-event-source.ts` |
| Add a reusable control | `components/ui/` (shadcn) first, then compose in the feature |
| Task workspace / Work page work | `components/tasks/workspace/`, `components/work/` |
