# Shadcn Config Verification

| Item | Result |
|---|---|
| `components.json` | Present at repo root. |
| UI alias | `@/components/ui` resolves to `apps/web/src/components/ui`. |
| Utils alias | `@/lib/utils` resolves to `apps/web/src/lib/utils`. |
| `cn` helper | `apps/web/src/lib/utils.ts` exports `cn(...inputs: ClassValue[])` using `clsx` and `tailwind-merge`. |
| Framework | Vite/React SPA; no Next.js patterns introduced. |
| Style/base | shadcn `base-nova` with Base UI/Radix-compatible generated primitives already present. |

Primitive generation targets are compatible with current aliases and source layout.
