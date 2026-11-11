import { expect, test } from "bun:test";
import { describeCatalog, pageErrors } from "./pages";

test("workspace catalog exposes validated named slots", () => {
  const spec = { root: "workspace", elements: {
    workspace: { type: "Workspace", props: {}, slots: { sidebar: ["list"] }, children: ["messages"] },
    list: { type: "Text", props: { text: "会话" }, children: [] },
    messages: { type: "ScrollArea", props: { follow: true }, children: [] },
  } };
  expect(pageErrors({ spec }, new Map(), "coding")).toEqual([]);
  const description = describeCatalog();
  expect(description.components.Workspace?.slots).toEqual(["default", "sidebar"]);
  expect(description.components.Composer?.slots).toEqual(["default", "actions"]);
  expect(description.components.WorkspaceHeader?.slots).toEqual(["default"]);
  expect(description.components.Panel?.slots).toEqual(["default"]);
  expect(pageErrors({ spec: { ...spec, elements: { ...spec.elements, workspace: { ...spec.elements.workspace, slots: { hidden: ["list"] } } } } }, new Map(), "coding").join(" ")).toContain("没有这个插槽");
  expect(pageErrors({ spec: { ...spec, elements: { ...spec.elements, workspace: { ...spec.elements.workspace, slots: { sidebar: ["missing"] } } } } }, new Map(), "coding").join(" ")).toContain("存在的子组件键");
});
