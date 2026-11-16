import assert from "node:assert/strict";
import { selectedTab } from "./src/system/detail";
import { pagesForApp, settingsPageForApp, settingsUnavailable } from "./src/system/registered-pages";
export function checkSettingsRules() {
  assert.equal(selectedTab("settings"), "settings");
  assert.equal(selectedTab("settings", true), "overview");
}
export function checkSettingsSpec() {
  const app = { id: "app/1", name: "example", status: "active", activeHash: "active" };
  const page = { module: "example", moduleId: app.id, id: "preferences", title: "应用偏好", purpose: "settings" as const };
  const pages = [{ ...page, moduleId: "replaced-owner" }, { ...page, module: "neighbor" }, { ...page, id: "main", purpose: undefined }, page];
  assert.equal(settingsPageForApp(pages, app), page);
  assert.equal(pagesForApp(pages, app).length, 2);
  for (const status of ["paused", "migrating"]) {
    assert.equal(settingsPageForApp(pages, { ...app, status }), undefined);
    assert.match(settingsUnavailable(pages, { ...app, status }), /恢复后/);
  }
  assert.match(settingsUnavailable(undefined, app), /正在读取/);
  assert.match(settingsUnavailable([], app), /尚未登记/);
  assert.equal(settingsPageForApp(pages, { ...app, activeHash: "" }), undefined);
}
