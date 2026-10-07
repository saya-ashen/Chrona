import { expect, it } from "vitest";
import en from "@chrona/i18n/messages/en.json";
import { controlPlaneNavigation } from "./control-plane-navigation";
it("keeps calendar primary and every advanced tool discoverable", () => {
  const { navItems, advancedNavItems } = controlPlaneNavigation("/home", en);
  expect(navItems.map((item) => item.href)).toEqual(["/home", "/schedule", "/action-center"]);
  expect(advancedNavItems.map((item) => item.href)).toEqual(["/dashboard", "/work", "/goals", "/tasks", "/settings"]);
});
