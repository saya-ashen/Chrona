# Baseline Command Expectations

| Command | Expected purpose | Expected dependency mode |
|---------|------------------|--------------------------|
| `bun run typecheck` | Validate TypeScript strict contracts across apps and packages | local only |
| `bun run lint` | Validate ESLint rules and ignore coverage | local only |
| `bun run test` | Run Vitest frontend/component/pure TypeScript tests | local only, jsdom |
| `bun run test:bun` | Run Bun-only package/runtime/API-adjacent tests | local SQLite/fakes/fixtures |
| `bun run test:api` | Run Hono API workflow tests | local SQLite/fakes |
| `CHRONA_LLM_FIXTURE_MODE=replay bun run test:llm:replay` | Validate provider fixture replay without live provider calls | fixture replay only |
| `bun run test:e2e:desktop` | Validate desktop browser workflow coverage | local dev server/browser |
| `bun run test:e2e:tablet` | Validate tablet browser workflow coverage | local dev server/browser |
| `bun run test:e2e:mobile` | Validate mobile browser workflow coverage and no horizontal scroll | local dev server/browser |

All routine commands must avoid live LLM providers, external network dependencies, real developer data, and local absolute path assertions.
