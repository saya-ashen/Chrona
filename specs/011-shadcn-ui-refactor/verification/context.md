# Implementation Context

- Branch: `011-shadcn-ui-refactor`
- Feature directory: `specs/011-shadcn-ui-refactor`
- Stack: Vite + React 19 SPA in `apps/web/`, Hono API server in `apps/server/`, Bun runtime, TypeScript strict.
- Scope constraint: frontend UI foundation refactor only. Backend APIs and data contracts are unchanged.
- UI foundation: shadcn/ui primitives in `apps/web/src/components/ui` are the default for basic controls.

## Project Setup Verification

| Check | Result |
|---|---|
| Git repo | `.git` detected. `.gitignore` exists. |
| Node/TypeScript | `package.json` exists. `.gitignore` covers `node_modules/`, `dist/`, logs, env files, and common editor/temp files. |
| Docker | `Dockerfile` and `.dockerignore` exist. `.dockerignore` covers `node_modules/`, `.git/`, `Dockerfile*`, `.dockerignore`, logs, env files, and `coverage/`. |
| ESLint | `eslint.config.mjs` exists with `globalIgnores` for `node_modules`, `dist`, `build`, `coverage`, and `*.min.js`. |
| Prettier | No `.prettierrc*` detected; no `.prettierignore` required. |
| npm publish | Package `files` list controls npm contents; no `.npmignore` required for this task. |
| Terraform | No `*.tf` detected. |
| Helm | No chart files detected. |
