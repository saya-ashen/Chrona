import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { describe, expect, it } from "vitest";

import {
  findUiFoundationViolations,
  formatViolations,
} from "../../../../scripts/check-ui-foundation.mjs";

function createFixture(files: Record<string, string>) {
  const root = mkdtempSync(path.join(tmpdir(), "chrona-ui-foundation-"));

  for (const [relativePath, content] of Object.entries(files)) {
    const filePath = path.join(root, relativePath);
    mkdirSync(path.dirname(filePath), { recursive: true });
    writeFileSync(filePath, content);
  }

  return root;
}

describe("UI foundation guard", () => {
  it("allows official shadcn buttonVariants only inside generated button source", () => {
    const root = createFixture({
      "apps/web/src/components/ui/button.tsx":
        "const buttonVariants = cva(''); export { buttonVariants };",
      "apps/web/src/components/example.tsx":
        "import { Button } from '@/components/ui/button'; export function Example() { return <Button />; }",
    });

    expect(findUiFoundationViolations(root)).toEqual([]);
  });

  it("flags removed primitives and reusable field class helpers in consumers", () => {
    const root = createFixture({
      "apps/web/src/components/example.tsx": [
        "import { StatusBadge } from '@/components/ui/status-badge';",
        "import { SurfaceCard } from '@/components/ui/surface-card';",
        "import { inputClassName } from '@/components/ui/field';",
        "import { buttonVariants } from '@/components/ui/button';",
        "export const value = buttonVariants({ variant: 'default' });",
      ].join("\n"),
    });

    const violations = findUiFoundationViolations(root);
    const report = formatViolations(violations);

    expect(report).toContain("legacy status badge import");
    expect(report).toContain("legacy surface card import");
    expect(report).toContain("legacy field class helper");
    expect(report).toContain("consumer buttonVariants usage");
  });
});
