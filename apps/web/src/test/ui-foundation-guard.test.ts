import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// The old guard CLI was removed with the legacy UI. Guard the current W1
// surfaces directly, without depending on a deleted implementation.
describe("steward UI foundation", () => {
  it.each([
    "apps/web/src/app-shell.tsx",
    "apps/web/src/components/not-found-page.tsx",
    "features/steward/ui/composer.tsx",
    "features/steward/ui/today-page.tsx",
  ])("uses shared shadcn controls in %s", file => {
    const source = readFileSync(resolve(file), "utf8");
    expect(source).toMatch(/import\s*\{[^}]*Button[^}]*\}\s*from\s*["']@shared\/ui["']/);
    expect(source).not.toMatch(/<(?:button|input|textarea|select)\b/);
    expect(source).not.toMatch(/\b(?:buttonVariants|inputClassName|StatusBadge|SurfaceCard)\b/);
  });
});
