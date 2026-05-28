import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

export async function scanPageAccessibility(page: Page) {
  return await new AxeBuilder({ page })
    .disableRules(["color-contrast"])
    .analyze();
}

export function formatAccessibilityViolations(violations: Awaited<ReturnType<typeof scanPageAccessibility>>["violations"]) {
  return violations.map((violation) => ({
    id: violation.id,
    impact: violation.impact,
    targets: violation.nodes.flatMap((node) => node.target),
  }));
}
