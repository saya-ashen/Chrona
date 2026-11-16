import assert from "node:assert/strict";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { SystemPage } from "./src/system/page";
import { SystemContext } from "./src/system/action";
import { runtimeText } from "./src/system/text";
import { checksText, incidentLabel } from "./src/system/diagnostics";
import { checkSettingsRules, checkSettingsSpec } from "./test-settings-page";
import { checkModelValues } from "./test-model-settings";
import { selectedSession, openMessages } from "./src/system/chat";
const call = async () => { throw new Error("Static rendering must not execute tools"); };
export async function checkSystemPages() {
  checkSettingsRules(); checkSettingsSpec(); checkModelValues();
  const render = (params: Parameters<typeof SystemPage>[0]["params"]) => renderToStaticMarkup(createElement(SystemContext.Provider, { value: { call, refresh: () => {} } }, createElement(SystemPage, { params })));
  assert.match(render({ name: "login", mode: "bootstrap" }), /原访问授权/);
  const error = render({ name: "error", message: "读取失败 <script>" });
  assert.match(error, /role="alert"/); assert.match(error, /&lt;script&gt;/);
  assert.match(render({ name: "settings" }), /登录密码.*内核.*应用设置/);
  for (const name of ["today", "apps"] as const) assert.match(render({ name }), /加载中/);
  assert.equal(selectedSession("/chat/new", [{ id: "s", createdAt: "now", source: "web" }]), null);
  let show = 0;
  const opened = openMessages("s", () => () => {}, async () => [{ id: "m", text: "hello", direction: "out" }], { show: items => { show = items.length; }, reply: () => {}, fail: error => { throw error; } });
  await opened.ready; assert.equal(show, 1); opened.close();
}
export function checkHealthRendering() {
  assert.equal(checksText({ tests: { count: 3, failed: 0 } }), "测试 3 项全部通过");
  assert.equal(checksText({ tests: { count: 3, failed: 1 }, smoke: "passed" }), "测试 3 项，失败 1；smoke: 通过");
  assert.match(runtimeText({ runtime: { state: "running" } }), /运行中/);
  assert.equal(incidentLabel({ attribution: "legacy-unattributed" } as Parameters<typeof incidentLabel>[0]), "旧记录（归属未知）");
}
