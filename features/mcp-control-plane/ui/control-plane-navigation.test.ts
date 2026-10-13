import { expect, it } from "vitest";
import en from "@chrona/i18n/messages/en.json";
import zh from "@chrona/i18n/messages/zh.json";
import { controlPlaneNavigation } from "./control-plane-navigation";
it.each([en, zh])("puts steward first and keeps legacy tools discoverable", messages => {
  const { navItems, advancedNavItems } = controlPlaneNavigation("/affairs/affair-1", messages);
  expect(navItems.map(item => item.href)).toEqual(["/today", "/affairs", "/schedule", "/delegations", "/connections"]);
  expect(navItems.map(item => item.label)).toEqual([messages.steward.today, messages.steward.affairs, messages.nav.schedule, messages.steward.delegations, messages.steward.connections]);
  expect(navItems.filter(item => item.active).map(item => item.href)).toEqual(["/affairs"]);
  expect(advancedNavItems.map(item => item.href)).toEqual(["/dashboard", "/work", "/goals", "/tasks", "/home", "/action-center", "/settings"]);
});
it("keeps task detail navigation in the legacy workspace", () => {
  const nav = controlPlaneNavigation("/tasks/task-1", en);
  expect(nav.navItems.some(item => item.active)).toBe(false);
  expect(nav.advancedNavItems.find(item => item.active)?.label).toBe(en.nav.tasks);
});
